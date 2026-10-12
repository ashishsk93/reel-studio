"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clapperboard, Download, FileArchive, Loader2, PartyPopper, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { JobDto, ProjectDto, RenderDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/page-header";
import { JobBanner } from "@/components/projects/job-banner";
import { api, errorMessage } from "@/lib/api";
import { useJobRefresh, useJobWatcher, useProjectJobs } from "@/lib/jobs";
import { projectKeys, useComposeStep, useProject, useRenders } from "@/lib/queries";
import { cn } from "@/lib/utils";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const { data: project } = useProject(id);
  const { data: compose } = useComposeStep(id);
  const { data: renders, isPending } = useRenders(id);
  const jobs = useProjectJobs(id);
  useJobRefresh(["render.final"], projectKeys.renders(id));
  const running = jobs.active("render.final");

  const render = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/projects/${id}/renders`);
      await queryClient.invalidateQueries({ queryKey: projectKeys.renders(id) });
      await watch(job, { label: "Rendering the Reel", successMessage: "Reel rendered" });
      await queryClient.invalidateQueries({ queryKey: ["projects", id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const posted = useMutation({
    mutationFn: (value: boolean) => api.post<ProjectDto>(`/projects/${id}/posted`, { posted: value }),
    onSuccess: (p) => {
      queryClient.setQueryData(projectKeys.one(id), p);
      if (p.postedAt) toast.success("Marked as posted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending || !project) return <Skeleton className="h-96 rounded-xl" />;
  const latest = renders?.find((r) => r.status === "succeeded");
  const current = renders?.[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <p className="flex-1 text-sm text-muted-foreground">
          1080×1920 · 30 fps · H.264 High · AAC 48 kHz {compose?.music ? `· music: ${compose.music.name}` : "· silent track for trending audio"}
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href={`/projects/${id}/compose`} />}>
          Back to compose
        </Button>
        <Button onClick={() => render.mutate()} disabled={render.isPending || Boolean(running)}>
          {render.isPending || running ? <Loader2 className="animate-spin" /> : <Clapperboard />} {latest ? "Render again" : "Render the Reel"}
        </Button>
      </div>

      {running && <JobBanner job={running} label="Rendering" />}
      {current?.status === "failed" && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          The last render failed: {current.error ?? current.warnings[0]}
        </p>
      )}

      {!latest ? (
        !running && (
          <EmptyState icon={<Clapperboard className="size-8" />} title="Not rendered yet">
            Render the Reel to get final.mp4, the covers, the caption and DM files, and the quality checks.
          </EmptyState>
        )
      ) : (
        <RenderView render={latest} project={project} captions={compose?.captions ?? null} onPosted={(v) => posted.mutate(v)} postedPending={posted.isPending} />
      )}

      {renders && renders.length > 1 && (
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Earlier renders</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {renders.slice(1).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge variant={r.status === "succeeded" ? "secondary" : "outline"}>{r.status}</Badge>
                {new Date(r.createdAt).toLocaleString()}
                {r.durationSec && <span>· {r.durationSec}s</span>}
                {r.zipUrl && (
                  <a className="text-primary hover:underline" href={r.zipUrl}>
                    zip
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RenderView({
  render,
  project,
  captions,
  onPosted,
  postedPending,
}: {
  render: RenderDto;
  project: ProjectDto;
  captions: { caption: string; dmTemplate: string; firstComment: string | null } | null;
  onPosted: (v: boolean) => void;
  postedPending: boolean;
}) {
  const file = (name: string) => render.files.find((f) => f.name === name);
  const video = file("final.mp4");
  const failed = render.qa?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        {video && <video src={video.url} controls playsInline className="aspect-[9/16] w-full rounded-2xl border bg-black" />}
        <p className="text-center text-xs text-muted-foreground">
          Rendered {new Date(render.finishedAt ?? render.createdAt).toLocaleString()} · {render.durationSec}s
        </p>
        {project.postedAt ? (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <PartyPopper className="size-4 text-primary" /> Posted {new Date(project.postedAt).toLocaleDateString()}
            </span>
            <Button size="xs" variant="ghost" onClick={() => onPosted(false)} disabled={postedPending}>
              Undo
            </Button>
          </div>
        ) : (
          <Button onClick={() => onPosted(true)} disabled={postedPending}>
            <CheckCircle2 /> Mark as posted
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Downloads</h3>
            {render.zipUrl && (
              <Button size="sm" className="ml-auto" nativeButton={false} render={<a href={render.zipUrl} />}>
                <FileArchive /> Everything (.zip)
              </Button>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {render.files.map((f) => (
              <li key={f.name}>
                <a href={f.url} download={f.name} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:border-primary/50">
                  <Download className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs">{f.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{kb(f.bytes)}</span>
                </a>
              </li>
            ))}
          </ul>
          {captions && (
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton text={captions.caption} label="Copy caption" size="sm" variant="outline" />
              {captions.firstComment && <CopyButton text={captions.firstComment} label="Copy first comment" size="sm" variant="outline" />}
              <CopyButton text={captions.dmTemplate} label="Copy DM reply" size="sm" variant="outline" />
            </div>
          )}
        </section>

        {render.qa && (
          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              Quality checks
              <Badge variant={failed.length ? "outline" : "secondary"} className={cn(failed.length && "text-amber-600")}>
                {failed.length ? `${failed.length} to look at` : "all passed"}
              </Badge>
            </h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {render.qa.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                  <span>
                    {c.label}
                    <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {render.qa.contactSheetUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={render.qa.contactSheetUrl} alt="Contact sheet" className="mt-4 w-full max-w-2xl rounded-lg border" />
            )}
          </section>
        )}

        {render.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
            {render.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
