"use client";

/**
 * 降噪面板 — DeepFilterNet 3 (浏览器 wasm)
 *
 * 完全本地 —— 不上传任何数据。npm 包 `deepfilternet3-noise-filter` 提供 wasm 模型，
 * 用 AudioWorklet 实时处理。我们走"离线模式"：把整个文件解码为 PCM → 切帧 → 喂给
 * 模型 → 拿到清晰 PCM → 编码回 wav → 下载。
 *
 * 优点：零延迟（不走网络），免费，完全私有。
 * 缺点：长音频在浏览器里跑会占主线程；建议 ≤ 10 分钟。
 */

import * as React from "react";
import { Loader2, Upload, Download, FileAudio, X, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

interface DenoiseResult {
  fileName: string;
  blob: Blob;
  url: string;
  durationSec: number;
  processingMs: number;
}

export function DenoisePanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<string>("");
  const [result, setResult] = React.useState<DenoiseResult | null>(null);
  const [originalUrl, setOriginalUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) {
      toast.error("文件过大（>100MB）。建议先压缩或截短");
      return;
    }
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (result) URL.revokeObjectURL(result.url);
    setFile(f);
    setOriginalUrl(URL.createObjectURL(f));
    setResult(null);
  };

  const onSubmit = async () => {
    if (!file) {
      toast.error("请先选择音频文件");
      return;
    }
    setBusy(true);
    setProgress("加载 DeepFilterNet 3 模型...");
    setResult(null);
    const t0 = performance.now();

    try {
      const dfn = await import("deepfilternet3-noise-filter") as DfnModule;

      // 1) 解码原音频到 48kHz 单声道
      setProgress("解码原音频...");
      const arrayBuf = await file.arrayBuffer();
      const decodeCtx = new AudioContext({ sampleRate: 48000 });
      const decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
      await decodeCtx.close().catch(() => {});

      // 2) 初始化降噪核心（拉 wasm + 模型）
      setProgress("初始化模型（首次需下载 ~10MB wasm）...");
      const Core = dfn.DeepFilterNet3Core;
      if (!Core) throw new Error("deepfilternet3-noise-filter 包导出异常");
      const core = new Core({ sampleRate: 48000, noiseReductionLevel: 1.0 });
      await core.initialize();

      // 3) OfflineAudioContext 离线渲染：source → DFN worklet → destination
      setProgress("降噪处理中...");
      const numChannels = 1;
      const offline = new OfflineAudioContext({
        numberOfChannels: numChannels,
        length: Math.ceil(decoded.duration * 48000),
        sampleRate: 48000,
      });

      // 准备单声道 buffer。toMono 返回的 Float32Array 类型签名跟 copyToChannel
      // 期望的 Float32Array<ArrayBuffer> 不严格一致，做一次显式拷贝消除歧义。
      const monoSrc = toMono(decoded);
      const monoCopy = new Float32Array(monoSrc.length);
      monoCopy.set(monoSrc);
      const monoBuf = offline.createBuffer(1, decoded.length, 48000);
      monoBuf.copyToChannel(monoCopy, 0);

      const src = offline.createBufferSource();
      src.buffer = monoBuf;

      const worklet = await core.createAudioWorkletNode(
        offline as unknown as AudioContext,
      );
      src.connect(worklet);
      worklet.connect(offline.destination);
      src.start(0);

      const rendered = await offline.startRendering();

      // 4) 编码 wav
      setProgress("打包 wav...");
      const samples = rendered.getChannelData(0);
      const wav = encodeWav(samples, 48000);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      try { core.destroy?.(); } catch { /* noop */ }

      const ms = performance.now() - t0;
      setResult({
        fileName: file.name,
        blob, url,
        durationSec: decoded.duration,
        processingMs: ms,
      });
      toast.success(`降噪完成 · ${(ms / 1000).toFixed(1)}s · 输出 wav 48kHz`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "降噪失败";
      console.error("[denoise]", e);
      toast.error(`${msg}（首次使用需要联网下载 wasm 模型，~10MB）`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const onDownload = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.fileName.replace(/\.[^.]+$/, "") + "-denoised.wav";
    a.click();
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="text-xs">音频文件</Label>
          {!file ? (
            <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface-1 py-12 hover:bg-secondary/30">
              <Upload className="size-6 text-muted-foreground" />
              <span className="mt-2 text-sm">点击选择文件</span>
              <span className="mt-1 text-[11px] text-muted-foreground">支持 mp3 / wav / m4a · 推荐 ≤ 10 分钟</span>
              <input type="file" accept="audio/*" className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
                <FileAudio className="size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{file.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} disabled={busy}>
                  <X className="size-3.5" />
                </Button>
              </div>
              {originalUrl && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">原音频</Label>
                  <audio src={originalUrl} controls className="mt-1 w-full" preload="metadata" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-5">
          <div className="text-sm">
            <div className="font-medium">DeepFilterNet 3 · 浏览器本地降噪</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              数据不离开浏览器 · 完全免费 · 首次需下载 ~10MB wasm 模型
            </div>
          </div>
          <Button variant="brand" size="lg" onClick={onSubmit} disabled={busy || !file} className="min-w-32">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {busy ? (progress || "处理中...") : "开始降噪"}
          </Button>
        </div>

        {result && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="brand" className="text-[10px]">降噪后</Badge>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {result.durationSec.toFixed(1)}s · {(result.blob.size / 1024 / 1024).toFixed(1)} MB · 处理 {(result.processingMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="brand" size="sm" onClick={onDownload}>
                  <Download className="size-3.5" /> 下载 wav
                </Button>
                <Button variant="ghost" size="icon-sm" title="删除结果"
                  onClick={() => {
                    URL.revokeObjectURL(result.url);
                    setResult(null);
                  }}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <audio src={result.url} controls className="mt-3 w-full" preload="metadata" />
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
          <div className="mb-1 text-foreground font-medium">适用场景</div>
          <ul className="space-y-1 ps-3 list-disc list-outside">
            <li>会议 / 访谈录音清掉空调嗡嗡声</li>
            <li>户外采访去除风噪 / 路噪</li>
            <li>低端麦克风录音改善信噪比</li>
          </ul>
          <div className="mt-2">
            建议输入 ≤ 10 分钟。长音频浏览器主线程会长时间被占住。
          </div>
        </section>
      </aside>
    </div>
  );
}

/* ─── audio helpers ─── */

interface DfnCore {
  initialize: () => Promise<void>;
  createAudioWorkletNode: (ctx: AudioContext) => Promise<AudioWorkletNode>;
  setSuppressionLevel?: (level: number) => void;
  destroy?: () => void;
}
interface DfnModule {
  DeepFilterNet3Core?: new (config?: {
    sampleRate?: number;
    noiseReductionLevel?: number;
  }) => DfnCore;
}

function toMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) {
    return buf.getChannelData(0);
  }
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) out[i] += data[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= buf.numberOfChannels;
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  // RIFF
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
