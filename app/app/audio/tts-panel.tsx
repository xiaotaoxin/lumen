"use client";

/**
 * TTS 面板 — CosyVoice 2 文本→语音 + 声纹复刻入口。
 * 从 audio/page.tsx 拆出来，作为「配音」tab 的内容。
 */

import * as React from "react";
import {
  Loader2, Play, Pause, Download, Volume2, RefreshCcw, AlertTriangle,
  Search, X, UserPlus, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  COSYVOICE_PRESETS, COSYVOICE_MODELS, modelForVoice, type VoicePreset,
  LANG_LABEL, VOICE_LANG_CHIPS,
} from "@/lib/voice-presets";
import { useCatalogStore } from "@/lib/store/catalog-store";
import { CloneVoiceDialog } from "./clone-voice-dialog";

const BAILIAN_FAMILIES = new Set([
  "bailian-tongyi",
  "bailian-qwen",
  "bailian-thirdparty",
  "dashscope-image",
  "dashscope-video",
]);

interface SynthResult {
  url: string;
  blob: Blob;
  format: string;
  chars: number;
  ms: number;
  text: string;
  voice: VoicePreset;
  model: string;
}

interface ClonedVoiceItem {
  id: string;
  name: string;
  voice_id: string;
  target_model: string;
  created_at: string;
}

function downloadResultBlob(r: SynthResult) {
  const a = document.createElement("a");
  a.href = r.url;
  a.download = `cosyvoice-${r.voice.id}-${Date.now()}.${r.format}`;
  a.click();
}

const SAMPLE_TEXTS = [
  "今夜星光灿烂，城市的喧嚣渐渐沉睡。",
  "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
  "三百年来，人类向太空发射了无数探测器。",
  "Hello! Welcome to Lumen — your AI creator workstation.",
];

export function TtsPanel() {
  const [text, setText] = React.useState(
    "你好，我是 Lumen 的 AI 配音助手。试试看不同的音色 —— 阳光暖男、甜美女声、新闻主播，总有一款适合你。",
  );
  const [voiceId, setVoiceId] = React.useState<string>(COSYVOICE_PRESETS[0].id);
  const [model, setModel] = React.useState<string>(modelForVoice(COSYVOICE_PRESETS[0].id));
  const [speed, setSpeed] = React.useState<number>(1.0);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<SynthResult[]>([]);

  // 复刻音色
  const [cloned, setCloned] = React.useState<ClonedVoiceItem[]>([]);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [clonedReloadKey, setClonedReloadKey] = React.useState(0);
  const reloadCloned = React.useCallback(() => setClonedReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/voice/clones", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) {
          setCloned((json as { voices: ClonedVoiceItem[] }).voices);
        }
      })
      .catch(() => { /* 静默 */ });
    return () => { cancelled = true; };
  }, [clonedReloadKey]);

  const isClonedVoice = (id: string) => cloned.some((c) => c.voice_id === id);
  const allVoices = React.useMemo(() => {
    const presetView: VoicePreset[] = COSYVOICE_PRESETS;
    const clonedView: VoicePreset[] = cloned.map((c) => ({
      id: c.voice_id,
      name: c.name,
      desc: "我的复刻音色",
      model: c.target_model,
      gender: "neutral",
      lang: "zh",
      tags: ["复刻", "我的"],
    }));
    return [...clonedView, ...presetView];
  }, [cloned]);

  const voice = allVoices.find((v) => v.id === voiceId) ?? COSYVOICE_PRESETS[0];

  const customModels = useCatalogStore((s) => s.customModels);
  const hasBailianKey = customModels.some(
    (m) => BAILIAN_FAMILIES.has(m.providerType ?? "") && m.hasApiKey,
  );

  const [search, setSearch] = React.useState("");
  const [langFilter, setLangFilter] = React.useState<string>("");

  const filteredVoices = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const langChip = VOICE_LANG_CHIPS.find((c) => c.value === langFilter);
    const langSet = langChip ? new Set(langChip.matches) : null;

    return allVoices.filter((v) => {
      if (langSet && langSet.size > 0 && !langSet.has(v.lang)) return false;
      if (!q) return true;
      const hay = (v.id + " " + v.name + " " + v.desc + " " + v.tags.join(" ")).toLowerCase();
      return hay.includes(q);
    });
  }, [search, langFilter, allVoices]);

  /* 试听 */
  const previewCacheRef = React.useRef<Map<string, string>>(new Map());
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = React.useState<string | null>(null);
  const [cachedVoiceIds, setCachedVoiceIds] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    return () => {
      previewCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewCacheRef.current.clear();
      audioRef.current?.pause();
    };
  }, []);

  const previewSampleText = (v: VoicePreset): string => {
    if (v.lang === "en" || v.lang === "en-uk") return `Hi, this is ${v.name}. Nice to meet you.`;
    if (v.lang === "yue") return `你好，我系 ${v.name}，好高兴见到你。`;
    return `你好呀，我是${v.name}，很高兴认识你。`;
  };

  const playPreview = async (v: VoicePreset, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewPlaying === v.id && audioRef.current) {
      audioRef.current.pause();
      setPreviewPlaying(null);
      return;
    }
    audioRef.current?.pause();

    let url = previewCacheRef.current.get(v.id);
    if (!url) {
      setPreviewLoading(v.id);
      try {
        const res = await fetch("/api/voice/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: previewSampleText(v), voice: v.id, model: v.model, format: "mp3" }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || j.detail || `试听失败 (${res.status})`);
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        previewCacheRef.current.set(v.id, url);
        setCachedVoiceIds((prev) => {
          const next = new Set(prev);
          next.add(v.id);
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "试听失败");
        setPreviewLoading(null);
        return;
      } finally {
        setPreviewLoading(null);
      }
    }

    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.onended = () => setPreviewPlaying(null);
    audioRef.current.onerror = () => setPreviewPlaying(null);
    try {
      await audioRef.current.play();
      setPreviewPlaying(v.id);
    } catch {
      setPreviewPlaying(null);
    }
  };

  const [lastVoiceId, setLastVoiceId] = React.useState(voiceId);
  if (voiceId !== lastVoiceId) {
    setLastVoiceId(voiceId);
    const v = allVoices.find((x) => x.id === voiceId);
    if (v) setModel(v.model);
  }

  React.useEffect(() => {
    return () => results.forEach((r) => URL.revokeObjectURL(r.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSynthesize = async () => {
    const t = text.trim();
    if (!t) { toast.error("请输入要合成的文本"); return; }
    if (t.length > 2000) { toast.error("单次最多 2000 字，先拆开试"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, voice: voiceId, model, format: "mp3", rate: speed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || j.detail || `合成失败 (${res.status})`);
      }
      const chars = Number(res.headers.get("X-Lumen-Cosyvoice-Chars") ?? 0);
      const ms = Number(res.headers.get("X-Lumen-Cosyvoice-Ms") ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setResults((prev) => [{ url, blob, format: "mp3", chars, ms, text: t, voice, model }, ...prev].slice(0, 12));
      toast.success(`合成完成 · ${(blob.size / 1024).toFixed(0)} KB · ${(ms / 1000).toFixed(1)}s`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合成失败");
    } finally {
      setBusy(false);
    }
  };

  const onDownload = (r: SynthResult) => downloadResultBlob(r);

  const onDeleteCloned = async (id: string) => {
    if (!window.confirm("删除该复刻音色？阿里云端音色也会一并删除。")) return;
    try {
      const res = await fetch(`/api/voice/clones/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("已删除");
      void reloadCloned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      {/* ── 主区 ── */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="text-xs">输入文本</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要合成的文本，最多 2000 字..."
            className="mt-2 min-h-40 text-sm"
            disabled={busy}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{text.length} / 2000 字</span>
            <div className="flex gap-1">
              {SAMPLE_TEXTS.map((s, i) => (
                <button key={i} type="button" onClick={() => setText(s)}
                  className="rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[10px] hover:bg-secondary"
                  disabled={busy} title={s}>
                  示例 {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-5">
          <div className="text-sm">
            <div className="font-medium">
              {voice.name} <span className="text-muted-foreground">· {voice.desc}</span>
              {isClonedVoice(voice.id) && (
                <Badge variant="brand" className="ml-2 text-[9px]">复刻</Badge>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              模型：{model} · 速率：×{speed.toFixed(2)} · 输出 mp3 22050Hz
            </div>
          </div>
          <Button variant="brand" size="lg" onClick={onSynthesize} disabled={busy || !text.trim()} className="min-w-32">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
            {busy ? "合成中..." : "开始合成"}
          </Button>
        </div>

        <div className="space-y-2">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              合成结果会出现在这里 · 最多保留 12 条
            </div>
          ) : (
            results.map((r, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="muted" className="text-[10px]">{r.voice.name}</Badge>
                      <span className="font-mono text-muted-foreground">{r.model}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{r.chars} 字 · {(r.ms / 1000).toFixed(1)}s · {(r.blob.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={r.text}>{r.text}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDownload(r)} title="下载">
                    <Download className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="删除"
                    onClick={() => {
                      URL.revokeObjectURL(r.url);
                      setResults((prev) => prev.filter((x) => x.url !== r.url));
                    }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <audio src={r.url} controls className="mt-3 w-full" preload="metadata" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 右栏 ── */}
      <aside className="space-y-4">
        {/* 我的复刻音色 */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs">我的复刻音色 · {cloned.length}</Label>
            <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)} disabled={!hasBailianKey}>
              <UserPlus className="size-3" /> 新建
            </Button>
          </div>
          {cloned.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              上传一段 5-30 秒清晰人声，生成专属音色。需要公网可达 wav URL（先到 admin 媒体处理上传到 COS）。
            </p>
          ) : (
            <div className="space-y-1">
              {cloned.map((c) => (
                <div key={c.id} className={cn(
                  "flex items-center gap-2 rounded-lg border p-2 text-xs",
                  voiceId === c.voice_id
                    ? "border-brand-400/60 bg-brand-500/10"
                    : "border-border bg-card hover:bg-secondary/40",
                )}>
                  <button type="button" onClick={() => setVoiceId(c.voice_id)} className="min-w-0 flex-1 text-left">
                    <div className="font-medium">{c.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{c.voice_id.slice(0, 20)}... · {c.target_model}</div>
                  </button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDeleteCloned(c.id)} title="删除">
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 内置音色 */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <Label className="text-xs">
              内置音色 · 共 {COSYVOICE_PRESETS.length} 个
              {filteredVoices.length !== allVoices.length && (
                <span className="ml-1 text-muted-foreground">· 筛出 {filteredVoices.length}</span>
              )}
            </Label>
            <button type="button"
              onClick={() => {
                const pool = filteredVoices.length > 0 ? filteredVoices : allVoices;
                setVoiceId(pool[Math.floor(Math.random() * pool.length)].id);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground">
              <RefreshCcw className="inline size-3" /> 随机
            </button>
          </div>

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索：名称 / 场景标签（如 客服 / 古风）"
              className="h-8 pl-8 pr-7 text-xs" />
            {search && (
              <button type="button" onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="清空">
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {VOICE_LANG_CHIPS.map((c) => (
              <button key={c.value || "all"} type="button" onClick={() => setLangFilter(c.value)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  langFilter === c.value
                    ? "border-brand-400/60 bg-brand-500/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}>
                {c.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {filteredVoices.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-[11px] text-muted-foreground">
                没有匹配的音色 · 试试清空筛选
              </div>
            )}
            {filteredVoices.map((v) => {
              const isLoading = previewLoading === v.id;
              const isPlaying = previewPlaying === v.id;
              const isCached = cachedVoiceIds.has(v.id);
              return (
                <button key={v.id} type="button" onClick={() => setVoiceId(v.id)}
                  className={cn(
                    "relative flex w-full flex-col items-start rounded-lg border p-2 pr-10 text-left transition-colors",
                    v.id === voiceId
                      ? "border-brand-400/60 bg-brand-500/10"
                      : "border-border bg-card hover:bg-secondary/40",
                  )}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{v.name}</span>
                    <Badge variant="muted" className="text-[9px]">{LANG_LABEL[v.lang]}</Badge>
                    {v.gender !== "neutral" && (
                      <span className="text-[10px] text-muted-foreground">
                        {v.gender === "male" ? "♂" : "♀"}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{v.desc}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {v.tags.map((t) => (
                      <span key={t} className="rounded-full border border-border bg-secondary/40 px-1.5 py-0 text-[9px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  <span role="button" tabIndex={-1} onClick={(e) => playPreview(v, e)}
                    title={isPlaying ? "暂停" : isCached ? "试听（缓存）" : "试听 · 首次会等 1-2 秒合成"}
                    className={cn(
                      "absolute right-2 top-2 inline-flex size-7 cursor-pointer items-center justify-center rounded-full border transition-colors",
                      isPlaying
                        ? "border-brand-400/60 bg-brand-500/20 text-brand-500"
                        : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}>
                    {isLoading ? <Loader2 className="size-3.5 animate-spin" />
                      : isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <Label className="text-xs">模型版本</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COSYVOICE_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-[11px] text-muted-foreground">
            选音色时已自动锁定它兼容的模型；混搭可能 400。
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <Label className="text-xs">语速 ×{speed.toFixed(2)}</Label>
          <input type="range" min={0.5} max={2.0} step={0.05} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="mt-2 w-full" disabled={busy} />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>0.5×</span><span>1.0×</span><span>2.0×</span>
          </div>
        </section>

        {!hasBailianKey && (
          <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-400">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <div className="font-medium">需要先在 admin 配置百炼 Key</div>
                <div className="mt-1 text-amber-700/80 dark:text-amber-400/80">
                  CosyVoice 复用通义万相的 sk-...。在 <code>/admin/models</code> → 通义万相 / 千问 / 第三方任一家族保存 Key 后即可使用。
                </div>
              </div>
            </div>
          </section>
        )}
      </aside>

      <CloneVoiceDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onCreated={() => { void reloadCloned(); setCloneOpen(false); }}
      />
    </div>
  );
}
