import { VersionPickService } from '../llm/version-pick.service';
import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  imageReviewChecked,
  type CheckGroup,
  type ChecklistItemDto,
  type ImageReviewOutput,
  type JobDto,
  type ReviewIssue,
} from '@reel/shared';
import { toJson } from '../common/json';
import { JobsService } from '../jobs/jobs.service';
import { LlmService, type LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AssetContextService, type AssetContext } from './asset-context.service';
import { EditPromptError, buildEditPrompt, candidateList, type StoredEditPrompt } from './edit-prompt';
import { adjustVerdict, aspectIssue, faceZoneIssue } from './review-checks';

export const REVIEW_JOB = 'asset.review';
const ReviewPayload = z.object({ assetId: z.string() });
const SEVERITY_RANK = { critical: 0, major: 1, minor: 2 } as const;

/** Flattens the model's grouped checks into the stored checklist. */
export function flattenChecklist(out: ImageReviewOutput, ctx: Pick<AssetContext, 'kind' | 'mustMatch'>): ChecklistItemDto[] {
  const rows = (group: CheckGroup, checks: ImageReviewOutput['identity']) =>
    checks.map((c) => ({ group, item: c.item, result: c.result, note: c.note }));
  return [
    ...rows('identity', out.identity),
    ...out.garment.map((g) => ({
      group: 'garment' as const,
      item: ctx.mustMatch.find((m) => m.key === g.key)?.label ?? g.key,
      result: g.result,
      note: g.note,
    })),
    ...rows('anatomy', out.anatomy),
    ...rows('artefacts', out.artefacts),
    ...rows(ctx.kind === 'creator' ? 'framing' : 'composition', out.composition),
  ];
}

/** Step 4 review: one generated image against the references, the product and the must-match list. */
@Injectable()
export class ReviewService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly settings: SettingsService,
    private readonly context: AssetContextService,
    private readonly versionPick: VersionPickService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: REVIEW_JOB,
      group: 'llm',
      payload: ReviewPayload,
      run: async ({ assetId }, ctx) => {
        await ctx.progress(0.1, 'Comparing with the references');
        const reviewId = await this.review(assetId);
        return { assetId, reviewId };
      },
    });
  }

  async start(assetId: string): Promise<JobDto> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return this.jobs.enqueue(REVIEW_JOB, { assetId }, { projectId: asset.projectId });
  }

  private async review(assetId: string): Promise<string> {
    const ctx = await this.context.forAsset(assetId);
    const { asset } = ctx;
    const keys = ctx.candidates.map((c) => c.key);

    const content: LlmPart[] = [
      { type: 'text', text: ctx.ownerText },
      { type: 'image', path: asset.path, label: `IMAGE UNDER REVIEW (version ${asset.version}, ${asset.width}×${asset.height} px):` },
      ...(ctx.compareImages.length
        ? [{ type: 'text' as const, text: 'Compare it with these:' }, ...ctx.compareImages]
        : []),
      {
        type: 'text',
        text: [
          ctx.mustMatchKeys.length
            ? `Score every must-match key in "garment": ${ctx.mustMatchKeys.join(', ')}.`
            : 'The product is not in frame (or not relevant): return an empty "garment" list.',
          '',
          'Reference keys you can attach in fixes:',
          candidateList(ctx.candidates),
          '',
          'Review the image under review.',
        ].join('\n'),
      },
    ];

    const result = await this.llm.call({
      task: ctx.reviewTask,
      modelKind: 'review',
      schema: imageReviewChecked({ mustMatchKeys: ctx.mustMatchKeys, attachKeys: keys }),
      system: [this.prompts.render(ctx.reviewPrompt), ...ctx.contextBlocks],
      content,
      projectId: ctx.projectId,
      influencerId: ctx.influencerId,
    });
    const out = result.data;

    // Checks the app can do exactly, added on top of the model's judgement.
    const added: ReviewIssue[] = [];
    const aspect = aspectIssue(asset.width, asset.height, ctx.expectedAspect);
    if (aspect && !out.issues.some((i) => /aspect ratio/i.test(i.description))) added.push(aspect);
    if (ctx.checkFaceZone) {
      const zone = await this.settings.get('overlay.safeZone');
      const face = faceZoneIssue(out.faceBox, zone);
      if (face) added.push(face);
    }

    const fixes: StoredEditPrompt[] = [];
    const notes: string[] = [];
    for (const plan of out.fixes) {
      try {
        fixes.push(
          buildEditPrompt(
            { persona: ctx.persona, edited: { id: asset.id, path: asset.path }, plan, candidates: ctx.candidates, maxRefs: ctx.maxRefs[plan.tool], noPerson: ctx.frame?.tag === 'background' },
            this.prompts,
          ),
        );
      } catch (error) {
        if (!(error instanceof EditPromptError)) throw error;
        notes.push(`A suggested fix was dropped: ${error.message}`);
      }
    }

    const review = await this.prisma.review.create({
      data: {
        assetId,
        verdict: adjustVerdict(out.verdict, added),
        summary: [out.summary, ...notes].join(' ').trim(),
        checklist: toJson(flattenChecklist(out, ctx)),
        issues: toJson([...out.issues, ...added].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])),
        fixPrompts: toJson(fixes),
        model: result.model,
        llmCallId: result.callId,
      },
    });
    if (asset.sceneId) await this.versionPick.refreshScene(asset.sceneId);
    return review.id;
  }
}
