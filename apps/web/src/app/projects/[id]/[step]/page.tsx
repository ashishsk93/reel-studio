"use client";

import { useParams } from "next/navigation";
import { Construction } from "lucide-react";
import { STEPS } from "@reel/shared";
import { EmptyState } from "@/components/page-header";

const PHASE: Record<string, number> = { images: 3, "video-prompts": 4, videos: 4, compose: 5, export: 5 };

/** Steps 4–8 until their phases land. */
export default function UpcomingStep() {
  const { step } = useParams<{ step: string }>();
  const label = STEPS.find((s) => s.key === step)?.label ?? step;
  return (
    <EmptyState icon={<Construction className="size-8" />} title={`${label} arrives in phase ${PHASE[step] ?? "—"}`}>
      Download the storyboard zip from step 3 and generate the images in Higgsfield in the meantime.
    </EmptyState>
  );
}
