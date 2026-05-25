"use client";

import * as React from "react";
import {
  ArrowUp, AtSign, Check, ChevronDown, Film, ImagePlus, Layers, Loader2,
  Plus, Settings2, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ExtrasPanel } from "./extras-panel";
import { findModel, useVideoModels } from "@/lib/catalog";
import { resolveVideoSpec } from "@/lib/providers/capabilities";
import type { Subject, VideoParams, VideoReferenceMode } from "@/lib/types";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type RefMention = { kind: "ref"; name: string; label: string; imageUrl: string; index: number };
type SubjectMention = { kind: "subject"; name: string; subject: Subject };
type Mention = RefMention | SubjectMention;

interface Props {
  prompt: string;
  onPromptChange: (v: string) => void;

  modelId: string;
  onModelChange: (id: string) => void;

  duration: VideoParams["duration"];
  onDurationChange: (v: VideoParams["duration"]) => void;
  resolution: VideoParams["resolution"];
  onResolutionChange: (v: VideoParams["resolution"]) => void;
  camera: VideoParams["camera"];
  onCameraChange: (v: VideoParams["camera"]) => void;

  /** 多张参考图（最多 9 张）— 替代旧的 referenceImageUrl + endFrameUrl */
  references: string[];
  onReferencesChange: (v: string[]) => void;

  referenceMode: VideoReferenceMode;
  onReferenceModeChange: (v: VideoReferenceMode) => void;

  /** 主体库 + 已 @ 引用的主体（按 prompt 文本扫描得出） */
  attachedSubjects: Subject[];
  allSubjects: Subject[];
  onSubjectsChanged?: () => void;

  /** Provider-specific extras (Kling mode, Luma loop, …) */
  extras: Record<string, unknown>;
  onExtrasChange: (v: Record<string, unknown>) => void;

  /** Negative prompt — only when spec.supportsNegativePrompt */
  negative?: string;
  onNegativeChange?: (v: string) => void;

  /** Seed — only when spec.supportsSeed */
  seed?: number;
  onSeedChange?: (v: number | undefined) => void;

  isRunning: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCES = 9;

const REFERENCE_MODES: Array<{
  value: VideoReferenceMode;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  maxRefs: number;
  slotLabels?: string[];
}> = [
  {
    value: "universal",
    label: "全能参考",
    hint: "上传 1-9 张参考素材，模型综合提取人物 / 风格 / 场景多元素",
    icon: Sparkles,
    maxRefs: 9,
  },
  {
    value: "first-last",
    label: "首尾帧",
    hint: "首帧 + 尾帧两张图，模型在中间补全过渡动画",
    icon: Film,
    maxRefs: 2,
    slotLabels: ["首帧", "尾帧"],
  },
  {
    value: "keyframes",
    label: "智能多帧",
    hint: "1-9 张关键帧按顺序排列，模型在帧间智能补全",
    icon: Layers,
    maxRefs: 9,
  },
];

export function VideoComposer({
  prompt, onPromptChange,
  modelId, onModelChange,
  duration, onDurationChange,
  resolution, onResolutionChange,
  camera, onCameraChange,
  references, onReferencesChange,
  referenceMode, onReferenceModeChange,
  attachedSubjects, allSubjects,
  extras, onExtrasChange,
  negative, onNegativeChange,
  seed, onSeedChange,
  isRunning, onSubmit, onCancel,
}: Props) {
  const videoModels = useVideoModels();
  const currentModel = findModel(modelId);
  const spec = React.useMemo(() => resolveVideoSpec(currentModel), [currentModel]);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [refModeOpen, setRefModeOpen] = React.useState(false);
  const [atPickerOpen, setAtPickerOpen] = React.useState(false);
  const [pendingSlot, setPendingSlot] = React.useState<number | null>(null);

  // @-mention：把上传的参考图当成可被 prompt 引用的实体
  const [mention, setMention] = React.useState<{ active: boolean; anchor: number; query: string }>({
    active: false, anchor: -1, query: "",
  });
  const [mentionHighlight, setMentionHighlight] = React.useState(0);
  const closeMention = () => setMention({ active: false, anchor: -1, query: "" });

  const refMentions = React.useMemo<RefMention[]>(
    () => references.map((url, i) => ({
      kind: "ref" as const,
      name: `参考图${i + 1}`,
      label: REFERENCE_MODES.find((m) => m.value === referenceMode)?.slotLabels?.[i] ?? `参考图${i + 1}`,
      imageUrl: url,
      index: i,
    })),
    [references, referenceMode],
  );
  const subjectMentions = React.useMemo<SubjectMention[]>(
    () => (allSubjects ?? []).map((s) => ({ kind: "subject" as const, name: s.name, subject: s })),
    [allSubjects],
  );
  const filteredMentions = React.useMemo<Mention[]>(() => {
    if (!mention.active) return [];
    const q = mention.query.toLowerCase();
    const refs = refMentions.filter((r) => r.name.toLowerCase().startsWith(q));
    const subs = subjectMentions.filter((s) => s.name.toLowerCase().startsWith(q));
    return [...refs, ...subs].slice(0, 8);
  }, [mention, refMentions, subjectMentions]);

  // 把 highlight 钳制到合法区间作为派生值（避免在 useEffect 里再 setState）
  const clampedMentionHighlight = Math.min(
    mentionHighlight,
    Math.max(0, filteredMentions.length - 1),
  );

  const insertMention = (m: Mention) => {
    const ta = taRef.current;
    if (!ta) return;
    let next: string;
    let newCaret: number;
    if (mention.active && mention.anchor >= 0) {
      // 用户打 @ 触发：替换 @xxx 这段
      const before = prompt.slice(0, mention.anchor - 1);
      const after = prompt.slice(mention.anchor + mention.query.length);
      const inserted = `@${m.name} `;
      next = before + inserted + after;
      newCaret = before.length + inserted.length;
    } else {
      // 用户点 @ 按钮触发：在当前光标位置插入（即便 textarea 失焦，selectionStart 仍保留最后位置）
      const caret = ta.selectionStart ?? prompt.length;
      const before = prompt.slice(0, caret);
      const after = prompt.slice(caret);
      const sep = caret === 0 || /\s$/.test(before) ? "" : " ";
      const inserted = `${sep}@${m.name} `;
      next = before + inserted + after;
      newCaret = before.length + inserted.length;
    }
    onPromptChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
    closeMention();
  };

  // 解析当前 prompt 中已经 @ 出现的参考图（subjects 由父组件传 attachedSubjects）
  const attachedRefs = React.useMemo<RefMention[]>(
    () => refMentions.filter((r) => new RegExp(`@${escapeRegExp(r.name)}(?=\\s|$)`).test(prompt)),
    [refMentions, prompt],
  );

  const removeMentionToken = (name: string) => {
    const re = new RegExp(`@${escapeRegExp(name)}(?=\\s|$)`, "g");
    onPromptChange(prompt.replace(re, "").replace(/[ \t]{2,}/g, " ").trimStart());
  };

  const modeMeta = REFERENCE_MODES.find((m) => m.value === referenceMode) ?? REFERENCE_MODES[0];

  const readFiles = (files: FileList): Promise<string[]> => {
    const arr = Array.from(files).filter((f) => {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} 大于 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
        return false;
      }
      return true;
    });
    return Promise.all(arr.map((f) => new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(f);
    })));
  };

  const handleFiles = async (fs: FileList | null) => {
    if (!fs || fs.length === 0) return;
    const next = [...references];
    const dataUrls = await readFiles(fs);
    if (pendingSlot !== null) {
      // 替换指定槽位
      next[pendingSlot] = dataUrls[0];
      setPendingSlot(null);
    } else {
      // 追加，限制总数 ≤ modeMeta.maxRefs
      for (const u of dataUrls) {
        if (next.length >= modeMeta.maxRefs) {
          toast.message(`${modeMeta.label}最多 ${modeMeta.maxRefs} 张`);
          break;
        }
        next.push(u);
      }
    }
    onReferencesChange(next);
  };

  const removeRef = (i: number) => {
    const next = references.filter((_, idx) => idx !== i);
    onReferencesChange(next);
  };

  // 切换模式时，把多余的参考图截断
  React.useEffect(() => {
    if (references.length > modeMeta.maxRefs) {
      onReferencesChange(references.slice(0, modeMeta.maxRefs));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMode]);

  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onPromptChange(value);
    const caret = e.target.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    // 匹配光标前的 @xxx（xxx 是字母 / 中文 / 数字 / 下划线）
    const m = /@([\p{L}\p{N}_]*)$/u.exec(upto);
    if (m) {
      const before = upto.slice(0, upto.length - m[0].length);
      // 只有在行首或空白后的 @ 才触发，避免邮箱被误识别
      if (before.length === 0 || /\s$/.test(before)) {
        setMention({ active: true, anchor: caret - m[1].length, query: m[1] });
        return;
      }
    }
    if (mention.active) closeMention();
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.active && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight(Math.min(clampedMentionHighlight + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight(Math.max(clampedMentionHighlight - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[clampedMentionHighlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (
      e.key === "Enter"
      && !e.shiftKey
      && !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onSubmit();
    }
  };

  const model = currentModel;
  // 强制至少需要参考图的模型（如纯 i2v）：模式切到 universal 也要至少一张
  const refRequired = spec.requiresReferenceImage === true;
  const canSubmit =
    !isRunning &&
    prompt.trim().length > 0 &&
    (!refRequired || references.length > 0) &&
    (referenceMode !== "first-last" || references.length === 0 || references.length === 2 || references.length === 1);

  return (
    <div className="relative w-full">
      <div className="rounded-3xl border border-border bg-card shadow-[0_24px_60px_-30px_color-mix(in_oklab,black_25%,transparent)]">
        {/* 参考图：多张网格（最多 9 张，按 mode 决定语义）*/}
        <div className="space-y-2 px-5 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {references.map((url, i) => (
              <div
                key={`${i}-${url.slice(-12)}`}
                className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-secondary"
              >
                <img src={url} alt={`参考 ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeRef(i)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`移除参考 ${i + 1}`}
                >
                  <X className="size-3" />
                </button>
                <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1 text-[10px] text-white">
                  {modeMeta.slotLabels?.[i] ?? `${i + 1}`}
                </span>
              </div>
            ))}
            {references.length < modeMeta.maxRefs && (
              <button
                type="button"
                onClick={() => { setPendingSlot(null); fileRef.current?.click(); }}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-card transition-colors hover:border-brand-400/40"
              >
                <Plus className="size-4 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  {modeMeta.slotLabels?.[references.length] ?? `第 ${references.length + 1} 张`}
                </span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {modeMeta.hint} · 最多 {modeMeta.maxRefs} 张，单张 ≤ {MAX_FILE_BYTES / 1024 / 1024}MB
            {refRequired && references.length === 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · {model?.name ?? "当前模型"} 仅支持图生视频，至少需要一张参考图
              </span>
            )}
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* 已 @ 引用的资源 chips（参考图 + 主体）— 给一个清晰的 "你引用了什么" 视图 */}
        {(attachedRefs.length > 0 || (attachedSubjects ?? []).length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-5 pt-3">
            {attachedRefs.map((r) => (
              <span
                key={`ref-${r.name}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/40 bg-brand-400/10 px-2 py-0.5 text-[11px] text-foreground"
              >
                <img src={r.imageUrl} className="size-4 rounded-full object-cover" alt={r.name} />
                @{r.name}
                <button
                  type="button"
                  onClick={() => removeMentionToken(r.name)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`移除 @${r.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {(attachedSubjects ?? []).map((s) => (
              <span
                key={`sub-${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-aurora-400/40 bg-aurora-400/10 px-2 py-0.5 text-[11px] text-foreground"
              >
                {s.imageUrl
                  ? <img src={s.imageUrl} className="size-4 rounded-full object-cover" alt={s.name} />
                  : <span className="size-4 rounded-full bg-aurora-400/30 text-[8px] flex items-center justify-center">主</span>
                }
                @{s.name}
                <button
                  type="button"
                  onClick={() => removeMentionToken(s.name)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`移除 @${s.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Text input */}
        <div className="relative px-5 pt-4">
          <textarea
            ref={taRef}
            value={prompt}
            onChange={onTextareaChange}
            onKeyDown={onTextareaKeyDown}
            placeholder={
              references.length > 0
                ? "描述镜头与动作；输入 @ 引用上传的参考图（如 @参考图1）。Enter 发送 · Shift+Enter 换行。"
                : "描述镜头与动作。例如：相机缓慢左移，云层快速流动，光影渐变。Enter 发送 · Shift+Enter 换行。"
            }
            className={cn(
              "w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-0 min-h-20",
            )}
          />

          {/* @-mention popup：参考图 + 主体 */}
          {mention.active && filteredMentions.length > 0 && (
            <div className="absolute left-5 right-5 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl">
              <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-widest text-muted-foreground">
                参考图 + 主体（↑↓ 选 · Enter / Tab 插入）
              </div>
              {filteredMentions.map((m, i) => (
                <button
                  key={`${m.kind}-${m.name}`}
                  type="button"
                  onClick={() => insertMention(m)}
                  onMouseEnter={() => setMentionHighlight(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                    i === clampedMentionHighlight ? "bg-secondary" : "hover:bg-secondary/60",
                  )}
                >
                  {m.kind === "ref" ? (
                    <img src={m.imageUrl} alt={m.name} className="size-9 rounded-md border border-border object-cover" />
                  ) : m.subject.imageUrl ? (
                    <img src={m.subject.imageUrl} alt={m.name} className="size-9 rounded-md border border-border object-cover" />
                  ) : (
                    <span className="flex size-9 items-center justify-center rounded-md border border-border bg-secondary text-[10px] text-muted-foreground">
                      主体
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      @{m.name}
                      <span className="ml-1.5 rounded-md bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">
                        {m.kind === "ref" ? "参考图" : "主体"}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {m.kind === "ref" ? m.label : (m.subject.description || "无描述")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {mention.active && filteredMentions.length === 0 && (
            <div className="absolute left-5 right-5 top-full z-30 mt-1 rounded-xl border border-dashed border-border bg-popover px-3 py-2 text-[12px] text-muted-foreground shadow-xl">
              没有匹配的参考图或主体。上传参考图，或到「主体库」添加 @ 引用对象。
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-3">
          <ToolbarButton
            label="添加参考图"
            icon={<ImagePlus className="size-4" />}
            onClick={() => { setPendingSlot(null); fileRef.current?.click(); }}
          />

          {/* @ 引用：点这里直接弹出参考图 + 主体列表，不必打字 */}
          <Popover open={atPickerOpen} onOpenChange={setAtPickerOpen}>
            <PopoverTrigger>
              <ToolbarButton
                label={refMentions.length > 0 ? "@ 引用参考图或主体" : "@ 引用主体"}
                icon={<AtSign className="size-4" />}
              />
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="max-h-72 overflow-y-auto">
                {refMentions.length > 0 && (
                  <>
                    <div className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      参考图（本次上传）
                    </div>
                    <div className="py-1">
                      {refMentions
                        .filter((r) => !attachedRefs.some((a) => a.index === r.index))
                        .map((r) => (
                          <button
                            key={r.index}
                            type="button"
                            onClick={() => { insertMention(r); setAtPickerOpen(false); }}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary"
                          >
                            <div className="size-8 shrink-0 overflow-hidden rounded-lg bg-secondary">
                              <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm">@{r.name}</div>
                              <div className="text-[11px] text-muted-foreground">{r.label}</div>
                            </div>
                          </button>
                        ))}
                      {refMentions.every((r) => attachedRefs.some((a) => a.index === r.index)) && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">所有参考图都已引用</div>
                      )}
                    </div>
                  </>
                )}
                <div className="border-y border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  主体（我的库）
                </div>
                <div className="py-1">
                  {(allSubjects ?? []).length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      还没有主体 — 去「主体」页新建。
                    </div>
                  ) : (
                    (allSubjects ?? [])
                      .filter((s) => !(attachedSubjects ?? []).some((a) => a.id === s.id))
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            insertMention({ kind: "subject", name: s.name, subject: s });
                            setAtPickerOpen(false);
                          }}
                          className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary"
                        >
                          <div className="size-8 shrink-0 overflow-hidden rounded-lg bg-secondary">
                            {s.imageUrl ? (
                              <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                {s.name.slice(0, 2)}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm">@{s.name}</div>
                            <div className="line-clamp-1 text-[11px] text-muted-foreground">{s.description}</div>
                          </div>
                        </button>
                      ))
                  )}
                  {(allSubjects ?? []).length > 0 && (allSubjects ?? []).every((s) => (attachedSubjects ?? []).some((a) => a.id === s.id)) && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">所有主体都已引用</div>
                  )}
                </div>
              </div>
              <a
                href="/app/subjects"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-brand-500 transition-colors hover:bg-secondary"
              >
                <Sparkles className="size-3.5" />
                到「主体」页新建 / 管理主体 ↗
              </a>
            </PopoverContent>
          </Popover>

          {/* 参考模式（不论模型 spec 都展示，让用户拥有一致的基础能力） */}
          <Popover open={refModeOpen} onOpenChange={setRefModeOpen}>
            <PopoverTrigger>
              <ToolbarPill
                icon={<modeMeta.icon className="size-3.5 text-brand-500" />}
                label={modeMeta.label}
              />
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="p-1.5">
                {REFERENCE_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { onReferenceModeChange(m.value); setRefModeOpen(false); }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      m.value === referenceMode ? "bg-secondary" : "hover:bg-secondary/60",
                    )}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-card text-foreground">
                      <m.icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {m.label}
                        {m.value === referenceMode && <Check className="size-3 text-brand-500" />}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{m.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger>
              <ToolbarPill
                icon={<Sparkles className="size-3.5 text-brand-500" />}
                label={model?.name ?? "选择模型"}
              />
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="max-h-72 overflow-y-auto p-1.5">
                {videoModels.map((m) => (
                  <PopoverItem
                    key={m.id}
                    active={m.id === modelId}
                    icon={<Sparkles className="size-3.5" />}
                    title={m.name}
                    desc={`${m.vendor} · ~${(m.avgLatencyMs / 1000).toFixed(1)}s · ${m.costPerCall} cr`}
                    onClick={() => { onModelChange(m.id); setModelOpen(false); }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <PopoverTrigger>
              <ToolbarButton label="高级参数" icon={<Settings2 className="size-4" />} />
            </PopoverTrigger>
            <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto">
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                  {/* Duration */}
                  {spec.duration !== "fixed" && spec.duration.mode === "enum" && (
                    <div className="space-y-2">
                      <Label>时长</Label>
                      <Select value={String(duration)} onValueChange={(v) => onDurationChange(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {spec.duration.options.map((d) => (
                            <SelectItem key={d} value={String(d)}>{d} 秒</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {spec.duration.hint && (
                        <p className="text-[11px] text-muted-foreground">{spec.duration.hint}</p>
                      )}
                    </div>
                  )}
                  {spec.duration !== "fixed" && spec.duration.mode === "range" && (
                    <div className="space-y-2">
                      <Label>时长（{duration}秒）</Label>
                      <Input
                        type="number"
                        min={spec.duration.min}
                        max={spec.duration.max}
                        step={spec.duration.step}
                        value={duration}
                        onChange={(e) => onDurationChange(Number(e.target.value))}
                      />
                      {spec.duration.hint && (
                        <p className="text-[11px] text-muted-foreground">{spec.duration.hint}</p>
                      )}
                    </div>
                  )}
                  {/* Resolution */}
                  {spec.resolution !== "fixed" && (
                    <div className="space-y-2">
                      <Label>分辨率</Label>
                      <Select value={resolution} onValueChange={(v) => onResolutionChange(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {spec.resolution.options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {spec.resolution.hint && (
                        <p className="text-[11px] text-muted-foreground">{spec.resolution.hint}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Camera */}
                {spec.camera !== "none" && spec.camera.mode === "enum" && (
                  <div className="space-y-2">
                    <Label>运镜</Label>
                    <Select value={camera} onValueChange={(v) => onCameraChange(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {spec.camera.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {spec.camera !== "none" && spec.camera.mode === "free-text" && (
                  <div className="space-y-2">
                    <Label>运镜描述</Label>
                    <Input
                      value={camera}
                      placeholder={spec.camera.placeholder}
                      onChange={(e) => onCameraChange(e.target.value)}
                    />
                  </div>
                )}

                {/* Negative prompt */}
                {spec.supportsNegativePrompt && onNegativeChange && (
                  <div className="space-y-2">
                    <Label>负向提示词</Label>
                    <Textarea
                      rows={2}
                      placeholder="例如：抖动、画面脏、变形"
                      value={negative ?? ""}
                      onChange={(e) => onNegativeChange(e.target.value)}
                      className="min-h-16 text-sm"
                    />
                  </div>
                )}

                {/* Seed */}
                {spec.supportsSeed && onSeedChange && (
                  <div className="space-y-2">
                    <Label>Seed（留空 = 随机）</Label>
                    <Input
                      type="number"
                      value={seed ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        onSeedChange(v === "" ? undefined : Number(v));
                      }}
                    />
                  </div>
                )}

                {/* Model-specific advanced params */}
                <ExtrasPanel
                  spec={spec.extras ?? []}
                  value={extras}
                  onChange={onExtrasChange}
                  title={model ? `${model.name} 独有参数` : undefined}
                />

                {spec.duration === "fixed" && spec.resolution === "fixed" && spec.camera === "none" && !spec.supportsNegativePrompt && !spec.supportsSeed && (!spec.extras || spec.extras.length === 0) && (
                  <p className="text-[11px] text-muted-foreground">
                    {model?.name ?? "当前模型"} 只接受提示词与首帧，没有可调参数。
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {isRunning ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <Loader2 className="size-3.5 animate-spin" />
              取消
            </Button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-all",
                canSubmit
                  ? "bg-foreground text-background shadow-md hover:brightness-110 active:scale-95"
                  : "bg-secondary text-muted-foreground cursor-not-allowed",
              )}
              aria-label="开始生成"
              title={refRequired && references.length === 0 ? "该模型仅支持图生视频，请先上传至少一张参考图" : "开始生成（Enter · Shift+Enter 换行）"}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Local toolbar primitives & lightweight popover (mirrors CenterComposer) ─── */

function ToolbarButton({
  label, icon, onClick,
}: { label: string; icon: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {icon}
    </button>
  );
}

function ToolbarPill({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-foreground transition-colors hover:bg-secondary"
    >
      {icon}
      <span>{label}</span>
      <ChevronDown className="size-3 text-muted-foreground" />
    </button>
  );
}

const PopoverContext = React.createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

function Popover({
  open, onOpenChange, children,
}: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      // Radix Select / Dropdown render to a portal outside this DOM tree —
      // treat clicks inside any Radix popper content as "still inside" so
      // the child Select can commit before the parent popover closes.
      if (target.closest?.("[data-radix-popper-content-wrapper]")) return;
      onOpenChange(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative">
      <PopoverContext.Provider value={{ open, setOpen: onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    </div>
  );
}

function PopoverTrigger({ children }: { children: React.ReactElement }) {
  const ctx = React.useContext(PopoverContext);
  type WithOnClick = { onClick?: (e: React.MouseEvent) => void };
  const child = children as React.ReactElement<WithOnClick>;
  return React.cloneElement(child, {
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      ctx?.setOpen(!ctx.open);
    },
  });
}

function PopoverContent({
  className, children,
}: { className?: string; children: React.ReactNode }) {
  const ctx = React.useContext(PopoverContext);
  if (!ctx?.open) return null;
  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-30 mb-2 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-popover shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PopoverItem({
  active, icon, title, desc, onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-card text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {desc && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{desc}</span>}
      </span>
    </button>
  );
}
