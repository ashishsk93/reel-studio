"use client";

import { type ReactNode } from "react";
import {
  IMAGE_MODELS,
  OUTFIT_STATES,
  PRODUCT_IMAGE_ROLES,
  SCENE_TYPES,
  SHOT_KINDS,
  type BackgroundDto,
  type ProductImageRole,
  type SceneDto,
  type SceneEditable,
} from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/page-header";
import { ROLE_LABEL } from "@/components/projects/product-image-dropzone";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/hooks";

export const SCENE_LABEL: Record<string, string> = {
  unboxing: "Unboxing",
  hold_up: "Hold up",
  pieces: "Pieces",
  detail: "Detail",
  wearing_front: "Wearing · front",
  wearing_alt: "Wearing · alt angle",
  custom: "Custom",
  hook: "Hook",
  try_on: "Try-on",
  styled: "Styled look",
  transition_before: "Transition · before",
  transition_after: "Transition · after",
};

/** A product as the storyboard offers it: number, title and the image roles it has. */
export interface SceneProductOption {
  id: string;
  number: number;
  title: string;
  roles: ProductImageRole[];
}

const NO_PRODUCT = "none";
export const SHOT_LABEL: Record<string, string> = {
  full_body: "Full body",
  three_quarter: "Three-quarter",
  back: "Back view",
  medium: "Medium",
  closeup: "Close-up",
  hands: "Hands",
};
export const MODEL_LABEL: Record<string, string> = { gpt_image: "GPT Image", nano_banana: "Nano Banana" };
const OUTFIT_LABEL: Record<string, string> = { own_clothes: "Her own clothes", wearing_product: "Wearing the product" };

export const BLANK_SCENE: SceneEditable = {
  type: "custom",
  purpose: "",
  shotKind: "medium",
  outfitState: "own_clothes",
  showsProduct: true,
  setting: "",
  description: "",
  productRoles: ["front"],
  onScreenText: "",
  targetDurationSec: 2.5,
  imageModel: "nano_banana",
  imageModelReason: "",
  motion: "",
  backgroundId: null,
  productId: null,
};

const NO_BACKGROUND = "none";

/** "1. Her cosy Delhi bedroom with a cream curtain…" */
export function backgroundLabel(b: BackgroundDto): string {
  const note = b.note.trim() || "Her room";
  return `${b.number}. ${note.length > 48 ? `${note.slice(0, 47)}…` : note}`;
}

/** Picks one of her places (references tagged background) as the scene's background, or none. */
export function BackgroundSelect({
  value,
  backgrounds,
  onChange,
  className,
}: {
  value: string | null;
  backgrounds: BackgroundDto[];
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const items = [{ value: NO_BACKGROUND, label: "No background image" }, ...backgrounds.map((b) => ({ value: b.id, label: backgroundLabel(b) }))];
  return (
    <Select value={value ?? NO_BACKGROUND} items={items} onValueChange={(v) => v && onChange(v === NO_BACKGROUND ? null : String(v))}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type SceneSubmit = SceneEditable & { imagePrompt?: string; promptOverride?: boolean };

function pick(scene: SceneDto): SceneEditable {
  return Object.fromEntries(Object.keys(BLANK_SCENE).map((k) => [k, scene[k as keyof SceneDto]])) as SceneEditable;
}

function EnumSelect({
  value,
  options,
  labels,
  onChange,
}: {
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} items={options.map((o) => ({ value: o, label: labels[o] ?? o }))} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels[o] ?? o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Create or edit a scene. Editing fields rebuilds the prompt unless it was edited by hand. */
export function SceneDialog({
  open,
  onOpenChange,
  scene,
  products,
  backgrounds,
  errors = {},
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene?: SceneDto;
  products: SceneProductOption[];
  backgrounds: BackgroundDto[];
  errors?: Record<string, string>;
  saving?: boolean;
  onSubmit: (value: SceneSubmit) => void;
}) {
  // Fresh from the scene each time the dialog opens.
  const opened = open ? `${scene?.id ?? "new"}:${scene?.updatedAt ?? ""}` : null;
  const [form, setForm] = useSyncedState<SceneEditable>(opened, () => {
    if (scene) return pick(scene);
    const first = products[0];
    const roles = first?.roles ?? [];
    return { ...BLANK_SCENE, productId: first?.id ?? null, productRoles: roles.includes("front") ? ["front"] : roles.slice(0, 1) };
  });
  const availableRoles = products.find((p) => p.id === form.productId)?.roles ?? [];
  const [override, setOverride] = useSyncedState(opened, () => scene?.promptOverride ?? false);
  const [prompt, setPrompt] = useSyncedState(opened, () => scene?.imagePrompt ?? "");

  const set = <K extends keyof SceneEditable>(key: K, value: SceneEditable[K]) => setForm({ ...form, [key]: value });
  const toggleRole = (role: ProductImageRole) =>
    set("productRoles", form.productRoles.includes(role) ? form.productRoles.filter((r) => r !== role) : [...form.productRoles, role]);

  const submit = () =>
    onSubmit({
      ...form,
      ...(scene ? (override ? { imagePrompt: prompt } : { promptOverride: false }) : {}),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{scene ? `Edit scene ${scene.order + 1}` : "Add a scene"}</DialogTitle>
          <DialogDescription>
            The prompt is assembled from these fields, the persona and the garment paragraph.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">
            <EnumSelect value={form.type} options={SCENE_TYPES} labels={SCENE_LABEL} onChange={(v) => set("type", v as SceneEditable["type"])} />
          </Field>
          <Field label="Framing" hint="Decides the reference images">
            <EnumSelect value={form.shotKind} options={SHOT_KINDS} labels={SHOT_LABEL} onChange={(v) => set("shotKind", v as SceneEditable["shotKind"])} />
          </Field>
          <Field label="Outfit">
            <EnumSelect
              value={form.outfitState}
              options={OUTFIT_STATES}
              labels={OUTFIT_LABEL}
              onChange={(v) => set("outfitState", v as SceneEditable["outfitState"])}
            />
          </Field>
          <Field label="Purpose" className="sm:col-span-2">
            <Input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
            <FieldError message={errors.purpose} />
          </Field>
          <Field label="Setting">
            <Input value={form.setting} onChange={(e) => set("setting", e.target.value)} />
          </Field>
          <Field
            label="Background image"
            hint={backgrounds.length ? "Her room photo, attached last so the room stays the same" : "Add a Background reference to her (Reference plan → Her room)"}
            className="sm:col-span-3"
          >
            <BackgroundSelect value={form.backgroundId} backgrounds={backgrounds} onChange={(v) => set("backgroundId", v)} />
          </Field>
          <Field label="Scene description" hint="What she does, pose, framing, camera position, setting details." className="sm:col-span-3">
            <Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} disabled={override} />
            <FieldError message={errors.description} />
          </Field>
          <Field label="On-screen text" hint="3–7 words, factual">
            <Input value={form.onScreenText} onChange={(e) => set("onScreenText", e.target.value)} />
          </Field>
          <Field label="Duration (s)">
            <Input
              type="number"
              step={0.5}
              min={0.5}
              max={15}
              value={form.targetDurationSec}
              onChange={(e) => set("targetDurationSec", Number(e.target.value))}
            />
            <FieldError message={errors.targetDurationSec} />
          </Field>
          <Field label="Image model">
            <EnumSelect
              value={form.imageModel}
              options={IMAGE_MODELS}
              labels={MODEL_LABEL}
              onChange={(v) => set("imageModel", v as SceneEditable["imageModel"])}
            />
          </Field>
          {products.length > 1 && (
            <Field label="Product" hint="The product this scene shows or she wears" className="sm:col-span-3">
              <Select
                value={form.productId ?? NO_PRODUCT}
                items={[{ value: NO_PRODUCT, label: "No product" }, ...products.map((p) => ({ value: p.id, label: `${p.number}. ${p.title}` }))]}
                onValueChange={(v) => {
                  const productId = !v || v === NO_PRODUCT ? null : String(v);
                  const roles = products.find((p) => p.id === productId)?.roles ?? [];
                  setForm({ ...form, productId, productRoles: form.productRoles.filter((r) => roles.includes(r)) });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRODUCT}>No product</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number}. {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Product images to attach" className="sm:col-span-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="mr-3 flex items-center gap-2 text-xs">
                <Switch checked={form.showsProduct} onCheckedChange={(v) => set("showsProduct", v)} /> Product in frame
              </label>
              {PRODUCT_IMAGE_ROLES.filter((r) => availableRoles.includes(r)).map((role) => (
                <button
                  key={role}
                  type="button"
                  disabled={!form.showsProduct}
                  onClick={() => toggleRole(role)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-40",
                    form.productRoles.includes(role) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {ROLE_LABEL[role]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Motion (for the video step)" className="sm:col-span-3">
            <Input value={form.motion} onChange={(e) => set("motion", e.target.value)} />
          </Field>

          {scene && (
            <div className="rounded-lg border p-3 sm:col-span-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={override} onCheckedChange={setOverride} /> Edit the final prompt by hand
              </label>
              {override ? (
                <Textarea rows={8} className="mt-3 font-mono text-xs" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Off: the prompt is rebuilt from the fields above, the persona and the garment paragraph.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {scene ? "Save scene" : "Add scene"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
