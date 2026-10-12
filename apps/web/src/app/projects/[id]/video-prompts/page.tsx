"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { VideoMode, VideoStepDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/page-header";
import { JobCard } from "@/components/video/job-card";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useJobRefresh } from "@/lib/jobs";
import { projectKeys, useImagesStep, useVideoStep } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: VideoMode; label: string; hint: string }> = [
  { value: "single", label: "Single scene", hint: "One generation per scene, each from its own approved still (recommended: Kling only takes a start frame)" },
  { value: "multi_shot", label: "Multi-shot", hint: "Scenes sharing a setting and outfit in one run of up to 15 s; shots after the first are generated from the prompt alone" },
];

export default function VideoPromptsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: images } = useImagesStep(id);
  const { data, error, isPending } = useVideoStep(id);
  useJobRefresh(["video.prompt"], projectKeys.video(id));
  const setData = (next: VideoStepDto) => queryClient.setQueryData(projectKeys.video(id), next);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects", id] });

  const mode = useMutation({
    mutationFn: (value: VideoMode) => api.put<VideoStepDto>(`/projects/${id}/video-mode`, { mode: value }),
    onSuccess: (next) => {
      setData(next);
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const generate = async (force = false): Promise<void> => {
    try {
      const next = await api.post<VideoStepDto>(`/projects/${id}/video-jobs/generate`, { force });
      setData(next);
      toast.success("Video prompts ready");
      void refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && window.confirm(e.message)) return generate(true);
      toast.error(errorMessage(e));
    }
  };

  if (error) return <ErrorState error={error} />;
  if (isPending || !data) return <Skeleton className="h-96 rounded-xl" />;

  const unapproved = images ? images.total - images.approved : 0;
  const main = data.jobs.filter((j) => j.purpose === "main");
  const replacements = data.jobs.filter((j) => j.purpose === "replacement");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3">
        <div className="flex rounded-lg border p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              title={m.hint}
              disabled={mode.isPending}
              onClick={() => m.value !== data.mode && mode.mutate(m.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                m.value === data.mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {main.length > 0 && (
          <p className="text-sm">
            <span className="font-semibold">
              {main.length} {data.mode === "multi_shot" ? `run${main.length > 1 ? "s" : ""}` : `generation${main.length > 1 ? "s" : ""}`}
            </span>{" "}
            · {data.totalSec}s generated · <span className="font-semibold">~{data.totalCredits} credits</span>
          </p>
        )}
        <div className="ml-auto flex gap-2">
          {main.length > 0 && (
            <Button variant="outline" onClick={() => void generate()}>
              <RefreshCw /> Rebuild from storyboard
            </Button>
          )}
          {main.length > 0 && (
            <Button nativeButton={false} render={<Link href={`/projects/${id}/videos`} />}>
              Videos <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      {main.length === 0 ? (
        <EmptyState icon={<Clapperboard className="size-8" />} title="No video prompts yet">
          {unapproved > 0 ? (
            <p>
              Approve an image for every scene first ({unapproved} left).{" "}
              <Link className="text-primary hover:underline" href={`/projects/${id}/images`}>
                Go to Images
              </Link>
            </p>
          ) : (
            <>
              <p className="mb-3">{MODES.find((m) => m.value === data.mode)?.hint}.</p>
              <Button onClick={() => void generate()}>
                <Wand2 /> Generate video prompts
              </Button>
            </>
          )}
        </EmptyState>
      ) : (
        main.map((job) => <JobCard key={job.id} job={job} projectId={id} />)
      )}

      {replacements.length > 0 && (
        <>
          <h2 className="mt-2 font-display text-lg font-semibold">Replacement shots</h2>
          <p className="-mt-3 text-sm text-muted-foreground">
            Single scenes re-generated after a video review. An approved replacement is used instead of that scene&apos;s shot in its run.
          </p>
          {replacements.map((job) => (
            <JobCard key={job.id} job={job} projectId={id} />
          ))}
        </>
      )}
    </div>
  );
}
