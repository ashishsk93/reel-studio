"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { HealthDto, ModelPrice, SettingKey, SettingsMap } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";

interface SettingRow<K extends SettingKey = SettingKey> {
  key: K;
  label: string;
  value: SettingsMap[K];
  default: SettingsMap[K];
}

function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingRow[]>("/settings") });
}

function useSaveSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: unknown }) => api.put(`/settings/${key}`, { value }),
    onSuccess: (_, { key }) => {
      toast.success(`Saved ${key}`);
      void queryClient.invalidateQueries({ queryKey: keys.settings });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

const FRIENDLY: SettingKey[] = ["llm.prices", "llm.usdToInr", "tools.image", "tools.video"];

export default function SettingsPage() {
  const { data, isPending, error } = useSettings();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<HealthDto>("/health") });
  const byKey = Object.fromEntries((data ?? []).map((r) => [r.key, r])) as { [K in SettingKey]: SettingRow<K> };

  return (
    <>
      <PageHeader title="Settings" description="Prices, tool limits and the templates the prompts are built from." />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}

      <div className="flex flex-col gap-6">
        <Card title="Environment" description="Read from .env at startup. Edit .env and restart the API to change these.">
          {health.data ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="text-muted-foreground">LLM mode</dt>
              <dd className="font-mono">{health.data.llmMode}</dd>
              <dt className="text-muted-foreground">API key</dt>
              <dd>{health.data.hasApiKey ? "Set" : "Not set"}</dd>
              <dt className="text-muted-foreground">Default model</dt>
              <dd className="font-mono">{health.data.modelDefault}</dd>
              <dt className="text-muted-foreground">Review model</dt>
              <dd className="font-mono">{health.data.modelReview}</dd>
              <dt className="text-muted-foreground">FFmpeg</dt>
              <dd className="truncate font-mono text-xs">{health.data.ffmpeg}</dd>
              <dt className="text-muted-foreground">Data folder</dt>
              <dd className="font-mono text-xs">{health.data.dataDir}</dd>
            </dl>
          ) : (
            <Skeleton className="h-32" />
          )}
        </Card>

        {isPending || !data ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : (
          <>
            <PricesCard row={byKey["llm.prices"]} rate={byKey["llm.usdToInr"]} />
            <ToolsCard image={byKey["tools.image"]} video={byKey["tools.video"]} />
            {data
              .filter((r) => !FRIENDLY.includes(r.key))
              .map((row) => (
                <JsonSettingCard key={row.key} row={row} />
              ))}
          </>
        )}
      </div>
    </>
  );
}

function Card({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
    </section>
  );
}

const PRICE_FIELDS: Array<keyof ModelPrice> = ["input", "output", "cacheWrite", "cacheRead"];

function PricesCard({ row, rate }: { row: SettingRow<"llm.prices">; rate: SettingRow<"llm.usdToInr"> }) {
  const save = useSaveSetting();
  const [prices, setPrices] = useState(row.value);
  const [inr, setInr] = useState(rate.value);
  useEffect(() => setPrices(row.value), [row.value]);
  useEffect(() => setInr(rate.value), [rate.value]);

  return (
    <Card
      title="Model prices"
      description="USD per 1M tokens, used for the cost log. Check current prices on the Anthropic pricing page."
      footer={
        <Button
          onClick={() => {
            save.mutate({ key: "llm.prices", value: prices });
            save.mutate({ key: "llm.usdToInr", value: inr });
          }}
          disabled={save.isPending}
        >
          {save.isPending && <Loader2 className="animate-spin" />} Save prices
        </Button>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Model</th>
            {PRICE_FIELDS.map((f) => (
              <th key={f} className="pb-2 font-medium capitalize">
                {f.replace("cache", "cache ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(prices).map(([model, price]) => (
            <tr key={model}>
              <td className="py-1 pr-3 font-mono text-xs">{model}</td>
              {PRICE_FIELDS.map((f) => (
                <td key={f} className="py-1 pr-2">
                  <Input
                    type="number"
                    step="0.001"
                    min={0}
                    value={price[f]}
                    onChange={(e) => setPrices({ ...prices, [model]: { ...price, [f]: Number(e.target.value) } })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-3">
        <Label>USD → INR</Label>
        <Input type="number" className="w-28" value={inr} onChange={(e) => setInr(Number(e.target.value))} />
      </div>
    </Card>
  );
}

function ToolsCard({ image, video }: { image: SettingRow<"tools.image">; video: SettingRow<"tools.video"> }) {
  const save = useSaveSetting();
  const [img, setImg] = useState(image.value);
  const [vid, setVid] = useState(video.value);
  useEffect(() => setImg(image.value), [image.value]);
  useEffect(() => setVid(video.value), [video.value]);

  const num = (label: string, value: number, onChange: (n: number) => void, step = 1) => (
    <div>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      <Input type="number" step={step} min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );

  return (
    <Card
      title="Generation tools"
      description="Higgsfield limits used when choosing reference images and estimating credits. Confirm these by testing."
      footer={
        <Button
          onClick={() => {
            save.mutate({ key: "tools.image", value: img });
            save.mutate({ key: "tools.video", value: vid });
          }}
          disabled={save.isPending}
        >
          {save.isPending && <Loader2 className="animate-spin" />} Save tools
        </Button>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {(Object.keys(img) as Array<keyof typeof img>).map((model) => (
          <div key={model} className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{img[model].label}</p>
            {num("Max reference images", img[model].maxRefs, (n) => setImg({ ...img, [model]: { ...img[model], maxRefs: n } }))}
            <div>
              <Label className="mb-1.5 block text-xs">Notes (used when recommending a model)</Label>
              <Input
                value={img[model].notes}
                onChange={(e) => setImg({ ...img, [model]: { ...img[model], notes: e.target.value } })}
              />
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2">
          <p className="text-sm font-medium">{vid.label} (video)</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {num("Max element references", vid.maxElementRefs, (n) => setVid({ ...vid, maxElementRefs: n }))}
            {num("Max multi-shot length (s)", vid.maxMultiShotSec, (n) => setVid({ ...vid, maxMultiShotSec: n }))}
            {num("Single-shot length (s)", vid.singleShotSec, (n) => setVid({ ...vid, singleShotSec: n }))}
            {num("Credits per 5 s", vid.creditsPer5s, (n) => setVid({ ...vid, creditsPer5s: n }), 0.01)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function JsonSettingCard({ row }: { row: SettingRow }) {
  const queryClient = useQueryClient();
  const save = useSaveSetting();
  const [text, setText] = useState(() => JSON.stringify(row.value, null, 2));
  const [parseError, setParseError] = useState("");
  useEffect(() => setText(JSON.stringify(row.value, null, 2)), [row.value]);

  const reset = useMutation({
    mutationFn: () => api.del(`/settings/${row.key}`),
    onSuccess: () => {
      toast.success(`Reset ${row.key} to default`);
      void queryClient.invalidateQueries({ queryKey: keys.settings });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    try {
      const value: unknown = JSON.parse(text);
      setParseError("");
      save.mutate({ key: row.key, value });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const isDefault = JSON.stringify(row.value) === JSON.stringify(row.default);

  return (
    <Card
      title={row.label}
      description={`${row.key}${isDefault ? " · default" : " · customised"}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => reset.mutate()} disabled={isDefault || reset.isPending}>
            <RotateCcw /> Reset to default
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <Textarea
        rows={Math.min(16, text.split("\n").length + 1)}
        className="font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {parseError && <p className="mt-1 text-xs text-destructive">{parseError}</p>}
    </Card>
  );
}
