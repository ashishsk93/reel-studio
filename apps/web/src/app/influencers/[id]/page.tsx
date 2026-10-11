"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { InfluencerDetailDto, JobDto, PromptCardDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { PersonaForm, pickPersona, type PersonaDraft } from "@/components/influencers/persona-form";
import { ReferenceGallery } from "@/components/influencers/reference-gallery";
import { PromptCard } from "@/components/prompt-card";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { keys, useInfluencer } from "@/lib/queries";

export default function InfluencerPage() {
  return (
    <Suspense>
      <InfluencerDetail />
    </Suspense>
  );
}

function InfluencerDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: influencer, isPending, error } = useInfluencer(id);
  const [tab, setTab] = useState(params.get("tab") ?? "profile");

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.influencers });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<InfluencerDetailDto>(`/influencers/${id}`, body),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const activate = useMutation({
    mutationFn: () => api.post<InfluencerDetailDto>(`/influencers/${id}/activate`),
    onSuccess: () => {
      toast.success("Influencer is active");
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/influencers/${id}`),
    onSuccess: async () => {
      toast.success("Influencer deleted");
      await refresh();
      router.push("/influencers");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (isPending || !influencer) return <Skeleton className="h-96 rounded-xl" />;

  return (
    <>
      <Link
        href="/influencers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Influencers
      </Link>

      <div className="mb-8 flex flex-wrap items-center gap-5">
        <div className="size-20 overflow-hidden rounded-2xl border bg-muted">
          {influencer.anchor ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={influencer.anchor.url} alt={influencer.name} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center font-display text-3xl font-extrabold text-primary/40">
              {influencer.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">{influencer.name}</h1>
            <Badge variant={influencer.status === "active" ? "default" : "outline"} className="capitalize">
              {influencer.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {influencer.age} · {influencer.city} · {influencer.hashtag}
          </p>
        </div>
        <div className="flex gap-2">
          {influencer.status === "draft" && (
            <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
              <CheckCircle2 /> Activate
            </Button>
          )}
          {influencer.status === "archived" ? (
            <Button variant="outline" onClick={() => patch.mutate({ status: "active" })}>
              <ArchiveRestore /> Unarchive
            </Button>
          ) : (
            influencer.status === "active" && (
              <Button variant="outline" onClick={() => patch.mutate({ status: "archived" })}>
                <Archive /> Archive
              </Button>
            )
          )}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="Delete influencer" />}>
              <Trash2 />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {influencer.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Her persona and all {influencer.references.length} reference images are deleted from disk. Influencers
                  used in projects can only be archived.
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
        </div>
      </div>

      {influencer.status === "draft" && !influencer.anchor && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          Draft. Review the persona, then upload her <strong>anchor</strong> image under References to activate her.
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-6">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="references">References ({influencer.references.length})</TabsTrigger>
          <TabsTrigger value="test">Test prompt</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab influencer={influencer} />
        </TabsContent>
        <TabsContent value="references">
          <ReferenceGallery influencer={influencer} />
        </TabsContent>
        <TabsContent value="test">
          <TestPromptTab influencer={influencer} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ProfileTab({ influencer }: { influencer: InfluencerDetailDto }) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const [draft, setDraft] = useState<PersonaDraft>(() => pickPersona(influencer));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  // Server data replaced (e.g. after a regenerate): reset the form.
  useEffect(() => setDraft(pickPersona(influencer)), [influencer]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickPersona(influencer));

  const save = useMutation({
    mutationFn: () => api.patch<InfluencerDetailDto>(`/influencers/${influencer.id}`, draft),
    onSuccess: () => {
      setErrors({});
      toast.success("Saved");
      void queryClient.invalidateQueries({ queryKey: keys.influencers });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    },
  });

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const job = await api.post<JobDto>(`/influencers/${influencer.id}/persona/regenerate`, {
        instruction: instruction.trim() || undefined,
      });
      const done = await watch(job, { label: "Rewriting persona", successMessage: "Persona updated" });
      if (done.status === "succeeded") {
        setInstruction("");
        await queryClient.invalidateQueries({ queryKey: keys.influencers });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="rounded-xl border bg-card p-6">
        <PersonaForm value={draft} onChange={setDraft} errors={errors} />
        <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-2 border-t bg-card pt-4">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(pickPersona(influencer))}>
            Discard
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </div>

      <aside className="flex flex-col gap-3 self-start rounded-xl border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="size-4 text-primary" /> Rewrite with AI
        </h3>
        <p className="text-xs text-muted-foreground">
          Describe a change (&ldquo;make her hair shoulder-length and forbid tattoos&rdquo;). Everything you don&apos;t
          mention stays the same. Unsaved edits are replaced.
        </p>
        <Textarea
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Optional instruction"
        />
        <Button variant="secondary" onClick={regenerate} disabled={regenerating}>
          {regenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {instruction.trim() ? "Apply change" : "Improve persona"}
        </Button>
      </aside>
    </div>
  );
}

function TestPromptTab({ influencer }: { influencer: InfluencerDetailDto }) {
  const sample = useMutation({
    mutationFn: () => api.post<PromptCardDto>(`/influencers/${influencer.id}/sample-prompt`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          Builds a full-body &ldquo;wearing the product&rdquo; prompt from her persona and references, using a sample
          garment. Paste it into Higgsfield to check her identity holds before using her in a project.
        </p>
        <Button onClick={() => sample.mutate()} disabled={sample.isPending}>
          {sample.isPending && <Loader2 className="animate-spin" />}
          {sample.data ? "Rebuild sample prompt" : "Generate sample prompt"}
        </Button>
      </div>
      {sample.data && (
        <PromptCard
          card={sample.data}
          title="Sample: wearing the product"
          chips={
            <>
              <Badge variant="secondary">GPT Image or Nano Banana</Badge>
              <Badge variant="secondary">9:16</Badge>
            </>
          }
        />
      )}
    </div>
  );
}
