/**
 * 服务端主密钥管理。
 *
 * 主密钥用于对称加密 lumen.db 里的 api_key 字段。
 *
 * 取值优先级：
 *   1. process.env.LUMEN_MASTER_KEY  — 部署到生产 / Vercel 时通过 Encrypted Env 注入
 *   2. <项目根>/.lumen-master.key    — 本地开发时启动自动生成（已加入 .gitignore）
 *
 * 编码：64 字符 hex（32 字节）。AES-256-GCM 直接用。
 *
 * 不要把这个值打到日志、不要回显给客户端、不要进 commit。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const KEY_FILE = path.join(process.cwd(), ".lumen-master.key");
const HEX_LENGTH = 64; // 32 bytes

let cached: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cached) return cached;

  // 1) env 注入 —— 生产 / 部署用
  const fromEnv = process.env.LUMEN_MASTER_KEY?.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
      throw new Error(
        "LUMEN_MASTER_KEY 必须是 64 字符 hex（32 字节）。当前值长度 " + fromEnv.length,
      );
    }
    cached = Buffer.from(fromEnv, "hex");
    return cached;
  }

  // 2) 本地文件 —— 开发模式自动生成
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, "utf-8").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(
        `${KEY_FILE} 内容损坏（应为 64 字符 hex）。删除该文件后重启会重新生成（已加密的旧 Key 会失效）`,
      );
    }
    cached = Buffer.from(raw, "hex");
    return cached;
  }

  // 3) 首次启动：自动生成
  const fresh = crypto.randomBytes(32);
  const hex = fresh.toString("hex");
  fs.writeFileSync(KEY_FILE, hex, { encoding: "utf-8", mode: 0o600 });
  console.log(
    `[lumen] 已自动生成主密钥 → ${KEY_FILE}（已加入 .gitignore，请妥善备份）`,
  );
  cached = fresh;
  return cached;
}

/** 仅用于测试：清缓存重新加载 */
export function _resetMasterKeyCache(): void {
  cached = null;
}
