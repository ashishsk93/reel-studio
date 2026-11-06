"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clapperboard, LogOut, Menu, MessageCircleReply, Moon, Settings, Store, Sun, Users, X } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { AuthStatusDto, HealthDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Shortcuts } from "@/components/shortcuts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/projects", label: "Projects", icon: Clapperboard },
  { href: "/influencers", label: "Influencers", icon: Users },
  { href: "/sources", label: "Sources & logos", icon: Store },
  { href: "/instagram", label: "Instagram", icon: MessageCircleReply },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/usage", label: "Usage & costs", icon: BarChart3 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the phone/tablet drawer whenever the route changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // The login page is full-screen, without the sidebar.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Phone and tablet: a top bar with a menu button; the sidebar becomes a drawer. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-sidebar/95 px-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <Menu />
        </Button>
        <Brand compact />
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden onClick={() => setMenuOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r bg-sidebar px-3 py-5 transition-transform duration-200",
          menuOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-60 lg:translate-x-0 lg:shadow-none",
        )}
      >
        <div className="mb-8 flex items-center justify-between">
          <Brand />
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <X />
          </Button>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:py-2",
                  active && "bg-sidebar-accent font-medium text-sidebar-foreground",
                )}
              >
                <Icon className={cn("size-4", active && "text-primary")} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-6">
          <StatusPanel />
          <div className="flex flex-col">
            <Shortcuts />
            <ThemeToggle />
            <SignOut />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/projects" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-extrabold text-primary-foreground">
        RS
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-semibold">Reel Studio</span>
        {!compact && <span className="block text-xs text-muted-foreground">@slayurbansociety</span>}
      </span>
    </Link>
  );
}

function StatusPanel() {
  const { data, error } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthDto>("/health"),
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        API offline. Start it with <code className="font-mono">pnpm dev</code>.
      </div>
    );
  }
  if (!data) return null;
  if (data.llmMode === "live") {
    return (
      <div className="px-2 text-xs text-muted-foreground">
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />
        Claude live · {data.modelDefault}
        {data.decisions && (
          <>
            <br />
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-sky-500 align-middle" />
            OpenAI decisions on
          </>
        )}
        {data.decisionsBlocked && (
          <>
            <br />
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle" />
            <span title={data.decisionsBlocked}>OpenAI decisions off (no access); using Claude</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      <strong className="font-semibold">LLM_MODE={data.llmMode}</strong>
      <br />
      AI answers are canned fixtures. Add your key in <code className="font-mono">.env</code> and set LLM_MODE=live.
    </div>
  );
}

/** Only on the hosted app, where sign-in is on. */
function SignOut() {
  const { data } = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<AuthStatusDto>("/auth/status"), staleTime: Infinity });
  if (!data?.enabled) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start"
      onClick={async () => {
        await api.post("/auth/logout").catch(() => undefined);
        // A full load, not a client-side push: the session is gone and every query and stream must restart.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      }}
    >
      <LogOut /> Sign out
    </Button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is undefined until mounted; render a neutral placeholder so SSR matches.
  if (!resolvedTheme) return <div className="h-7" />;
  const dark = resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="sm" className="justify-start" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light mode" : "Dark mode"}
    </Button>
  );
}
