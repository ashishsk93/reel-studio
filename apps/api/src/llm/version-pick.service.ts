import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { VersionPickDto } from '@reel/shared';
import { Prisma, type Asset, type Review } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { refTags } from '../influencers/influencer.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { DecisionService, type ChoiceAnswer, type DecisionPart } from './decision.service';

const IssuesSchema = z.array(z.object({ severity: z.string(), description: z.string() }));
const FramesSchema = z.array(z.object({ t: z.number(), path: z.string() }));

export const VersionPickSchema = z.object({
  assetId: z.string(),
  version: z.number(),
  confidence: z.number().nullable(),
  by: z.enum(['decisions', 'rules']),
  note: z.string(),
});

type Reviewed = Asset & { reviews: Review[] };

const VERDICT_SCORE: Record<string, number> = { pass: 3, warn: 2, fail: 0 };
const SEVERITY_COST: Record<string, number> = { critical: 1.5, major: 0.6, minor: 0.1 };
/** Video versions are shown to the decision model as this many frames each. */
const FRAMES_PER_VIDEO = 3;

/** Rule-based pick: best verdict, then the least severe issues, then the newest version. */
export function rulesPick(versions: Array<{ assetId: string; version: number; verdict: string; issues: Array<{ severity: string }> }>) {
  const score = (v: (typeof versions)[number]) =>
    (VERDICT_SCORE[v.verdict] ?? 1) - v.issues.reduce((sum, i) => sum + (SEVERITY_COST[i.severity] ?? 0.3), 0);
  return [...versions].sort((a, b) => score(b) - score(a) || b.version - a.version)[0];
}

/** Evenly spaced frames of a processed video (first and last included). */
export function spreadFrames<T>(frames: T[], count: number): T[] {
  if (frames.length <= count) return frames;
  return Array.from({ length: count }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (count - 1))]);
}

/**
 * Which of a scene's (or video job's) reviewed versions to approve. The decision model looks at
 * every version next to her anchor and the product photo, with each version's review, and picks
 * one with a confidence; without it, the rules above decide. Stored on the scene / job and
 * refreshed after every review, reject or delete.
 */
@Injectable()
export class VersionPickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisions: DecisionService,
  ) {}

  async refreshScene(sceneId: string): Promise<void> {
    const scene = await this.prisma.scene.findUnique({
      where: { id: sceneId },
      include: { project: { include: { influencer: { include: { references: true } } } }, product: { include: { images: true } } },
    });
    if (!scene) return;
    const assets = await this.prisma.asset.findMany({
      where: { sceneId, status: { not: 'rejected' } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const anchor = scene.project.influencer.references.find((r) => refTags(r).includes('anchor'));
    const productImage = scene.product?.images.sort((a, b) => Number(b.role === 'front') - Number(a.role === 'front') || a.order - b.order)[0];
    const pick = await this.pick({
      assets,
      kind: 'image',
      context: `Scene ${scene.order + 1} (${scene.type}): ${scene.purpose} ${scene.description}`,
      references: [
        ...(anchor ? [{ path: anchor.path, label: 'Reference: her face (anchor)' }] : []),
        ...(productImage ? [{ path: productImage.path, label: 'Reference: the product' }] : []),
      ],
      projectId: scene.projectId,
    });
    await this.prisma.scene.update({ where: { id: sceneId }, data: { recommendation: pick ? toJson(pick) : Prisma.DbNull } });
  }

  async refreshVideoJob(jobId: string): Promise<void> {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const assets = await this.prisma.asset.findMany({
      where: { videoJobId: jobId, status: { not: 'rejected' } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const start = await this.prisma.asset.findUnique({ where: { id: job.startAssetId } });
    const pick = await this.pick({
      assets,
      kind: 'video',
      context: 'A generated image-to-video clip for one scene of the Reel',
      references: start ? [{ path: start.path, label: 'Reference: the approved still the clip starts from (the look to keep)' }] : [],
      projectId: job.projectId,
    });
    await this.prisma.videoJob.update({ where: { id: jobId }, data: { recommendation: pick ? toJson(pick) : Prisma.DbNull } });
  }

  read(value: unknown): VersionPickDto | null {
    return readJson(VersionPickSchema.nullable(), value, null);
  }

  private async pick(input: {
    assets: Reviewed[];
    kind: 'image' | 'video';
    context: string;
    references: Array<{ path: string; label: string }>;
    projectId: string;
  }): Promise<VersionPickDto | null> {
    const versions = input.assets
      .filter((a) => a.reviews[0])
      .map((a) => ({
        asset: a,
        assetId: a.id,
        version: a.version,
        verdict: a.reviews[0].verdict,
        summary: a.reviews[0].summary,
        issues: readJson(IssuesSchema, a.reviews[0].issues, []),
      }))
      .sort((a, b) => a.version - b.version);
    if (versions.length < 2) return null;
    const fallback = rulesPick(versions);

    const parts: DecisionPart[] = [
      { type: 'text', text: `${input.kind === 'image' ? 'Generated images' : 'Generated video clips'} for one scene of an Instagram fashion affiliate Reel. ${input.context}` },
      ...input.references.map((r): DecisionPart => ({ type: 'image', path: r.path, label: r.label })),
    ];
    for (const v of versions) {
      const review = `review: ${v.verdict}; ${v.issues.length ? v.issues.map((i) => `${i.severity}: ${i.description}`).join('; ') : 'no issues'}`;
      if (input.kind === 'image') {
        parts.push({ type: 'image', path: v.asset.path, label: `Version ${v.version} (${review})` });
      } else {
        const frames = spreadFrames(readJson(FramesSchema, v.asset.frames, []), FRAMES_PER_VIDEO);
        parts.push({ type: 'text', text: `Version ${v.version} (${review}), ${frames.length} frames:` });
        for (const f of frames) parts.push({ type: 'image', path: f.path, label: `Version ${v.version} at ${f.t.toFixed(1)} s` });
      }
    }

    const answers = await this.decisions.ask({
      task: 'version_pick',
      input: parts,
      questions: [
        {
          type: 'choice',
          name: 'best',
          instructions:
            'Which version should be approved for the Reel? She must look like the face reference and the garment must match the product exactly; then prefer fewer and milder problems (hands, artefacts, drift), then the better composition. Prefer a newer version only when the others are equally good.',
          choices: versions.map((v) => ({ value: `v${v.version}`, description: `Version ${v.version}` })),
        },
      ],
      projectId: input.projectId,
    });
    const answer = answers?.get('best') as ChoiceAnswer | undefined;
    const chosen = answer?.type === 'choice' ? versions.find((v) => `v${v.version}` === answer.choice) : undefined;
    if (chosen && answer) {
      return {
        assetId: chosen.assetId,
        version: chosen.version,
        confidence: Math.round(answer.confidence * 100) / 100,
        by: 'decisions',
        note: chosen.assetId === fallback.assetId ? 'Agrees with the review verdicts.' : `The review verdicts alone would pick version ${fallback.version}.`,
      };
    }
    return { assetId: fallback.assetId, version: fallback.version, confidence: null, by: 'rules', note: 'Best review verdict with the fewest serious issues.' };
  }
}
