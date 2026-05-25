/**
 * /api/voice/clones/[id]  —  删除复刻音色
 *
 * 同时删阿里云端 voice 和本地 db 行。
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { resolveBailianApiKey } from "@/lib/server/cosyvoice";

export const runtime = "nodejs";

interface Ctx { params: Promise<{ id: string }>; }

const REST_BASE = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";

async function deleteRemote(apiKey: string, voiceId: string): Promise<void> {
  const res = await fetch(REST_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "voice-enrollment",
      input: { action: "delete_voice", voice_id: voiceId },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[voice/clones] 阿里云删除失败 ${voiceId}: ${res.status} ${text.slice(0, 200)}`);
    // 继续删本地 —— 即使云端失败，本地也要清掉
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db
    .prepare<[string], { voice_id: string }>("SELECT voice_id FROM cloned_voices WHERE id = ?")
    .get(id);
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const apiKey = resolveBailianApiKey();
  if (apiKey) {
    try { await deleteRemote(apiKey, row.voice_id); }
    catch { /* 已记日志 */ }
  }

  db.prepare("DELETE FROM cloned_voices WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
