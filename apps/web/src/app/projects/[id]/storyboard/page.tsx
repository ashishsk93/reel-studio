"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clapperboard,
  Download,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type { BackgroundDto, JobDto, ProductImageRole, SceneDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { PromptCard } from "@/components/prompt-card";
import { JobBanner } from "@/components/projects/job-banner";
import { BackgroundSelect, MODEL_LABEL, SCENE_LABEL, SHOT_LABEL, SceneDialog, type SceneSubmit } from "@/components/projects/scene-dialog";
import { API_URL, ApiError, api, errorMessage } from "@/lib/api";
import { useJobWatcher, useProjectJobs } from "@/lib/jobs";
import { projectKeys, useProject, useSpec, useStoryboard } from "@/lib/queries";

const GENERATE = "storyboard.generate";

export default function StoryboardStep() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const { data: project } = useProject(id);
  const { data: spec } = useSpec(id);
  const { data: board, error } = useStoryboard(id, Boolean(spec));
  const jobs = useProjectJobs(id);
  const generating = jobs.active(GENERATE);
  const lastGenerate = jobs.latest(GENERATE);
  const [adding, setAdding] = useState(false);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const roles = [...new Set(project?.productImages.map((i) => i.role) ?? [])] as ProductImageRole[];
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectKeys.storyboard(id) });

  const generate = async (instruction?: string, force = false) => {
    try {
      const job = await api.post<JobDto>(`/projects/${id}/storyboard`, { instruction: instruction || undefined, force });
      void watch(job, { label: "Planning the storyboard", successMessage: "Storyboard ready" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && window.confirm(`${e.message}`)) return generate(instruction, true);
      toast.error(errorMessage(e));
    }
  };

  const add = useMutation({
    mutationFn: (value: SceneSubmit) => api.post<SceneDto>(`/projects/${id}/scenes`, value),
    onSuccess: () => {
      setAdding(false);
      setAddErrors({});
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) setAddErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    },
  });

  if (!project) return null;
  if (!spec) {
    return (
      <EmptyState title="Analyse the product first">
        <Link className="text-primary hover:underline" href={`/projects/${id}/analysis`}>
          Go to step 2
        </Link>
      </EmptyState>
    );
  }

  const scenes = board?.scenes ?? [];
  const reelSec = board ? board.totalSec + board.ctaSec : 0;

  return (
    <div className="flex flex-col gap-5">
      {generating && <JobBanner job={generating} label="Claude is planning the storyboard" />}
      {!generating && lastGenerate?.status === "failed" && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          The last storyboard run failed: {lastGenerate.error}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}

      {scenes.length === 0 ? (
        !generating && (
          <EmptyState icon={<Clapperboard className="size-8" />} title="No storyboard yet">
            <p className="mb-3">
              Claude plans the scenes from the analysis; the prompts are assembled from {project.influencer.name}&apos;s persona
              and your templates.
            </p>
            <GenerateButton onGenerate={generate} label="Generate storyboard" />
          </EmptyState>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold">{scenes.length} scenes</span> · {board!.totalSec}s + {board!.ctaSec}s CTA ={" "}
              <span className={reelSec < 16 || reelSec > 20 ? "font-semibold text-amber-600" : "font-semibold"}>{reelSec}s</span>
              <span className="text-muted-foreground"> (target 16–20 s)</span>
            </div>
            {board!.notes.length > 0 && (
              <Popover>
                <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
                  <Info /> Notes
                </PopoverTrigger>
                <PopoverContent className="w-96 text-sm">
                  <ul className="list-disc space-y-1 pl-4">
                    {board!.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" nativeButton={false} render={<a href={`${API_URL}/projects/${id}/storyboard.zip`} />}>
                <Download /> All attachments + prompts
              </Button>
              <GenerateButton onGenerate={generate} label="Regenerate" variant="outline" withInstruction disabled={Boolean(generating)} />
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Add scene
              </Button>
              <Button nativeButton={false} render={<Link href={`/projects/${id}/images`} />}>
                Images <ArrowRight />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {scenes.map((scene, i) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                projectId={id}
                availableRoles={roles}
                backgrounds={board?.backgrounds ?? []}
                isFirst={i === 0}
                isLast={i === scenes.length - 1}
                order={scenes.map((s) => s.id)}
              />
            ))}
          </div>
        </>
      )}

      <SceneDialog
        open={adding}
        onOpenChange={setAdding}
        availableRoles={roles}
        backgrounds={board?.backgrounds ?? []}
        errors={addErrors}
        saving={add.isPending}
        onSubmit={(v) => add.mutate(v)}
      />
    </div>
  );
}

function GenerateButton({
  onGenerate,
  label,
  variant = "default",
  withInstruction,
  disabled,
}: {
  onGenerate: (instruction?: string) => Promise<void>;
  label: string;
  variant?: "default" | "outline";
  withInstruction?: boolean;
  disabled?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [open, setOpen] = useState(false);
  if (!withInstruction) {
    return (
      <Button variant={variant} onClick={() => void onGenerate()} disabled={disabled}>
        <Wand2 /> {label}
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant={variant} disabled={disabled} />}>
        <RefreshCw /> {label}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="mb-2 text-xs text-muted-foreground">Replaces every scene. Optional instruction:</p>
        <Textarea
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "Wearing scenes on a rooftop at golden hour"'
        />
        <Button
          className="mt-2 w-full"
          onClick={() => {
            setOpen(false);
            void onGenerate(instruction.trim());
            setInstruction("");
          }}
        >
          Regenerate storyboard
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SceneCard({
  scene,
  projectId,
  availableRoles,
  backgrounds,
  isFirst,
  isLast,
  order,
}: {
  scene: SceneDto;
  projectId: string;
  availableRoles: ProductImageRole[];
  backgrounds: BackgroundDto[];
  isFirst: boolean;
  isLast: boolean;
  order: string[];
}) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [text, setText] = useState(scene.onScreenText);
  useEffect(() => setText(scene.onScreenText), [scene.onScreenText]);
  const [instruction, setInstruction] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [revising, setRevising] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectKeys.storyboard(projectId) });
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const update = useMutation({
    mutationFn: (body: Partial<SceneSubmit>) => api.patch<SceneDto>(`/scenes/${scene.id}`, body),
    onSuccess: () => {
      setEditing(false);
      setErrors({});
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e);
    },
  });
  const remove = useMutation({ mutationFn: () => api.del(`/scenes/${scene.id}`), onSuccess: () => void refresh(), onError });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put(`/projects/${projectId}/scenes/order`, { ids }),
    onSuccess: () => void refresh(),
    onError,
  });

  const move = (delta: number) => {
    const ids = [...order];
    const i = ids.indexOf(scene.id);
    ids.splice(i, 1);
    ids.splice(i + delta, 0, scene.id);
    reorder.mutate(ids);
  };

  const revise = async () => {
    setReviseOpen(false);
    setRevising(true);
    try {
      const job = await api.post<JobDto>(`/scenes/${scene.id}/regenerate-prompt`, { instruction: instruction.trim() || undefined });
      setInstruction("");
      await watch(job, { label: `Rewriting scene ${scene.order + 1}`, successMessage: `Scene ${scene.order + 1} updated` });
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setRevising(false);
    }
  };

  return (
    <article className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
            {scene.order + 1}
          </span>
          <div>
            <p className="text-sm font-semibold">{SCENE_LABEL[scene.type]}</p>
            <p className="text-xs text-muted-foreground">
              {SHOT_LABEL[scene.shotKind]} · {scene.targetDurationSec}s
            </p>
          </div>
          <div className="ml-auto flex">
            <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={isFirst} onClick={() => move(-1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={isLast} onClick={() => move(1)}>
              <ArrowDown />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{scene.purpose}</p>
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">On-screen text</p>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== scene.onScreenText && update.mutate({ onScreenText: text })}
            className="font-display font-semibold"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{scene.outfitState === "wearing_product" ? "Wearing it" : "Own clothes"}</Badge>
          <Badge variant="secondary" className="max-w-full truncate" title={scene.setting}>
            {scene.setting}
          </Badge>
        </div>
        {backgrounds.length > 0 && (
          <BackgroundSelect
            className="h-8 text-xs"
            value={scene.backgroundId}
            backgrounds={backgrounds}
            onChange={(v) => update.mutate({ backgroundId: v })}
          />
        )}
        {scene.motion && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Motion:</span> {scene.motion}
          </p>
        )}
      </div>

      <PromptCard
        card={scene.card}
        chips={
          <>
            <Tooltip>
              <TooltipTrigger render={<Badge />}>{MODEL_LABEL[scene.imageModel]}</TooltipTrigger>
              <TooltipContent>{scene.imageModelReason || "Recommended model"}</TooltipContent>
            </Tooltip>
            <Badge variant="secondary">9:16</Badge>
            {scene.promptOverride && <Badge variant="outline">Edited by hand</Badge>}
            {revising && (
              <Badge variant="outline">
                <Loader2 className="animate-spin" /> Rewriting
              </Badge>
            )}
          </>
        }
        footer={
          <>
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={`${API_URL}/scenes/${scene.id}/attachments.zip`} />}>
              <Download /> Download attachments (zip)
            </Button>
            <Popover open={reviseOpen} onOpenChange={setReviseOpen}>
              <PopoverTrigger render={<Button size="sm" variant="outline" disabled={revising} />}>
                <Wand2 /> Regenerate prompt
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <p className="mb-2 text-xs text-muted-foreground">
                  Optional instruction. Everything you don&apos;t mention stays the same.
                </p>
                <Textarea
                  rows={3}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder='e.g. "Sitting on the bed instead"'
                />
                <Button className="mt-2 w-full" onClick={() => void revise()}>
                  Regenerate
                </Button>
              </PopoverContent>
            </Popover>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button size="sm" variant="ghost" className="ml-auto text-destructive" />}>
                <Trash2 /> Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete scene {scene.order + 1}?</AlertDialogTitle>
                  <AlertDialogDescription>{SCENE_LABEL[scene.type]}: {scene.onScreenText}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      <SceneDialog
        open={editing}
        onOpenChange={setEditing}
        scene={scene}
        availableRoles={availableRoles}
        backgrounds={backgrounds}
        errors={errors}
        saving={update.isPending}
        onSubmit={(v) => update.mutate(v)}
      />
    </article>
  );
}
