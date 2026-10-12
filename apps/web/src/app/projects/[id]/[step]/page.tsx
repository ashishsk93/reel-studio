"use client";

import { useParams } from "next/navigation";
import { Construction } from "lucide-react";
import { STEPS } from "@reel/shared";
import { EmptyState } from "@/components/page-header";

const PHASE: Record<string, number> = { compose: 5, export: 5 };

/** Steps 7–8 until their phases land. */
export default function UpcomingStep() {
  const { step } = useParams<{ step: string }>();
  const label = STEPS.find((s) => s.key === step)?.label ?? step;
  return (
    <EmptyState icon={<Construction className="size-8" />} title={`${label} arrives in phase ${PHASE[step] ?? "—"}`}>
      Your approved video windows are saved; composing comes next.
    </EmptyState>
  );
}
