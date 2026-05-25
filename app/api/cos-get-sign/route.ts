// 给"COS 上的私有对象 URL"签一个临时的 GET 预签名 URL，
// 让浏览器能直接打开 / 下载，不用把 COS 桶设成公共读。

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

interface SignBody {
  /** 完整 COS 对象 URL，例如
   *  https://lumen-1300.cos.ap-shanghai.myqcloud.com/lumen-out/foo.mp4 */
  url: string;
  /** 默认 1 小时；可改更短 */
  expiresInSec?: number;
}

function sha1Hex(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}
function hmacSha1Hex(key: string, data: string): string {
  return crypto.createHmac("sha1", key).update(data).digest("hex");
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-lumen-api-key");
  if (!apiKey || !apiKey.includes(":")) {
    return NextResponse.json({ error: "缺少 SecretId:SecretKey" }, { status: 401 });
  }
  const colonIdx = apiKey.indexOf(":");
  const secretId = apiKey.slice(0, colonIdx).trim();
  const secretKey = apiKey.slice(colonIdx + 1).trim();
  if (!secretId.startsWith("AKID")) {
    return NextResponse.json({ error: "SecretId 应以 AKID 开头" }, { status: 401 });
  }

  let body: SignBody;
  try {
    body = (await req.json()) as SignBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.url) {
    return NextResponse.json({ error: "缺少 url" }, { status: 400 });
  }

  // 解析 host + pathname
  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return NextResponse.json({ error: "url 不是合法 URL" }, { status: 400 });
  }
  // 期望 host 形如 {bucket}.cos.{region}.myqcloud.com
  const m = parsed.host.match(/^([^.]+)\.cos\.([^.]+)\.myqcloud\.com$/);
  if (!m) {
    return NextResponse.json({ error: `host 不是合法 COS 域名：${parsed.host}` }, { status: 400 });
  }

  const pathname = parsed.pathname; // 已经是 /key 形式

  // GET V4 签名
  const expires = Math.max(60, body.expiresInSec ?? 3600);
  const startTime = Math.floor(Date.now() / 1000);
  const endTime = startTime + expires;
  const keyTime = `${startTime};${endTime}`;
  const signKey = hmacSha1Hex(secretKey, keyTime);

  const httpString = `get\n${pathname}\n\n\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`;
  const signature = hmacSha1Hex(signKey, stringToSign);

  const sigParams = new URLSearchParams();
  sigParams.set("q-sign-algorithm", "sha1");
  sigParams.set("q-ak", secretId);
  sigParams.set("q-sign-time", keyTime);
  sigParams.set("q-key-time", keyTime);
  sigParams.set("q-header-list", "");
  sigParams.set("q-url-param-list", "");
  sigParams.set("q-signature", signature);

  const signedUrl = `${parsed.origin}${pathname}?${sigParams.toString()}`;
  return NextResponse.json({ signedUrl, expiresInSec: expires });
}

export const runtime = "nodejs";
