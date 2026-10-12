"use client";

import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

/**
 * A failed load: what went wrong in plain words and a Retry button (refetches the queries on
 * screen unless `onRetry` is given; `null` hides it).
 */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: (() => void) | null; className?: string }) {
  const queryClient = useQueryClient();
  const offline = error instanceof ApiError && error.status === 0;
  const notFound = error instanceof ApiError && error.status === 404;
  const title = offline ? "Can't reach the API" : notFound ? "Not found" : "Something went wrong";
  const retry = onRetry ?? (() => void queryClient.refetchQueries({ type: "active" }));
  return (
    <div
      role="alert"
      className={[
        "flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm",
        className ?? "",
      ].join(" ")}
    >
      {offline ? <WifiOff className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">{title}</p>
        <p className="mt-0.5 break-words text-muted-foreground">
          {offline ? (
            <>
              Start it with <code className="font-mono">pnpm dev</code> in the project folder, then retry.
            </>
          ) : (
            errorMessage(error)
          )}
        </p>
      </div>
      {!notFound && onRetry !== null && (
        <Button size="sm" variant="outline" onClick={retry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}
