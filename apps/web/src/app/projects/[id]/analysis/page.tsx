"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, RefreshCw, ScanSearch, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import type { JobDto, MustMatchItem, ProductSpecDto, ProductSpecSave, ProjectDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState } from "@/components/page-header";
import { CopyButton } from "@/components/copy-button";
import { ListEditor } from "@/components/list-editor";
import { JobBanner } from "@/components/projects/job-banner";
import { SpecEditor } from "@/components/projects/spec-editor";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useJobWatcher, useProjectJobs } from "@/lib/jobs";
import { projectKeys, useProject, useSpecs } from "@/lib/queries";
import { useSyncedState } from "@/lib/hooks";
import { Expandable } from "@/components/lightbox";

const ANALYZE = "product.analyze";
const PARAGRAPH = "product.paragraph";

function editable(s: ProductSpecDto): ProductSpecSave {
  return { spec: s.spec, mustMatch: s.mustMatch, unknowns: s.unknowns, garmentParagraph: s.garmentParagraph };
}

export default function AnalysisStep() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id);
  const { data: specs, isPending, error } = useSpecs(id);
  const jobs = useProjectJobs(id);
  const running = jobs.allActive(ANALYZE);
  const lastFailed = jobs.latest(ANALYZE)?.status === "failed" ? jobs.latest(ANALYZE) : undefined;
  const [tab, setTab] = useState<string | null>(null);

  if (error) return <ErrorState error={error} />;
  if (isPending || !project || !specs) return null;
  const specOf = (productId: string) => specs.find((s) => s.productId === productId);
  const missing = project.products.filter((p) => !specOf(p.id));
  const multi = project.products.length > 1;
  const current = project.products.find((p) => p.id === tab) ?? project.products[0];

  const view = (product: ProjectDto["products"][number]) => {
    const spec = specOf(product.id);
    return spec ? (
      <SpecView projectId={id} productId={product.id} spec={spec} images={product.images} busy={running.length > 0} allAnalysed={missing.length === 0} />
    ) : (
      running.length === 0 && (
        <EmptyState icon={<ScanSearch className="size-8" />} title={`${product.title}: not analysed yet`}>
          <div className="mt-3">
            <AnalyzeButton productId={product.id} label="Analyse product" />
          </div>
        </EmptyState>
      )
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {running.length > 0 && (
        <JobBanner job={running[0]} label={running.length > 1 ? `Claude is reading the photos of ${running.length} products` : "Claude is reading the product photos"} />
      )}
      {running.length === 0 && lastFailed && missing.length > 0 && (
        <ErrorState error={new Error(`The last analysis failed: ${lastFailed.error}`)} onRetry={null} />
      )}
      {multi && missing.length > 1 && running.length === 0 && (
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
          <span>{missing.length} products are not analysed yet.</span>
          <AnalyzeAllButton projectId={id} />
        </div>
      )}
      {multi ? (
        <Tabs value={current.id} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="flex-wrap">
            {project.products.map((p) => (
              <TabsTrigger key={p.id} value={p.id}>
                {p.number}. {p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title}
                {!specOf(p.id) && <span className="ml-1 size-1.5 rounded-full bg-amber-500" />}
              </TabsTrigger>
            ))}
          </TabsList>
          {project.products.map((p) => (
            <TabsContent key={p.id} value={p.id} className="mt-4 flex flex-col gap-5">
              {view(p)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        view(current)
      )}
    </div>
  );
}

function AnalyzeAllButton({ projectId }: { projectId: string }) {
  const watch = useJobWatcher();
  const start = useMutation({
    mutationFn: () => api.post<JobDto[]>(`/projects/${projectId}/analyze`, {}),
    onSuccess: (jobs) => jobs.forEach((job) => void watch(job, { label: "Analysing product", successMessage: "Product analysed" })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button onClick={() => start.mutate()} disabled={start.isPending}>
      <ScanSearch /> Analyse all
    </Button>
  );
}

function AnalyzeButton({ productId, label, withInstruction }: { productId: string; label: string; withInstruction?: boolean }) {
  const watch = useJobWatcher();
  const [instruction, setInstruction] = useState("");
  const [open, setOpen] = useState(false);
  const start = useMutation({
    mutationFn: () => api.post<JobDto>(`/products/${productId}/analyze`, { instruction: instruction.trim() || undefined }),
    onSuccess: (job) => {
      setOpen(false);
      setInstruction("");
      void watch(job, { label: "Analysing product", successMessage: "Product analysed" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!withInstruction) {
    return (
      <Button onClick={() => start.mutate()} disabled={start.isPending}>
        <ScanSearch /> {label}
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        <RefreshCw /> {label}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="mb-2 text-xs text-muted-foreground">
          Replaces the spec, checklist and paragraph, including your edits. Optional instruction:
        </p>
        <Textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder='e.g. "The dupatta is in image 4"' />
        <Button className="mt-2 w-full" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending && <Loader2 className="animate-spin" />} Re-analyse
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Card({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SpecView({
  projectId,
  productId,
  spec,
  images,
  busy,
  allAnalysed,
}: {
  projectId: string;
  productId: string;
  spec: ProductSpecDto;
  images: Array<{ id: string; url: string; role: string }>;
  busy: boolean;
  allAnalysed: boolean;
}) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const jobs = useProjectJobs(projectId);
  const [draft, setDraft] = useSyncedState(spec, () => editable(spec));
  const [paragraphInstruction, setParagraphInstruction] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(spec));
  const paragraphJob = jobs.active(PARAGRAPH);

  const save = useMutation({
    mutationFn: () => api.put<ProductSpecDto>(`/products/${productId}/spec`, draft),
    onSuccess: () => {
      toast.success("Analysis saved");
      void queryClient.invalidateQueries({ queryKey: projectKeys.spec(projectId) });
    },
    onError: (e) => toast.error(e instanceof ApiError && e.issues?.length ? errorMessage(e) : errorMessage(e)),
  });

  const rewriteParagraph = async () => {
    try {
      if (dirty) await save.mutateAsync();
      const job = await api.post<JobDto>(`/products/${productId}/spec/paragraph`, {
        instruction: paragraphInstruction.trim() || undefined,
      });
      setParagraphInstruction("");
      void watch(job, { label: "Rewriting garment paragraph", successMessage: "Paragraph rewritten" });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setMust = (i: number, patch: Partial<MustMatchItem>) =>
    setDraft({ ...draft, mustMatch: draft.mustMatch.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Version {spec.version}</Badge>
        {spec.editedByUser && <Badge variant="outline">Edited by you</Badge>}
        <div className="ml-auto flex gap-2">
          <AnalyzeButton productId={productId} label="Re-analyse" withInstruction />
          <Button nativeButton={false} render={<Link href={`/projects/${projectId}/storyboard`} />} disabled={dirty || !allAnalysed}>
            Storyboard <ArrowRight />
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <div className="flex flex-col gap-5">
          <Card
            title="Garment paragraph"
            hint="Pasted into every prompt where the product is visible."
            actions={<CopyButton text={draft.garmentParagraph} variant="outline" size="sm" />}
          >
            {paragraphJob && <div className="mb-3"><JobBanner job={paragraphJob} label="Rewriting the paragraph" /></div>}
            <Textarea
              rows={7}
              className="font-mono text-[13px] leading-relaxed"
              value={draft.garmentParagraph}
              onChange={(e) => setDraft({ ...draft, garmentParagraph: e.target.value })}
              disabled={busy}
            />
            <div className="mt-3 flex gap-2">
              <Input
                value={paragraphInstruction}
                onChange={(e) => setParagraphInstruction(e.target.value)}
                placeholder='Optional: "mention the mirror work on the yoke"'
              />
              <Button variant="secondary" onClick={rewriteParagraph} disabled={Boolean(paragraphJob) || busy}>
                <Wand2 /> Rewrite from spec
              </Button>
            </div>
          </Card>

          <Card title="Must match" hint="Checked in every image and video review (6–10 items).">
            <div className="flex flex-col gap-2">
              {draft.mustMatch.map((m, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                  <Input value={m.label} onChange={(e) => setMust(i, { label: e.target.value })} placeholder="What to check" />
                  <Input value={m.expected} onChange={(e) => setMust(i, { expected: e.target.value })} placeholder="What correct looks like" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    onClick={() => setDraft({ ...draft, mustMatch: draft.mustMatch.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  setDraft({ ...draft, mustMatch: [...draft.mustMatch, { key: `item_${draft.mustMatch.length + 1}`, label: "", expected: "" }] })
                }
              >
                <Plus /> Add item
              </Button>
            </div>
          </Card>

          <Card title="Unknowns" hint="Not visible in the photos. Never put in prompts; scenes avoid showing them.">
            <ListEditor value={draft.unknowns} onChange={(unknowns) => setDraft({ ...draft, unknowns })} addLabel="Add unknown" />
          </Card>

          <Card title="Garment spec" hint="Structured description. Edit, then rewrite the paragraph from it.">
            <SpecEditor value={draft.spec} onChange={(s) => setDraft({ ...draft, spec: s })} />
          </Card>
        </div>

        <aside className="flex flex-col gap-2 self-start lg:sticky lg:top-6">
          <p className="text-xs font-medium text-muted-foreground">Product photos</p>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {images.map((im, i) => (
              <Expandable key={im.id} items={images.map((x) => ({ url: x.url, label: x.role }))} index={i} className="relative overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt={im.role} className="aspect-[3/4] w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1.5 text-[10px]">{im.role}</span>
              </Expandable>
            ))}
          </div>
        </aside>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm">Unsaved changes to the analysis</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDraft(editable(spec))}>
              Discard
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
