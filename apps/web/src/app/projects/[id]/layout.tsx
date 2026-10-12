"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { STEPS, formatInr, type StepKey } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/projects/stepper";
import { ErrorState } from "@/components/page-header";
import { useProject, useUsage } from "@/lib/queries";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const segment = useSelectedLayoutSegment();
  const { data: project, error } = useProject(id);
  const { data: usage } = useUsage({ projectId: id });
  const step = STEPS.find((s) => s.key === segment)?.key as StepKey | undefined;

  return (
    <>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      {error && <ErrorState error={error} />}
      {project ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            {project.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.coverUrl} alt="" className="size-14 rounded-xl border object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-semibold">{project.productTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {project.influencer.name} · {project.source.displayName} · {formatInr(project.priceInr)}
                {project.priceLabel && project.priceMode !== "exact" && ` (badge: ${project.priceLabel})`} · {project.occasion}
              </p>
            </div>
            {usage && (usage.total.calls > 0 || usage.klingCredits > 0) && (
              <Link
                href={`/usage?project=${id}`}
                className="rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                title="Claude cost and estimated Kling credits for this Reel"
              >
                Claude ${usage.total.costUsd.toFixed(3)} · {Math.round(usage.klingCredits * 100) / 100} Kling credits
              </Link>
            )}
            {project.postedAt && <Badge>Posted {new Date(project.postedAt).toLocaleDateString()}</Badge>}
          </div>
          <Stepper projectId={id} furthest={project.furthestStatus} current={step} />
        </>
      ) : (
        !error && <Skeleton className="mb-8 h-24 rounded-xl" />
      )}
      {children}
    </>
  );
}
