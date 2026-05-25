// 生成腾讯云 COS PUT 预签名 URL —— 让浏览器直接 PUT 文件到 COS，
// 不经过 Next.js 服务端中转，避免大文件拖崩 RAM。
//
// 客户端 POST：
//   Headers: X-Lumen-API-Key: SecretId:SecretKey
//   Body: { fileName, contentType, bucket, region, prefix? }
// 返回：
//   { uploadUrl, finalUrl, key }
//
// COS 签名算法（V4 风格）：
//   https://cloud.tencent.com/document/product/436/7778

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

interface SignBody {
  fileName: string;
  contentType?: string;
  bucket: string;
  region: string;
  prefix?: string;
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
    return NextResponse.json({ error: "缺少 SecretId:SecretKey（X-Lumen-API-Key）" }, { status: 401 });
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
  const { fileName, bucket, region } = body;
  if (!fileName || !bucket || !region) {
    return NextResponse.json({ error: "缺少 fileName / bucket / region" }, { status: 400 });
  }

  // 拼对象 key：lumen-uploads/{ts}-{safeName}
  const safeName = fileName.replace(/[^\w.\-]+/g, "_");
  const ts = Date.now();
  const prefix = (body.prefix ?? "lumen-uploads/").replace(/^\/+|\/+$/g, "");
  const key = `${prefix}/${ts}-${safeName}`;
  const pathname = `/${key}`;

  // V4 签名：1 小时有效
  const startTime = Math.floor(Date.now() / 1000);
  const endTime = startTime + 3600;
  const keyTime = `${startTime};${endTime}`;
  const signKey = hmacSha1Hex(secretKey, keyTime);

  // 不签 headers / params（让浏览器随便发）
  const httpString = `put\n${pathname}\n\n\n`;
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

  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const uploadUrl = `https://${host}${pathname}?${sigParams.toString()}`;
  // finalUrl：用户后续把它当 input 喂给 MPS（CosInputInfo.Object = pathname）
  const finalUrl = `https://${host}${pathname}`;

  return NextResponse.json({ uploadUrl, finalUrl, key });
}

export const runtime = "nodejs";
