/**
 * /api/admin/models  —  models 列表 + 创建
 *
 * GET  → 列表（绝不返回 apiKey 明文，只返回 hasApiKey: boolean）
 * POST → 创建一条；body 里的 apiKey 立刻 AES-GCM 加密落 DB
 *
 * 注意：当前 lumen 是 client-side mock auth，没有 server-side session。
 * 这层路由没有强 admin 校验 —— 安全保障来自"Key 永远只能写不能读"的 API 形态：
 * 即使端点暴露，攻击者也只能写入 / 列出元数据，拿不到任何 Key 明文。
 * 真上线前应叠一层 admin token / 真服务端 session。
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createModel, listModels, type CreateModelInput,
} from "@/lib/server/models-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ models: listModels() });
  } catch (e) {
    console.error("[admin/models] GET fail", e);
    return NextResponse.json(
      { error: (e as Error).message ?? "服务器错误" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: CreateModelInput;
  try {
    body = (await req.json()) as CreateModelInput;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const dto = createModel(body);
    return NextResponse.json({ model: dto }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "创建失败" },
      { status: 400 },
    );
  }
}
