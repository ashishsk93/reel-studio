"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface CompareImage {
  label: string;
  url: string | null;
}

/** Hover to magnify around the cursor. */
export function ZoomImage({ src, alt, zoom = 2.5, className, children }: { src: string; alt: string; zoom?: number; className?: string; children?: ReactNode }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`);
  };
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      onMouseMove={zoom > 1 ? move : undefined}
      onMouseLeave={() => setOrigin(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="size-full object-contain transition-transform duration-75"
        style={origin ? { transform: `scale(${zoom})`, transformOrigin: origin } : undefined}
        draggable={false}
      />
      {children}
    </div>
  );
}

/** Generated image next to the product photos and her references, each zoomable. */
export function CompareDialog({
  open,
  onOpenChange,
  generated,
  images,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generated: CompareImage;
  images: CompareImage[];
}) {
  const [zoom, setZoom] = useState(true);
  const all = [generated, ...images];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription className="flex items-center gap-3">
            Hover an image to magnify it.
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={zoom} onCheckedChange={setZoom} /> Magnifier
            </label>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {all.map((image, i) => (
            <figure key={`${image.label}-${i}`} className="flex min-w-48 flex-1 flex-col gap-1.5">
              <figcaption className={cn("text-xs font-medium", i === 0 && "text-primary")}>{image.label}</figcaption>
              <div className={cn("h-[72vh] rounded-lg border bg-muted", i === 0 && "ring-2 ring-primary")}>
                {image.url ? (
                  <ZoomImage src={image.url} alt={image.label} zoom={zoom ? 2.5 : 1} className="size-full" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-6" />
                  </div>
                )}
              </div>
            </figure>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
