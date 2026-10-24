"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FORMATS, ProductFieldsSchema, type ProductDto, type ProductImageDto, type ProjectDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
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
import { InfluencerPicker, ShowTextField } from "@/components/projects/pickers";
import { ProductImageDropzone, RoleSelect, type PendingImage } from "@/components/projects/product-image-dropzone";
import { FORMAT_ICON, ProductFields, emptyProduct, productDraft, productRange, type ProductDraft } from "@/components/projects/product-fields";
import { ApiError, api, errorMessage } from "@/lib/api";
import { projectKeys, useInfluencers, useProject, useSources } from "@/lib/queries";
import { useSyncedState } from "@/lib/hooks";
import { Expandable } from "@/components/lightbox";

export default function ProductStep() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id);
  if (!project) return null;
  const rule = FORMATS[project.format];
  const multi = rule.products.max > 1;
  return (
    <div className="flex flex-col gap-6">
      <DetailsCard project={project} />
      {project.products.map((p) => (
        <ProductCard key={p.id} project={project} product={p} multi={multi} canRemove={project.products.length > rule.products.min} />
      ))}
      {project.products.length < rule.products.max && <AddProductCard project={project} multi={multi} />}
    </div>
  );
}

function errorsOf(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fieldErrors() : {};
}

function DetailsCard({ project }: { project: ProjectDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const influencers = useInfluencers();
  const pick = (p: ProjectDto) => ({ influencerId: p.influencer.id, title: p.title, occasion: p.occasion, showText: p.showText });
  const [form, setForm] = useSyncedState(project, () => pick(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(project));
  const rule = FORMATS[project.format];
  const Icon = FORMAT_ICON[project.format];

  const save = useMutation({
    mutationFn: () => api.patch<ProjectDto>(`/projects/${project.id}`, form),
    onSuccess: () => {
      setErrors({});
      toast.success("Saved");
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (e) => {
      setErrors(errorsOf(e));
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">The Reel</h2>
        <Badge variant="secondary" className="gap-1">
          <Icon className="size-3" /> {rule.label} · {productRange(project.format)}
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1.5 block">{project.format === "classic" ? "Product title" : "Title"}</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={rule.titleExample} />
          <FieldError message={errors.title} />
        </div>
        <div>
          <Label className="mb-1.5 block">Occasion or mood</Label>
          <Input value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} />
          <FieldError message={errors.occasion} />
        </div>
      </div>
      <div className="mt-5">
        <ShowTextField value={form.showText} onChange={(showText) => setForm({ ...form, showText })} />
      </div>
      <div className="mt-5">
        <Label className="mb-1.5 block">Influencer</Label>
        <InfluencerPicker influencers={influencers.data ?? []} value={form.influencerId} onChange={(influencerId) => setForm({ ...form, influencerId })} />
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
              <AlertDialogDescription>All photos, scenes and generated files for this Reel are deleted from disk. This can&apos;t be undone.</AlertDialogDescription>
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
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </section>
  );
}

function ProductCard({ project, product, multi, canRemove }: { project: ProjectDto; product: ProductDto; multi: boolean; canRemove: boolean }) {
  const queryClient = useQueryClient();
  const sources = useSources();
  const [form, setForm] = useSyncedState(product, () => productDraft(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(productDraft(product));
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectKeys.one(project.id) });

  const save = useMutation({
    mutationFn: () => api.patch<ProductDto>(`/products/${product.id}`, { ...form, priceModeOverride: form.priceModeOverride ?? null }),
    onSuccess: () => {
      setErrors({});
      toast.success("Saved");
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (e) => {
      setErrors(errorsOf(e));
      toast.error(errorMessage(e));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del<ProjectDto>(`/products/${product.id}`),
    onSuccess: () => {
      toast.success(`${product.title} removed`);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{multi ? `Product ${product.number}` : "Product"}</h2>
        {product.priceLabel && <Badge variant="outline">{product.priceLabel}</Badge>}
        {!product.analyzed && <Badge variant="outline">Not analysed yet</Badge>}
        {canRemove && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button size="sm" variant="ghost" className="ml-auto text-destructive" />}>
              <Trash2 /> Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {product.title}?</AlertDialogTitle>
                <AlertDialogDescription>Its photos and analysis are deleted. Scenes that show it lose their product; regenerate the storyboard afterwards.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <PhotosEditor product={product} onChanged={refresh} />
      <div className="mt-5 border-t pt-5">
        <ProductFields value={form} onChange={setForm} sources={sources.data ?? []} errors={errors} showNote={multi} />
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save product
        </Button>
      </div>
    </section>
  );
}

function PhotosEditor({ product, onChanged }: { product: ProductDto; onChanged: () => unknown }) {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const after = () => void onChanged();

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      pending.forEach((p) => body.append("images", p.file));
      body.append("roles", JSON.stringify(pending.map((p) => p.role)));
      return api.upload<ProductImageDto[]>(`/products/${product.id}/images`, body);
    },
    onSuccess: () => {
      setPending([]);
      after();
    },
    onError,
  });
  const setRole = useMutation({ mutationFn: ({ imageId, role }: { imageId: string; role: string }) => api.patch(`/product-images/${imageId}`, { role }), onSuccess: after, onError });
  const remove = useMutation({ mutationFn: (imageId: string) => api.del(`/product-images/${imageId}`), onSuccess: after, onError });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put(`/products/${product.id}/images/order`, { ids }), onSuccess: after, onError });

  const move = (index: number, delta: number) => {
    const ids = product.images.map((i) => i.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + delta, 0, item);
    reorder.mutate(ids);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Photos</p>
        {product.analyzed && <p className="text-xs text-amber-600">Changed the photos or their roles? Re-run its analysis in step 2.</p>}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {product.images.map((image, i) => (
          <div key={image.id} className="flex flex-col gap-1.5">
            <div className="group relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
              <Expandable items={product.images.map((p) => ({ url: p.url, label: p.role }))} index={i} className="size-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.role} className="size-full object-cover" />
              </Expandable>
              <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex gap-1">
                  <Button size="icon-xs" variant="secondary" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft />
                  </Button>
                  <Button size="icon-xs" variant="secondary" aria-label="Move later" disabled={i === product.images.length - 1} onClick={() => move(i, 1)}>
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
      <div className="mt-4">
        <ProductImageDropzone value={pending} onChange={setPending} />
        {pending.length > 0 && (
          <Button className="mt-3" onClick={() => upload.mutate()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Add {pending.length} photo{pending.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AddProductCard({ project, multi }: { project: ProjectDto; multi: boolean }) {
  const queryClient = useQueryClient();
  const sources = useSources();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [form, setForm] = useState<ProductDraft>(() => emptyProduct(project.products.at(-1)?.source.id ?? ""));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const add = useMutation({
    mutationFn: () => {
      const parsed = ProductFieldsSchema.safeParse(form);
      const next: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message]));
      if (images.length === 0) next.images = "Add at least one photo";
      if (Object.keys(next).length) {
        setErrors(next);
        throw new Error("Check the highlighted fields");
      }
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => v !== null && body.append(k, String(v)));
      images.forEach((img) => body.append("images", img.file));
      body.append("roles", JSON.stringify(images.map((i) => i.role)));
      return api.upload<ProjectDto>(`/projects/${project.id}/products`, body);
    },
    onSuccess: async (p) => {
      const added = p.products.at(-1);
      toast.success("Product added");
      setOpen(false);
      setImages([]);
      setErrors({});
      setForm(emptyProduct(added?.source.id ?? ""));
      if (added) await api.post(`/products/${added.id}/analyze`, {});
      void queryClient.invalidateQueries({ queryKey: ["projects", project.id] });
    },
    onError: (e) => {
      setErrors((prev) => ({ ...prev, ...errorsOf(e) }));
      toast.error(errorMessage(e));
    },
  });

  if (!open) {
    return (
      <Button variant="outline" className="self-center" onClick={() => setOpen(true)}>
        <Plus /> Add product {project.products.length + 1}
      </Button>
    );
  }
  return (
    <section className="rounded-xl border border-dashed bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">Product {project.products.length + 1}</h2>
      <ProductImageDropzone value={images} onChange={setImages} />
      <FieldError message={errors.images} />
      <div className="mt-5 border-t pt-5">
        <ProductFields value={form} onChange={setForm} sources={sources.data ?? []} errors={errors} showNote={multi} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button onClick={() => add.mutate()} disabled={add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add and analyse
        </Button>
      </div>
    </section>
  );
}
