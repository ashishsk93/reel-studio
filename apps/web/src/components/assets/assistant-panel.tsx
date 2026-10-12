"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { AssetDto, AssistantMessageDto, JobDto } from "@reel/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EditPromptCard } from "@/components/assets/review-card";
import { api, errorMessage } from "@/lib/api";
import { useJobWatcher } from "@/lib/jobs";
import { assistantKeys, useAssistantMessages } from "@/lib/queries";
import { cn } from "@/lib/utils";

const EXAMPLES = ["Make the embroidery denser on the sleeves", "Change the background to a rooftop at golden hour", "Fix her hands"];

/** Modification assistant: describe a change, get an edit prompt plus the images to attach. History is kept per image. */
export function AssistantPanel({
  asset,
  open,
  onOpenChange,
  onEdited,
}: {
  asset: AssetDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdited?: () => void;
}) {
  const queryClient = useQueryClient();
  const watch = useJobWatcher();
  const { data: messages = [], isPending } = useAssistantMessages(asset.id, open);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, thinking, open]);

  // Suggestions from the latest review's issues, then generic examples.
  const suggestions = [
    ...(asset.review?.issues ?? []).slice(0, 3).map((i) => `Fix this: ${i.description}`),
    ...EXAMPLES,
  ].slice(0, 4);

  const send = async (message: string) => {
    const body = message.trim();
    if (!body || thinking) return;
    setThinking(true);
    setText("");
    const key = assistantKeys.messages(asset.id);
    try {
      const { job } = await api.post<{ message: AssistantMessageDto; job: JobDto }>(`/assets/${asset.id}/assistant`, { message: body });
      await queryClient.invalidateQueries({ queryKey: key });
      const done = await watch(job, { label: "Modification assistant", successMessage: "Edit ready" });
      if (done.status === "succeeded") onEdited?.();
    } catch (e) {
      toast.error(errorMessage(e));
      setText(body);
    } finally {
      await queryClient.invalidateQueries({ queryKey: key });
      setThinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Modify version {asset.version}
          </DialogTitle>
          <DialogDescription>
            Describe a change. You get an edit prompt for Higgsfield, the images to attach in order, and what to check.
            Everything you don&apos;t mention stays the same.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt="" className="hidden aspect-[9/16] w-32 self-start rounded-lg border object-cover sm:block" />
          <div className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {!isPending && messages.length === 0 && !thinking && (
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>Try one of these, or write your own:</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setText(s)}
                      className="rounded-full border px-2.5 py-1 text-left text-xs hover:border-primary/50 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                <p
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {m.content}
                </p>
                {m.edit && (
                  <div className="w-full">
                    <EditPromptCard edit={m.edit} />
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Writing the edit…
              </p>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <form
          className="flex items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send(text);
              }
            }}
            placeholder='e.g. "The embroidery looks too sparse on the sleeve" (Ctrl+Enter to send)'
          />
          <Button type="submit" disabled={!text.trim() || thinking}>
            {thinking ? <Loader2 className="animate-spin" /> : <Send />} Send
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
