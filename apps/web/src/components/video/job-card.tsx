"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Pencil, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { JobDto, VideoJobDto, VideoStepDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PromptCard } from "@/components/prompt-card";
import { ShotPlan } from "@/components/video/shot-plan";
import { api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { projectKeys } from "@/lib/queries";

/** A Kling prompt card for one video job: shot plan, prompt, attachments, rewrite/edit/reset. */
export function JobCard({ job, projectId, compact }: { job: VideoJobDto; projectId: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(job.card.prompt);
  const [instruction, setInstruction] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const key = projectKeys.video(projectId);
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<VideoStepDto>(`/video-jobs/${job.id}`, body),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      setEditing(false);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/video-jobs/${job.id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["projects", projectId] }),
    onError,
  });

  const rewrite = async () => {
    setRewriteOpen(false);
    setRewriting(true);
    try {
      const j = await api.post<JobDto>(`/video-jobs/${job.id}/regenerate-prompt`, { instruction: instruction.trim() });
      setInstruction("");
      await watch(j, { label: `Rewriting ${job.title}`, successMessage: "Video prompt updated" });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      onError(e);
    } finally {
      setRewriting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card/50 p-4">
      {!compact && (
        <header className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-semibold">{job.title}</h3>
          {job.purpose === "replacement" && (
            <Button size="xs" variant="ghost" className="ml-auto text-destructive" onClick={() => remove.mutate()}>
              <Trash2 /> Remove
            </Button>
          )}
        </header>
      )}
      {!compact && <ShotPlan shots={job.expectedShots} durationSec={job.durationSec} />}
      {editing ? (
        <div className="rounded-xl border bg-card p-4">
          <Textarea rows={10} className="font-mono text-xs" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={() => patch.mutate({ prompt })} disabled={!prompt.trim() || patch.isPending}>
              Save prompt
            </Button>
          </div>
        </div>
      ) : (
        <PromptCard
          compact={compact}
          card={job.card}
          chips={
            <>
              <Badge>Kling 3.0</Badge>
              <Badge variant="secondary">{job.durationSec}s</Badge>
              <Badge variant="secondary">{job.settings.resolution}</Badge>
              <Badge variant="secondary">Sound {job.settings.sound ? "on" : "off"}</Badge>
              <Badge variant="secondary">~{job.creditEstimate} credits</Badge>
              {job.mode === "multi_shot" && <Badge variant="outline">Multi-shot</Badge>}
              {job.promptOverride && <Badge variant="outline">Edited</Badge>}
              {rewriting && (
                <Badge variant="outline">
                  <Loader2 className="animate-spin" /> Rewriting
                </Badge>
              )}
            </>
          }
          footer={
            <>
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={job.zipUrl} />}>
                <Download /> Download attachments (zip)
              </Button>
              <Popover open={rewriteOpen} onOpenChange={setRewriteOpen}>
                <PopoverTrigger render={<Button size="sm" variant="outline" disabled={rewriting} />}>
                  <Wand2 /> Rewrite with AI
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Describe the change. Shot markers, timings and the consistency lines stay verbatim.
                  </p>
                  <Textarea
                    rows={3}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder='e.g. "Less movement in shot 2"'
                  />
                  <Button className="mt-2 w-full" disabled={!instruction.trim()} onClick={() => void rewrite()}>
                    Rewrite
                  </Button>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPrompt(job.card.prompt);
                  setEditing(true);
                }}
              >
                <Pencil /> Edit
              </Button>
              {job.promptOverride && (
                <Button size="sm" variant="ghost" onClick={() => patch.mutate({ promptOverride: false })}>
                  <RotateCcw /> Reset to template
                </Button>
              )}
            </>
          }
        />
      )}
    </section>
  );
}
