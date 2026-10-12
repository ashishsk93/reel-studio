"use client";

import Link from "next/link";
import { Suspense, useRef, useState, type DragEvent } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Film,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { JobDto, VideoAssetDto, VideoJobDto, VideoStepDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/page-header";
import { VERDICT_STYLE } from "@/components/assets/review-card";
import { SCENE_LABEL } from "@/components/projects/scene-dialog";
import { JobCard } from "@/components/video/job-card";
import { TimelineEditor } from "@/components/video/timeline-editor";
import { VideoReviewCard } from "@/components/video/video-review-card";
import { api, errorMessage } from "@/lib/api";
import { useJobRefresh } from "@/lib/jobs";
import { projectKeys, useVideoStep } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function VideosPage() {
  return (
    <Suspense>
      <VideosStep />
    </Suspense>
  );
}

function VideosStep() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data, error, isPending } = useVideoStep(id);
  useJobRefresh(["video.process", "video.review", "video.prompt"], projectKeys.video(id));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects", id] });

  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (isPending || !data) return <Skeleton className="h-96 rounded-xl" />;
  if (data.jobs.length === 0) {
    return (
      <EmptyState title="No video prompts yet">
        <Link className="text-primary hover:underline" href={`/projects/${id}/video-prompts`}>
          Generate them in step 5
        </Link>
      </EmptyState>
    );
  }

  const selected = data.jobs.find((j) => j.id === params.get("job")) ?? data.jobs.find((j) => !j.approvedAssetId) ?? data.jobs[0];
  const select = (jobId: string) => router.replace(`${pathname}?job=${jobId}`, { scroll: false });
  const sceneLabel = (sceneId: string) => {
    const s = data.scenes.find((x) => x.id === sceneId);
    return s ? `Scene ${s.order + 1} ${SCENE_LABEL[s.type] ?? s.type}` : "Deleted scene";
  };
  const covered = data.scenes.length - data.missingSceneIds.length;
  const done = data.missingSceneIds.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3">
        <div className="min-w-48 flex-1">
          <p className="text-sm">
            <span className="font-semibold">
              {covered} of {data.scenes.length} scenes have an approved video window
            </span>
            <span className="text-muted-foreground"> · upload each Kling result, check the timeline, approve</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(covered / Math.max(1, data.scenes.length)) * 100}%` }} />
          </div>
        </div>
        {done ? (
          <Button nativeButton={false} render={<Link href={`/projects/${id}/compose`} />}>
            Compose <ArrowRight />
          </Button>
        ) : (
          <Button disabled title="Approve a video for every scene first">
            Compose <ArrowRight />
          </Button>
        )}
      </div>

      <nav className="flex gap-2 overflow-x-auto pb-1">
        {data.jobs.map((job) => (
          <JobTab key={job.id} job={job} active={job.id === selected.id} onClick={() => select(job.id)} />
        ))}
      </nav>

      <JobVideos key={selected.id} job={selected} projectId={id} sceneLabel={sceneLabel} onChanged={refresh} step={data} />
    </div>
  );
}

function JobTab({ job, active, onClick }: { job: VideoJobDto; active: boolean; onClick: () => void }) {
  const latest = job.assets[0];
  const verdict = latest?.review?.verdict;
  const busy = latest?.processing && latest.processing.status !== "failed";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left transition-colors",
        active ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
      )}
    >
      <Film className="size-4 text-muted-foreground" />
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {job.title}
          {job.approvedAssetId ? (
            <CheckCircle2 className="size-3.5 text-primary" />
          ) : busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            verdict && <span className={cn("size-2 rounded-full", VERDICT_STYLE[verdict].dot)} />
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {job.durationSec}s · {job.assets.length ? `${job.assets.length} upload${job.assets.length > 1 ? "s" : ""}` : "nothing uploaded"}
        </p>
      </div>
    </button>
  );
}

function JobVideos({
  job,
  projectId,
  sceneLabel,
  onChanged,
  step,
}: {
  job: VideoJobDto;
  projectId: string;
  sceneLabel: (sceneId: string) => string;
  onChanged: () => Promise<unknown>;
  step: VideoStepDto;
}) {
  const [showPrompt, setShowPrompt] = useState(job.assets.length === 0);
  const [selectedId, setSelectedId] = useState<string>();
  const approved = job.assets.find((a) => a.status === "approved");
  const selected = job.assets.find((a) => a.id === selectedId) ?? approved ?? job.assets[0];
  const segmentsFromOther = job.sceneIds.filter((sid) => {
    const seg = step.segments.find((s) => s.sceneId === sid);
    return seg && seg.videoJobId !== job.id;
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("files", file);
      return api.upload<{ assetId: string }>(`/video-jobs/${job.id}/assets`, form);
    },
    onSuccess: async ({ assetId }) => {
      toast.success("Uploaded: normalising, detecting cuts, then Claude reviews it");
      setSelectedId(assetId);
      await onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card/50 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-semibold">{job.title}</h2>
        <Badge variant="secondary">{job.durationSec}s</Badge>
        <Badge variant="secondary">{job.expectedShots.length} shot{job.expectedShots.length > 1 ? "s" : ""}</Badge>
        {job.purpose === "replacement" && <Badge variant="outline">Replacement shot</Badge>}
      </header>
      {segmentsFromOther.length > 0 && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {segmentsFromOther.map(sceneLabel).join(", ")} currently {segmentsFromOther.length > 1 ? "use" : "uses"} an approved replacement shot.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowPrompt(!showPrompt)}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showPrompt ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Prompt and attachments
        </button>
        {showPrompt && <JobCard job={job} projectId={projectId} compact />}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {job.assets.map((a) => (
          <VersionChip key={a.id} asset={a} active={a.id === selected?.id} onClick={() => setSelectedId(a.id)} />
        ))}
        <VideoDrop pending={upload.isPending} onFile={(f) => upload.mutate(f)} big={job.assets.length === 0} />
      </div>

      {selected && (
        <VideoDetail key={selected.id} asset={selected} job={job} sceneLabel={sceneLabel} onChanged={onChanged} />
      )}
    </section>
  );
}

function VersionChip({ asset, active, onClick }: { asset: VideoAssetDto; active: boolean; onClick: () => void }) {
  const thumb = asset.frames[0]?.url;
  const verdict = asset.review?.verdict;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Version ${asset.version}`}
      className={cn(
        "relative aspect-[9/16] w-14 overflow-hidden rounded-lg border-2 bg-muted",
        active ? "border-primary" : "border-transparent hover:border-primary/40",
        asset.status === "rejected" && "opacity-50",
      )}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="size-full object-cover" />
      ) : (
        <Film className="absolute inset-0 m-auto size-4 text-muted-foreground" />
      )}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">v{asset.version}</span>
      {asset.status === "approved" && <CheckCircle2 className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white text-primary" />}
      {asset.status === "rejected" && <XCircle className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white text-destructive" />}
      {asset.processing && asset.processing.status !== "failed" ? (
        <Loader2 className="absolute top-0.5 left-0.5 size-3.5 animate-spin text-white drop-shadow" />
      ) : (
        verdict && <span className={cn("absolute top-1 left-1 size-2.5 rounded-full ring-2 ring-white", VERDICT_STYLE[verdict].dot)} />
      )}
    </button>
  );
}

function VideoDrop({ onFile, pending, big }: { onFile: (f: File) => void; pending: boolean; big: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const take = (list: FileList | null) => {
    const file = Array.from(list ?? []).find((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (file) onFile(file);
    else if (list?.length) toast.error("Upload an MP4, MOV or WebM video.");
  };
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      disabled={pending}
      className={cn(
        "flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground transition-colors",
        big ? "w-40 px-3 text-xs" : "w-14 text-[10px]",
        dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:text-foreground",
      )}
    >
      {pending ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
      {big ? "Drop the Kling video here or click to upload" : "Upload"}
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv"
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function VideoDetail({
  asset,
  job,
  sceneLabel,
  onChanged,
}: {
  asset: VideoAssetDto;
  job: VideoJobDto;
  sceneLabel: (sceneId: string) => string;
  onChanged: () => Promise<unknown>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const approve = useMutation({ mutationFn: () => api.post(`/assets/${asset.id}/approve`), onSuccess: onChanged, onError });
  const reject = useMutation({ mutationFn: () => api.post(`/assets/${asset.id}/reject`), onSuccess: onChanged, onError });
  const remove = useMutation({ mutationFn: () => api.del(`/assets/${asset.id}`), onSuccess: onChanged, onError });
  const rereview = useMutation({ mutationFn: () => api.post<JobDto>(`/assets/${asset.id}/review`), onSuccess: onChanged, onError });
  const reprocess = useMutation({ mutationFn: () => api.post<JobDto>(`/assets/${asset.id}/reprocess`), onSuccess: onChanged, onError });
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = t;
  };

  const p = asset.processing;
  const busy = p && p.status !== "failed";
  const processed = Boolean(asset.shotBounds);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          v{asset.version} · {asset.width}×{asset.height}
          {asset.probe && ` · ${asset.probe.fps} fps${asset.probe.vfr ? " (variable)" : ""} · ${asset.probe.codec}${asset.probe.hasAudio ? " · audio" : ""}`} ·{" "}
          {asset.durationSec.toFixed(2)} s
        </span>
        {Math.abs(asset.durationSec - job.durationSec) > 0.6 && (
          <Badge variant="outline" className="text-amber-600">
            Expected {job.durationSec}s
          </Badge>
        )}
        {asset.status === "approved" && <Badge>Approved</Badge>}
        {asset.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {asset.status !== "approved" && (
            <Button size="sm" onClick={() => approve.mutate()} disabled={!processed || approve.isPending}>
              <CheckCircle2 /> Approve
            </Button>
          )}
          {asset.status !== "rejected" && (
            <Button size="sm" variant="outline" onClick={() => reject.mutate()} disabled={reject.isPending}>
              <XCircle /> Reject
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => rereview.mutate()} disabled={Boolean(busy) || rereview.isPending}>
            <RefreshCw /> Re-review
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button size="sm" variant="ghost" className="text-destructive" />}>
              <Trash2 /> Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete version {asset.version}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The video, its normalised copy, frames and reviews are deleted. If it is approved, its scenes lose their video window.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {busy && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          <p className="flex-1">
            {p.type === "review" ? "Claude is reviewing the frames shot by shot" : "Processing"}
            <span className="text-muted-foreground">
              {" "}
              · {p.status === "queued" ? "queued" : p.message || "working"}
              {p.progress > 0 && ` · ${Math.round(p.progress * 100)}%`}
            </span>
          </p>
        </div>
      )}
      {p?.status === "failed" && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          <p className="flex-1">
            {p.type === "review" ? "The review" : "Processing"} failed: {p.error}
          </p>
          <Button size="sm" variant="outline" onClick={() => (p.type === "review" ? rereview.mutate() : reprocess.mutate())}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}

      {processed ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <TimelineEditor asset={asset} expected={job.expectedShots} sceneLabel={sceneLabel} videoRef={videoRef} onSaved={onChanged} />
          <div>
            {asset.review ? (
              <VideoReviewCard review={asset.review} sceneLabel={sceneLabel} onSeek={seek} onReplacementCreated={onChanged} />
            ) : (
              !busy && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Not reviewed yet.
                  <Button size="sm" variant="outline" onClick={() => rereview.mutate()}>
                    Review now
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        !busy &&
        p?.status !== "failed" && (
          <p className="text-sm text-muted-foreground">Waiting for processing to start…</p>
        )
      )}
    </div>
  );
}
