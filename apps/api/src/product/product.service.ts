import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  GarmentParagraphChecked,
  MustMatchItemSchema,
  ProductAnalysisChecked,
  ProductSpecSchema,
  hasPlaceholder,
  type JobDto,
  type ProductSpecDto,
  type ProductSpecSave,
} from '@reel/shared';
import type { ProductSpec as ProductSpecRow } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { JobsService } from '../jobs/jobs.service';
import { LlmService, type LlmPart } from '../llm/llm.service';
import { PromptService } from '../llm/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { sortProductImages } from '../projects/project.mapper';

export const ANALYZE_JOB = 'product.analyze';
export const PARAGRAPH_JOB = 'product.paragraph';

const AnalyzePayload = z.object({ projectId: z.string(), instruction: z.string().optional() });
const ParagraphPayload = z.object({ projectId: z.string(), instruction: z.string().optional() });

export function toSpecDto(row: ProductSpecRow): ProductSpecDto {
  return {
    id: row.id,
    projectId: row.projectId,
    spec: ProductSpecSchema.parse(row.spec),
    mustMatch: readJson(z.array(MustMatchItemSchema), row.mustMatch, []),
    unknowns: readJson(z.array(z.string()), row.unknowns, []),
    garmentParagraph: row.garmentParagraph,
    version: row.version,
    editedByUser: row.editedByUser,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Step 2: product photos → ProductSpec, must-match checklist, unknowns and the garment paragraph. */
@Injectable()
export class ProductService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly llm: LlmService,
    private readonly prompts: PromptService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      type: ANALYZE_JOB,
      group: 'llm',
      payload: AnalyzePayload,
      run: async ({ projectId, instruction }, ctx) => {
        await ctx.progress(0.05, 'Reading product photos');
        const spec = await this.analyze(projectId, instruction);
        await this.projects.reach(projectId, 'product_analyzed');
        return { specId: spec.id, version: spec.version };
      },
    });
    this.jobs.register({
      type: PARAGRAPH_JOB,
      group: 'llm',
      payload: ParagraphPayload,
      run: async ({ projectId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Writing garment paragraph');
        const spec = await this.rewriteParagraph(projectId, instruction);
        return { specId: spec.id };
      },
    });
  }

  async get(projectId: string): Promise<ProductSpecDto | null> {
    const row = await this.prisma.productSpec.findUnique({ where: { projectId } });
    return row ? toSpecDto(row) : null;
  }

  async startAnalysis(projectId: string, instruction?: string): Promise<JobDto> {
    const project = await this.projects.find(projectId);
    if (project.productImages.length === 0) throw new BadRequestException('Upload product images first.');
    return this.jobs.enqueue(ANALYZE_JOB, { projectId, instruction }, { projectId });
  }

  async startParagraph(projectId: string, instruction?: string): Promise<JobDto> {
    if (!(await this.get(projectId))) throw new BadRequestException('Run the product analysis first.');
    return this.jobs.enqueue(PARAGRAPH_JOB, { projectId, instruction }, { projectId });
  }

  async save(projectId: string, data: ProductSpecSave): Promise<ProductSpecDto> {
    const existing = await this.prisma.productSpec.findUnique({ where: { projectId } });
    if (!existing) throw new NotFoundException('Run the product analysis first.');
    if (hasPlaceholder(data.garmentParagraph)) {
      throw new BadRequestException('The garment paragraph contains brackets or a placeholder; it is pasted into prompts as-is.');
    }
    const row = await this.prisma.productSpec.update({
      where: { projectId },
      data: {
        spec: toJson(data.spec),
        mustMatch: toJson(data.mustMatch),
        unknowns: toJson(data.unknowns),
        garmentParagraph: data.garmentParagraph,
        editedByUser: true,
        version: { increment: 1 },
      },
    });
    return toSpecDto(row);
  }

  private async analyze(projectId: string, instruction?: string) {
    const project = await this.projects.find(projectId);
    const images = sortProductImages(project.productImages);
    const content: LlmPart[] = [
      {
        type: 'text',
        text: [
          `Product title from the listing: ${project.productTitle}`,
          `Store: ${project.source.displayName}`,
          `Occasion it will be styled for: ${project.occasion}`,
          `There are ${images.length} product images. Roles were tagged by the user: ${images.map((im, i) => `image ${i + 1} = ${im.role}`).join(', ')}.`,
          images.some((im) => im.role === 'back')
            ? 'A back image is included.'
            : 'No image is tagged as the back; treat the back as unknown unless one clearly shows it.',
        ].join('\n'),
      },
      ...images.map((im, i): LlmPart => ({ type: 'image', path: im.path, label: `Product image ${i + 1} (${im.role}):` })),
      {
        type: 'text',
        text: instruction
          ? `Analyse the outfit. Also follow this instruction from the user: ${instruction}`
          : 'Analyse the outfit.',
      },
    ];

    const result = await this.llm.call({
      task: 'product_analysis',
      schema: ProductAnalysisChecked,
      system: [this.prompts.render('product-analysis')],
      content,
      projectId,
    });
    const { spec, mustMatch, unknowns, garmentParagraph } = result.data;
    return this.prisma.productSpec.upsert({
      where: { projectId },
      create: {
        projectId,
        spec: toJson(spec),
        mustMatch: toJson(mustMatch),
        unknowns: toJson(unknowns),
        garmentParagraph: garmentParagraph.trim(),
      },
      update: {
        spec: toJson(spec),
        mustMatch: toJson(mustMatch),
        unknowns: toJson(unknowns),
        garmentParagraph: garmentParagraph.trim(),
        editedByUser: false,
        version: { increment: 1 },
      },
    });
  }

  private async rewriteParagraph(projectId: string, instruction?: string) {
    const current = await this.get(projectId);
    if (!current) throw new Error('No product analysis yet');
    const result = await this.llm.call({
      task: 'garment_paragraph',
      schema: GarmentParagraphChecked,
      system: [this.prompts.render('garment-paragraph')],
      content: [
        {
          type: 'text',
          text: [
            'Spec (JSON):',
            JSON.stringify(current.spec, null, 2),
            '',
            'Must match:',
            ...current.mustMatch.map((m) => `- ${m.label}: ${m.expected}`),
            '',
            'Unknown (never mention):',
            ...(current.unknowns.length ? current.unknowns.map((u) => `- ${u}`) : ['- none']),
            '',
            'Current paragraph:',
            current.garmentParagraph,
            '',
            instruction ? `Instruction: ${instruction}` : 'Rewrite the paragraph so it matches the spec exactly.',
          ].join('\n'),
        },
      ],
      projectId,
    });
    return this.prisma.productSpec.update({
      where: { projectId },
      data: { garmentParagraph: result.data.garmentParagraph.trim(), version: { increment: 1 } },
    });
  }
}
