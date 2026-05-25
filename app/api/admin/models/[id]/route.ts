/**
 * /api/admin/models/[id]
 *
 * GET    → 单条（不含 apiKey）
 * PATCH  → 部分更新；body.apiKey === "" 表示清空，非空表示替换，undefined 表示不改
 * DELETE → 删除
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deleteModel, getModel, updateModel, type UpdateModelInput,
} from "@/lib/server/models-store";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const dto = getModel(id);
  if (!dto) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ model: dto });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: UpdateModelInput;
  try {
    body = (await req.json()) as UpdateModelInput;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const dto = updateModel(id, body);
    return NextResponse.json({ model: dto });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "更新失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    deleteModel(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "删除失败" },
      { status: 400 },
    );
  }
}
