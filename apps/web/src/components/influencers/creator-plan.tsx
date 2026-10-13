"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleDashed, Download, Lock, Loader2, Pencil, RotateCcw, SkipForward, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { CreatorTaskDto, CreatorTaskStatus, InfluencerDetailDto, JobDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState, ErrorState } from "@/components/page-header";
import { PromptCard } from "@/components/prompt-card";
import { AssetWorkbench } from "@/components/assets/asset-workbench";
import { MODEL_LABEL } from "@/components/projects/scene-dialog";
import { TAG_LABEL } from "@/components/influencers/reference-gallery";
import { API_URL, api, errorMessage } from "@/lib/api";
import { useJobRefresh, useJobWatcher } from "@/lib/jobs";
import { useCreatorTasks } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Expandable } from "@/components/lightbox";

const STATUS: Record<CreatorTaskStatus, { label: string; icon: typeof Circle; className: string }> = {
  locked: { label: "Locked", icon: Lock, className: "text-muted-foreground" },
  ready: { label: "To do", icon: Circle, className: "text-muted-foreground" },
  in_review: { label: "Uploaded", icon: CircleDashed, className: "text-amber-600" },
  approved: { label: "Approved", icon: CheckCircle2, className: "text-primary" },
  skipped: { label: "Skipped", icon: SkipForward, className: "text-muted-foreground" },
};

/** Character creator, step 2: prompts for every reference frame, uploads, reviews, approval into references. */
export function CreatorPlan({ influencer }: { influencer: InfluencerDetailDto }) {
  const queryClient = useQueryClient();
  const { data: tasks, isPending, error } = useCreatorTasks(influencer.id);
  const [selectedId, setSelectedId] = useState<string>();
  useJobRefresh(["asset.review", "assistant.reply", "creator.prompt"], ["influencers"]);

  const create = useMutation({
    mutationFn: () => api.post<CreatorTaskDto[]>(`/influencers/${influencer.id}/creator/plan`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["influencers"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) return <ErrorState error={error} />;
  if (isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (!tasks?.length) {
    return (
      <EmptyState title="No reference plan yet">
        <p className="mb-3">
          Get a Higgsfield prompt for each reference frame (anchor, turnaround, full-body bases, close-ups, hands, lifestyle).
          Upload what you generate: Claude checks each one against the anchor, and approved frames become her reference
          images. Tags she already has are marked done.
        </p>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Create reference plan
        </Button>
      </EmptyState>
    );
  }

  const selected = tasks.find((t) => t.id === selectedId) ?? tasks.find((t) => t.status === "ready" || t.status === "in_review") ?? tasks[0];
  const counted = tasks.filter((t) => t.status !== "skipped");
  const approved = counted.filter((t) => t.status === "approved").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
      <aside className="flex flex-col gap-3 self-start">
        <div>
          <p className="text-sm font-semibold">
            {approved} of {counted.length} frames approved
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(approved / Math.max(1, counted.length)) * 100}%` }} />
          </div>
        </div>
        <ol className="flex flex-col gap-0.5">
          {tasks.map((t) => {
            const s = STATUS[t.status];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    t.id === selected.id ? "bg-primary/10 font-medium" : "hover:bg-muted",
                  )}
                >
                  <s.icon className={cn("size-4 shrink-0", s.className)} />
                  <span className="flex-1">{TAG_LABEL[t.tag]}</span>
                  {t.assets.length > 0 && <span className="text-[11px] text-muted-foreground">{t.assets.length}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {influencer.status === "draft" && influencer.anchor && (
          <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
            The anchor is approved: you can <strong>Activate</strong> her now. The other frames are recommended for consistency.
          </p>
        )}
      </aside>

      <FrameDetail key={selected.id} task={selected} influencer={influencer} />
    </div>
  );
}

function FrameDetail({ task, influencer }: { task: CreatorTaskDto; influencer: InfluencerDetailDto }) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["influencers"] });
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(task.card.prompt);
  const [instruction, setInstruction] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriting, setRewriting] = useState(false);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<CreatorTaskDto>(`/creator-tasks/${task.id}`, body),
    onSuccess: () => {
      setEditing(false);
      void refresh();
    },
    onError,
  });

  const rewrite = async () => {
    setRewriteOpen(false);
    setRewriting(true);
    try {
      const job = await api.post<JobDto>(`/creator-tasks/${task.id}/regenerate-prompt`, { instruction: instruction.trim() });
      setInstruction("");
      await watch(job, { label: `Rewriting the ${TAG_LABEL[task.tag]} prompt`, successMessage: "Prompt updated" });
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setRewriting(false);
    }
  };

  const first = influencer.name.split(" ")[0];
  const locked = task.status === "locked";
  const compare = [
    ...(influencer.anchor && task.tag !== "anchor" ? [{ label: `${first} anchor`, url: influencer.anchor.url }] : []),
    ...task.card.attachments.filter((a) => a.id !== influencer.anchor?.id).map((a) => ({ label: a.label, url: a.url })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h2 className="font-display text-lg font-semibold first-letter:uppercase">{TAG_LABEL[task.tag]}</h2>
          <p className="text-sm text-muted-foreground">{task.purpose}</p>
        </div>
        {task.status === "skipped" ? (
          <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: "ready" })}>
            <RotateCcw /> Un-skip
          </Button>
        ) : (
          task.status !== "approved" &&
          task.tag !== "anchor" && (
            <Button size="sm" variant="ghost" onClick={() => patch.mutate({ status: "skipped" })}>
              <SkipForward /> Skip this frame
            </Button>
          )
        )}
      </header>

      {task.reference && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <Expandable items={[{ url: task.reference.url, label: task.tag }]}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={task.reference.url} alt="" className="h-16 w-12 rounded-md border object-cover" />
          </Expandable>
          <p>
            <span className="font-medium">In her references.</span>{" "}
            <span className="text-muted-foreground">
              {task.status === "approved" && task.assets.some((a) => a.status === "approved")
                ? "Approved from this plan; approving another version replaces it."
                : "Already tagged in the gallery. Generate a new one here only if you want to replace it."}
            </span>
          </p>
        </div>
      )}

      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        {task.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

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
          card={task.card}
          chips={
            <>
              <Badge title={task.modelReason}>{MODEL_LABEL[task.imageModel]}</Badge>
              <Badge variant="secondary">{task.aspect}</Badge>
              {task.promptOverride && <Badge variant="outline">Edited</Badge>}
              {rewriting && (
                <Badge variant="outline">
                  <Loader2 className="animate-spin" /> Rewriting
                </Badge>
              )}
            </>
          }
          footer={
            <>
              {task.card.attachments.length > 0 && (
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={`${API_URL}/creator-tasks/${task.id}/attachments.zip`} />}>
                  <Download /> Download attachments (zip)
                </Button>
              )}
              <Popover open={rewriteOpen} onOpenChange={setRewriteOpen}>
                <PopoverTrigger render={<Button size="sm" variant="outline" disabled={rewriting} />}>
                  <Wand2 /> Rewrite with AI
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Describe the change. Her identity, the persona rules and the image numbering stay verbatim.
                  </p>
                  <Textarea
                    rows={3}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder='e.g. "Warmer golden-hour light"'
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
                  setPrompt(task.card.prompt);
                  setEditing(true);
                }}
              >
                <Pencil /> Edit
              </Button>
              {task.promptOverride && (
                <Button size="sm" variant="ghost" onClick={() => patch.mutate({ promptOverride: false })}>
                  <RotateCcw /> Reset to default
                </Button>
              )}
            </>
          }
        />
      )}

      <AssetWorkbench
        assets={task.assets}
        uploadPath={`/creator-tasks/${task.id}/assets`}
        compare={compare}
        onChanged={refresh}
        aspect={task.aspect.replace(":", "/")}
        disabled={locked ? `Approve ${first}'s anchor first: every other frame is checked against it.` : undefined}
        emptyHint={`Generate this frame in Higgsfield with the prompt above${task.card.attachments.length ? " and the attachments in order" : ""}, then upload the results. Approving one adds it to ${first}'s references.`}
      />
    </div>
  );
}
