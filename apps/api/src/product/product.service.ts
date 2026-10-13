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

const ProductPayload = z.object({ productId: z.string(), instruction: z.string().optional() });

export function toSpecDto(row: ProductSpecRow): ProductSpecDto {
  return {
    id: row.id,
    projectId: row.projectId,
    productId: row.productId,
    spec: ProductSpecSchema.parse(row.spec),
    mustMatch: readJson(z.array(MustMatchItemSchema), row.mustMatch, []),
    unknowns: readJson(z.array(z.string()), row.unknowns, []),
    garmentParagraph: row.garmentParagraph,
    version: row.version,
    editedByUser: row.editedByUser,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Step 2: each product's photos → ProductSpec, must-match checklist, unknowns and the garment paragraph. */
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
      payload: ProductPayload,
      run: async ({ productId, instruction }, ctx) => {
        await ctx.progress(0.05, 'Reading product photos');
        const spec = await this.analyze(productId, instruction);
        await this.reachIfAllAnalyzed(spec.projectId);
        return { specId: spec.id, productId, version: spec.version };
      },
    });
    this.jobs.register({
      type: PARAGRAPH_JOB,
      group: 'llm',
      payload: ProductPayload,
      run: async ({ productId, instruction }, ctx) => {
        await ctx.progress(0.1, 'Writing garment paragraph');
        const spec = await this.rewriteParagraph(productId, instruction);
        return { specId: spec.id, productId };
      },
    });
  }

  /** The analysis of one product, or null before it runs. */
  async forProduct(productId: string): Promise<ProductSpecDto | null> {
    const row = await this.prisma.productSpec.findUnique({ where: { productId } });
    return row ? toSpecDto(row) : null;
  }

  /** Every analysed product of a project, keyed by product id. */
  async specs(projectId: string): Promise<Map<string, ProductSpecDto>> {
    const rows = await this.prisma.productSpec.findMany({ where: { projectId } });
    return new Map(rows.map((r) => [r.productId, toSpecDto(r)]));
  }

  /** The first product's analysis (classic and three_ways projects have one product). */
  async first(projectId: string): Promise<ProductSpecDto | null> {
    const product = await this.prisma.product.findFirst({ where: { projectId }, orderBy: { order: 'asc' } });
    return product ? this.forProduct(product.id) : null;
  }

  async startAnalysis(productId: string, instruction?: string): Promise<JobDto> {
    const product = await this.projects.findProduct(productId);
    if (product.images.length === 0) throw new BadRequestException('Upload product photos first.');
    return this.jobs.enqueue(ANALYZE_JOB, { productId, instruction }, { projectId: product.projectId });
  }

  /** Analyses every product that has no analysis yet (or all of them with `all`). */
  async startProjectAnalysis(projectId: string, all = false): Promise<JobDto[]> {
    const project = await this.projects.find(projectId);
    const todo = project.products.filter((p) => all || !p.spec);
    if (todo.length === 0) throw new BadRequestException('Every product is analysed already.');
    return Promise.all(todo.map((p) => this.startAnalysis(p.id)));
  }

  async startParagraph(productId: string, instruction?: string): Promise<JobDto> {
    const product = await this.projects.findProduct(productId);
    if (!(await this.forProduct(productId))) throw new BadRequestException('Run the product analysis first.');
    return this.jobs.enqueue(PARAGRAPH_JOB, { productId, instruction }, { projectId: product.projectId });
  }

  async save(productId: string, data: ProductSpecSave): Promise<ProductSpecDto> {
    const existing = await this.prisma.productSpec.findUnique({ where: { productId } });
    if (!existing) throw new NotFoundException('Run the product analysis first.');
    if (hasPlaceholder(data.garmentParagraph)) {
      throw new BadRequestException('The garment paragraph contains brackets or a placeholder; it is pasted into prompts as-is.');
    }
    const row = await this.prisma.productSpec.update({
      where: { productId },
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

  private async reachIfAllAnalyzed(projectId: string): Promise<void> {
    const [products, specs] = await Promise.all([
      this.prisma.product.count({ where: { projectId } }),
      this.prisma.productSpec.count({ where: { projectId } }),
    ]);
    if (products > 0 && specs >= products) await this.projects.reach(projectId, 'product_analyzed');
  }

  private async analyze(productId: string, instruction?: string) {
    const product = await this.projects.findProduct(productId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: product.projectId } });
    const images = sortProductImages(product.images);
    const content: LlmPart[] = [
      {
        type: 'text',
        text: [
          `Product title from the listing: ${product.title}`,
          `Store: ${product.source.displayName}`,
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
        text: instruction ? `Analyse the outfit. Also follow this instruction from the user: ${instruction}` : 'Analyse the outfit.',
      },
    ];

    const result = await this.llm.call({
      task: 'product_analysis',
      schema: ProductAnalysisChecked,
      system: [this.prompts.render('product-analysis')],
      content,
      projectId: product.projectId,
    });
    const { spec, mustMatch, unknowns, garmentParagraph } = result.data;
    const fields = {
      spec: toJson(spec),
      mustMatch: toJson(mustMatch),
      unknowns: toJson(unknowns),
      garmentParagraph: garmentParagraph.trim(),
    };
    return this.prisma.productSpec.upsert({
      where: { productId },
      create: { projectId: product.projectId, productId, ...fields },
      update: { ...fields, editedByUser: false, version: { increment: 1 } },
    });
  }

  private async rewriteParagraph(productId: string, instruction?: string) {
    const current = await this.forProduct(productId);
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
      projectId: current.projectId,
    });
    return this.prisma.productSpec.update({
      where: { productId },
      data: { garmentParagraph: result.data.garmentParagraph.trim(), version: { increment: 1 } },
    });
  }
}
