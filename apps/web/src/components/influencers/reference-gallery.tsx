"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { REF_TAGS, type InfluencerDetailDto, type ReferenceImageDto, type RefTag } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Expandable } from "@/components/lightbox";

export const TAG_LABEL: Record<RefTag, string> = {
  anchor: "anchor",
  turnaround: "turnaround",
  base_front: "base front",
  base_three_quarter: "base ¾",
  base_walk: "base walk",
  base_hair_up: "base hair up",
  closeup_front: "close-up front",
  closeup_left: "close-up left",
  closeup_right: "close-up right",
  profile: "profile",
  hands: "hands",
  lifestyle: "lifestyle",
  background: "background (room)",
};

export function TagChips({
  selected,
  onToggle,
  disabled,
}: {
  selected: RefTag[];
  onToggle: (tag: RefTag) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {REF_TAGS.map((tag) => {
        const on = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(tag)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {TAG_LABEL[tag]}
          </button>
        );
      })}
    </div>
  );
}

export function ReferenceGallery({ influencer }: { influencer: InfluencerDetailDto }) {
  const present = new Set(influencer.references.flatMap((r) => r.tags));
  const missing = REF_TAGS.filter((t) => !present.has(t));

  return (
    <div className="flex flex-col gap-6">
      <Uploader influencerId={influencer.id} hasAnchor={present.has("anchor")} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Coverage:</span>
        {REF_TAGS.map((t) => (
          <Badge key={t} variant={present.has(t) ? "default" : "outline"} className={cn(!present.has(t) && "text-muted-foreground")}>
            {TAG_LABEL[t]}
          </Badge>
        ))}
        {missing.length === 0 && <span className="text-emerald-600">All tags covered</span>}
      </div>

      {influencer.references.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reference images yet. Start with the anchor.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {influencer.references.map((ref) => (
            <ReferenceCard key={ref.id} reference={ref} influencerId={influencer.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Uploader({ influencerId, hasAnchor }: { influencerId: string; hasAnchor: boolean }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState<RefTag[]>(hasAnchor ? [] : ["anchor"]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("tags", JSON.stringify(tags));
      form.append("note", note);
      return api.upload<ReferenceImageDto[]>(`/influencers/${influencerId}/references`, form);
    },
    onSuccess: (created) => {
      toast.success(`Uploaded ${created.length} image${created.length === 1 ? "" : "s"}`);
      setFiles([]);
      setNote("");
      setTags([]);
      void queryClient.invalidateQueries({ queryKey: ["influencers"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list).filter((f) => f.type.startsWith("image/"))]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors",
          dragging ? "border-primary bg-primary/5" : "hover:border-primary/50",
        )}
      >
        <ImagePlus className="size-6" />
        <span>Drop reference images here, or click to choose (JPEG, PNG, WebP)</span>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="relative">
                <FilePreview file={f} />
                <button
                  type="button"
                  aria-label="Remove"
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] text-background"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium">Tags for {files.length === 1 ? "this image" : "these images"}</p>
            <TagChips
              selected={tags}
              onToggle={(t) => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
            />
            {tags.includes("anchor") && files.length > 1 && (
              <p className="mt-2 text-xs text-destructive">The anchor must be uploaded on its own.</p>
            )}
            {tags.includes("anchor") && hasAnchor && (
              <p className="mt-2 text-xs text-amber-600">This replaces the current anchor (the old image keeps its other tags).</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload {files.length}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    if (img.current) img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} alt={file.name} className="h-24 w-16 rounded-md border object-cover" />;
}

function ReferenceCard({ reference, influencerId }: { reference: ReferenceImageDto; influencerId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(reference.note);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["influencers"] });

  const update = useMutation({
    mutationFn: (body: { tags?: RefTag[]; note?: string }) => api.patch(`/references/${reference.id}`, body),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/references/${reference.id}`),
    onSuccess: () => {
      toast.success("Reference deleted");
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = (tag: RefTag) =>
    update.mutate({ tags: reference.tags.includes(tag) ? reference.tags.filter((t) => t !== tag) : [...reference.tags, tag] });

  return (
    <div className="group overflow-hidden rounded-xl border bg-card" data-influencer={influencerId}>
      <Expandable items={[{ url: reference.url, label: reference.tags.join(", ") || "Reference" }]} className="relative block aspect-[3/4] bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={reference.url} alt={reference.tags.join(", ")} className="size-full object-cover" loading="lazy" />
        {reference.tags.includes("anchor") && (
          <span className="absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            Anchor
          </span>
        )}
      </Expandable>
      <div className="flex flex-col gap-2 p-3">
        {editing ? (
          <>
            <TagChips selected={reference.tags} onToggle={toggle} disabled={update.isPending} />
            <div className="flex gap-1.5">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="h-7 text-xs" />
              <Button
                size="sm"
                onClick={() => {
                  if (note !== reference.note) update.mutate({ note });
                  setEditing(false);
                }}
              >
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-5 flex-wrap gap-1">
              {reference.tags.length === 0 && <span className="text-xs text-amber-600">Untagged</span>}
              {reference.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[11px]">
                  {TAG_LABEL[t]}
                </Badge>
              ))}
            </div>
            {reference.note && <p className="text-xs text-muted-foreground">{reference.note}</p>}
          </>
        )}
        <div className="flex justify-between">
          <span className="text-[11px] text-muted-foreground">
            {reference.width}×{reference.height}
          </span>
          <div className="flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
            <Button variant="ghost" size="icon-xs" aria-label="Edit tags" onClick={() => setEditing(!editing)}>
              <Pencil />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Delete" />}>
                <Trash2 />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this reference image?</AlertDialogTitle>
                  <AlertDialogDescription>The file is removed from disk. This can&apos;t be undone.</AlertDialogDescription>
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
      </div>
    </div>
  );
}
