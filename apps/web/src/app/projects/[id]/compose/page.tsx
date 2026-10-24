"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RotateCcw, ScanFace, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { ComposeSegmentDto, ComposeStepDto, JobDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState } from "@/components/page-header";
import { ReelPreview } from "@/components/compose/reel-preview";
import { CaptionsPanel, CoverPanel, CtaPanel } from "@/components/compose/panels";
import { SCENE_LABEL } from "@/components/projects/scene-dialog";
import { API_URL, api, errorMessage } from "@/lib/api";
import { useJobRefresh, useJobWatcher } from "@/lib/jobs";
import { detectFrames } from "@/lib/mediapipe";
import { projectKeys, useComposeStep } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function ComposePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, error, isPending } = useComposeStep(id);
  const key = projectKeys.compose(id);
  useJobRefresh(["segment.details", "segment.placement_check", "cover.suggest", "captions.generate"], key);
  const setData = (next: ComposeStepDto) => queryClient.setQueryData(key, next);
  const detecting = useAutoDetect(id, data, setData);

  const showTextAll = useMutation({
    mutationFn: (on: boolean) => api.put<ComposeStepDto>(`/projects/${id}/compose/text`, { showText: on }),
    onSuccess: setData,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const complete = useMutation({
    mutationFn: () => api.post(`/projects/${id}/compose/complete`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects", id] });
      router.push(`/projects/${id}/export`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) return <ErrorState error={error} />;
  if (isPending || !data) return <Skeleton className="h-96 rounded-xl" />;
  if (data.segments.length === 0) {
    return (
      <EmptyState title="No approved videos yet">
        <Link className="text-primary hover:underline" href={`/projects/${id}/videos`}>
          Approve a video window for every scene in step 6
        </Link>
      </EmptyState>
    );
  }

  const len = data.totalSec;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">
            {data.segments.length} segments + {data.cta.durationSec}s end card ={" "}
            <span className={len < 16 || len > 20 ? "text-amber-600" : ""}>{len}s</span>
          </span>
          <span className="text-muted-foreground"> (target 16–20 s)</span>
        </p>
        {detecting && (
          <Badge variant="outline">
            <Loader2 className="animate-spin" /> {detecting}
          </Badge>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm" title="Turn on-screen text on or off for every scene; each scene also has its own switch">
          <Switch
            checked={data.segments.some((s) => s.showText)}
            onCheckedChange={(v) => showTextAll.mutate(v)}
            disabled={showTextAll.isPending}
          />{" "}
          Text on all scenes
          {data.segments.some((s) => s.showText) && data.segments.some((s) => !s.showText) && (
            <span className="text-xs text-muted-foreground">
              ({data.segments.filter((s) => s.showText).length}/{data.segments.length})
            </span>
          )}
        </label>
        <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
          Export <ArrowRight />
        </Button>
      </div>
      {data.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          {data.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      <Tabs defaultValue="overlays">
        <TabsList className="mb-4">
          <TabsTrigger value="overlays">Text and badge</TabsTrigger>
          <TabsTrigger value="cta">End card</TabsTrigger>
          <TabsTrigger value="cover">Cover</TabsTrigger>
          <TabsTrigger value="captions">Caption and music</TabsTrigger>
        </TabsList>
        <TabsContent value="overlays">
          <Overlays projectId={id} step={data} setData={setData} />
        </TabsContent>
        <TabsContent value="cta">
          <CtaPanel projectId={id} step={data} setData={setData} />
        </TabsContent>
        <TabsContent value="cover">
          <CoverPanel projectId={id} step={data} setData={setData} />
        </TabsContent>
        <TabsContent value="captions">
          <CaptionsPanel projectId={id} step={data} setData={setData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Runs MediaPipe on segments that have no detections yet and posts the boxes. */
function useAutoDetect(projectId: string, step: ComposeStepDto | undefined, setData: (d: ComposeStepDto) => void): string | null {
  const [status, setStatus] = useState<string | null>(null);
  const running = useRef(false);
  const [failed, setFailed] = useState<string[]>([]);
  const pending = step?.segments.filter((s) => !s.detections.detected && !failed.includes(s.id)) ?? [];
  const pendingKey = pending.map((s) => s.id).join(",");

  useEffect(() => {
    if (!pendingKey || running.current) return;
    running.current = true;
    const ids = pendingKey.split(",");
    (async () => {
      for (const [i, segId] of ids.entries()) {
        const seg = step!.segments.find((s) => s.id === segId)!;
        setStatus(`Finding faces and hands ${i + 1}/${ids.length}`);
        try {
          const found = await detectFrames(seg.sampleTimes.map((t) => `${API_URL}/assets/${seg.assetId}/frame?t=${t.toFixed(3)}`));
          setData(await api.post<ComposeStepDto>(`/segments/${segId}/detections`, found));
        } catch (e) {
          setFailed((f) => [...f, segId]);
          toast.error(errorMessage(e));
          break;
        }
      }
      setStatus(null);
      running.current = false;
    })();
  }, [pendingKey, projectId, setData, step]);

  return status;
}

function Overlays({ projectId, step, setData }: { projectId: string; step: ComposeStepDto; setData: (d: ComposeStepDto) => void }) {
  const [selectedId, setSelectedId] = useState(step.segments[0].id);
  const [zones, setZones] = useState(true);
  const [boxes, setBoxes] = useState(false);
  const seg = step.segments.find((s) => s.id === selectedId) ?? step.segments[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ol className="flex flex-col gap-2">
        {step.segments.map((s) => (
          <SegmentRow
            key={s.id}
            segment={s}
            active={s.id === seg.id}
            onSelect={() => setSelectedId(s.id)}
            setData={setData}
            projectId={projectId}
          />
        ))}
      </ol>
      <aside className="flex flex-col items-center gap-3 self-start lg:sticky lg:top-4">
        <ReelPreview
          segment={seg}
          step={step}
          showZones={zones}
          showDetections={boxes}
          onMoveBadge={(pos) =>
            void api
              .put<ComposeStepDto>(`/segments/${seg.id}/compose`, { badgePlacement: pos })
              .then(setData)
              .catch((e) => toast.error(errorMessage(e)))
          }
        />
        <div className="flex flex-wrap justify-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <Switch checked={zones} onCheckedChange={setZones} /> Instagram UI areas
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={boxes} onCheckedChange={setBoxes} /> Detections
          </label>
        </div>
        {boxes && (
          <p className="text-center text-[11px] text-muted-foreground">
            <span className="text-red-500">face</span> · <span className="text-amber-500">hands</span> · <span className="text-sky-500">body</span> ·{" "}
            <span className="text-fuchsia-500">garment detail</span> · white: text
          </p>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {seg.badge && seg.product ? (
            <>
              Badge: {seg.product.store} {seg.product.priceLabel ?? "(logo only)"} · drag it to move
            </>
          ) : seg.product ? (
            "No badge: upload the store logo under Sources & logos"
          ) : (
            "No badge: this scene shows no product"
          )}
        </p>
      </aside>
    </div>
  );
}

function SegmentRow({
  segment: s,
  active,
  onSelect,
  setData,
  projectId,
}: {
  segment: ComposeSegmentDto;
  active: boolean;
  onSelect: () => void;
  setData: (d: ComposeStepDto) => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const [text, setText] = useState(s.onScreenText);
  const [prev, setPrev] = useState(s.onScreenText);
  if (prev !== s.onScreenText) {
    setPrev(s.onScreenText);
    setText(s.onScreenText);
  }
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ComposeStepDto>(`/segments/${s.id}/compose`, body),
    onSuccess: setData,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const suggest = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/segments/${s.id}/text/suggest`, { instruction: instruction.trim() || undefined });
      const done = await watch(job, { label: `Writing text for scene ${s.sceneOrder + 1}`, successMessage: "Pick one of the new texts" });
      const result = done.result as { options?: string[] } | null;
      if (done.status === "succeeded") setOptions(result?.options ?? []);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const choose = (option: string) => {
    setText(option);
    update.mutate({ onScreenText: option });
    setOptions([]);
    setSuggestOpen(false);
    setInstruction("");
  };
  const check = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/segments/${s.id}/placement/check`);
      const done = await watch(job, { label: `Checking the badge on scene ${s.sceneOrder + 1}` });
      const result = done.result as { ok?: boolean; note?: string } | null;
      if (done.status === "succeeded") toast[result?.ok ? "success" : "warning"](result?.note ?? "Checked");
      await queryClient.invalidateQueries({ queryKey: projectKeys.compose(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li
      onClick={onSelect}
      className={cn("flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 transition-colors", active ? "border-primary ring-1 ring-primary" : "hover:border-primary/40")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{s.sceneOrder + 1}</span>
        <span className="text-sm font-semibold">{SCENE_LABEL[s.sceneType]}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {s.inSec.toFixed(2)}–{s.outSec.toFixed(2)} s · {(s.outSec - s.inSec).toFixed(1)} s
        </span>
        {!s.detections.detected && <Badge variant="outline">Detecting…</Badge>}
        {s.detections.detected && s.badgeEnabled && !s.detections.detailsChecked && (
          <Badge variant="outline">
            <Loader2 className="animate-spin" /> Garment details
          </Badge>
        )}
      </div>
      <Input
        value={text}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== s.onScreenText && update.mutate({ onScreenText: text })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="font-display font-semibold"
        placeholder="No on-screen text"
        disabled={!s.showText}
        title={s.showText ? undefined : "On-screen text is off for this scene"}
      />
      {suggestOpen ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !suggest.isPending && suggest.mutate()}
              placeholder="Optional: more playful, mention the colour…"
              className="h-8 text-xs"
            />
            <Button size="sm" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
              {suggest.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {options.length ? "Again" : "Suggest"}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => (setSuggestOpen(false), setOptions([]))}>
              <X />
            </Button>
          </div>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => choose(o)}
                  className="rounded-full border bg-background px-3 py-1 font-display text-sm font-semibold transition-colors hover:border-primary hover:bg-primary/5"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-2">
          <Switch checked={s.showText} onCheckedChange={(v) => update.mutate({ showText: v })} /> On-screen text
        </label>
        {!suggestOpen && s.showText && (
          <Button size="xs" variant="ghost" onClick={() => setSuggestOpen(true)}>
            <Sparkles /> New text
          </Button>
        )}
        <label className="flex items-center gap-2">
          <Switch checked={s.badgeEnabled} onCheckedChange={(v) => update.mutate({ badgeEnabled: v })} /> Logo and price badge
          {!s.badgeEligible && <span className="text-muted-foreground">(not a product scene)</span>}
        </label>
        {s.badgeEnabled && s.placement && (
          <>
            <span className="text-muted-foreground">{s.placement.manual ? "Placed by hand" : `Auto: ${s.placement.anchor}${s.placement.scale < 1 ? " (80%)" : ""}`}</span>
            {s.placement.manual && (
              <Button size="xs" variant="ghost" onClick={() => update.mutate({ badgePlacement: null })}>
                <RotateCcw /> Auto
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check with Claude
            </Button>
          </>
        )}
        {!s.detections.detected && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <ScanFace className="size-3.5" /> waiting for detection
          </span>
        )}
      </div>
      {s.badgeEnabled && s.placementWarning && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {s.placementWarning}
        </p>
      )}
    </li>
  );
}
