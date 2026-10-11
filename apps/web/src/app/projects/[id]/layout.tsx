"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { STEPS, formatInr, type StepKey } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/projects/stepper";
import { errorMessage } from "@/lib/api";
import { useProject } from "@/lib/queries";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const segment = useSelectedLayoutSegment();
  const { data: project, error } = useProject(id);
  const step = STEPS.find((s) => s.key === segment)?.key as StepKey | undefined;

  return (
    <>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
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
