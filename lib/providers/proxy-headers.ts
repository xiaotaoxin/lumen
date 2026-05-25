/**
 * 客户端 adapter 调 /api/proxy/* 时统一的鉴权头注入。
 *
 * Stage-2 路径（推荐）：
 *   X-Lumen-Model-Id: <model.id>  → server 反查 lumen.db 解密 Key，浏览器不见明文
 *
 * Stage-1 兼容：
 *   X-Lumen-API-Key: <plain key>   → 仅 admin "测试连接" 草稿态用，此时 model 还没存盘
 *
 * 二选一即可；优先 modelId。
 */

export interface ProxyAuthInput {
  modelId?: string;
  apiKey?: string;
}

export function setProxyAuthHeader(headers: Headers, cfg: ProxyAuthInput): boolean {
  if (cfg.modelId) {
    headers.set("X-Lumen-Model-Id", cfg.modelId);
    return true;
  }
  if (cfg.apiKey) {
    headers.set("X-Lumen-API-Key", cfg.apiKey);
    return true;
  }
  return false;
}
