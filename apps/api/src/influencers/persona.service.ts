import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  CreatorBriefSchema,
  InfluencerFieldsSchema,
  PersonaOutputSchema,
  type CreatorBrief,
  type JobDto,
  type PersonaOutput,
} from '@reel/shared';
import { JobsService } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { InfluencersService } from './influencers.service';
import { personaOf } from './influencer.mapper';

export const PERSONA_DRAFT_JOB = 'persona.draft';
export const PERSONA_REGENERATE_JOB = 'persona.regenerate';

/** Same shape as the structured output, plus the checks the JSON schema can't express. */
const PersonaChecked = PersonaOutputSchema.superRefine((persona, ctx) => {
  const result = InfluencerFieldsSchema.safeParse(normalizePersona(persona));
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

/** Small fixes that shouldn't cost a retry: hashtag prefix, stray whitespace, empty list items. */
export function normalizePersona(persona: PersonaOutput): PersonaOutput {
  const clean = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);
  const tag = persona.hashtag.trim().replace(/\s+/g, '');
  return {
    ...persona,
    hashtag: tag.startsWith('#') ? tag : `#${tag}`,
    signatureDetails: clean(persona.signatureDetails),
    forbiddenFeatures: clean(persona.forbiddenFeatures),
    exampleLines: clean(persona.exampleLines),
    conditionalFeatures: persona.conditionalFeatures.filter((c) => c.feature.trim() && c.rule.trim()),
  };
}

const DraftPayload = z.object({ brief: CreatorBriefSchema });
const RegeneratePayload = z.object({ influencerId: z.string(), instruction: z.string().optional() });

/** Character creator, step 1: brief → persona (Haiku), stored as a draft influencer. */
@Injectable()
export class PersonaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly influencers: InfluencersService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: PERSONA_DRAFT_JOB,
      group: 'llm',
      payload: DraftPayload,
      run: async ({ brief }, ctx) => {
        await ctx.progress(0.1, 'Writing persona');
        const persona = await this.generate(brief);
        await ctx.progress(0.9, 'Saving draft');
        const created = await this.influencers.create({ ...persona, status: 'draft' }, brief);
        return { influencerId: created.id };
      },
    });

    this.jobs.register({
      type: PERSONA_REGENERATE_JOB,
      group: 'llm',
      payload: RegeneratePayload,
      run: async ({ influencerId, instruction }, ctx) => {
        const current = await this.prisma.influencer.findUnique({ where: { id: influencerId } });
        if (!current) throw new Error('Influencer no longer exists');
        await ctx.progress(0.1, 'Rewriting persona');
        const brief = CreatorBriefSchema.safeParse(current.creatorBrief);
        const { slug: _slug, status: _status, creatorBrief: _brief, id: _id, createdAt: _c, updatedAt: _u, ...fields } = current;
        const persona = await this.generate(brief.success ? brief.data : null, {
          current: { ...fields, ...personaOf(current) },
          instruction,
          influencerId,
        });
        await this.influencers.update(influencerId, persona);
        return { influencerId };
      },
    });
  }

  draft(brief: CreatorBrief): Promise<JobDto> {
    return this.jobs.enqueue(PERSONA_DRAFT_JOB, { brief });
  }

  async regenerate(influencerId: string, instruction?: string): Promise<JobDto> {
    const exists = await this.prisma.influencer.count({ where: { id: influencerId } });
    if (!exists) throw new NotFoundException('Influencer not found');
    return this.jobs.enqueue(PERSONA_REGENERATE_JOB, { influencerId, instruction });
  }

  private async generate(
    brief: z.output<typeof CreatorBriefSchema> | null,
    revise?: { current: Record<string, unknown>; instruction?: string; influencerId: string },
  ): Promise<PersonaOutput> {
    const others = await this.prisma.influencer.findMany({
      where: revise ? { id: { not: revise.influencerId } } : {},
      orderBy: { createdAt: 'asc' },
    });
    const example = others.find((o) => o.slug === 'aanya-kapoor') ?? others[0];
    const system = this.prompts.render('persona', {
      exampleIdentity: example?.identityBlock ?? '(none yet)',
      existingCharacters: others.length
        ? others.map((o) => `- ${o.name}, ${o.age}, ${o.city}: ${o.shortIdentity}`).join('\n')
        : '(none yet)',
    });

    const parts: string[] = [];
    if (brief) {
      parts.push(
        'Brief:',
        `- Name: ${brief.name || '(choose one)'}`,
        `- Age: ${brief.age}`,
        `- City / region: ${brief.city}`,
        `- Lane / niche: ${brief.lane}`,
        `- Vibe: ${brief.vibe}`,
        `- Look notes: ${brief.lookNotes || '(none)'}`,
        `- Voice and language: ${brief.voiceLanguage}`,
        `- Must have: ${brief.mustHave || '(none)'}`,
        `- Must avoid: ${brief.mustAvoid || '(none)'}`,
      );
    }
    if (revise) {
      parts.push(
        '',
        'Current persona (JSON):',
        JSON.stringify(revise.current, null, 2),
        '',
        revise.instruction
          ? `Revise it following this instruction, and keep everything the instruction doesn't mention identical: ${revise.instruction}`
          : 'Write an improved version that keeps the same person (same face, name and background) but is more specific and more consistent for image generation.',
      );
    } else {
      parts.push('', 'Create the persona.');
    }

    const result = await this.llm.call({
      task: revise ? 'persona_regenerate' : 'persona_draft',
      schema: PersonaChecked,
      system: [system],
      content: [{ type: 'text', text: parts.join('\n') }],
      influencerId: revise?.influencerId,
    });
    return normalizePersona(result.data);
  }
}
