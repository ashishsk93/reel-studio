"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { FORMATS, ProductFieldsSchema, ProjectFieldsSchema, type JobDto, type ProjectDto, type StoryFormat } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, PageHeader } from "@/components/page-header";
import { InfluencerPicker } from "@/components/projects/pickers";
import { ProductImageDropzone, type PendingImage } from "@/components/projects/product-image-dropzone";
import { FormatPicker, ProductFields, emptyProduct, type ProductDraft } from "@/components/projects/product-fields";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { projectKeys, useInfluencers, useSources } from "@/lib/queries";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

type ProductEntry = { key: number; images: PendingImage[]; fields: ProductDraft };

export default function NewProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const influencers = useInfluencers();
  const sources = useSources();

  const [format, setFormat] = useState<StoryFormat>("classic");
  const [form, setForm] = useState({ influencerId: "", title: "", occasion: "" });
  const [products, setProducts] = useState<ProductEntry[]>([{ key: 0, images: [], fields: emptyProduct() }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const rule = FORMATS[format];
  const multi = rule.products.max > 1;

  // Sensible defaults once the lists load: first active influencer, the first store (Amazon).
  if (!form.influencerId && influencers.data?.length) {
    const first = influencers.data.find((i) => i.status === "active") ?? influencers.data[0];
    setForm({ ...form, influencerId: first.id });
  }
  const defaultSource = sources.data?.[0]?.id ?? "";
  if (defaultSource && products.some((p) => !p.fields.sourceId)) {
    setProducts(products.map((p) => (p.fields.sourceId ? p : { ...p, fields: { ...p.fields, sourceId: defaultSource } })));
  }

  const pickFormat = (f: StoryFormat) => {
    setFormat(f);
    const { min, max } = FORMATS[f].products;
    // Keep what was entered; add or drop empty products to fit the format.
    let next = products.slice(0, Math.max(min, Math.min(max, products.length)));
    let key = Math.max(...products.map((p) => p.key)) + 1;
    while (next.length < min) next = [...next, { key: key++, images: [], fields: emptyProduct(next.at(-1)?.fields.sourceId ?? defaultSource) }];
    setProducts(next);
  };
  const updateProduct = (key: number, patch: Partial<ProductEntry>) => setProducts(products.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const addProduct = () =>
    setProducts([...products, { key: Math.max(...products.map((p) => p.key)) + 1, images: [], fields: emptyProduct(products.at(-1)?.fields.sourceId ?? defaultSource) }]);

  const submit = async () => {
    const next: Record<string, string> = {};
    const project = ProjectFieldsSchema.safeParse({ ...form, format });
    if (!project.success) for (const i of project.error.issues) next[i.path.join(".")] = i.message;
    products.forEach((p, n) => {
      const parsed = ProductFieldsSchema.safeParse(p.fields);
      if (!parsed.success) for (const i of parsed.error.issues) next[`products.${n}.${i.path.join(".")}`] = i.message;
      if (p.images.length === 0) next[`products.${n}.images`] = "Add at least one photo";
    });
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error("Check the highlighted fields");
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("influencerId", form.influencerId);
      body.append("format", format);
      body.append("title", form.title);
      body.append("occasion", form.occasion);
      body.append(
        "products",
        JSON.stringify(products.map((p) => ({ ...p.fields, priceModeOverride: p.fields.priceModeOverride ?? null, imageCount: p.images.length }))),
      );
      products.forEach((p) => p.images.forEach((img) => body.append("images", img.file)));
      body.append("roles", JSON.stringify(products.flatMap((p) => p.images.map((i) => i.role))));
      const created = await api.upload<ProjectDto>("/projects", body);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });

      // Each product is analysed straight away; the analysis page follows the jobs.
      const jobs = await api.post<JobDto[]>(`/projects/${created.id}/analyze`, {});
      for (const job of jobs) {
        void watch(job, {
          label: "Analysing product",
          successMessage: "Product analysed",
          onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["projects", created.id] }),
        });
      }
      router.push(`/projects/${created.id}/analysis`);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      toast.error(errorMessage(error));
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="New project" description="Pick the kind of Reel, then add the products. Analysis starts as soon as you create it." />
      <div className="rounded-xl border bg-card p-6">
        <Section title="Format" hint="How the Reel is told. You can't change it once the storyboard exists.">
          <FormatPicker value={format} onChange={pickFormat} />
        </Section>

        <Section title="The Reel" hint="The title is the project's name; it isn't shown in the Reel.">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">{format === "classic" ? "Product title" : "Title"}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={rule.titleExample} />
              <FieldError message={errors.title} />
            </div>
            <div>
              <Label className="mb-1.5 block">Occasion or mood</Label>
              <Input value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} placeholder="e.g. Diwali party" />
              <FieldError message={errors.occasion} />
            </div>
          </div>
        </Section>

        {products.map((p, n) => (
          <Section
            key={p.key}
            title={multi ? `Product ${n + 1}` : "Product"}
            hint="Photos from the listing; tag each one so the right photo is attached to each scene."
          >
            {multi && products.length > rule.products.min && (
              <Button variant="ghost" size="sm" className="self-end text-muted-foreground" onClick={() => setProducts(products.filter((x) => x.key !== p.key))}>
                <X /> Remove product {n + 1}
              </Button>
            )}
            <ProductImageDropzone value={p.images} onChange={(images) => updateProduct(p.key, { images })} />
            <FieldError message={errors[`products.${n}.images`]} />
            <ProductFields
              value={p.fields}
              onChange={(fields) => updateProduct(p.key, { fields })}
              sources={sources.data ?? []}
              showNote={multi}
              errors={Object.fromEntries(
                Object.entries(errors)
                  .filter(([k]) => k.startsWith(`products.${n}.`))
                  .map(([k, v]) => [k.slice(`products.${n}.`.length), v]),
              )}
            />
          </Section>
        ))}
        {multi && products.length < rule.products.max && (
          <div className="flex justify-center border-t py-4">
            <Button variant="outline" onClick={addProduct}>
              <Plus /> Add product {products.length + 1}
            </Button>
          </div>
        )}

        <Section title="Influencer">
          <InfluencerPicker influencers={influencers.data ?? []} value={form.influencerId} onChange={(id) => setForm({ ...form, influencerId: id })} />
          <FieldError message={errors.influencerId} />
        </Section>

        <div className="flex justify-end border-t pt-6">
          <Button size="lg" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Create and analyse
          </Button>
        </div>
      </div>
    </>
  );
}
