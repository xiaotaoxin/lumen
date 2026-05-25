/**
 * /api/voice/synthesize  —  CosyVoice 2 文本→语音
 *
 * 服务端做 WebSocket 中继：客户端发文本 + 音色配置 → server 用 lumen.db 解密的百炼 sk-...
 * 连 wss → 收齐音频流 → 整体回 audio/mpeg。客户端永远不见 Key。
 *
 * Body:
 *   {
 *     text: string,
 *     voice?: string,        // 默认 longanyang
 *     model?: string,        // 默认 cosyvoice-v3-flash
 *     format?: "mp3" | "wav" | "pcm" | "opus",
 *     sampleRate?: number,
 *     volume?: number, rate?: number, pitch?: number
 *   }
 *
 * Response: audio/<format> 二进制
 *   X-Lumen-Cosyvoice-Chars: 计费字符数
 *   X-Lumen-Cosyvoice-Ms:   合成耗时
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveBailianApiKey, synthesizeOnce, type SynthesizeOptions } from "@/lib/server/cosyvoice";

export const runtime = "nodejs";

interface Body {
  text?: string;
  voice?: string;
  model?: string;
  format?: SynthesizeOptions["format"];
  sampleRate?: number;
  volume?: number;
  rate?: number;
  pitch?: number;
}

const FORMAT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pcm: "audio/pcm",
  opus: "audio/opus",
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text 不能为空" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "text 单次不能超过 2000 字" }, { status: 400 });
  }

  const apiKey = resolveBailianApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "尚未配置百炼 API Key",
        detail: "请先在 /admin/models 下「通义万相 / 千问 / 第三方」中任一家族保存百炼 sk-... Key。CosyVoice 共用同一份。",
      },
      { status: 401 },
    );
  }

  try {
    const result = await synthesizeOnce(apiKey, {
      text,
      voice: body.voice ?? "longanyang",
      model: body.model ?? "cosyvoice-v3-flash",
      format: body.format ?? "mp3",
      sampleRate: body.sampleRate ?? 22050,
      volume: body.volume,
      rate: body.rate,
      pitch: body.pitch,
    });

    const mime = FORMAT_TO_MIME[result.format] ?? "audio/mpeg";
    const headers = new Headers({
      "Content-Type": mime,
      "Content-Length": String(result.audio.length),
      "X-Lumen-Cosyvoice-Chars": String(result.characters ?? 0),
      "X-Lumen-Cosyvoice-Ms": String(result.durationMs),
      "Cache-Control": "no-store",
    });
    return new NextResponse(result.audio as unknown as BodyInit, { status: 200, headers });
  } catch (e) {
    const msg = (e as Error).message ?? "合成失败";
    console.error("[voice/synthesize] fail:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
