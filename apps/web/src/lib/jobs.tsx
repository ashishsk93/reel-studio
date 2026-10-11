"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import type { JobDto } from "@reel/shared";
import { API_URL, api, errorMessage } from "./api";

type Listener = (job: JobDto) => void;

interface JobEvents {
  subscribe(listener: Listener): () => void;
}

const JobEventsContext = createContext<JobEvents | null>(null);

/** One EventSource for the whole app; components subscribe to job updates through it. */
export function JobEventsProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const source = new EventSource(`${API_URL}/events`);
    source.addEventListener("job", (event) => {
      const job = JSON.parse((event as MessageEvent<string>).data) as JobDto;
      listeners.current.forEach((listener) => listener(job));
    });
    return () => source.close();
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ subscribe }), [subscribe]);
  return <JobEventsContext.Provider value={value}>{children}</JobEventsContext.Provider>;
}

const FINAL = new Set(["succeeded", "failed", "cancelled"]);

export interface WatchOptions {
  /** Shown in the progress toast, e.g. "Drafting persona". */
  label: string;
  successMessage?: string;
  onSuccess?: (job: JobDto) => void;
  onError?: (job: JobDto) => void;
}

/**
 * Follows a job until it finishes: a progress toast that becomes a success toast,
 * or an error toast with a Retry button.
 */
export function useJobWatcher() {
  const events = useContext(JobEventsContext);
  if (!events) throw new Error("useJobWatcher must be used inside JobEventsProvider");

  return useMemo(() => {
    const watch = (initial: JobDto, options: WatchOptions): Promise<JobDto> =>
      new Promise((resolve) => {
        const toastId = `job-${initial.id}`;
        let done = false;
        let unsubscribe = () => {};

        const handle = (job: JobDto) => {
          if (done || job.id !== initial.id) return;
          if (!FINAL.has(job.status)) {
            const pct = Math.round(job.progress * 100);
            toast.loading(options.label, {
              id: toastId,
              description: `${job.message || job.status}${pct > 0 ? ` · ${pct}%` : ""}`,
            });
            return;
          }
          done = true;
          unsubscribe();
          if (job.status === "succeeded") {
            toast.success(options.successMessage ?? `${options.label}: done`, { id: toastId, description: undefined });
            options.onSuccess?.(job);
          } else {
            toast.error(`${options.label} failed`, {
              id: toastId,
              description: job.error ?? job.status,
              duration: 15_000,
              action: {
                label: "Retry",
                onClick: () => {
                  api
                    .post<JobDto>(`/jobs/${job.id}/retry`)
                    .then((retried) => watch(retried, options))
                    .catch((error) => toast.error(errorMessage(error)));
                },
              },
            });
            options.onError?.(job);
          }
          resolve(job);
        };

        unsubscribe = events.subscribe(handle);
        handle(initial);
        // The job may have finished before the subscription started.
        api.get<JobDto>(`/jobs/${initial.id}`).then(handle).catch(() => undefined);
      });
    return watch;
  }, [events]);
}
