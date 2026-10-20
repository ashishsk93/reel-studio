"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageCircleReply, Pencil, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { InstagramMediaDto, InstagramReplyDto, InstagramRuleDto, InstagramRuleInput, InstagramStatusDto } from "@reel/shared";
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
import { instagramKeys, useInstagramStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export default function InstagramPage() {
  const { data: status, isPending, error } = useInstagramStatus();

  return (
    <>
      <PageHeader
        title="Instagram"
        description="Your own account: publish Reels from the Export step, and DM people who comment your keyword."
      />
      {error && <ErrorState error={error} />}
      {isPending || !status ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountCard status={status} />
          {status.connected && (
            <>
              <RulesCard />
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
            <span className="block text-xs text-muted-foreground">Master switch for every keyword rule below.</span>
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

const EMPTY_RULE: InstagramRuleInput = { keyword: "LINK", dmText: "", commentReply: null, mediaId: null, matchDms: false, enabled: true };

function RulesCard() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: instagramKeys.rules, queryFn: () => api.get<InstagramRuleDto[]>("/instagram/rules") });
  const [editing, setEditing] = useState<{ id: string | null; value: InstagramRuleInput } | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: instagramKeys.rules });
  const toggle = useMutation({
    mutationFn: (r: InstagramRuleDto) => api.patch(`/instagram/rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/instagram/rules/${id}`), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <Card
      title="Keyword replies"
      description="When someone comments the keyword, they get your DM once (Instagram allows one private reply per comment, within 7 days). Comments from before a rule existed are left alone."
      actions={
        <Button size="sm" onClick={() => setEditing({ id: null, value: EMPTY_RULE })}>
          <Plus /> New rule
        </Button>
      }
    >
      {editing && <RuleForm initial={editing} onDone={() => (setEditing(null), void invalidate())} />}
      {rules.error && <ErrorState error={rules.error} />}
      {rules.data?.length === 0 && !editing && (
        <EmptyState icon={<MessageCircleReply className="size-8" />} title="No rules yet">
          Publishing a Reel from the Export step adds one for that Reel automatically.
        </EmptyState>
      )}
      <ul className="flex flex-col divide-y">
        {rules.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
            <Switch checked={r.enabled} onCheckedChange={() => toggle.mutate(r)} className="mt-1" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge className="font-mono">{r.keyword}</Badge>
                <span className="text-muted-foreground">
                  {r.mediaId ? (
                    r.permalink ? (
                      <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {r.projectTitle ?? "One Reel"} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      (r.projectTitle ?? `Post ${r.mediaId}`)
                    )
                  ) : (
                    "Every post"
                  )}
                </span>
                {r.matchDms && <Badge variant="outline">also DMs</Badge>}
                {r.commentReply && <Badge variant="outline">public reply</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{r.dmText}</p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Edit rule"
              onClick={() => setEditing({ id: r.id, value: { keyword: r.keyword, dmText: r.dmText, commentReply: r.commentReply, mediaId: r.mediaId, matchDms: r.matchDms, enabled: r.enabled } })}
            >
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete rule" onClick={() => remove.mutate(r.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RuleForm({ initial, onDone }: { initial: { id: string | null; value: InstagramRuleInput }; onDone: () => void }) {
  const [v, setV] = useState(initial.value);
  const media = useQuery({ queryKey: instagramKeys.media, queryFn: () => api.get<InstagramMediaDto[]>("/instagram/media") });
  const save = useMutation({
    mutationFn: () => (initial.id ? api.patch(`/instagram/rules/${initial.id}`, v) : api.post("/instagram/rules", v)),
    onSuccess: () => (toast.success("Rule saved"), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};

  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kw">Keyword</Label>
        <Input id="kw" value={v.keyword} onChange={(e) => setV({ ...v, keyword: e.target.value })} className="font-mono" />
        <FieldError message={errors.keyword} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="post">Applies to</Label>
        <select
          id="post"
          value={v.mediaId ?? ""}
          onChange={(e) => setV({ ...v, mediaId: e.target.value || null })}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Every post</option>
          {v.mediaId && !media.data?.some((m) => m.id === v.mediaId) && <option value={v.mediaId}>Post {v.mediaId}</option>}
          {media.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {new Date(m.timestamp).toLocaleDateString()} · {(m.caption ?? "(no caption)").slice(0, 60)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="dm">DM they get</Label>
        <Textarea id="dm" rows={4} value={v.dmText} onChange={(e) => setV({ ...v, dmText: e.target.value })} placeholder="Here's the link 💛 https://…" />
        <FieldError message={errors.dmText} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="pub">Public reply under the comment (optional)</Label>
        <Input id="pub" value={v.commentReply ?? ""} onChange={(e) => setV({ ...v, commentReply: e.target.value || null })} placeholder="Sent you a DM 💌" />
      </div>
      <label className={cn("flex items-center gap-2 text-sm", v.mediaId && "opacity-50")}>
        <Switch checked={!v.mediaId && Boolean(v.matchDms)} disabled={Boolean(v.mediaId)} onCheckedChange={(c) => setV({ ...v, matchDms: c })} />
        Also answer DMs that contain the keyword
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save rule
        </Button>
      </div>
    </form>
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
    <Card title="Recent replies" description="Every comment or DM the auto-replier answered or skipped.">
      {activity.error && <ErrorState error={activity.error} />}
      {activity.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {activity.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("w-14 text-xs font-medium", STATUS_STYLE[r.status])}>{r.status}</span>
            <span className="font-medium">{r.fromUsername ? `@${r.fromUsername}` : "someone"}</span>
            <span className="text-muted-foreground">
              {r.kind === "dm" ? "DMed" : "commented"} “{r.text.slice(0, 80)}”
            </span>
            {r.keyword && <Badge variant="outline" className="font-mono">{r.keyword}</Badge>}
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
        {row(Boolean(status.publicUrl), `PUBLIC_URL set${status.publicUrl ? ` (${status.publicUrl})` : ""}`, "Publishing and webhooks need the app reachable over HTTPS; until then, keyword replies run by checking comments.")}
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
