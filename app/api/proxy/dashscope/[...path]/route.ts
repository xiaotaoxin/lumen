// Stage-2 阿里云百炼（DashScope）proxy。
// 浏览器送 X-Lumen-Model-Id → server 反查 lumen.db 解密 Key（推荐路径）；
// 或送 X-Lumen-API-Key 明文 → 仅 admin UI 的"测试连接"草稿态用。
// 任何一种入口拿到的 plain Key 在本进程内 Authorization: Bearer 转发上游后立即丢弃。

import { NextRequest, NextResponse } from "next/server";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM = "https://dashscope.aliyuncs.com";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "x-lumen-api-key",
  "x-lumen-model-id",
  "cookie",
]);

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const auth = resolveProxyAuth(req);
  if (!auth) {
    return NextResponse.json(
      { code: "MissingApiKey", message: "missing X-Lumen-Model-Id or X-Lumen-API-Key" },
      { status: 401 },
    );
  }
  const apiKey = auth.apiKey;

  const targetUrl = new URL(`${UPSTREAM}/${path.join("/")}`);
  req.nextUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Authorization", `Bearer ${apiKey}`);

  let body: BodyInit | undefined;
  let bodySize = 0;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const buf = await req.arrayBuffer();
    body = buf;
    bodySize = buf.byteLength;
  }

  const logTag = `[dashscope ${req.method} ${path.join("/")}]`;
  console.log(`${logTag} → upstream${bodySize ? ` body=${(bodySize / 1024).toFixed(1)}KB` : ""}`);
  const t0 = Date.now();

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (err) {
    console.error(`${logTag} ← FAIL ${Date.now() - t0}ms: ${(err as Error).message}`);
    return NextResponse.json(
      { code: "UpstreamFetchFailed", message: `upstream fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  // 把上游响应里的全部 output 字段提取出来（task_status / scheduled_time / message / code / 等）
  let statusSuffix = "";
  let fullDump = "";
  if (req.method === "GET" && path[0] === "api" && path[2] === "tasks" && upstream.ok) {
    const cloned = upstream.clone();
    try {
      const j = (await cloned.json()) as {
        output?: Record<string, unknown>;
        usage?: Record<string, unknown>;
        request_id?: string;
      };
      const out = j.output ?? {};
      const ts = out.task_status as string | undefined;
      if (ts) statusSuffix = ` · task_status=${ts}`;
      // 每 10 次 poll 打一次 full body，避免刷屏；或者第一次就打
      const slim: Record<string, unknown> = {};
      for (const k of ["task_id", "task_status", "submit_time", "scheduled_time", "end_time", "code", "message", "results", "video_url"]) {
        if (k in out) slim[k] = out[k];
      }
      if (j.request_id) slim.request_id = j.request_id;
      fullDump = JSON.stringify(slim);
    } catch { /* 忽略，只为日志 */ }
  }
  console.log(`${logTag} ← ${upstream.status} ${upstream.statusText} in ${Date.now() - t0}ms${statusSuffix}`);
  if (fullDump) console.log(`${logTag} body: ${fullDump.slice(0, 600)}`);
  if (!upstream.ok) {
    const cloned = upstream.clone();
    const text = await cloned.text().catch(() => "");
    console.error(`${logTag} fail: ${text.slice(0, 500)}`);
  }

  // Strip content-encoding AND content-length: Node's fetch auto-decompresses
  // the upstream body, so forwarding the original encoding header makes the
  // browser try to decode plaintext as gzip → "TypeError: Failed to fetch".
  // Length is wrong for the same reason.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "content-length" || lower === "content-encoding") return;
    respHeaders.set(key, value);
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const runtime = "nodejs";
