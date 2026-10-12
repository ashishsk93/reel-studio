"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ["C"], what: "Copy the prompt under the mouse, or the first one on screen" },
  { keys: ["Z"], what: "Download that prompt's attachments (zip)" },
  { keys: ["]"], what: "Next step of the project" },
  { keys: ["["], what: "Previous step" },
  { keys: ["1", "–", "8"], what: "Jump to a step" },
  { keys: ["Ctrl", "Enter"], what: "Send a message to the modification assistant" },
  { keys: ["?"], what: "Show these shortcuts" },
];

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role=dialog]") !== null;
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/** The copy target the user means: the one under the mouse, else the first visible one. */
function target(selector: string): HTMLElement | null {
  const hovered = [...document.querySelectorAll(":hover")].pop();
  const near = hovered?.closest<HTMLElement>(selector);
  if (near) return near;
  return [...document.querySelectorAll<HTMLElement>(selector)].find(onScreen) ?? null;
}

function copyNow(): void {
  const card = target("[data-copy-target]");
  const button = card?.querySelector<HTMLElement>("[data-copy]") ?? target("[data-copy]");
  if (!button) return void toast("Nothing to copy on this page");
  button.click();
  button.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function zipNow(): void {
  const card = target("[data-copy-target]");
  const link = card?.querySelector<HTMLAnchorElement>('a[href*=".zip"]') ?? target('a[href*="attachments.zip"]');
  if (!link) return void toast("No attachments to download here");
  link.click();
}

/** Stepper links in order; locked steps have no href. */
function stepLinks(): Array<{ href: string | null; current: boolean }> {
  return [...document.querySelectorAll("[data-stepper] li")].map((li) => {
    const a = li.querySelector("a");
    return { href: a?.getAttribute("href") ?? null, current: a?.getAttribute("aria-current") === "step" };
  });
}

/** Global single-key shortcuts (ignored while typing or inside dialogs) and the "?" help dialog. */
export function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const go = (index: number) => {
      const steps = stepLinks();
      if (steps.length === 0) return;
      const step = steps[index];
      if (!step) return;
      if (!step.href) return void toast("Finish the earlier steps first");
      router.push(step.href);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key;
      if (key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (key === "c" || key === "C") copyNow();
      else if (key === "z" || key === "Z") zipNow();
      else if (key === "]" || key === "[") {
        const steps = stepLinks();
        const current = steps.findIndex((s) => s.current);
        if (current < 0) return;
        go(current + (key === "]" ? 1 : -1));
      } else if (/^[1-8]$/.test(key)) go(Number(key) - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Keyboard /> Shortcuts <kbd className="ml-auto rounded border px-1.5 font-mono text-[10px]">?</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Single keys work anywhere except while typing in a field.</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2 text-sm">
            {SHORTCUTS.map((s) => (
              <li key={s.what} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{s.what}</span>
                <span className="flex shrink-0 gap-1">
                  {s.keys.map((k) =>
                    k === "–" ? (
                      <span key={k} className="text-muted-foreground">
                        –
                      </span>
                    ) : (
                      <kbd key={k} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {k}
                      </kbd>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
