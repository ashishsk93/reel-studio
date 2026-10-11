"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PRICE_MODES, priceLabel, type PriceMode, type SourceDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { ListEditor } from "@/components/list-editor";
import { api, errorMessage } from "@/lib/api";
import { keys, useSources } from "@/lib/queries";

const MODE_LABEL: Record<PriceMode, string> = {
  exact: "Exact price",
  under_band: "“Under ₹X” band",
  hidden: "Logo only",
};

const MODE_HINT: Record<PriceMode, string> = {
  exact: "Shows the price you enter.",
  under_band: "Rounds up to the next ₹100 / ₹500 / ₹1,000. Use for Amazon: Associates restricts exact prices in static content.",
  hidden: "No price on the badge.",
};

export default function SourcesPage() {
  const { data, isPending, error } = useSources();
  return (
    <>
      <PageHeader
        title="Sources & logos"
        description="The store logo and price badge appear on product-showing segments. Disclosure lines go into every caption and DM reply."
      />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        {isPending
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[520px] rounded-xl" />)
          : data?.map((source) => <SourceCard key={source.id} source={source} />)}
      </div>
    </>
  );
}

function SourceCard({ source }: { source: SourceDto }) {
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => pick(source));
  useEffect(() => setForm(pick(source)), [source]);
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(source));
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.sources });

  const save = useMutation({
    mutationFn: () =>
      api.patch<SourceDto>(`/sources/${source.id}`, {
        ...form,
        disclosureLines: form.disclosureLines.map((l) => l.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(`${source.displayName} saved`);
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (f: File) => {
      const body = new FormData();
      body.append("file", f);
      return api.upload<SourceDto>(`/sources/${source.id}/logo`, body);
    },
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeLogo = useMutation({
    mutationFn: () => api.del<SourceDto>(`/sources/${source.id}/logo`),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const example = priceLabel(1499, form.priceMode);

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">{source.displayName}</h2>

      <div>
        <Label className="mb-1.5 block">Logo</Label>
        <div className="bg-checker flex h-28 items-center justify-center rounded-lg border">
          {source.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.logoUrl} alt={`${source.displayName} logo`} className="max-h-20 max-w-[80%] object-contain" />
          ) : (
            <span className="rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">No logo yet</span>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => file.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />}
            {source.logoUrl ? "Replace" : "Upload"} PNG
          </Button>
          {source.logoUrl && (
            <Button variant="ghost" size="sm" onClick={() => removeLogo.mutate()}>
              <Trash2 /> Remove
            </Button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Transparent PNG or WebP. The checkerboard shows transparency.</p>
      </div>

      <div>
        <Label className="mb-1.5 block">Display name</Label>
        <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </div>

      <div>
        <Label className="mb-1.5 block">Price display</Label>
        <Select
          value={form.priceMode}
          items={PRICE_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          onValueChange={(v) => v && setForm({ ...form, priceMode: v as PriceMode })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRICE_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {MODE_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{MODE_HINT[form.priceMode]}</p>
        <p className="mt-2 text-xs">
          ₹1,499 shows as{" "}
          <span className="rounded-full bg-foreground px-2 py-0.5 font-display font-semibold text-background">
            {example ?? "logo only"}
          </span>
        </p>
      </div>

      <div>
        <Label className="mb-1.5 block">Disclosure lines</Label>
        <ListEditor
          value={form.disclosureLines}
          onChange={(disclosureLines) => setForm({ ...form, disclosureLines })}
          placeholder="e.g. Ad · Affiliate link"
          addLabel="Add line"
        />
      </div>

      <div>
        <Label className="mb-1.5 block">Link notes</Label>
        <Textarea rows={2} value={form.linkNotes} onChange={(e) => setForm({ ...form, linkNotes: e.target.value })} />
      </div>

      <Button className="mt-auto" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
        {save.isPending && <Loader2 className="animate-spin" />} Save
      </Button>
    </div>
  );
}

function pick(s: SourceDto) {
  return { displayName: s.displayName, priceMode: s.priceMode, disclosureLines: s.disclosureLines, linkNotes: s.linkNotes };
}
