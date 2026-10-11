"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { STEPS, canOpenStep, isStepDone } from "@reel/shared";
import { useProject } from "@/lib/queries";

/** Opens the first unfinished step. */
export default function ProjectIndex() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data } = useProject(id);

  useEffect(() => {
    if (!data) return;
    const next =
      STEPS.find((s) => s.key !== "product" && canOpenStep(s.key, data.furthestStatus) && !isStepDone(s.key, data.furthestStatus)) ??
      STEPS[STEPS.length - 1];
    router.replace(`/projects/${id}/${next.key}`);
  }, [data, id, router]);

  return null;
}
