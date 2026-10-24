"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { PRICE_MODES, priceLabel, sourceDefinition, type InfluencerDto, type PriceMode, type SourceDto } from "@reel/shared";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function InfluencerPicker({
  influencers,
  value,
  onChange,
}: {
  influencers: InfluencerDto[];
  value: string;
  onChange: (id: string) => void;
}) {
  const usable = influencers.filter((i) => i.status !== "archived");
  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No influencers yet.{" "}
        <Link href="/influencers/new" className="text-primary hover:underline">
          Create one
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {usable.map((inf) => {
        const selected = inf.id === value;
        return (
          <button
            key={inf.id}
            type="button"
            onClick={() => onChange(inf.id)}
            className={cn(
              "relative overflow-hidden rounded-xl border text-left transition-all",
              selected ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/50",
            )}
          >
            <div className="aspect-[4/5] bg-gradient-to-br from-primary/15 to-muted">
              {inf.anchor ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inf.anchor.url} alt={inf.name} className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center font-display text-3xl font-extrabold text-primary/40">
                  {inf.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className="text-sm font-medium">{inf.name}</p>
              <p className="text-xs text-muted-foreground">{inf.city}</p>
              {!inf.anchor && <p className="mt-1 text-[11px] text-amber-600">No anchor image yet</p>}
              {inf.status === "draft" && <p className="mt-1 text-[11px] text-amber-600">Draft</p>}
            </div>
            {selected && (
              <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-4" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The uploaded store logo, or a monogram in the store's colour until one is uploaded. */
export function SourceLogo({ source, className }: { source: Pick<SourceDto, "key" | "displayName" | "logoUrl">; className?: string }) {
  if (source.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={source.logoUrl} alt={source.displayName} className={cn("max-h-8 max-w-[80%] object-contain", className)} />;
  }
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5 font-display text-sm font-semibold">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white ring-1 ring-white/25"
        style={{ backgroundColor: sourceDefinition(source.key)?.brandColor ?? "#6b7280" }}
        aria-hidden
      >
        {source.displayName.charAt(0)}
      </span>
      <span className="truncate">{source.displayName}</span>
    </span>
  );
}

export function SourcePicker({
  sources,
  value,
  onChange,
}: {
  sources: SourceDto[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {sources.map((s) => {
        const selected = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={cn(
              "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border px-3 transition-all",
              selected ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/50",
            )}
          >
            <SourceLogo source={s} />
            <span className="text-[11px] text-muted-foreground">
              {s.priceMode === "under_band" ? "Under-₹X band" : s.priceMode === "hidden" ? "Logo only" : "Exact price"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const MODE_LABEL: Record<PriceMode, string> = {
  exact: "Exact price",
  under_band: "Under ₹X band",
  hidden: "Logo only",
};

/** Price mode shown next to the price field: the source default, or a per-project override. */
export function PriceModeField({
  price,
  source,
  override,
  onOverride,
}: {
  price: number;
  source: SourceDto | undefined;
  override: PriceMode | null;
  onOverride: (mode: PriceMode | null) => void;
}) {
  if (!source) return null;
  const mode = override ?? source.priceMode;
  const label = price > 0 ? priceLabel(price, mode) : null;
  const options = [
    { value: "default", label: `${source.displayName} default (${MODE_LABEL[source.priceMode]})` },
    ...PRICE_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={override ?? "default"}
        items={options}
        onValueChange={(v) => onOverride(!v || v === "default" ? null : (v as PriceMode))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Badge shows{" "}
        <span className="rounded-full bg-foreground px-2 py-0.5 font-display font-semibold text-background">
          {label ?? (mode === "hidden" ? "logo only" : "—")}
        </span>
        {source.key === "amazon" && mode === "exact" && (
          <span className="ml-1 text-amber-600">Amazon Associates restricts exact prices in static content.</span>
        )}
      </p>
    </div>
  );
}

/** The project's on-screen text switch (off: no scene gets text over the outfit). */
export function ShowTextField({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={value} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        On-screen text
        <span className="block text-xs text-muted-foreground">Off: no scene shows text, so nothing covers the outfit. You can change this on the Compose step.</span>
      </span>
    </label>
  );
}
