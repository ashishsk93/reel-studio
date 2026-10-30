"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { REFERENCE_VIDEO, type ProjectDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/** Dance format: the clip whose moves she performs. Attached to every motion transfer card. */
export function ReferenceVideoPanel({ project }: { project: ProjectDto }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const clip = project.referenceVideo;

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("files", file);
      form.append("confirmed", String(confirmed));
      return api.upload(`/projects/${project.id}/reference-video`, form);
    },
    onSuccess: () => {
      toast.success("Reference video saved");
      void queryClient.invalidateQueries({ queryKey: ["projects", project.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      if (input.current) input.current.value = "";
    },
  });

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3">
      {clip && <video src={clip.url} controls muted playsInline className="h-40 rounded-lg border" />}
      <div className="flex min-w-60 flex-1 flex-col gap-2">
        <h2 className="text-sm font-semibold">Reference video</h2>
        <p className="text-sm text-muted-foreground">
          {clip
            ? `${clip.name} · ${clip.durationSec}s · ${clip.width}×${clip.height}`
            : `MP4 or MOV, ${REFERENCE_VIDEO.minSec}–${REFERENCE_VIDEO.maxSec} s, one person in full view with no cuts. Her moves come from this clip.`}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          The performer is an adult and I may use this clip.
        </label>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
        <Button className="self-start" variant="outline" disabled={!confirmed || upload.isPending} onClick={() => input.current?.click()}>
          <Upload /> {clip ? "Replace clip" : "Upload clip"}
        </Button>
      </div>
    </section>
  );
}
