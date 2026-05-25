/**
 * AES-256-GCM 对称加密 / 解密。用于 lumen.db 里的 api_key 字段。
 *
 * 输出格式：base64( iv(12B) || tag(16B) || ciphertext )
 * iv 每次随机生成 —— 同一个明文每次加密的密文都不同，不可比较。
 * tag 是 GCM 的认证标签，用于检测篡改；解密时若 tag 不对会抛错。
 *
 * 主密钥从 getMasterKey() 获取（32 字节）。
 */

import * as nodeCrypto from "node:crypto";
import { getMasterKey } from "./master-key";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM 推荐 12
const TAG_BYTES = 16;

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) throw new Error("encryptApiKey: 明文不能为空");
  const key = getMasterKey();
  const iv = nodeCrypto.randomBytes(IV_BYTES);
  const cipher = nodeCrypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptApiKey(envelope: string): string {
  if (!envelope) throw new Error("decryptApiKey: 密文不能为空");
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("decryptApiKey: 密文长度异常");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const key = getMasterKey();
  const decipher = nodeCrypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf-8");
}
