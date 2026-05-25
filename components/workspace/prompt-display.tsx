"use client";

import * as React from "react";
import { Check, Copy, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  prompt: string;
  onUse?: (prompt: string) => void;
  className?: string;
}

/**
 * Strip the system tags we wrap around the user's prompt before sending
 * it to the model (e.g. "[剧本模式 / 多镜头叙事]" prefix, "[附 N 张参考图]"
 * suffix). The cleaned prompt is what we copy and what we re-load into the
 * composer when the user clicks "使用此提示词".
 */
function cleanPrompt(p: string): string {
  return p
    .replace(/^\[[^\]]+模式[^\]]*\]\n?/, "")
    .replace(/\n?\[附\s*\d+\s*张参考图\]$/, "")
    .trim();
}

export function PromptDisplay({ prompt, onUse, className }: Props) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleaned = React.useMemo(() => cleanPrompt(prompt), [prompt]);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  React.useEffect(() => () => cancelClose(), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("复制失败，请手动选中");
    }
  };

  return (
    <div
      className={cn("relative inline-block w-full", className)}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <p className="line-clamp-2 text-sm leading-snug cursor-default">{prompt}</p>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-2 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="max-h-72 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-popover-foreground whitespace-pre-wrap">
            {cleaned}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-1 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">{cleaned.length} 字</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "已复制" : "复制"}
              </button>
              {onUse && (
                <button
                  type="button"
                  onClick={() => { onUse(cleaned); setOpen(false); toast.success("已填入输入框"); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background transition-all hover:brightness-110"
                >
                  <Wand2 className="size-3.5" />
                  使用此提示词
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
