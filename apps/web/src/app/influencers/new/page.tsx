"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CreatorBriefSchema, type InfluencerDetailDto, type JobDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, PageHeader } from "@/components/page-header";
import { EMPTY_PERSONA, PersonaForm, type PersonaDraft } from "@/components/influencers/persona-form";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { keys } from "@/lib/queries";

export default function NewInfluencerPage() {
  return (
    <Suspense>
      <NewInfluencer />
    </Suspense>
  );
}

function NewInfluencer() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("mode") === "manual" ? "manual" : "ai");

  return (
    <>
      <PageHeader
        title="New influencer"
        description="Generate a new character from a short brief, or enter one you already use."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-6">
          <TabsTrigger value="ai">
            <Sparkles /> Generate with AI
          </TabsTrigger>
          <TabsTrigger value="manual">Add existing</TabsTrigger>
        </TabsList>
        <TabsContent value="ai">
          <BriefForm />
        </TabsContent>
        <TabsContent value="manual">
          <ManualForm />
        </TabsContent>
      </Tabs>
    </>
  );
}

const EMPTY_BRIEF = {
  name: "",
  age: 23,
  city: "",
  lane: "",
  vibe: "",
  lookNotes: "",
  voiceLanguage: "Hinglish",
  mustHave: "",
  mustAvoid: "",
};

function BriefForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const set = (key: keyof typeof EMPTY_BRIEF, value: string | number) => setBrief({ ...brief, [key]: value });

  const submit = async () => {
    const parsed = CreatorBriefSchema.safeParse({ ...brief, name: brief.name || undefined });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setRunning(true);
    try {
      const job = await api.post<JobDto>("/influencers/draft", parsed.data);
      const done = await watch(job, { label: "Drafting persona", successMessage: "Persona drafted" });
      const id = (done.result as { influencerId?: string } | null)?.influencerId;
      if (done.status === "succeeded" && id) {
        await queryClient.invalidateQueries({ queryKey: keys.influencers });
        router.push(`/influencers/${id}?tab=profile`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  };

  const text = (key: keyof typeof EMPTY_BRIEF, label: string, placeholder: string, hint?: string) => (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Input value={String(brief[key])} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={errors[key]} />
    </div>
  );

  return (
    <div className="max-w-2xl rounded-xl border bg-card p-6">
      <p className="mb-6 text-sm text-muted-foreground">
        Claude drafts the identity block, feature rules and voice. You review and edit it, then upload her reference
        images (anchor first). Generating the reference images with Higgsfield prompts comes in phase 3.
      </p>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_100px_1fr]">
          {text("name", "Name (optional)", "Let Claude choose")}
          <div>
            <Label className="mb-1.5 block">Age</Label>
            <Input type="number" min={18} value={brief.age} onChange={(e) => set("age", Number(e.target.value))} />
            <FieldError message={errors.age} />
          </div>
          {text("city", "City / region", "e.g. Jaipur")}
        </div>
        {text("lane", "Lane", "e.g. block prints, cotton co-ords, Teej and Gangaur")}
        {text("vibe", "Vibe", "e.g. sunny, chatty, boho")}
        {text("voiceLanguage", "Voice and language", "e.g. Hinglish, playful")}
        <div>
          <Label className="mb-1.5 block">Look notes</Label>
          <Textarea
            rows={3}
            value={brief.lookNotes}
            placeholder="Anything about her face, hair, build or style you already have in mind"
            onChange={(e) => set("lookNotes", e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("mustHave", "Must have", "e.g. short wavy hair")}
          {text("mustAvoid", "Must avoid", "e.g. no tattoos, no nose ring")}
        </div>
        <Button size="lg" className="mt-2 self-start" onClick={submit} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {running ? "Drafting…" : "Draft persona"}
        </Button>
      </div>
    </div>
  );
}

function ManualForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [persona, setPersona] = useState<PersonaDraft>(EMPTY_PERSONA);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => api.post<InfluencerDetailDto>("/influencers", { ...persona, status: "draft" }),
    onSuccess: async (created) => {
      toast.success(`${created.name} created as a draft. Upload her anchor image to activate her.`);
      await queryClient.invalidateQueries({ queryKey: keys.influencers });
      router.push(`/influencers/${created.id}?tab=references`);
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      toast.error(errorMessage(error));
    },
  });

  return (
    <div className="rounded-xl border bg-card p-6">
      <PersonaForm value={persona} onChange={setPersona} errors={errors} />
      <div className="mt-6 flex justify-end border-t pt-6">
        <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Create influencer
        </Button>
      </div>
    </div>
  );
}
