"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Columns3, ImagePlus, Loader2, RefreshCw, ScanFace, Sparkles, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { AssetDto, Box, JobDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { AssistantPanel } from "@/components/assets/assistant-panel";
import { CompareDialog, ZoomImage, type CompareImage } from "@/components/assets/compare-view";
import { ReviewCard, VERDICT_STYLE } from "@/components/assets/review-card";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Versions of one scene's (or character frame's) generated image: upload, review, compare,
 * approve or reject, and the modification assistant.
 */
export function AssetWorkbench({
  assets,
  uploadPath,
  compare,
  onChanged,
  safeZone,
  aspect = "9/16",
  disabled,
  emptyHint,
}: {
  assets: AssetDto[];
  /** POST endpoint taking multipart `files`. */
  uploadPath: string;
  compare: CompareImage[];
  onChanged: () => void | Promise<unknown>;
  /** Shade the top and bottom bands Instagram covers. */
  safeZone?: { top: number; bottom: number };
  /** CSS aspect ratio of the preview. */
  aspect?: string;
  disabled?: ReactNode;
  emptyHint?: ReactNode;
}) {
  const approved = assets.find((a) => a.status === "approved");
  const [selectedId, setSelectedId] = useState<string | undefined>(approved?.id ?? assets[0]?.id);
  // The upload handler selects the newest upload; until the list refetches, fall back to approved/newest.
  const selected = assets.find((a) => a.id === selectedId) ?? approved ?? assets[0];

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      return api.upload<AssetDto[]>(uploadPath, form);
    },
    onSuccess: async (created) => {
      toast.success(`Uploaded ${created.length} image${created.length === 1 ? "" : "s"}; Claude is reviewing`);
      if (created[0]) setSelectedId(created[created.length - 1].id);
      await onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        {assets.map((a) => (
          <VersionThumb key={a.id} asset={a} active={a.id === selected?.id} aspect={aspect} onClick={() => setSelectedId(a.id)} />
        ))}
        {disabled ? null : <UploadTile aspect={aspect} pending={upload.isPending} onFiles={(f) => upload.mutate(f)} big={assets.length === 0} />}
      </div>

      {disabled && <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{disabled}</div>}
      {!disabled && assets.length === 0 && emptyHint && <div className="text-sm text-muted-foreground">{emptyHint}</div>}

      {selected && (
        <AssetDetail key={selected.id} asset={selected} compare={compare} onChanged={onChanged} safeZone={safeZone} />
      )}
    </div>
  );
}

function VersionThumb({ asset, active, aspect, onClick }: { asset: AssetDto; active: boolean; aspect: string; onClick: () => void }) {
  const verdict = asset.review?.verdict;
  const reviewing = asset.reviewJob && asset.reviewJob.status !== "failed";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-16 overflow-hidden rounded-lg border-2 bg-muted transition-all",
        active ? "border-primary" : "border-transparent hover:border-primary/40",
        asset.status === "rejected" && "opacity-50",
      )}
      style={{ aspectRatio: aspect }}
      title={`Version ${asset.version}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.url} alt={`v${asset.version}`} className="size-full object-cover" loading="lazy" />
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">v{asset.version}</span>
      {asset.status === "approved" && <CheckCircle2 className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white text-primary" />}
      {asset.status === "rejected" && <XCircle className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white text-destructive" />}
      {reviewing ? (
        <Loader2 className="absolute top-0.5 left-0.5 size-3.5 animate-spin text-white drop-shadow" />
      ) : (
        verdict && <span className={cn("absolute top-1 left-1 size-2.5 rounded-full ring-2 ring-white", VERDICT_STYLE[verdict].dot)} />
      )}
    </button>
  );
}

function UploadTile({ onFiles, pending, aspect, big }: { onFiles: (files: File[]) => void; pending: boolean; aspect: string; big: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (files.length) onFiles(files);
    else if (list?.length) toast.error("Only JPEG, PNG and WebP images.");
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
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
      onDrop={onDrop}
      disabled={pending}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground transition-colors",
        big ? "w-40 px-3 text-xs" : "w-16 text-[10px]",
        dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:text-foreground",
      )}
      style={{ aspectRatio: aspect }}
    >
      {pending ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
      {big ? "Drop generated images here or click to upload" : "Upload"}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function AssetDetail({
  asset,
  compare,
  onChanged,
  safeZone,
}: {
  asset: AssetDto;
  compare: CompareImage[];
  onChanged: () => void | Promise<unknown>;
  safeZone?: { top: number; bottom: number };
}) {
  const [highlight, setHighlight] = useState<Box | null>(null);
  const [showZone, setShowZone] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const after = async () => {
    await onChanged();
  };

  const approve = useMutation({ mutationFn: () => api.post<AssetDto>(`/assets/${asset.id}/approve`), onSuccess: after, onError });
  const reject = useMutation({ mutationFn: () => api.post<AssetDto>(`/assets/${asset.id}/reject`), onSuccess: after, onError });
  const remove = useMutation({ mutationFn: () => api.del(`/assets/${asset.id}`), onSuccess: after, onError });
  const review = useMutation({ mutationFn: () => api.post<JobDto>(`/assets/${asset.id}/review`), onSuccess: after, onError });
  const reviewing = Boolean(asset.reviewJob && asset.reviewJob.status !== "failed");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,300px)_1fr]">
      <div className="flex flex-col gap-3">
        <ZoomImage src={asset.url} alt={`Version ${asset.version}`} zoom={2} className="w-full max-w-[300px] rounded-xl border bg-muted">
          {showZone && safeZone && (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/45" style={{ height: `${safeZone.top * 100}%` }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${safeZone.bottom * 100}%` }} />
            </>
          )}
          {highlight && (
            <div
              className="pointer-events-none absolute rounded border-2 border-amber-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
              style={{
                left: `${highlight.x * 100}%`,
                top: `${highlight.y * 100}%`,
                width: `${highlight.w * 100}%`,
                height: `${highlight.h * 100}%`,
              }}
            />
          )}
        </ZoomImage>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            v{asset.version} · {asset.width}×{asset.height}
          </span>
          {asset.status === "approved" && <Badge>Approved</Badge>}
          {asset.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {asset.status !== "approved" && (
            <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}>
              <CheckCircle2 /> Approve
            </Button>
          )}
          {asset.status !== "rejected" && (
            <Button size="sm" variant="outline" onClick={() => reject.mutate()} disabled={reject.isPending}>
              <XCircle /> Reject
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setAssistantOpen(true)}>
            <Sparkles /> Modify
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="ghost" onClick={() => setComparing(true)}>
            <Columns3 /> Compare
          </Button>
          {safeZone && (
            <Button size="xs" variant={showZone ? "secondary" : "ghost"} onClick={() => setShowZone(!showZone)}>
              <ScanFace /> Safe zone
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => review.mutate()} disabled={reviewing || review.isPending}>
            <RefreshCw /> Re-review
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button size="xs" variant="ghost" className="text-destructive" />}>
              <Trash2 /> Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete version {asset.version}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The file, its reviews and its assistant history are deleted. If it is the approved version it is unapproved
                  first; for a character frame, the reference created from it is removed too.
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

      <ReviewCard asset={asset} onRetry={() => review.mutate()} retrying={review.isPending} onHighlight={setHighlight} />

      <CompareDialog
        open={comparing}
        onOpenChange={setComparing}
        generated={{ label: `Generated v${asset.version}`, url: asset.url }}
        images={compare}
      />
      <AssistantPanel
        asset={{ id: asset.id, version: asset.version, url: asset.url, kind: "image", issues: (asset.review?.issues ?? []).map((i) => i.description) }}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
      />
    </div>
  );
}
