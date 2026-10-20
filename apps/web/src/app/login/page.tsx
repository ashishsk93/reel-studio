"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, LogIn, Moon, Sun } from "lucide-react";
import type { AuthStatusDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

/** Only same-site paths, so ?next= can't send you to another site after signing in. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/projects";
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const next = safeNext(useSearchParams().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<AuthStatusDto>("/auth/status") });
  const login = useMutation({
    mutationFn: () => api.post("/auth/login", { username, password }),
    // A full load, so every query and the job stream start fresh with the new session.
    onSuccess: () => window.location.assign(next),
    onError: () => setPassword(""),
  });
  const error =
    login.error instanceof ApiError && login.error.status === 401
      ? "Wrong username or password."
      : login.error instanceof ApiError && login.error.status === 429
        ? "Too many attempts. Wait a minute and try again."
        : login.error
          ? "Couldn't reach Reel Studio. Try again in a moment."
          : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-sidebar px-4">
      <ThemeButton />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary font-display text-lg font-extrabold text-primary-foreground">
            RS
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Reel Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">@slayurbansociety</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {status.data && !status.data.enabled ? (
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">Sign-in is off on this computer; it is only needed on the hosted app.</p>
              <Button nativeButton={false} render={<Link href="/projects" />}>
                Open Reel Studio
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="mt-1" disabled={login.isPending || !username || !password}>
                {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Private workspace. Repeated wrong passwords block your address.</p>
      </div>
    </div>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  if (!resolvedTheme) return null;
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="absolute top-4 right-4"
      aria-label={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
