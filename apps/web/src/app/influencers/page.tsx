"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkles, UserPlus, Users } from "lucide-react";
import type { InfluencerDto } from "@reel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader } from "@/components/page-header";
import { errorMessage } from "@/lib/api";
import { useInfluencers } from "@/lib/queries";

export default function InfluencersPage() {
  const { data, isPending, error } = useInfluencers();
  const [showArchived, setShowArchived] = useState(false);
  const list = (data ?? []).filter((i) => showArchived || i.status !== "archived");

  return (
    <>
      <PageHeader
        title="Influencers"
        description="Recurring AI characters. Each one's reference images keep her face consistent across every Reel."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/influencers/new?mode=manual" />}>
              <UserPlus /> Add existing
            </Button>
            <Button nativeButton={false} render={<Link href="/influencers/new" />}>
              <Sparkles /> New character
            </Button>
          </>
        }
      />

      <label className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
      </label>

      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {isPending ? (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title="No influencers yet">
          Create a new character with AI, or add one you already have.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {list.map((influencer) => (
            <InfluencerCard key={influencer.id} influencer={influencer} />
          ))}
        </div>
      )}
    </>
  );
}

const STATUS_VARIANT = { active: "default", draft: "outline", creating: "outline", archived: "secondary" } as const;

function InfluencerCard({ influencer }: { influencer: InfluencerDto }) {
  return (
    <Link
      href={`/influencers/${influencer.id}`}
      className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[3/4] bg-gradient-to-br from-primary/15 to-muted">
        {influencer.anchor ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={influencer.anchor.url}
            alt={influencer.name}
            className="size-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <span className="font-display text-4xl font-extrabold text-primary/40">{influencer.name.charAt(0)}</span>
            <span className="text-xs">No anchor image yet</span>
          </div>
        )}
        <Badge variant={STATUS_VARIANT[influencer.status]} className="absolute top-2 right-2 capitalize">
          {influencer.status}
        </Badge>
      </div>
      <div className="p-3">
        <p className="font-medium">{influencer.name}</p>
        <p className="text-sm text-muted-foreground">
          {influencer.age} · {influencer.city}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {influencer.referenceCount} reference{influencer.referenceCount === 1 ? "" : "s"} · {influencer.hashtag}
        </p>
      </div>
    </Link>
  );
}
