"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { PriceMode, ProductImageDto, ProjectDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FieldError } from "@/components/page-header";
import { InfluencerPicker, PriceModeField, SourcePicker } from "@/components/projects/pickers";
import { ProductImageDropzone, RoleSelect, type PendingImage } from "@/components/projects/product-image-dropzone";
import { ApiError, api, errorMessage } from "@/lib/api";
import { projectKeys, useInfluencers, useProject, useSources, useSpec } from "@/lib/queries";
import { useSyncedState } from "@/lib/hooks";

function pick(p: ProjectDto) {
  return {
    influencerId: p.influencer.id,
    sourceId: p.source.id,
    productTitle: p.productTitle,
    priceInr: String(p.priceInr),
    productUrl: p.productUrl ?? "",
    affiliateLink: p.affiliateLink ?? "",
    occasion: p.occasion,
    priceModeOverride: p.priceModeOverride,
  };
}

export default function ProductStep() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id);
  if (!project) return null;
  return (
    <div className="flex flex-col gap-6">
      <ImagesCard project={project} />
      <DetailsCard project={project} />
    </div>
  );
}

function ImagesCard({ project }: { project: ProjectDto }) {
  const queryClient = useQueryClient();
  const { data: spec } = useSpec(project.id);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectKeys.one(project.id) });
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      pending.forEach((p) => body.append("images", p.file));
      body.append("roles", JSON.stringify(pending.map((p) => p.role)));
      return api.upload<ProductImageDto[]>(`/projects/${project.id}/product-images`, body);
    },
    onSuccess: () => {
      setPending([]);
      void refresh();
    },
    onError,
  });
  const setRole = useMutation({
    mutationFn: ({ imageId, role }: { imageId: string; role: string }) => api.patch(`/product-images/${imageId}`, { role }),
    onSuccess: () => void refresh(),
    onError,
  });
  const remove = useMutation({
    mutationFn: (imageId: string) => api.del(`/product-images/${imageId}`),
    onSuccess: () => void refresh(),
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put(`/projects/${project.id}/product-images/order`, { ids }),
    onSuccess: () => void refresh(),
    onError,
  });

  const move = (index: number, delta: number) => {
    const ids = project.productImages.map((i) => i.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + delta, 0, item);
    reorder.mutate(ids);
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Product photos</h2>
        {spec && <p className="text-xs text-amber-600">Changed the photos or their roles? Re-run the analysis in step 2.</p>}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {project.productImages.map((image, i) => (
          <div key={image.id} className="flex flex-col gap-1.5">
            <div className="group relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.role} className="size-full object-cover" />
              <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex gap-1">
                  <Button size="icon-xs" variant="secondary" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="secondary"
                    aria-label="Move later"
                    disabled={i === project.productImages.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowRight />
                  </Button>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger render={<Button size="icon-xs" variant="secondary" aria-label="Delete photo" />}>
                    <Trash2 />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
                      <AlertDialogDescription>It is removed from disk and from scene attachments.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => remove.mutate(image.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <RoleSelect value={image.role} onChange={(role) => setRole.mutate({ imageId: image.id, role })} />
          </div>
        ))}
      </div>
      <div className="mt-5">
        <ProductImageDropzone value={pending} onChange={setPending} />
        {pending.length > 0 && (
          <Button className="mt-3" onClick={() => upload.mutate()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Add {pending.length} photo
            {pending.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </section>
  );
}

function DetailsCard({ project }: { project: ProjectDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const influencers = useInfluencers();
  const sources = useSources();
  const [form, setForm] = useSyncedState(project, () => pick(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(project));
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });

  const save = useMutation({
    mutationFn: () => api.patch<ProjectDto>(`/projects/${project.id}`, form),
    onSuccess: () => {
      setErrors({});
      toast.success("Saved");
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/projects/${project.id}`),
    onSuccess: async () => {
      toast.success("Project deleted");
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      router.push("/projects");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">Details</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1.5 block">Product title</Label>
          <Input value={form.productTitle} onChange={(e) => set("productTitle", e.target.value)} />
          <FieldError message={errors.productTitle} />
        </div>
        <div>
          <Label className="mb-1.5 block">Occasion or mood</Label>
          <Input value={form.occasion} onChange={(e) => set("occasion", e.target.value)} />
          <FieldError message={errors.occasion} />
        </div>
        <div>
          <Label className="mb-1.5 block">Price (₹)</Label>
          <Input type="number" value={form.priceInr} onChange={(e) => set("priceInr", e.target.value)} />
          <FieldError message={errors.priceInr} />
        </div>
        <div>
          <Label className="mb-1.5 block">Price on the badge</Label>
          <PriceModeField
            price={Number(form.priceInr) || 0}
            source={sources.data?.find((s) => s.id === form.sourceId)}
            override={form.priceModeOverride}
            onOverride={(mode: PriceMode | null) => setForm({ ...form, priceModeOverride: mode })}
          />
        </div>
        <div>
          <Label className="mb-1.5 block">Product URL</Label>
          <Input value={form.productUrl} onChange={(e) => set("productUrl", e.target.value)} placeholder="https://" />
          <FieldError message={errors.productUrl} />
        </div>
        <div>
          <Label className="mb-1.5 block">Affiliate link</Label>
          <Input value={form.affiliateLink} onChange={(e) => set("affiliateLink", e.target.value)} placeholder="https://" />
          <FieldError message={errors.affiliateLink} />
        </div>
      </div>
      <div className="mt-5">
        <Label className="mb-1.5 block">Source</Label>
        <SourcePicker sources={sources.data ?? []} value={form.sourceId} onChange={(sourceId) => set("sourceId", sourceId)} />
      </div>
      <div className="mt-5">
        <Label className="mb-1.5 block">Influencer</Label>
        <InfluencerPicker
          influencers={influencers.data ?? []}
          value={form.influencerId}
          onChange={(influencerId) => set("influencerId", influencerId)}
        />
        {form.influencerId !== project.influencer.id && project.sceneCount > 0 && (
          <p className="mt-2 text-xs text-amber-600">Prompts are rebuilt for the new influencer; regenerate the storyboard if her voice should change.</p>
        )}
      </div>
      <div className="mt-6 flex items-center gap-2 border-t pt-4">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" className="text-destructive" />}>
            <Trash2 /> Delete project
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this project?</AlertDialogTitle>
              <AlertDialogDescription>
                All photos, scenes and generated files for this Reel are deleted from disk. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button className="ml-auto" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save details
        </Button>
      </div>
    </section>
  );
}
