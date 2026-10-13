"use client";

import { Check, Clapperboard, Gift, Shirt, ShoppingBag, Sparkles } from "lucide-react";
import { FORMATS, STORY_FORMATS, type PriceMode, type ProductDto, type SourceDto, type StoryFormat } from "@reel/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/page-header";
import { PriceModeField, SourcePicker } from "@/components/projects/pickers";
import { cn } from "@/lib/utils";

/** Editable fields of one product (photos are handled separately). */
export interface ProductDraft {
  title: string;
  note: string;
  sourceId: string;
  priceInr: string;
  priceModeOverride: PriceMode | null;
  productUrl: string;
  affiliateLink: string;
}

export const emptyProduct = (sourceId = ""): ProductDraft => ({
  title: "",
  note: "",
  sourceId,
  priceInr: "",
  priceModeOverride: null,
  productUrl: "",
  affiliateLink: "",
});

export function productDraft(p: ProductDto): ProductDraft {
  return {
    title: p.title,
    note: p.note,
    sourceId: p.source.id,
    priceInr: String(p.priceInr),
    priceModeOverride: p.priceModeOverride,
    productUrl: p.productUrl ?? "",
    affiliateLink: p.affiliateLink ?? "",
  };
}

/** Title, on-screen note (multi-product formats), store, price and links of one product. */
export function ProductFields({
  value,
  onChange,
  sources,
  errors = {},
  showNote,
}: {
  value: ProductDraft;
  onChange: (next: ProductDraft) => void;
  sources: SourceDto[];
  errors?: Record<string, string>;
  showNote?: boolean;
}) {
  const set = <K extends keyof ProductDraft>(key: K, v: ProductDraft[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-4", showNote && "md:grid-cols-2")}>
        <div>
          <Label className="mb-1.5 block">Product title</Label>
          <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="As on the listing" />
          <FieldError message={errors.title} />
        </div>
        {showNote && (
          <div>
            <Label className="mb-1.5 block">On-screen note (optional)</Label>
            <Input value={value.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. Pure cotton, 3 colours" maxLength={60} />
            <FieldError message={errors.note} />
          </div>
        )}
      </div>
      <div>
        <Label className="mb-1.5 block">Store</Label>
        <SourcePicker sources={sources} value={value.sourceId} onChange={(id) => set("sourceId", id)} />
        <FieldError message={errors.sourceId} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div>
          <Label className="mb-1.5 block">Price (₹)</Label>
          <Input type="number" min={1} value={value.priceInr} onChange={(e) => set("priceInr", e.target.value)} placeholder="499" />
          <FieldError message={errors.priceInr} />
        </div>
        <div>
          <Label className="mb-1.5 block">Price on the badge</Label>
          <PriceModeField
            price={Number(value.priceInr) || 0}
            source={sources.find((s) => s.id === value.sourceId)}
            override={value.priceModeOverride}
            onOverride={(mode) => set("priceModeOverride", mode)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-1.5 block">Product URL (optional)</Label>
          <Input value={value.productUrl} onChange={(e) => set("productUrl", e.target.value)} placeholder="https://" />
          <FieldError message={errors.productUrl} />
        </div>
        <div>
          <Label className="mb-1.5 block">Affiliate link (optional)</Label>
          <Input value={value.affiliateLink} onChange={(e) => set("affiliateLink", e.target.value)} placeholder="https://" />
          <FieldError message={errors.affiliateLink} />
        </div>
      </div>
    </div>
  );
}

export const FORMAT_ICON: Record<StoryFormat, typeof Gift> = {
  classic: Gift,
  haul: ShoppingBag,
  occasion: Sparkles,
  transition: Clapperboard,
  three_ways: Shirt,
};

export function productRange(format: StoryFormat): string {
  const { min, max } = FORMATS[format].products;
  return min === max ? `${min} product${min > 1 ? "s" : ""}` : `${min}–${max} products`;
}

/** The story format cards shown when creating a project. */
export function FormatPicker({ value, onChange }: { value: StoryFormat; onChange: (format: StoryFormat) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {STORY_FORMATS.map((f) => {
        const rule = FORMATS[f];
        const Icon = FORMAT_ICON[f];
        const selected = f === value;
        return (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            className={cn(
              "relative flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all",
              selected ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/50",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} /> {rule.label}
            </span>
            <span className="text-xs text-muted-foreground">{rule.description}</span>
            <span className="mt-auto pt-1 text-[11px] text-muted-foreground">
              {productRange(f)} · {rule.reelSec.min}–{rule.reelSec.max} s
            </span>
            {selected && (
              <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
