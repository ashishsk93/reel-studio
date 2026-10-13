"use client";

import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { STEPS, FORMATS, formatInr, isStepDone, type ProjectSummaryDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { useProjects } from "@/lib/queries";

export default function ProjectsPage() {
  const { data, isPending, error } = useProjects();

  return (
    <>
      <PageHeader
        title="Projects"
        description="One project is one Reel: product photos in, an upload-ready video out."
        actions={
          <Button nativeButton={false} render={<Link href="/projects/new" />}>
            <Plus /> New project
          </Button>
        }
      />
      {error && <ErrorState error={error} />}
      {isPending ? (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<Clapperboard className="size-8" />} title="No projects yet">
          Start with the product photos from Amazon, Myntra or Meesho.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: ProjectSummaryDto }) {
  const done = STEPS.filter((s) => isStepDone(s.key, project.furthestStatus)).length;
  return (
    <Link href={`/projects/${project.id}`} className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-[3/4] bg-muted">
        {project.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.coverUrl} alt={project.title} className="size-full object-cover" />
        )}
        <Badge className="absolute top-2 right-2" variant={project.postedAt ? "default" : "secondary"}>
          {project.postedAt ? "Posted" : `Step ${Math.min(done + 1, STEPS.length)} of ${STEPS.length}`}
        </Badge>
        {project.influencer.anchorUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.influencer.anchorUrl}
            alt={project.influencer.name}
            className="absolute bottom-2 left-2 size-9 rounded-full border-2 border-background object-cover"
          />
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-medium">{project.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {FORMATS[project.format].label} · {project.influencer.name} · {project.sources.map((s) => s.displayName).join(", ")} ·{" "}
          {project.productCount > 1 ? `${project.productCount} products` : formatInr(project.priceRange.min)}
        </p>
        <p className="text-xs text-muted-foreground">{project.occasion}</p>
      </div>
    </Link>
  );
}
