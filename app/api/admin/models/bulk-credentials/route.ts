/**
 * /api/admin/models/bulk-credentials  —  共享凭证批量更新
 *
 * 用于 admin "家族共享凭证" UI：一次更新某些 providerType 下所有 model 的
 * apiKey + endpoint。client 提交 plain key，服务端立即加密。
 *
 * Body: { providerTypes: string[]; apiKey?: string; endpoint?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateCredentials } from "@/lib/server/models-store";
import type { ProviderType } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  providerTypes: ProviderType[];
  apiKey?: string;
  endpoint?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.providerTypes) || body.providerTypes.length === 0) {
    return NextResponse.json({ error: "providerTypes 不能为空" }, { status: 400 });
  }
  try {
    const updated = bulkUpdateCredentials(body.providerTypes, {
      apiKey: body.apiKey,
      endpoint: body.endpoint,
    });
    return NextResponse.json({ updated });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "更新失败" },
      { status: 400 },
    );
  }
}
