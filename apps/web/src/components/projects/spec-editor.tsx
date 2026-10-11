"use client";

import { Plus, X } from "lucide-react";
import { TRANSPARENCY, type ProductSpec } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ListEditor } from "@/components/list-editor";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const LABELS: Record<string, string> = {
  garmentType: "Garment type",
  exactColourName: "Exact colour name",
  fitSilhouette: "Fit & silhouette",
  waistDetails: "Waist details",
  surfaceWork: "Surface work",
  hemDetails: "Hem",
  backDetails: "Back details",
  otherDistinctive: "Other distinctive details",
  listingStyling: "Styling seen in the listing (suggestion only)",
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Renders any spec value: strings as inputs, string lists as list editors, objects as groups. */
function Field({ name, value, onChange }: { name: string; value: Json; onChange: (v: Json) => void }) {
  if (name === "transparency") {
    return (
      <div>
        <Label className="mb-1.5 block text-xs">{label(name)}</Label>
        <Select value={String(value)} items={TRANSPARENCY.map((t) => ({ value: t, label: t.replace("_", "-") }))} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSPARENCY.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace("_", "-")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (typeof value === "string") {
    const long = value.length > 70;
    return (
      <div>
        <Label className="mb-1.5 block text-xs">{label(name)}</Label>
        {long ? (
          <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    );
  }
  if (Array.isArray(value)) {
    const objects = value.length > 0 && typeof value[0] === "object";
    if (!objects && (value.length === 0 || typeof value[0] === "string") && name !== "pieces") {
      return (
        <div>
          <Label className="mb-1.5 block text-xs">{label(name)}</Label>
          <ListEditor value={value as string[]} onChange={onChange} />
        </div>
      );
    }
    const template = Object.fromEntries(Object.keys((value[0] as Record<string, Json>) ?? { name: "", description: "" }).map((k) => [k, ""]));
    return (
      <div>
        <Label className="mb-1.5 block text-xs">{label(name)}</Label>
        <div className="flex flex-col gap-2">
          {value.map((item, i) => (
            <div key={i} className="flex gap-2 rounded-lg border p-3">
              <div className="grid flex-1 gap-2 sm:grid-cols-[180px_1fr]">
                {Object.entries(item as Record<string, Json>).map(([k, v]) => (
                  <Field key={k} name={k} value={v} onChange={(next) => onChange(value.map((it, j) => (j === i ? { ...(it as object), [k]: next } : it)))} />
                ))}
              </div>
              <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...value, template])}>
            <Plus /> Add
          </Button>
        </div>
      </div>
    );
  }
  if (value && typeof value === "object") {
    return (
      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-xs font-medium">{label(name)}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(value).map(([k, v]) => (
            <Field key={k} name={k} value={v} onChange={(next) => onChange({ ...value, [k]: next })} />
          ))}
        </div>
      </fieldset>
    );
  }
  return null;
}

export function SpecEditor({ value, onChange }: { value: ProductSpec; onChange: (next: ProductSpec) => void }) {
  const record = value as unknown as Record<string, Json>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(record).map(([key, v]) => (
        <div key={key} className={typeof v === "object" ? "md:col-span-2" : undefined}>
          <Field name={key} value={v} onChange={(next) => onChange({ ...record, [key]: next } as unknown as ProductSpec)} />
        </div>
      ))}
    </div>
  );
}
