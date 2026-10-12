"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Any page that crashes while rendering lands here instead of a blank screen. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <CircleAlert className="size-6 text-destructive" />
      <h1 className="font-display text-lg font-semibold">This page hit an error</h1>
      <p className="text-sm break-words text-muted-foreground">{error.message || "Unknown error"}</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/projects" />}>
          Back to projects
        </Button>
      </div>
    </div>
  );
}
