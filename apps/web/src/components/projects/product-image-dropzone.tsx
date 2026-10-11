"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { PRODUCT_IMAGE_ROLES, type ProductImageRole } from "@reel/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface PendingImage {
  file: File;
  role: ProductImageRole;
}

export const ROLE_LABEL: Record<ProductImageRole, string> = {
  front: "Front",
  back: "Back",
  detail: "Detail",
  pants: "Pants / bottom",
  lifestyle: "Lifestyle",
  other: "Other",
};

/** Guesses a sensible role from position: first image front, the rest "other". */
function defaultRole(index: number, existing: PendingImage[]): ProductImageRole {
  if (index === 0 && !existing.some((i) => i.role === "front")) return "front";
  return "other";
}

export function RoleSelect({ value, onChange }: { value: ProductImageRole; onChange: (role: ProductImageRole) => void }) {
  return (
    <Select
      value={value}
      items={PRODUCT_IMAGE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
      onValueChange={(v) => v && onChange(v as ProductImageRole)}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRODUCT_IMAGE_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={file.name} className="size-full object-cover" /> : null;
}

/** Drag-and-drop product photos, each with a role tag. */
export function ProductImageDropzone({
  value,
  onChange,
}: {
  value: PendingImage[];
  onChange: (next: PendingImage[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    onChange([...value, ...files.map((file, i) => ({ file, role: defaultRole(value.length + i, value) }))]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3">
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
        <span>Drop the listing photos here, or click to choose</span>
        <span className="text-xs">Tag each one: a back photo lets the storyboard use back views.</span>
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
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {value.map((item, i) => (
            <div key={`${item.file.name}-${i}`} className="flex flex-col gap-1.5">
              <div className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
                <Preview file={item.file} />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <RoleSelect value={item.role} onChange={(role) => onChange(value.map((v, j) => (j === i ? { ...v, role } : v)))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
