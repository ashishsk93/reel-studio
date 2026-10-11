"use client";

import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type { ConditionalFeature, InfluencerFields } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/page-header";
import { ListEditor } from "@/components/list-editor";

export type PersonaDraft = InfluencerFields;

export const EMPTY_PERSONA: PersonaDraft = {
  name: "",
  age: 22,
  city: "",
  identityBlock: "",
  shortIdentity: "",
  voiceNotes: "",
  exampleLines: [],
  personality: "",
  lane: "",
  hashtag: "#",
  signatureDetails: [],
  forbiddenFeatures: [],
  conditionalFeatures: [],
  defaultStyling: "",
  homeOutfit: "",
  homeSetting: "",
};

export function pickPersona(source: PersonaDraft): PersonaDraft {
  return Object.fromEntries(Object.keys(EMPTY_PERSONA).map((k) => [k, source[k as keyof PersonaDraft]])) as PersonaDraft;
}

function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function PersonaForm({
  value,
  onChange,
  errors = {},
}: {
  value: PersonaDraft;
  onChange: (next: PersonaDraft) => void;
  errors?: Record<string, string>;
}) {
  const set = <K extends keyof PersonaDraft>(key: K, v: PersonaDraft[K]) => onChange({ ...value, [key]: v });

  return (
    <div>
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-[1fr_100px_1fr]">
          <Field label="Name" error={errors.name}>
            <Input value={value.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Age" error={errors.age}>
            <Input
              type="number"
              min={18}
              value={value.age}
              onChange={(e) => set("age", Number(e.target.value))}
            />
          </Field>
          <Field label="City" error={errors.city}>
            <Input value={value.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Lane" hint="Niche, occasions and festivals" error={errors.lane}>
            <Input value={value.lane} onChange={(e) => set("lane", e.target.value)} />
          </Field>
          <Field label="Hashtag" error={errors.hashtag}>
            <Input value={value.hashtag} onChange={(e) => set("hashtag", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Identity"
        description="Pasted into every image prompt. Be specific and visual so the face stays consistent."
      >
        <Field label="Identity block" error={errors.identityBlock}>
          <Textarea
            rows={7}
            className="font-mono text-[13px] leading-relaxed"
            value={value.identityBlock}
            onChange={(e) => set("identityBlock", e.target.value)}
          />
        </Field>
        <Field
          label="Short identity"
          hint={`Used in "Keep ${value.name.split(" ")[0] || "her"} identical: …". Under 45 words.`}
          error={errors.shortIdentity}
        >
          <Textarea rows={3} value={value.shortIdentity} onChange={(e) => set("shortIdentity", e.target.value)} />
        </Field>
        <Field label="Signature details">
          <ListEditor
            value={value.signatureDetails}
            onChange={(v) => set("signatureDetails", v)}
            placeholder="e.g. glossy cherry-red lip tint"
            errors={errors}
            errorPrefix="signatureDetails"
          />
        </Field>
      </Section>

      <Section
        title="Feature rules"
        description="Checked in every image review. Forbidden features must never appear; conditional ones only under their rule."
      >
        <Field label="Forbidden features">
          <ListEditor
            value={value.forbiddenFeatures}
            onChange={(v) => set("forbiddenFeatures", v)}
            placeholder="e.g. no nose ring or nose piercing"
            errors={errors}
            errorPrefix="forbiddenFeatures"
          />
        </Field>
        <Field label="Conditional features">
          <ConditionalEditor
            value={value.conditionalFeatures}
            onChange={(v) => set("conditionalFeatures", v)}
            errors={errors}
          />
        </Field>
      </Section>

      <Section title="Voice" description="Used for on-screen text, captions and DM replies.">
        <Field label="Voice notes" error={errors.voiceNotes}>
          <Textarea rows={2} value={value.voiceNotes} onChange={(e) => set("voiceNotes", e.target.value)} />
        </Field>
        <Field label="Personality" error={errors.personality}>
          <Input value={value.personality} onChange={(e) => set("personality", e.target.value)} />
        </Field>
        <Field label="Example lines">
          <ListEditor
            value={value.exampleLines}
            onChange={(v) => set("exampleLines", v)}
            placeholder="e.g. Main character, sorted 💅"
            errors={errors}
            errorPrefix="exampleLines"
          />
        </Field>
      </Section>

      <Section title="Styling & home" description="Defaults for unboxing and indoor scenes.">
        <Field label="Default styling" error={errors.defaultStyling}>
          <Input value={value.defaultStyling} onChange={(e) => set("defaultStyling", e.target.value)} />
        </Field>
        <Field label="Home outfit" hint="Her own clothes in unboxing scenes" error={errors.homeOutfit}>
          <Input value={value.homeOutfit} onChange={(e) => set("homeOutfit", e.target.value)} />
        </Field>
        <Field label="Home setting" error={errors.homeSetting}>
          <Input value={value.homeSetting} onChange={(e) => set("homeSetting", e.target.value)} />
        </Field>
      </Section>
    </div>
  );
}

function ConditionalEditor({
  value,
  onChange,
  errors,
}: {
  value: ConditionalFeature[];
  onChange: (next: ConditionalFeature[]) => void;
  errors: Record<string, string>;
}) {
  const update = (i: number, patch: Partial<ConditionalFeature>) =>
    onChange(value.map((item, j) => (j === i ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((item, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Input
                value={item.feature}
                placeholder="Feature and exact location, e.g. a small crescent-moon tattoo on the inside of her left wrist"
                onChange={(e) => update(i, { feature: e.target.value })}
              />
              <FieldError message={errors[`conditionalFeatures.${i}.feature`]} />
              <Input
                value={item.rule}
                placeholder="When it may appear, e.g. only if the inside of her left wrist is visible; never anywhere else"
                onChange={(e) => update(i, { rule: e.target.value })}
              />
              <FieldError message={errors[`conditionalFeatures.${i}.rule`]} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...value, { feature: "", rule: "" }])}
      >
        <Plus /> Add conditional feature
      </Button>
    </div>
  );
}
