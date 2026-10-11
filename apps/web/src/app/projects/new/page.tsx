"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ProjectFieldsSchema, type JobDto, type PriceMode, type ProjectDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, PageHeader } from "@/components/page-header";
import { InfluencerPicker, PriceModeField, SourcePicker } from "@/components/projects/pickers";
import { ProductImageDropzone, type PendingImage } from "@/components/projects/product-image-dropzone";
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

export default function NewProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const influencers = useInfluencers();
  const sources = useSources();

  const [images, setImages] = useState<PendingImage[]>([]);
  const [form, setForm] = useState({
    influencerId: "",
    sourceId: "",
    productTitle: "",
    priceInr: "",
    productUrl: "",
    affiliateLink: "",
    occasion: "",
  });
  const [override, setOverride] = useState<PriceMode | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });

  // Sensible defaults: first active influencer, Amazon.
  useEffect(() => {
    if (!form.influencerId && influencers.data?.length) {
      const first = influencers.data.find((i) => i.status === "active") ?? influencers.data[0];
      setForm((f) => ({ ...f, influencerId: first.id }));
    }
  }, [influencers.data, form.influencerId]);
  useEffect(() => {
    if (!form.sourceId && sources.data?.length) setForm((f) => ({ ...f, sourceId: sources.data![0].id }));
  }, [sources.data, form.sourceId]);

  const source = sources.data?.find((s) => s.id === form.sourceId);

  const submit = async () => {
    const parsed = ProjectFieldsSchema.safeParse({ ...form, priceModeOverride: override });
    const next: Record<string, string> = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]));
    if (images.length === 0) next.images = "Add at least one product photo";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      const body = new FormData();
      images.forEach((img) => body.append("images", img.file));
      body.append("roles", JSON.stringify(images.map((i) => i.role)));
      Object.entries(form).forEach(([k, v]) => body.append(k, v));
      if (override) body.append("priceModeOverride", override);
      const project = await api.upload<ProjectDto>("/projects", body);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });

      // Analysis starts straight away; the analysis page follows the job.
      const job = await api.post<JobDto>(`/projects/${project.id}/analyze`, {});
      void watch(job, {
        label: "Analysing product",
        successMessage: "Product analysed",
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectKeys.one(project.id) }),
      });
      router.push(`/projects/${project.id}/analysis`);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      toast.error(errorMessage(error));
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="New project" description="Product photos and details. Analysis starts as soon as you create it." />
      <div className="rounded-xl border bg-card p-6">
        <Section title="Product photos" hint="From the listing. Tag each one so the right photo is attached to each scene.">
          <ProductImageDropzone value={images} onChange={setImages} />
          <FieldError message={errors.images} />
        </Section>

        <Section title="Product">
          <div>
            <Label className="mb-1.5 block">Product title</Label>
            <Input value={form.productTitle} onChange={(e) => set("productTitle", e.target.value)} placeholder="As on the listing" />
            <FieldError message={errors.productTitle} />
          </div>
          <div>
            <Label className="mb-1.5 block">Occasion or mood</Label>
            <Input value={form.occasion} onChange={(e) => set("occasion", e.target.value)} placeholder="e.g. Diwali party" />
            <FieldError message={errors.occasion} />
          </div>
        </Section>

        <Section title="Source & price">
          <SourcePicker sources={sources.data ?? []} value={form.sourceId} onChange={(id) => set("sourceId", id)} />
          <FieldError message={errors.sourceId} />
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div>
              <Label className="mb-1.5 block">Price (₹)</Label>
              <Input
                type="number"
                min={1}
                value={form.priceInr}
                onChange={(e) => set("priceInr", e.target.value)}
                placeholder="1499"
              />
              <FieldError message={errors.priceInr} />
            </div>
            <div>
              <Label className="mb-1.5 block">Price on the badge</Label>
              <PriceModeField price={Number(form.priceInr) || 0} source={source} override={override} onOverride={setOverride} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Product URL (optional)</Label>
              <Input value={form.productUrl} onChange={(e) => set("productUrl", e.target.value)} placeholder="https://" />
              <FieldError message={errors.productUrl} />
            </div>
            <div>
              <Label className="mb-1.5 block">Affiliate link (optional)</Label>
              <Input value={form.affiliateLink} onChange={(e) => set("affiliateLink", e.target.value)} placeholder="https://" />
              <FieldError message={errors.affiliateLink} />
            </div>
          </div>
        </Section>

        <Section title="Influencer">
          <InfluencerPicker
            influencers={influencers.data ?? []}
            value={form.influencerId}
            onChange={(id) => set("influencerId", id)}
          />
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
