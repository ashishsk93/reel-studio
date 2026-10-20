"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Film, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { InstagramReelDto, InstagramReplyDto, InstagramStatusDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/page-header";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useSyncedState } from "@/lib/hooks";
import { instagramKeys, useInstagramStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export default function InstagramPage() {
  const { data: status, isPending, error } = useInstagramStatus();

  return (
    <>
      <PageHeader
        title="Instagram"
        description="Your own account: publish Reels from the Export step, and DM each Reel's link to people who comment the keyword."
      />
      {error && <ErrorState error={error} />}
      {isPending || !status ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountCard status={status} />
          {status.connected && (
            <>
              <ReplySettingsCard status={status} />
              <ReelsCard keyword={status.keyword} />
              <ActivityCard />
            </>
          )}
          <SetupCard status={status} />
        </div>
      )}
    </>
  );
}

function Card({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function AccountCard({ status }: { status: InstagramStatusDto }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const set = (s: InstagramStatusDto) => queryClient.setQueryData(instagramKeys.status, s);
  const connect = useMutation({
    mutationFn: () => api.put<InstagramStatusDto>("/instagram/connect", { accessToken: token }),
    onSuccess: (s) => {
      set(s);
      setToken("");
      toast.success(`Connected @${s.username}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (body: { autoReply?: boolean; poll?: boolean }) => api.patch<InstagramStatusDto>("/instagram", body),
    onSuccess: set,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disconnect = useMutation({ mutationFn: () => api.del<InstagramStatusDto>("/instagram"), onSuccess: set, onError: (e) => toast.error(errorMessage(e)) });
  const refresh = useMutation({
    mutationFn: () => api.post<InstagramStatusDto>("/instagram/refresh-token"),
    onSuccess: (s) => (set(s), toast.success("Token refreshed")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const poll = useMutation({
    mutationFn: () => api.post<{ checked: number; answered: number }>("/instagram/poll"),
    onSuccess: (r) => {
      toast.success(`Checked ${r.checked} comment${r.checked === 1 ? "" : "s"}, sent ${r.answered} DM${r.answered === 1 ? "" : "s"}`);
      void queryClient.invalidateQueries({ queryKey: instagramKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!status.connected) {
    return (
      <Card title="Connect your account" description="Paste the access token from the Meta App Dashboard (Instagram → API setup with Instagram login → Generate token).">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <Input type="password" autoComplete="off" placeholder="IGAA…" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
          <Button type="submit" disabled={connect.isPending || token.trim().length < 20}>
            {connect.isPending && <Loader2 className="animate-spin" />} Connect
          </Button>
        </form>
        <FieldError message={connect.error instanceof ApiError ? connect.error.fieldErrors().accessToken : undefined} />
      </Card>
    );
  }

  return (
    <Card
      title={`@${status.username}`}
      description={
        status.tokenExpiresAt
          ? `Token valid until ${new Date(status.tokenExpiresAt).toLocaleDateString()}; refreshed automatically while the app runs.`
          : "Token expiry unknown."
      }
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={cn(refresh.isPending && "animate-spin")} /> Refresh token
          </Button>
          <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            <Unplug /> Disconnect
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-3">
          <Switch checked={status.autoReply} onCheckedChange={(v) => update.mutate({ autoReply: v })} />
          <span>
            Auto-reply on
            <span className="block text-xs text-muted-foreground">Master switch for every Reel&apos;s DM.</span>
          </span>
        </label>
        <label className="flex items-center gap-3">
          <Switch checked={status.poll} onCheckedChange={(v) => update.mutate({ poll: v })} />
          <span>
            Check comments every 90 seconds
            <span className="block text-xs text-muted-foreground">
              Works without webhooks (needed while the Meta app is in Development mode or the app runs only on this computer).
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Last webhook: {ago(status.lastWebhookAt)}</span>
          <span>Last check: {ago(status.lastPollAt)}</span>
          <Button size="xs" variant="outline" onClick={() => poll.mutate()} disabled={poll.isPending}>
            {poll.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
          </Button>
        </div>
        {status.lastError && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{status.lastError}</p>
        )}
      </div>
    </Card>
  );
}

function ReplySettingsCard({ status }: { status: InstagramStatusDto }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useSyncedState(`${status.keyword}|${status.commentReply ?? ""}`, () => ({
    keyword: status.keyword,
    commentReply: status.commentReply ?? "",
  }));
  const save = useMutation({
    mutationFn: () => api.patch<InstagramStatusDto>("/instagram", { keyword: form.keyword, commentReply: form.commentReply.trim() || null }),
    onSuccess: (s) => {
      queryClient.setQueryData(instagramKeys.status, s);
      toast.success("Saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};
  const dirty = form.keyword !== status.keyword || (form.commentReply.trim() || null) !== status.commentReply;

  return (
    <Card title="Reply settings" description="Shared by every Reel. Only the DM text is set per Reel, below.">
      <form
        className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kw">Keyword</Label>
          <Input id="kw" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} className="font-mono" />
          <FieldError message={errors.keyword} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pub">Public reply under the comment (optional)</Label>
          <Input id="pub" value={form.commentReply} onChange={(e) => setForm({ ...form, commentReply: e.target.value })} placeholder="Sent you a DM 💌" />
          <FieldError message={errors.commentReply} />
        </div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </form>
    </Card>
  );
}

function ReelsCard({ keyword }: { keyword: string }) {
  const reels = useQuery({ queryKey: instagramKeys.reels, queryFn: () => api.get<InstagramReelDto[]>("/instagram/reels") });
  return (
    <Card
      title="Your Reels"
      description={`Give a Reel a DM and people who comment ${keyword} get it once (Instagram allows one private reply per comment, within 7 days). Reels without a DM are left alone, e.g. Meesho, whose app replies itself.`}
      actions={
        <Button size="sm" variant="outline" onClick={() => void reels.refetch()} disabled={reels.isFetching}>
          <RefreshCw className={cn(reels.isFetching && "animate-spin")} /> Reload
        </Button>
      }
    >
      {reels.error && <ErrorState error={reels.error} />}
      {reels.isPending && <Skeleton className="h-40" />}
      {reels.data?.length === 0 && (
        <EmptyState icon={<Film className="size-8" />} title="No Reels yet">
          Reels you post show up here.
        </EmptyState>
      )}
      <ul className="flex flex-col divide-y">
        {reels.data?.map((r) => (
          <ReelRow key={r.mediaId} reel={r} />
        ))}
      </ul>
    </Card>
  );
}

function ReelRow({ reel }: { reel: InstagramReelDto }) {
  const queryClient = useQueryClient();
  const [text, setText] = useSyncedState(reel.dmText, () => reel.dmText ?? "");
  const [includeExisting, setIncludeExisting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: instagramKeys.reels });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/instagram/reels/${reel.mediaId}/dm`, { dmText: text, enabled, includeExisting }),
    onSuccess: () => (toast.success("DM saved"), void refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const skipExisting = useMutation({
    mutationFn: () => api.post<{ skipped: number }>(`/instagram/reels/${reel.mediaId}/skip-existing`),
    onSuccess: ({ skipped }) => toast.success(skipped ? `Skipped ${skipped} existing comment${skipped === 1 ? "" : "s"}` : "No new comments to skip"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const clear = useMutation({
    mutationFn: () => api.del(`/instagram/reels/${reel.mediaId}/dm`),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = text.trim() !== (reel.dmText ?? "");

  return (
    <li className="flex gap-4 py-4">
      <a href={reel.permalink ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
        {reel.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reel.thumbnailUrl} alt="" className="aspect-[9/16] w-20 rounded-lg border object-cover" />
        ) : (
          <div className="flex aspect-[9/16] w-20 items-center justify-center rounded-lg border bg-muted">
            <Film className="size-5 text-muted-foreground" />
          </div>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{new Date(reel.timestamp).toLocaleDateString()}</span>
          {reel.projectTitle && <Badge variant="secondary">{reel.projectTitle}</Badge>}
          {reel.dmText ? (
            <Badge variant={reel.enabled ? "default" : "outline"}>{reel.enabled ? "Auto-DM on" : "Paused"}</Badge>
          ) : (
            <Badge variant="outline">No auto-DM</Badge>
          )}
          {reel.sent > 0 && <span>{reel.sent} sent</span>}
          {reel.permalink && (
            <a href={reel.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              Open <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <p className="line-clamp-1 text-sm">{reel.caption ?? "(no caption)"}</p>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="The DM for this Reel, with its link…" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reel.dmText ? (
            <>
              <label className="mr-auto flex items-center gap-2 text-xs">
                <Switch checked={reel.enabled} disabled={dirty || save.isPending} onCheckedChange={(v) => save.mutate(v)} /> Send it
              </label>
              <Button
                size="sm"
                variant="ghost"
                title="Mark every comment on this Reel so far as answered; only new comments get the DM"
                onClick={() => skipExisting.mutate()}
                disabled={skipExisting.isPending}
              >
                {skipExisting.isPending && <Loader2 className="animate-spin" />} Skip current comments
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
                Remove DM
              </Button>
            </>
          ) : (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={includeExisting} onCheckedChange={setIncludeExisting} size="sm" /> Also DM people who already commented
            </label>
          )}
          <Button size="sm" onClick={() => save.mutate(reel.dmText ? reel.enabled : true)} disabled={!dirty || !text.trim() || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save DM
          </Button>
        </div>
      </div>
    </li>
  );
}

const STATUS_STYLE: Record<InstagramReplyDto["status"], string> = {
  sent: "text-emerald-600",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

function ActivityCard() {
  const activity = useQuery({
    queryKey: instagramKeys.activity,
    queryFn: () => api.get<InstagramReplyDto[]>("/instagram/activity"),
    refetchInterval: 30_000,
  });
  return (
    <Card title="Recent replies" description="Every comment the auto-replier answered or skipped.">
      {activity.error && <ErrorState error={activity.error} />}
      {activity.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {activity.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("w-14 text-xs font-medium", STATUS_STYLE[r.status])}>{r.status}</span>
            <span className="font-medium">{r.fromUsername ? `@${r.fromUsername}` : "someone"}</span>
            <span className="text-muted-foreground">commented “{r.text.slice(0, 80)}”</span>
            {r.permalink && (
              <a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                Reel
              </a>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
            {r.detail && <p className="w-full pl-16 text-xs text-muted-foreground">{r.detail}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SetupCard({ status }: { status: InstagramStatusDto }) {
  const row = (ok: boolean, label: string, hint: string) => (
    <li className="flex gap-2">
      <span className={cn("w-4 shrink-0", ok ? "text-emerald-600" : "text-amber-600")}>{ok ? "✓" : "•"}</span>
      <span>
        {label}
        {!ok && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </li>
  );
  return (
    <Card title="Setup" description="What each piece needs. See docs/instagram.md for the Meta app steps.">
      <ul className="flex flex-col gap-2 text-sm">
        {row(status.connected, "Account connected", "Paste a token above.")}
        {row(status.configured, "INSTAGRAM_APP_SECRET set", "From the Meta app: Instagram → API setup → Business login settings. Signs webhooks and video links.")}
        {row(Boolean(status.publicUrl), `PUBLIC_URL set${status.publicUrl ? ` (${status.publicUrl})` : ""}`, "Publishing and webhooks need the app reachable over HTTPS; until then, DMs go out by checking comments.")}
        {row(status.verifyTokenSet, "INSTAGRAM_WEBHOOK_VERIFY_TOKEN set", "Any random string; paste the same one in the Meta app's webhook settings.")}
      </ul>
      {status.webhookUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Webhook callback URL:</span>
          <code className="rounded bg-muted px-1.5 py-0.5">{status.webhookUrl}</code>
          <CopyButton text={status.webhookUrl} size="sm" variant="outline" />
        </div>
      )}
    </Card>
  );
}
