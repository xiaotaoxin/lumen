/**
 * Proxy 路由共享的"取明文 API Key"逻辑。
 *
 * 优先级（向后兼容）：
 *   1. 请求头 X-Lumen-Model-Id  → 查 lumen.db 解密 → 推荐路径，浏览器永远不见明文
 *   2. 请求头 X-Lumen-API-Key   → 直接用作明文 ← 过渡期保留，仅用于 admin UI 的"测试连接"草稿态
 *
 * 当两个头都没有 → 返回 null，proxy 路由各自决定如何 401。
 */

import type { NextRequest } from "next/server";
import { resolvePlaintextApiKey } from "./models-store";

export interface ProxyAuth {
  apiKey: string;
  /** 仅在通过 modelId 解析时有值 —— 用于 proxy 路由查 endpoint 等元数据 */
  modelId: string | null;
  /** "model" / "header" —— 仅用于日志 */
  source: "model" | "header";
}

export function resolveProxyAuth(req: NextRequest): ProxyAuth | null {
  const modelId = req.headers.get("x-lumen-model-id");
  if (modelId) {
    const key = resolvePlaintextApiKey(modelId);
    if (key) return { apiKey: key, modelId, source: "model" };
    return null;
  }
  const headerKey = req.headers.get("x-lumen-api-key");
  if (headerKey) return { apiKey: headerKey, modelId: null, source: "header" };
  return null;
}
