"use client";

import * as React from "react";
import {
  ArrowUp, AtSign, ChevronDown, FilmIcon, ImagePlus, Lightbulb, Loader2,
  Settings2, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SubjectManager } from "./subject-manager";
import { ExtrasPanel } from "./extras-panel";
import { IMAGE_STYLES, findModel, useImageModels } from "@/lib/catalog";
import { resolveImageSpec } from "@/lib/providers/capabilities";
import type { ImageParams, PromptMode, Subject } from "@/lib/types";

interface Props {
  prompt: string;
  onPromptChange: (v: string) => void;
  mode: PromptMode;
  onModeChange: (m: PromptMode) => void;

  modelId: string;
  onModelChange: (id: string) => void;

  size: ImageParams["size"];
  onSizeChange: (v: ImageParams["size"]) => void;
  batch: ImageParams["batch"];
  onBatchChange: (v: ImageParams["batch"]) => void;
  style: string;
  onStyleChange: (v: string) => void;
  negative: string;
  onNegativeChange: (v: string) => void;

  references: string[];
  onReferencesChange: (v: string[]) => void;

  /** Per-model "advanced" extras, e.g. dall-e-3 quality, wanx prompt_extend. */
  extras: Record<string, unknown>;
  onExtrasChange: (v: Record<string, unknown>) => void;

  attachedSubjects: Subject[];
  allSubjects: Subject[];
  onSubjectsChanged: () => void;

  isRunning: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}

/**
 * @-mention items unify two sources:
 *   - Reference images uploaded into this composer (named "参考图1", "参考图2"…)
 *   - Subjects from the user's library
 * References list first because they're the most contextual.
 */
type RefMention = { kind: "ref"; name: string; index: number; imageUrl: string };
type SubjectMention = { kind: "subject"; name: string; subject: Subject };
type Mention = RefMention | SubjectMention;

const MAX_REFS = 9;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function CenterComposer({
  prompt, onPromptChange,
  mode, onModeChange,
  modelId, onModelChange,
  size, onSizeChange,
  batch, onBatchChange,
  style, onStyleChange,
  negative, onNegativeChange,
  references, onReferencesChange,
  extras, onExtrasChange,
  attachedSubjects, allSubjects, onSubjectsChanged,
  isRunning, onSubmit, onCancel,
}: Props) {
  const imageModels = useImageModels();
  const currentModel = findModel(modelId);
  const spec = React.useMemo(() => resolveImageSpec(currentModel), [currentModel]);
  const maxRefs = spec.maxReferenceImages ?? MAX_REFS;
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [modeOpen, setModeOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [subjectPickerOpen, setSubjectPickerOpen] = React.useState(false);
  const [mention, setMention] = React.useState<{
    active: boolean; anchor: number; query: string;
  }>({ active: false, anchor: -1, query: "" });
  const [highlight, _setHighlight] = React.useState(0);
  const [highlightKey, setHighlightKey] = React.useState("");
  if (highlightKey !== mention.query + ":" + String(mention.active)) {
    setHighlightKey(mention.query + ":" + String(mention.active));
    if (highlight !== 0) _setHighlight(0);
  }
  const setHighlight = _setHighlight;

  const closeMention = () => setMention({ active: false, anchor: -1, query: "" });

  const refMentions = React.useMemo<RefMention[]>(
    () => references.map((url, i) => ({
      kind: "ref" as const,
      name: `参考图${i + 1}`,
      index: i,
      imageUrl: url,
    })),
    [references],
  );

  const subjectMentions = React.useMemo<SubjectMention[]>(
    () => allSubjects.map((s) => ({ kind: "subject" as const, name: s.name, subject: s })),
    [allSubjects],
  );

  const filteredMentions = React.useMemo<Mention[]>(() => {
    if (!mention.active) return [];
    const q = mention.query.toLowerCase();
    const refs = refMentions.filter((r) => r.name.toLowerCase().startsWith(q));
    const subs = subjectMentions.filter((s) => s.name.toLowerCase().startsWith(q));
    return [...refs, ...subs].slice(0, 8);
  }, [mention, refMentions, subjectMentions]);

  const insertMention = (m: Mention) => {
    const ta = taRef.current;
    if (!ta) return;
    let next: string;
    let newCaret: number;
    if (mention.active && mention.anchor >= 0) {
      const before = prompt.slice(0, mention.anchor - 1);
      const after = prompt.slice(mention.anchor + mention.query.length);
      const inserted = `@${m.name} `;
      next = before + inserted + after;
      newCaret = before.length + inserted.length;
    } else {
      // 用户点 @ 按钮触发：在当前光标位置插入
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

  const removeMentionToken = (name: string) => {
    const re = new RegExp(`@${escapeRegExp(name)}(?=\\s|$)`, "g");
    onPromptChange(prompt.replace(re, "").replace(/[ \t]{2,}/g, " ").trimStart());
  };

  // Derive the attached references the same way we derive attached subjects:
  // by scanning the prompt for the @-tokens. References mentioned in the
  // prompt show up as chips; uploaded-but-unmentioned ones still appear in
  // the strip above but without a chip.
  const attachedRefs = React.useMemo<RefMention[]>(
    () => refMentions.filter((r) => new RegExp(`@${escapeRegExp(r.name)}(?=\\s|$)`).test(prompt)),
    [refMentions, prompt],
  );

  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onPromptChange(value);
    const caret = e.target.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const m = /@([\p{L}\p{N}_]*)$/u.exec(upto);
    if (m) {
      const before = upto.slice(0, upto.length - m[0].length);
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
        setHighlight((h) => Math.min(h + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    // Enter 发送，Shift+Enter 换行；中文输入法 composition 中的 Enter 不触发
    if (
      e.key === "Enter"
      && !e.shiftKey
      && !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onSubmit();
    }
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files) return;
    // 不再因为 spec.supportsReferenceImages 拦截 —— 让所有模型都能接收参考图。
    // 如果上游 adapter 真的不消费参考图，最多就是被忽略，不会出错。
    if (!spec.supportsReferenceImages) {
      toast.message(`${currentModel?.name ?? "当前模型"} 可能不识别参考图`, {
        description: "已上传保存，但模型生成时可能忽略它。",
      });
    }
    const remaining = maxRefs - references.length;
    if (remaining <= 0) {
      toast.error(`最多 ${maxRefs} 张参考图`);
      return;
    }
    const incoming = Array.from(files).slice(0, remaining);
    Promise.all(
      incoming.map((f) => {
        if (f.size > MAX_FILE_BYTES) {
          toast.error(`${f.name} 超过 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
          return Promise.resolve<string | null>(null);
        }
        return new Promise<string | null>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => resolve(null);
          r.readAsDataURL(f);
        });
      }),
    ).then((urls) => {
      const fresh = urls.filter((u): u is string => !!u);
      if (fresh.length) onReferencesChange([...references, ...fresh]);
    });
  };

  const removeRef = (idx: number) =>
    onReferencesChange(references.filter((_, i) => i !== idx));

  const model = findModel(modelId);

  const canSubmit = !isRunning && prompt.trim().length > 0;

  return (
    <div className="relative w-full">
      <div className="rounded-3xl border border-border bg-card shadow-[0_24px_60px_-30px_color-mix(in_oklab,black_25%,transparent)]">
        {/* Reference image strip (only when present) */}
        {references.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
            {references.map((url, i) => (
              <div key={i} className="group relative">
                {/* Thumbnail */}
                <div className="relative size-14 overflow-hidden rounded-lg border border-border bg-secondary">
                  <img src={url} alt={`参考 ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeRef(i)}
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="移除"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                {/* Hover preview — large floating image above the thumbnail */}
                <div
                  className={cn(
                    "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2",
                    "opacity-0 scale-95 transition-all duration-150",
                    "group-hover:opacity-100 group-hover:scale-100",
                  )}
                >
                  <div className="overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-2xl">
                    <img
                      src={url}
                      alt={`参考 ${i + 1} 预览`}
                      className="block max-h-72 max-w-72 rounded-lg object-contain"
                    />
                    <div className="px-2 pb-1 pt-1 text-[10px] font-mono text-muted-foreground">
                      @参考图{i + 1}
                    </div>
                  </div>
                  {/* Caret pointing down to the thumbnail */}
                  <div className="mx-auto -mt-px size-2 rotate-45 border-b border-r border-border bg-popover" />
                </div>
              </div>
            ))}
            <span className="text-[11px] text-muted-foreground">{references.length}/{maxRefs} 参考</span>
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
              mode === "script"
                ? "用分镜或剧本格式描述更复杂的画面。输入 @ 引用参考图或主体。Enter 发送 · Shift+Enter 换行。"
                : "输入想法、剧本或上传参考。输入 @ 引用参考图或主体，和 Lumen 一起创作。"
            }
            className={cn(
              "w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-0",
              mode === "script" ? "min-h-32" : "min-h-20",
            )}
          />
          {mention.active && filteredMentions.length > 0 && (
            <MentionPopover
              items={filteredMentions}
              highlight={highlight}
              onPick={insertMention}
              onHover={setHighlight}
            />
          )}
          {mention.active && filteredMentions.length === 0 && (
            <div className="absolute left-5 top-full z-30 mt-1 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
              没有匹配的参考图或主体 ·{" "}
              <button
                type="button"
                onClick={() => { closeMention(); setManagerOpen(true); }}
                className="text-brand-500 hover:underline"
              >
                新建一个主体
              </button>
            </div>
          )}
        </div>

        {/* Attached chips: references first, then subjects */}
        {(attachedRefs.length > 0 || attachedSubjects.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
            {attachedRefs.map((r) => (
              <span
                key={`ref-${r.index}`}
                className="group inline-flex items-center gap-1.5 rounded-full border border-aurora-400/40 bg-aurora-400/10 py-1 pl-1 pr-2 text-xs"
                title={`第 ${r.index + 1} 张参考图`}
              >
                <img src={r.imageUrl} alt={r.name} className="size-5 rounded-full object-cover" />
                <span className="font-mono">@{r.name}</span>
                <button
                  type="button"
                  onClick={() => removeMentionToken(r.name)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`从提示词中移除 ${r.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {attachedSubjects.map((s) => (
              <span
                key={`subj-${s.id}`}
                className="group inline-flex items-center gap-1.5 rounded-full border border-brand-400/40 bg-brand-500/8 py-1 pl-1 pr-2 text-xs"
                title={s.description}
              >
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt={s.name} className="size-5 rounded-full object-cover" />
                ) : (
                  <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px]">
                    {s.name.slice(0, 2)}
                  </span>
                )}
                <span className="font-mono">@{s.name}</span>
                <button
                  type="button"
                  onClick={() => removeMentionToken(s.name)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`从提示词中移除 ${s.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-3">
          {/* 上传参考图：所有模型都可见（基础能力）；不识别参考图的模型会在上传时给提示 */}
          <ToolbarButton
            label="上传参考"
            onClick={() => fileRef.current?.click()}
            icon={<ImagePlus className="size-4" />}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Mode pill */}
          <Popover open={modeOpen} onOpenChange={setModeOpen}>
            <PopoverTrigger>
              <ToolbarPill
                icon={mode === "script" ? <FilmIcon className="size-3.5" /> : <Lightbulb className="size-3.5" />}
                label={mode === "script" ? "剧本模式" : "想法模式"}
              />
            </PopoverTrigger>
            <PopoverContent>
              <div className="space-y-1 p-1.5">
                <PopoverItem
                  active={mode === "idea"}
                  icon={<Lightbulb className="size-3.5" />}
                  title="想法"
                  desc="一段提示词，快速生成"
                  onClick={() => { onModeChange("idea"); setModeOpen(false); }}
                />
                <PopoverItem
                  active={mode === "script"}
                  icon={<FilmIcon className="size-3.5" />}
                  title="剧本"
                  desc="多镜头叙事，复杂构图"
                  onClick={() => { onModeChange("script"); setModeOpen(false); }}
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Model pill */}
          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger>
              <ToolbarPill
                icon={<Sparkles className="size-3.5 text-brand-500" />}
                label={model?.name ?? "选择模型"}
              />
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="max-h-72 overflow-y-auto p-1.5">
                {imageModels.map((m) => (
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

          {/* Advanced — content is driven entirely by the model's spec */}
          <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <PopoverTrigger>
              <ToolbarButton label="高级参数" icon={<Settings2 className="size-4" />} />
            </PopoverTrigger>
            <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto">
              <div className="space-y-4 p-4">
                {/* Size — only when spec defines an enum */}
                {spec.size.mode === "enum" && (
                  <div className="space-y-2">
                    <Label>尺寸</Label>
                    <Select value={size} onValueChange={(v) => onSizeChange(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {spec.size.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.ratio === "auto" ? o.label : `${o.ratio} · ${o.label}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Batch — hidden when model only supports n=1 */}
                  {spec.maxBatch > 1 && (
                    <div className="space-y-2">
                      <Label>批量</Label>
                      <Select value={String(batch)} onValueChange={(v) => onBatchChange(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: spec.maxBatch }, (_, i) => i + 1).map((n) => (
                            <SelectItem key={n} value={String(n)}>{n} 张</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {/* Style preset (Lumen UI-side, injected into prompt; not provider-specific) */}
                  <div className="space-y-2">
                    <Label>风格</Label>
                    <Select value={style} onValueChange={onStyleChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMAGE_STYLES.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Negative — only when supported */}
                {spec.supportsNegativePrompt && (
                  <div className="space-y-2">
                    <Label htmlFor="cc-neg">负向提示词</Label>
                    <Textarea
                      id="cc-neg"
                      rows={2}
                      placeholder="例如：低质量、模糊、多余手指"
                      value={negative}
                      onChange={(e) => onNegativeChange(e.target.value)}
                      className="min-h-16 text-sm"
                    />
                  </div>
                )}

                {/* Model-specific advanced params declared by adapter */}
                <ExtrasPanel
                  spec={spec.extras ?? []}
                  value={extras}
                  onChange={onExtrasChange}
                  title={currentModel ? `${currentModel.name} 独有参数` : undefined}
                />

                {/* Friendly empty hint when nothing is configurable */}
                {spec.size.mode !== "enum" && spec.maxBatch <= 1 && !spec.supportsNegativePrompt && (!spec.extras || spec.extras.length === 0) && (
                  <p className="text-[11px] text-muted-foreground">
                    {currentModel?.name ?? "当前模型"} 只接受提示词，没有可调参数。
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* @ picker — references first, then subjects */}
          <Popover open={subjectPickerOpen} onOpenChange={setSubjectPickerOpen}>
            <PopoverTrigger>
              <ToolbarButton
                label={refMentions.length > 0 ? "引用参考图或主体" : "引用主体"}
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
                            onClick={() => { insertMention(r); setSubjectPickerOpen(false); }}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary"
                          >
                            <div className="size-8 shrink-0 overflow-hidden rounded-lg bg-secondary">
                              <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm">@{r.name}</div>
                              <div className="text-[11px] text-muted-foreground">第 {r.index + 1} 张参考图</div>
                            </div>
                          </button>
                        ))}
                    </div>
                  </>
                )}
                <div className="border-y border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  主体（我的库）
                </div>
                <div className="py-1">
                  {allSubjects.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      还没有主体
                    </div>
                  ) : (
                    allSubjects
                      .filter((s) => !attachedSubjects.some((a) => a.id === s.id))
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            insertMention({ kind: "subject", name: s.name, subject: s });
                            setSubjectPickerOpen(false);
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
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSubjectPickerOpen(false); setManagerOpen(true); }}
                className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-brand-500 transition-colors hover:bg-secondary"
              >
                <Sparkles className="size-3.5" />
                新建 / 管理主体
              </button>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {/* Send / Cancel */}
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
              title="开始生成（Enter · Shift+Enter 换行）"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>

      <SubjectManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onChange={onSubjectsChanged}
      />
    </div>
  );
}

function ToolbarButton({
  label, icon, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
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

/* Lightweight uncontrolled-style popover wrapper. We use a simple
   click-outside approach instead of pulling in Radix Popover to keep the
   composer toolbar dependencies low. */
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
      // Ignore clicks inside our own popover.
      if (ref.current && ref.current.contains(target)) return;
      // Radix Select / Dropdown / Tooltip etc. render their content in a
      // portal outside this popover's DOM tree. Treat clicks inside any
      // Radix popper content as "still inside" so opening a child Select
      // doesn't immediately tear down the parent popover (which would
      // unmount the Select before its onValueChange could commit).
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

/**
 * Renders the child element directly, merging in an onClick that toggles
 * the popover. This avoids nesting a second <button> inside an existing
 * button child (which is invalid HTML and triggers a hydration error).
 */
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

function MentionPopover({
  items, highlight, onPick, onHover,
}: {
  items: Mention[];
  highlight: number;
  onPick: (m: Mention) => void;
  onHover: (idx: number) => void;
}) {
  // Track whether any of the items are references — if so, show a tiny
  // section divider before the first subject in the list.
  const firstSubjectIdx = items.findIndex((m) => m.kind === "subject");
  return (
    <div className="absolute left-5 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
      <div className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        参考图与主体
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {items.map((m, i) => {
          const showDivider = i === firstSubjectIdx && items.some((x) => x.kind === "ref");
          const key = m.kind === "ref" ? `ref-${m.index}` : `subj-${m.subject.id}`;
          return (
            <React.Fragment key={key}>
              {showDivider && (
                <div className="my-1 border-t border-border/60" />
              )}
              <button
                type="button"
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => { e.preventDefault(); onPick(m); }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                  i === highlight ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <div className="size-9 shrink-0 overflow-hidden rounded-lg bg-secondary">
                  {m.kind === "ref" ? (
                    <img src={m.imageUrl} alt={m.name} className="h-full w-full object-cover" />
                  ) : m.subject.imageUrl ? (
                    <img src={m.subject.imageUrl} alt={m.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                      {m.name.slice(0, 2)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm">@{m.name}</div>
                  <div className="line-clamp-1 text-[11px] text-muted-foreground">
                    {m.kind === "ref"
                      ? `第 ${m.index + 1} 张参考图`
                      : (m.subject.description || "（无描述）")}
                  </div>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Enter / Tab 插入 · Esc 取消
      </div>
    </div>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
