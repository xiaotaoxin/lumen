"use client";

/**
 * ASR 字幕面板 — 阿里百炼 Qwen3-ASR
 *
 * 用户上传音视频文件 → 浏览器把它转成 dataURL POST 给 /api/voice/asr
 * → 服务端用百炼 sk-... 提交录音文件识别任务 → 异步轮询 → 返回 SRT 字幕
 *
 * 走录音文件识别（async task）而不是实时 ASR，因为这是给现有视频/音频转文字的场景。
 */

import * as React from "react";
import { Loader2, Upload, Download, FileAudio, Subtitles, Languages, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AsrSegment {
  begin_time: number;
  end_time: number;
  text: string;
}

interface AsrResult {
  fileName: string;
  text: string;
  srt: string;
  segments: AsrSegment[];
  durationMs: number;
  language?: string;
}

const LANGUAGE_HINTS = [
  { value: "auto", label: "自动检测" },
  { value: "zh",   label: "中文（普通话）" },
  { value: "yue",  label: "粤语" },
  { value: "en",   label: "英语" },
  { value: "ja",   label: "日语" },
  { value: "ko",   label: "韩语" },
];

function msToSrtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mss = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(mss).padStart(3, "0")}`;
}
const pad = (n: number) => String(n).padStart(2, "0");

function segmentsToSrt(segs: AsrSegment[]): string {
  return segs.map((s, i) =>
    `${i + 1}\n${msToSrtTime(s.begin_time)} --> ${msToSrtTime(s.end_time)}\n${s.text}\n`
  ).join("\n");
}

type Source = "file" | "url";

export function AsrPanel() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [source, setSource] = React.useState<Source>("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [audioUrl, setAudioUrl] = React.useState<string>("");
  const [language, setLanguage] = React.useState<string>("auto");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<string>("");
  const [result, setResult] = React.useState<AsrResult | null>(null);

  const onFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      toast.error("同步识别 ≤ 25MB · 长音频请改用「公网 URL」入口");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const onSubmit = async () => {
    if (source === "file" && !file) {
      toast.error("请先选择音频或视频文件");
      return;
    }
    if (source === "url" && !/^https?:\/\//.test(audioUrl.trim())) {
      toast.error("请填一个 https:// 公网 URL");
      return;
    }
    setBusy(true);
    setProgress(source === "file" ? "上传中..." : "提交任务...");
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        languageHints: language === "auto" ? undefined : [language],
      };
      let displayName: string;
      if (source === "file" && file) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        payload.dataUrl = dataUrl;
        payload.fileName = file.name;
        displayName = file.name;
      } else {
        payload.fileUrl = audioUrl.trim();
        const tail = audioUrl.split("/").pop() ?? "audio";
        displayName = tail.length > 40 ? tail.slice(0, 37) + "..." : tail;
      }

      setProgress(source === "file" ? "识别中（短音频同步）..." : "异步识别中（带时间戳）...");
      const submit = await fetch("/api/voice/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!submit.ok) {
        const j = await submit.json().catch(() => ({}));
        const hint = j.hint ? ` —— ${j.hint}` : "";
        throw new Error((j.error || `提交失败 (${submit.status})`) + hint);
      }
      const json = await submit.json() as {
        text: string;
        segments: AsrSegment[];
        durationMs: number;
        language?: string;
        mode?: "sync" | "async";
      };

      const srt = json.segments.length > 0 ? segmentsToSrt(json.segments) : "";
      setResult({
        fileName: displayName,
        text: json.text,
        srt,
        segments: json.segments,
        durationMs: json.durationMs,
        language: json.language,
      });
      const segCount = json.segments.length;
      toast.success(
        segCount > 0
          ? `识别完成 · ${segCount} 段 · ${(json.durationMs / 1000).toFixed(1)}s`
          : `识别完成 · 纯文本（短音频无时间戳）· ${(json.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "识别失败");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const downloadSrt = () => {
    if (!result) return;
    const blob = new Blob([result.srt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName.replace(/\.[^.]+$/, "") + ".srt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTxt = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName.replace(/\.[^.]+$/, "") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitDisabled = busy
    || (source === "file" && !file)
    || (source === "url" && !audioUrl.trim());

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          {/* source 切换 */}
          <div className="mb-3 inline-flex h-8 items-center gap-1 rounded-lg bg-secondary p-0.5 text-xs">
            <button type="button" onClick={() => setSource("file")} disabled={busy}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                source === "file" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}>
              上传文件 · 短音频
            </button>
            <button type="button" onClick={() => setSource("url")} disabled={busy}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                source === "url" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}>
              公网 URL · 带时间戳
            </button>
          </div>

          {source === "file" ? (
            <>
              <Label className="text-xs">音频 / 视频文件（≤ 25MB）</Label>
              {!file ? (
                <div className="mt-2">
                  <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden"
                    onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface-1 py-12 hover:bg-secondary/30">
                    <Upload className="size-6 text-muted-foreground" />
                    <span className="mt-2 text-sm">点击选择文件</span>
                    <span className="mt-1 text-[11px] text-muted-foreground">
                      支持 mp3 / wav / m4a / mp4 等 · 同步识别仅返回纯文本（无时间戳）
                    </span>
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
                  <FileAudio className="size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{file.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || "未知类型"}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} disabled={busy} title="移除">
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Label className="text-xs">音频 / 视频公网 URL</Label>
              <input
                type="url"
                value={audioUrl}
                onChange={(e) => setAudioUrl(e.target.value)}
                disabled={busy}
                placeholder="https://xxx.cos.ap-shanghai.myqcloud.com/audio.mp3"
                className="mt-2 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                必须 https 公网可达。先把音频上传到 COS / OSS / 七牛 等任意对象存储拿链接。<br />
                此入口走异步接口，**返回带时间戳的 SRT** 字幕。
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-5">
          <div className="text-sm">
            <div className="font-medium">
              Qwen3-ASR · {source === "file" ? "同步纯文本识别" : "异步带时间戳识别"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              识别语言：{LANGUAGE_HINTS.find((x) => x.value === language)?.label}
              {source === "file" ? " · 输出 .txt" : " · 输出 .srt + .txt"}
            </div>
          </div>
          <Button variant="brand" size="lg" onClick={onSubmit} disabled={submitDisabled} className="min-w-32">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Subtitles className="size-4" />}
            {busy ? (progress || "识别中...") : "开始识别"}
          </Button>
        </div>

        {result && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{result.fileName}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {result.segments.length > 0
                      ? `${result.segments.length} 段 · ${(result.durationMs / 1000).toFixed(1)}s`
                      : `纯文本 · ${(result.durationMs / 1000).toFixed(1)}s`}
                    {result.language && <> · 语言：{result.language}</>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadTxt}>
                    <Download className="size-3.5" /> txt
                  </Button>
                  {result.segments.length > 0 && (
                    <Button variant="brand" size="sm" onClick={downloadSrt}>
                      <Download className="size-3.5" /> srt
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" onClick={() => setResult(null)} title="删除结果">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <Label className="text-xs">{result.segments.length > 0 ? "分段时间轴" : "识别全文"}</Label>
              <div className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto">
                {result.segments.length === 0 && (
                  <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface-1 p-3 text-sm leading-relaxed">
                    {result.text}
                  </div>
                )}
                {result.segments.map((s, i) => (
                  <div key={i} className="flex gap-3 rounded-lg border border-border bg-surface-1 p-2 text-xs">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {msToSrtTime(s.begin_time).slice(0, 8)}
                    </span>
                    <span className="flex-1">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <Label className="text-xs">识别语言</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGE_HINTS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-[11px] text-muted-foreground">
            自动检测可识别 52 个语种 + 22 个中文方言；指定语言可提升准确率。
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 text-foreground">
            <Languages className="size-3.5" /> 用法提示
          </div>
          <ul className="space-y-1 ps-3 list-disc list-outside">
            <li>识别后可直接下载 .srt 字幕，导入剪映 / Premiere</li>
            <li>纯文本 .txt 适合用于二次创作 / 字幕翻译</li>
            <li>视频文件会自动提取音频轨识别</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
