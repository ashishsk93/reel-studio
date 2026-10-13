"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Download, ImageIcon } from "lucide-react";
import type { SceneImagesDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/page-header";
import { PromptCard } from "@/components/prompt-card";
import { AssetWorkbench } from "@/components/assets/asset-workbench";
import { VERDICT_STYLE } from "@/components/assets/review-card";
import { MODEL_LABEL, SCENE_LABEL, SHOT_LABEL } from "@/components/projects/scene-dialog";
import { API_URL } from "@/lib/api";
import { useJobRefresh } from "@/lib/jobs";
import { projectKeys, useImagesStep, useProject, useSetting } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function ImagesPage() {
  return (
    <Suspense>
      <ImagesStep />
    </Suspense>
  );
}

function ImagesStep() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: project } = useProject(id);
  const { data, error, isPending } = useImagesStep(id);
  useJobRefresh(["asset.review", "assistant.reply"], projectKeys.images(id));

  if (error) return <ErrorState error={error} />;
  if (isPending || !project) return <Skeleton className="h-96 rounded-xl" />;
  if (!data || data.total === 0) {
    return (
      <EmptyState title="No storyboard yet">
        <Link className="text-primary hover:underline" href={`/projects/${id}/storyboard`}>
          Plan the scenes in step 3
        </Link>
      </EmptyState>
    );
  }

  const selectedId = params.get("scene") ?? data.scenes.find((s) => !s.approvedAssetId)?.scene.id ?? data.scenes[0].scene.id;
  const selected = data.scenes.find((s) => s.scene.id === selectedId) ?? data.scenes[0];
  const select = (sceneId: string) => router.replace(`${pathname}?scene=${sceneId}`, { scroll: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects", id] });
  const done = data.approved === data.total;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3">
        <div className="min-w-48 flex-1">
          <p className="text-sm">
            <span className="font-semibold">
              {data.approved} of {data.total} scenes approved
            </span>
            <span className="text-muted-foreground"> · upload what you generate, Claude reviews each image</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(data.approved / data.total) * 100}%` }} />
          </div>
        </div>
        <Button variant="outline" nativeButton={false} render={<a href={`${API_URL}/projects/${id}/storyboard.zip`} />}>
          <Download /> All prompts + attachments
        </Button>
        {done ? (
          <Button nativeButton={false} render={<Link href={`/projects/${id}/video-prompts`} />}>
            Video prompts <ArrowRight />
          </Button>
        ) : (
          <Button disabled title="Approve one image per scene first">
            Video prompts <ArrowRight />
          </Button>
        )}
      </div>

      <nav className="flex gap-2 overflow-x-auto pb-1">
        {data.scenes.map((s) => (
          <SceneTab key={s.scene.id} item={s} active={s.scene.id === selected.scene.id} onClick={() => select(s.scene.id)} />
        ))}
      </nav>

      <SceneImages key={selected.scene.id} item={selected} projectId={id} onChanged={refresh} />
    </div>
  );
}

function SceneTab({ item, active, onClick }: { item: SceneImagesDto; active: boolean; onClick: () => void }) {
  const approved = item.assets.find((a) => a.id === item.approvedAssetId);
  const latest = item.assets[0];
  const thumb = approved ?? latest;
  const verdict = latest?.review?.verdict;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-xl border bg-card p-1.5 pr-3 text-left transition-colors",
        active ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
      )}
    >
      <div className="relative aspect-[9/16] w-9 overflow-hidden rounded-md bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb.url} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="absolute inset-0 m-auto size-4 text-muted-foreground" />
        )}
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {item.scene.order + 1}. {SCENE_LABEL[item.scene.type]}
          {approved ? (
            <CheckCircle2 className="size-3.5 text-primary" />
          ) : (
            verdict && <span className={cn("size-2 rounded-full", VERDICT_STYLE[verdict].dot)} />
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {approved ? "Approved" : item.assets.length ? `${item.assets.length} version${item.assets.length > 1 ? "s" : ""}` : "No images yet"}
        </p>
      </div>
    </button>
  );
}

function SceneImages({ item, projectId, onChanged }: { item: SceneImagesDto; projectId: string; onChanged: () => Promise<unknown> }) {
  const { scene } = item;
  // Instagram covers these bands; shown as an overlay on the image.
  const { data: safeZone } = useSetting("overlay.safeZone");
  const [showPrompt, setShowPrompt] = useState(item.assets.length === 0);
  const compare = scene.card.attachments.map((a) => ({ label: a.label, url: a.url }));

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card/50 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-semibold">
          Scene {scene.order + 1}: {SCENE_LABEL[scene.type]}
        </h2>
        <Badge variant="secondary">{SHOT_LABEL[scene.shotKind]}</Badge>
        <Badge variant="secondary">{scene.outfitState === "wearing_product" ? "Wearing it" : "Own clothes"}</Badge>
        <Badge>{MODEL_LABEL[scene.imageModel]}</Badge>
        <span className="ml-auto font-display text-sm font-semibold">&ldquo;{scene.onScreenText}&rdquo;</span>
      </header>
      <p className="-mt-2 text-sm text-muted-foreground">{scene.purpose}</p>

      <div>
        <button
          type="button"
          onClick={() => setShowPrompt(!showPrompt)}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showPrompt ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Prompt and attachments
        </button>
        {showPrompt && (
          <PromptCard
            compact
            card={scene.card}
            footer={
              <>
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={`${API_URL}/scenes/${scene.id}/attachments.zip`} />}>
                  <Download /> Download attachments (zip)
                </Button>
                <Link href={`/projects/${projectId}/storyboard`} className="text-xs text-muted-foreground hover:text-foreground">
                  Edit the scene in the storyboard
                </Link>
              </>
            }
          />
        )}
      </div>

      <AssetWorkbench
        assets={item.assets}
        recommendation={item.recommendation}
        uploadPath={`/scenes/${scene.id}/assets`}
        compare={compare}
        onChanged={onChanged}
        safeZone={safeZone}
        emptyHint="Generate this scene in Higgsfield with the prompt and attachments above, then upload one or more results."
      />
    </section>
  );
}
