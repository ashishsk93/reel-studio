"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { InstagramProjectDto, JobDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { JobBanner } from "@/components/projects/job-banner";
import { api, errorMessage } from "@/lib/api";
import { useJobRefresh, useJobWatcher, useProjectJobs } from "@/lib/jobs";
import { useSyncedState } from "@/lib/hooks";
import { instagramKeys, projectKeys, useProjectInstagram } from "@/lib/queries";

/** Export step: publish the latest render to Instagram and set its DM (unless another app, e.g. Meesho's, replies). */
export function PublishCard({ projectId, renderId }: { projectId: string; renderId: string }) {
  const { data } = useProjectInstagram(projectId);
  if (!data) return null;
  return <PublishForm projectId={projectId} renderId={renderId} data={data} />;
}

function PublishForm({ projectId, renderId, data }: { projectId: string; renderId: string; data: InstagramProjectDto }) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const jobs = useProjectJobs(projectId);
  useJobRefresh(["instagram.publish"], instagramKeys.project(projectId));
  const running = jobs.active("instagram.publish");

  const [form, setForm] = useSyncedState(JSON.stringify(data.defaults), () => ({
    caption: data.defaults.caption,
    firstComment: data.defaults.firstComment ?? "",
    shareToFeed: true,
    autoReply: !data.otherAppReplies,
    dmText: data.defaults.dmText,
  }));
  const [open, setOpen] = useState(false);

  const publish = useMutation({
    mutationFn: async () => {
      const job = await api.post<JobDto>(`/projects/${projectId}/instagram`, {
        renderId,
        caption: form.caption,
        firstComment: form.firstComment.trim() || null,
        shareToFeed: form.shareToFeed,
        dmText: form.autoReply ? form.dmText : null,
      });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: instagramKeys.project(projectId) });
      await watch(job, { label: "Publishing to Instagram", successMessage: "Reel is live on Instagram" });
      await queryClient.invalidateQueries({ queryKey: instagramKeys.project(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.one(projectId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const live = data.posts.find((p) => p.status === "published");
  const last = data.posts[0];
  const missing = [
    !data.ready.connected && "connect your account on the Instagram page",
    !data.ready.secret && "set INSTAGRAM_APP_SECRET",
    !data.ready.publicUrl && "set PUBLIC_URL (Instagram downloads the video from it, so the app has to be online)",
  ].filter(Boolean);

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Instagram</h3>
        {live && <Badge>Live</Badge>}
        {live?.permalink && (
          <a href={live.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Open the Reel <ExternalLink className="size-3" />
          </a>
        )}
        {!open && !running && (
          <Button size="sm" className="ml-auto" variant={live ? "outline" : "default"} onClick={() => setOpen(true)} disabled={missing.length > 0}>
            <Send /> {live ? "Post again" : "Post to Instagram"}
          </Button>
        )}
      </div>

      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          To post from here: {missing.join("; ")}. See the{" "}
          <Link href="/instagram" className="text-primary hover:underline">
            Instagram page
          </Link>
          .
        </p>
      )}
      {running && <JobBanner job={running} label="Publishing" />}
      {last?.status === "failed" && !running && <p className="text-xs text-destructive">The last attempt failed: {last.error}</p>}
      {live?.error && <p className="text-xs text-amber-600">{live.error}</p>}

      {open && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-caption">Caption</Label>
            <Textarea id="ig-caption" rows={8} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            <span className="text-right text-xs text-muted-foreground">{form.caption.length} / 2200</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-first">First comment (optional)</Label>
            <Textarea id="ig-first" rows={2} value={form.firstComment} onChange={(e) => setForm({ ...form, firstComment: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.shareToFeed} onCheckedChange={(v) => setForm({ ...form, shareToFeed: v })} /> Also show on the profile grid
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.autoReply} onCheckedChange={(v) => setForm({ ...form, autoReply: v })} /> DM people who comment{" "}
            <span className="font-mono">{data.defaults.keyword}</span>
          </label>
          {data.otherAppReplies && !form.autoReply && (
            <p className="-mt-1 text-xs text-muted-foreground">
              Off for Meesho: its app replies once you generate the link. You can still set a DM later on the Instagram page.
            </p>
          )}
          {form.autoReply && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ig-dm">DM for this Reel</Label>
              <Textarea id="ig-dm" rows={4} value={form.dmText} onChange={(e) => setForm({ ...form, dmText: e.target.value })} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={publish.isPending || !form.caption.trim() || (form.autoReply && !form.dmText.trim())}>
              {publish.isPending ? <Loader2 className="animate-spin" /> : <Send />} Publish now
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
