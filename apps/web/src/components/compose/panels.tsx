"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ImageIcon, Loader2, Music, Save, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { CaptionPackageDto, ComposeStepDto, CtaDto, JobDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/copy-button";
import { SCENE_LABEL } from "@/components/projects/scene-dialog";
import { api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { projectKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Props = { projectId: string; step: ComposeStepDto; setData: (d: ComposeStepDto) => void };

// ---------- End card ----------

export function CtaPanel({ projectId, step, setData }: Props) {
  const [draft, setDraft] = useState<CtaDto>(step.cta);
  const [prev, setPrev] = useState(step.cta);
  if (JSON.stringify(prev) !== JSON.stringify(step.cta)) {
    setPrev(step.cta);
    setDraft(step.cta);
  }
  const save = useMutation({
    mutationFn: (body: Partial<CtaDto>) => api.put<ComposeStepDto>(`/projects/${projectId}/cta`, body),
    onSuccess: (d) => {
      setData(d);
      toast.success("End card updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(step.cta);
  const lastSeg = step.segments[step.segments.length - 1];
  const chosenSeg = step.segments.find((s) => s.id === draft.frame?.segmentId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div>
          <Label className="mb-1.5 block text-xs">Text (&ldquo;LINK&rdquo; gets the pink pill; a trailing 👇 bounces)</Label>
          <Input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="font-display font-semibold" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs">Duration: {draft.durationSec}s</Label>
            <input
              type="range"
              min={2}
              max={4}
              step={0.5}
              value={draft.durationSec}
              onChange={(e) => setDraft({ ...draft, durationSec: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Darken: {Math.round(draft.darken * 100)}%</Label>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={draft.darken}
              onChange={(e) => setDraft({ ...draft, darken: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.zoom} onCheckedChange={(v) => setDraft({ ...draft, zoom: v })} /> Slow zoom
        </label>
        <div>
          <Label className="mb-2 block text-xs">Background</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={draft.background === "last_frame" ? "default" : "outline"}
              onClick={() => setDraft({ ...draft, background: "last_frame", frame: null })}
            >
              Freeze the last frame
            </Button>
            {step.segments.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={draft.background === "chosen_frame" && draft.frame?.segmentId === s.id ? "default" : "outline"}
                onClick={() => setDraft({ ...draft, background: "chosen_frame", frame: { segmentId: s.id, timeSec: (s.inSec + s.outSec) / 2 } })}
              >
                Scene {s.sceneOrder + 1} frame
              </Button>
            ))}
          </div>
          {draft.background === "chosen_frame" && chosenSeg && draft.frame && (
            <div className="mt-3">
              <Label className="mb-1.5 block text-xs">
                Frame time in scene {chosenSeg.sceneOrder + 1}: {draft.frame.timeSec.toFixed(2)} s
              </Label>
              <input
                type="range"
                min={chosenSeg.inSec}
                max={chosenSeg.outSec}
                step={1 / 30}
                value={draft.frame.timeSec}
                onChange={(e) => setDraft({ ...draft, frame: { segmentId: chosenSeg.id, timeSec: Number(e.target.value) } })}
                className="w-full accent-[var(--primary)]"
              />
            </div>
          )}
          {draft.background === "last_frame" && lastSeg && (
            <p className="mt-2 text-xs text-muted-foreground">The last frame of scene {lastSeg.sceneOrder + 1} at {lastSeg.outSec.toFixed(2)} s.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(step.cta)}>
            Discard
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save end card
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.ctaPreviewUrl} alt="End card preview" className="aspect-[9/16] w-[300px] rounded-2xl border bg-black object-cover" />
        <p className="text-center text-xs text-muted-foreground">Still preview; the render adds the zoom and the bouncing pointer.</p>
      </div>
    </div>
  );
}

// ---------- Cover ----------

export function CoverPanel({ projectId, step, setData }: Props) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const cover = step.cover;
  const [candidate, setCandidate] = useState<number | null>(cover.chosen?.candidate ?? cover.best);
  const [title, setTitle] = useState(cover.chosen?.title ?? cover.titleOptions[0] ?? "");
  const [prev, setPrev] = useState(JSON.stringify([cover.chosen, cover.best, cover.titleOptions]));
  const key = JSON.stringify([cover.chosen, cover.best, cover.titleOptions]);
  if (prev !== key) {
    setPrev(key);
    setCandidate(cover.chosen?.candidate ?? cover.best);
    setTitle(cover.chosen?.title ?? cover.titleOptions[0] ?? "");
  }

  const suggest = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/projects/${projectId}/cover/suggest`);
      await watch(job, { label: "Picking the cover", successMessage: "Cover suggested" });
      await queryClient.invalidateQueries({ queryKey: projectKeys.compose(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const choose = useMutation({
    mutationFn: () => api.put<ComposeStepDto>(`/projects/${projectId}/cover`, { candidate, title }),
    onSuccess: (d) => {
      setData(d);
      toast.success("Cover rendered");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const chosenChanged = candidate !== cover.chosen?.candidate || title !== cover.chosen?.title;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
        <p className="max-w-xl flex-1 text-sm text-muted-foreground">
          Claude picks the best frame (face clear, outfit fully visible) and writes three titles. The titled cover keeps the title inside
          the centre 1080×1440 area so the profile grid crop still works.
        </p>
        <Button onClick={() => suggest.mutate()} disabled={suggest.isPending}>
          {suggest.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {cover.candidates.length ? "Suggest again" : "Suggest a cover"}
        </Button>
      </div>

      {cover.candidates.length > 0 && (
        <>
          {cover.reason && <p className="text-sm text-muted-foreground">Claude: {cover.reason}</p>}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {cover.candidates.map((c, i) => (
              <button
                key={`${c.assetId}-${c.timeSec}`}
                type="button"
                onClick={() => setCandidate(i)}
                className={cn(
                  "relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-lg border-2",
                  candidate === i ? "border-primary" : "border-transparent hover:border-primary/40",
                )}
                title={c.label}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={c.label} className="size-full object-cover" />
                {cover.best === i && <Badge className="absolute top-1 left-1 text-[10px]">Best</Badge>}
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[10px] text-white">
                  {SCENE_LABEL[c.label.match(/\((\w+)\)/)?.[1] ?? ""] ?? c.label}
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <Label className="text-xs">Title</Label>
              {cover.titleOptions.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={title === t} onChange={() => setTitle(t)} className="accent-[var(--primary)]" /> {t}
                </label>
              ))}
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Or write your own" className="mt-1" />
              <Button className="mt-2 self-start" onClick={() => choose.mutate()} disabled={candidate === null || !title.trim() || choose.isPending}>
                {choose.isPending ? <Loader2 className="animate-spin" /> : <ImageIcon />} {chosenChanged ? "Render cover" : "Re-render cover"}
              </Button>
            </div>
            <div className="flex gap-3">
              {[
                { url: cover.plainUrl, label: "cover.jpg" },
                { url: cover.titledUrl, label: "cover_titled.jpg" },
              ].map((c) => (
                <figure key={c.label} className="flex flex-col items-center gap-1">
                  {c.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.url} alt={c.label} className="aspect-[9/16] w-44 rounded-xl border object-cover" />
                  ) : (
                    <div className="flex aspect-[9/16] w-44 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                      not rendered
                    </div>
                  )}
                  <figcaption className="font-mono text-[11px] text-muted-foreground">{c.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Caption, DM, checklist, music ----------

export function CaptionsPanel({ projectId, step, setData }: Props) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const generate = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/projects/${projectId}/captions`);
      await watch(job, { label: "Writing the caption package", successMessage: "Caption package ready" });
      await queryClient.invalidateQueries({ queryKey: projectKeys.compose(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <p className="flex-1 text-sm text-muted-foreground">
            In her voice, facts only from the product spec, with the store&apos;s disclosure lines and the LINK DM.
          </p>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {step.captions ? "Regenerate" : "Write caption package"}
          </Button>
        </div>
        {step.captions && <CaptionEditor key={step.captions.updatedAt} projectId={projectId} captions={step.captions} setData={setData} />}
      </div>
      <MusicCard projectId={projectId} step={step} setData={setData} />
    </div>
  );
}

function CaptionEditor({ projectId, captions, setData }: { projectId: string; captions: CaptionPackageDto; setData: (d: ComposeStepDto) => void }) {
  const [draft, setDraft] = useState(captions);
  const dirty = JSON.stringify(draft) !== JSON.stringify(captions);
  const save = useMutation({
    mutationFn: (body: Partial<CaptionPackageDto>) => api.put<ComposeStepDto>(`/projects/${projectId}/captions`, body),
    onSuccess: setData,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const field = (label: string, value: string, onChange: (v: string) => void, rows: number) => (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <CopyButton text={value} size="sm" variant="outline" />
      </div>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className="text-sm" />
    </div>
  );

  return (
    <>
      {field("Caption", draft.caption, (caption) => setDraft({ ...draft, caption }), 10)}
      {field("First comment (optional)", draft.firstComment ?? "", (v) => setDraft({ ...draft, firstComment: v || null }), 2)}
      {field("DM reply when someone comments LINK", draft.dmTemplate, (dmTemplate) => setDraft({ ...draft, dmTemplate }), 5)}
      <div className="rounded-xl border bg-card p-4">
        <Label className="mb-2 block text-xs">Posting checklist</Label>
        <ul className="flex flex-col gap-2">
          {draft.checklist.map((c, i) => (
            <li key={c.item}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={c.done}
                  onCheckedChange={(v) => {
                    const checklist = draft.checklist.map((x, j) => (j === i ? { ...x, done: Boolean(v) } : x));
                    setDraft({ ...draft, checklist });
                    save.mutate({ checklist });
                  }}
                />
                <span className={cn(c.done && "text-muted-foreground line-through")}>{c.item}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(captions)}>
          Discard
        </Button>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ caption: draft.caption, firstComment: draft.firstComment, dmTemplate: draft.dmTemplate })}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save edits
        </Button>
      </div>
    </>
  );
}

function MusicCard({ projectId, step, setData }: Props) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("files", file);
      return api.upload<ComposeStepDto>(`/projects/${projectId}/music`, form);
    },
    onSuccess: setData,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/projects/${projectId}/music`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectKeys.compose(projectId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-3 self-start rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Music className="size-4 text-primary" /> Music (optional)
      </h3>
      <p className="text-xs text-muted-foreground">
        By default the Reel has a silent track so you can add trending audio in Instagram. An uploaded track is normalised to about
        -14 LUFS and faded out.
      </p>
      {step.music ? (
        <>
          <audio controls src={step.music.url} className="w-full" />
          <p className="truncate text-xs">
            {step.music.name} · {step.music.durationSec.toFixed(1)} s
          </p>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove.mutate()}>
            <Trash2 /> Remove music
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Upload a track
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
