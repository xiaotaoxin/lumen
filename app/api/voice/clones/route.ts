/**
 * /api/voice/clones  —  CosyVoice 复刻音色 CRUD
 *
 * GET  → 列表（仅 metadata）
 * POST → 创建：调阿里 voice-enrollment REST 拿 voice_id → 写 lumen.db
 *
 * Key 复用 lumen.db 里 bailian-* 家族任一记录的 sk-...
 */

import * as crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { resolveBailianApiKey, createClonedVoice } from "@/lib/server/cosyvoice";

export const runtime = "nodejs";

interface ClonedVoiceRow {
  id: string;
  name: string;
  voice_id: string;
  target_model: string;
  audio_url: string | null;
  language_hints: string | null;
  created_at: string;
}

export async function GET() {
  const rows = getDb()
    .prepare<[], ClonedVoiceRow>("SELECT * FROM cloned_voices ORDER BY created_at DESC")
    .all();
  return NextResponse.json({ voices: rows });
}

interface CreateBody {
  name?: string;
  audioUrl?: string;
  targetModel?: string;
  languageHints?: string[];
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const audioUrl = (body.audioUrl ?? "").trim();
  const targetModel = (body.targetModel ?? "cosyvoice-v3.5-flash").trim();
  if (!name) return NextResponse.json({ error: "name 不能为空" }, { status: 400 });
  if (!/^https?:\/\//.test(audioUrl)) {
    return NextResponse.json({ error: "audioUrl 必须是 http(s):// 公网 URL" }, { status: 400 });
  }

  const apiKey = resolveBailianApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置百炼 API Key", detail: "请到 /admin/models 给 bailian-* 家族保存 sk-... Key" },
      { status: 401 },
    );
  }

  try {
    // 用 name 前 6 字符做 prefix（阿里要求 ASCII，所以做下哈希前缀）
    const prefix = "lm" + crypto.createHash("md5").update(name).digest("hex").slice(0, 6);
    const { voiceId } = await createClonedVoice(apiKey, {
      audioUrl,
      prefix,
      targetModel,
      languageHints: body.languageHints,
    });

    const id = "cv_" + crypto.randomBytes(6).toString("hex");
    const now = new Date().toISOString();
    getDb()
      .prepare(`
        INSERT INTO cloned_voices (id, name, voice_id, target_model, audio_url, language_hints, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id, name, voiceId, targetModel,
        audioUrl,
        body.languageHints ? JSON.stringify(body.languageHints) : null,
        now,
      );

    return NextResponse.json({
      voice: { id, name, voice_id: voiceId, target_model: targetModel, audio_url: audioUrl, created_at: now },
    }, { status: 201 });
  } catch (e) {
    console.error("[voice/clones] POST fail:", e);
    return NextResponse.json(
      { error: (e as Error).message ?? "创建失败" },
      { status: 502 },
    );
  }
}
