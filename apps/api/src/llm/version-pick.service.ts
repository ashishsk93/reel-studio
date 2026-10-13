import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { VersionPickDto } from '@reel/shared';
import { Prisma, type Asset, type Review } from '../generated/prisma/client';
import { readJson, toJson } from '../common/json';
import { PrismaService } from '../prisma/prisma.service';
import { JevService, type JevChoiceAnswer } from './jev.service';

const IssuesSchema = z.array(z.object({ severity: z.string(), description: z.string() }));

export const VersionPickSchema = z.object({
  assetId: z.string(),
  version: z.number(),
  confidence: z.number().nullable(),
  by: z.enum(['jev', 'rules']),
  note: z.string(),
});

type Reviewed = Asset & { reviews: Review[] };

const VERDICT_SCORE: Record<string, number> = { pass: 3, warn: 2, fail: 0 };
const SEVERITY_COST: Record<string, number> = { critical: 1.5, major: 0.6, minor: 0.1 };

/** Rule-based pick: best verdict, then the least severe issues, then the newest version. */
export function rulesPick(versions: Array<{ assetId: string; version: number; verdict: string; issues: Array<{ severity: string }> }>) {
  const score = (v: (typeof versions)[number]) =>
    (VERDICT_SCORE[v.verdict] ?? 1) - v.issues.reduce((sum, i) => sum + (SEVERITY_COST[i.severity] ?? 0.3), 0);
  return [...versions].sort((a, b) => score(b) - score(a) || b.version - a.version)[0];
}

/**
 * Which of a scene's (or video job's) reviewed versions to approve. Jev weighs the reviews (identity
 * and garment first, then issue severity) and returns a pick with a confidence; without Jev the
 * rules above decide. Stored on the scene / job and refreshed after every review, reject or delete.
 */
@Injectable()
export class VersionPickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jev: JevService,
  ) {}

  async refreshScene(sceneId: string): Promise<void> {
    const scene = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!scene) return;
    const assets = await this.prisma.asset.findMany({
      where: { sceneId, status: { not: 'rejected' } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const pick = await this.pick(assets, `Scene ${scene.order + 1} (${scene.type}): ${scene.purpose} ${scene.description}`, 'image', scene.projectId);
    await this.prisma.scene.update({ where: { id: sceneId }, data: { recommendation: pick ? toJson(pick) : Prisma.DbNull } });
  }

  async refreshVideoJob(jobId: string): Promise<void> {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const assets = await this.prisma.asset.findMany({
      where: { videoJobId: jobId, status: { not: 'rejected' } },
      include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const pick = await this.pick(assets, 'A generated video clip for the Reel', 'video', job.projectId);
    await this.prisma.videoJob.update({ where: { id: jobId }, data: { recommendation: pick ? toJson(pick) : Prisma.DbNull } });
  }

  read(value: unknown): VersionPickDto | null {
    return readJson(VersionPickSchema.nullable(), value, null);
  }

  private async pick(assets: Reviewed[], context: string, kind: 'image' | 'video', projectId: string): Promise<VersionPickDto | null> {
    const versions = assets
      .filter((a) => a.reviews[0])
      .map((a) => ({
        assetId: a.id,
        version: a.version,
        verdict: a.reviews[0].verdict,
        summary: a.reviews[0].summary,
        issues: readJson(IssuesSchema, a.reviews[0].issues, []),
      }))
      .sort((a, b) => a.version - b.version);
    if (versions.length < 2) return null;
    const fallback = rulesPick(versions);

    const describe = (v: (typeof versions)[number]) =>
      `Version ${v.version}: review verdict ${v.verdict}; ${v.issues.length ? v.issues.map((i) => `${i.severity}: ${i.description}`).join('; ') : 'no issues'}`;
    const answers = await this.jev.ask({
      task: 'version_pick',
      state: {
        what: `${kind === 'image' ? 'Generated images' : 'Generated videos'} for one scene of a fashion affiliate Reel, each reviewed by an AI checker.`,
        scene: context,
        versions: versions.map((v) => ({ version: v.version, verdict: v.verdict, summary: v.summary, issues: v.issues })),
      },
      questions: {
        best: {
          type: 'choice',
          instructions:
            'Which version should be approved for the Reel? The influencer looking like herself and the garment matching the product matter most, then how severe the remaining issues are, then composition. A newer version is fine to prefer only when the reviews are equally good.',
          criteria: Object.fromEntries(versions.map((v) => [`v${v.version}`, describe(v)])),
        },
      },
      projectId,
    });
    const answer = answers?.best as JevChoiceAnswer | undefined;
    const chosen = answer?.type === 'choice' ? versions.find((v) => `v${v.version}` === answer.choice) : undefined;
    if (chosen && answer) {
      return {
        assetId: chosen.assetId,
        version: chosen.version,
        confidence: Math.round(answer.confidence * 100) / 100,
        by: 'jev',
        note: chosen.assetId === fallback.assetId ? 'Same pick as the review verdicts.' : `The review verdicts alone would pick version ${fallback.version}.`,
      };
    }
    return { assetId: fallback.assetId, version: fallback.version, confidence: null, by: 'rules', note: 'Best review verdict with the fewest serious issues.' };
  }
}
