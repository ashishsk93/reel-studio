"use client";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { JobEventsProvider } from "@/lib/jobs";
import { LightboxProvider } from "@/components/lightbox";

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  const make = () =>
    new QueryClient({
      defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
    });
  if (typeof window === "undefined") return make();
  browserQueryClient ??= make();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={getQueryClient()}>
        <JobEventsProvider>
          <TooltipProvider>
            <LightboxProvider>{children}</LightboxProvider>
          </TooltipProvider>
          <Toaster richColors closeButton position="bottom-right" />
        </JobEventsProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
