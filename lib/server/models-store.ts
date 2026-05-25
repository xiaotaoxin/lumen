/**
 * 服务端 models CRUD。封装 SQLite 表 + AES-GCM 加 / 解密。
 *
 * 关键不变量：
 *   - 创建/更新 时如果 plain apiKey 不为空 → 立刻加密存 api_key_encrypted
 *   - 列表查询永不返回明文 apiKey，只返回 hasApiKey: boolean
 *   - 解密的明文只在两个调用点出现：
 *       1) /api/proxy/* 服务端：拿到明文 → Authorization 头转发上游 → 立刻丢弃
 *       2) testCall（admin 测试连接，未实现服务端版本时禁用）
 */

import * as crypto from "node:crypto";
import type { ImageCapability, ModelKind, ProviderType } from "../types";
import { getDb } from "./db";
import { encryptApiKey, decryptApiKey } from "./crypto";

/**
 * 客户端可见的 model dto —— **永远不包含 apiKey 明文**。
 * hasApiKey 让 admin UI 知道这条记录是否已经设置过 Key。
 */
export interface ServerModelDto {
  id: string;
  name: string;
  vendor: string;
  kind: ModelKind;
  description: string;
  providerType: ProviderType;
  endpoint?: string;
  providerModelId?: string;
  costPerCall: number;
  avgLatencyMs: number;
  baseFailureRate: number;
  badge?: "new" | "fast" | "premium";
  capabilities?: ImageCapability[];
  enabled: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModelInput {
  name: string;
  vendor: string;
  kind: ModelKind;
  description?: string;
  providerType: ProviderType;
  endpoint?: string;
  apiKey?: string;            // 写入：明文，store 内部加密存盘
  providerModelId?: string;
  costPerCall?: number;
  avgLatencyMs?: number;
  baseFailureRate?: number;
  badge?: "new" | "fast" | "premium";
  capabilities?: ImageCapability[];
  enabled?: boolean;
}

export interface UpdateModelInput {
  name?: string;
  vendor?: string;
  kind?: ModelKind;
  description?: string;
  providerType?: ProviderType;
  endpoint?: string;
  /**
   * 三态：
   *   undefined → 不改
   *   ""        → 清空（删除已存的 Key）
   *   非空       → 替换为新明文（store 内部加密）
   */
  apiKey?: string;
  providerModelId?: string;
  costPerCall?: number;
  avgLatencyMs?: number;
  baseFailureRate?: number;
  badge?: "new" | "fast" | "premium" | null;
  capabilities?: ImageCapability[];
  enabled?: boolean;
}

interface DbRow {
  id: string;
  name: string;
  vendor: string;
  kind: ModelKind;
  description: string | null;
  provider_type: ProviderType;
  endpoint: string | null;
  api_key_encrypted: string | null;
  provider_model_id: string | null;
  cost_per_call: number;
  avg_latency_ms: number;
  base_failure_rate: number;
  badge: string | null;
  capabilities: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToDto(r: DbRow): ServerModelDto {
  return {
    id: r.id,
    name: r.name,
    vendor: r.vendor,
    kind: r.kind,
    description: r.description ?? "（无描述）",
    providerType: r.provider_type,
    endpoint: r.endpoint ?? undefined,
    providerModelId: r.provider_model_id ?? undefined,
    costPerCall: r.cost_per_call,
    avgLatencyMs: r.avg_latency_ms,
    baseFailureRate: r.base_failure_rate,
    badge: (r.badge as ServerModelDto["badge"]) ?? undefined,
    capabilities: r.capabilities ? (JSON.parse(r.capabilities) as ImageCapability[]) : undefined,
    enabled: !!r.enabled,
    hasApiKey: !!r.api_key_encrypted,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function shortId(prefix = "m_"): string {
  return prefix + crypto.randomBytes(6).toString("hex");
}

/** 列表（不含明文 apiKey）。 */
export function listModels(): ServerModelDto[] {
  const rows = getDb().prepare<[], DbRow>("SELECT * FROM models ORDER BY created_at DESC").all();
  return rows.map(rowToDto);
}

/** 单条（不含明文 apiKey）。 */
export function getModel(id: string): ServerModelDto | null {
  const row = getDb().prepare<[string], DbRow>("SELECT * FROM models WHERE id = ?").get(id);
  return row ? rowToDto(row) : null;
}

/**
 * 仅供 /api/proxy/* 路由调用：拿到 modelId 反查解密后的明文 apiKey。
 * 找不到 / 没设置 Key 时返回 null。
 *
 * **绝对不要把这个函数的返回值写到响应里**——它是给上游签名用的中间产物。
 */
export function resolvePlaintextApiKey(modelId: string): string | null {
  const row = getDb()
    .prepare<[string], { api_key_encrypted: string | null }>(
      "SELECT api_key_encrypted FROM models WHERE id = ? AND enabled = 1",
    )
    .get(modelId);
  if (!row || !row.api_key_encrypted) return null;
  try {
    return decryptApiKey(row.api_key_encrypted);
  } catch (err) {
    console.error(`[models-store] 解密 ${modelId} 失败：`, (err as Error).message);
    return null;
  }
}

/** 解析 modelId 拿到 endpoint（用于走自定义代理路径的 provider）。 */
export function getModelEndpoint(modelId: string): string | null {
  const row = getDb()
    .prepare<[string], { endpoint: string | null }>(
      "SELECT endpoint FROM models WHERE id = ? AND enabled = 1",
    )
    .get(modelId);
  return row?.endpoint ?? null;
}

export function createModel(input: CreateModelInput): ServerModelDto {
  const name = input.name.trim();
  const vendor = input.vendor.trim();
  if (!name) throw new Error("名称不能为空");
  if (!vendor) throw new Error("厂商不能为空");
  if (input.kind !== "image" && input.kind !== "video") {
    throw new Error("kind 必须是 image 或 video");
  }
  const db = getDb();
  const exists = db
    .prepare<[string], { id: string }>("SELECT id FROM models WHERE LOWER(name) = LOWER(?)")
    .get(name);
  if (exists) throw new Error("已经有同名模型");

  const now = new Date().toISOString();
  const id = shortId("custom-");
  const apiKeyEncrypted = input.apiKey ? encryptApiKey(input.apiKey) : null;

  db.prepare(`
    INSERT INTO models (
      id, name, vendor, kind, description, provider_type, endpoint,
      api_key_encrypted, provider_model_id,
      cost_per_call, avg_latency_ms, base_failure_rate,
      badge, capabilities, enabled, created_at, updated_at
    ) VALUES (
      @id, @name, @vendor, @kind, @description, @providerType, @endpoint,
      @apiKeyEncrypted, @providerModelId,
      @costPerCall, @avgLatencyMs, @baseFailureRate,
      @badge, @capabilities, @enabled, @createdAt, @updatedAt
    )
  `).run({
    id,
    name,
    vendor,
    kind: input.kind,
    description: input.description?.trim() || null,
    providerType: input.providerType,
    endpoint: input.endpoint?.trim() || null,
    apiKeyEncrypted,
    providerModelId: input.providerModelId?.trim() || null,
    costPerCall: input.costPerCall ?? 2,
    avgLatencyMs: input.avgLatencyMs ?? 5000,
    baseFailureRate: input.baseFailureRate ?? 0.05,
    badge: input.badge ?? null,
    capabilities:
      input.kind === "image" && input.capabilities
        ? JSON.stringify(input.capabilities)
        : null,
    enabled: input.enabled === false ? 0 : 1,
    createdAt: now,
    updatedAt: now,
  });

  return getModel(id)!;
}

export function updateModel(id: string, patch: UpdateModelInput): ServerModelDto {
  const db = getDb();
  const cur = getModel(id);
  if (!cur) throw new Error("模型不存在");

  // 名称冲突检查
  if (patch.name !== undefined) {
    const newName = patch.name.trim();
    if (!newName) throw new Error("名称不能为空");
    const dup = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM models WHERE LOWER(name) = LOWER(?) AND id != ?",
      )
      .get(newName, id);
    if (dup) throw new Error("已经有同名模型");
  }

  // apiKey 三态处理
  let apiKeyClause = "";
  let apiKeyValue: string | null | undefined = undefined;
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === "") {
      apiKeyClause = ", api_key_encrypted = NULL";
      apiKeyValue = null;
    } else {
      apiKeyClause = ", api_key_encrypted = @apiKeyEncrypted";
      apiKeyValue = encryptApiKey(patch.apiKey);
    }
  }

  const setClauses: string[] = ["updated_at = @updatedAt"];
  const bind: Record<string, unknown> = {
    id,
    updatedAt: new Date().toISOString(),
  };

  const map = (
    field: string,
    column: string,
    value: unknown,
    transform?: (v: unknown) => unknown,
  ) => {
    if (value === undefined) return;
    setClauses.push(`${column} = @${field}`);
    bind[field] = transform ? transform(value) : value;
  };

  map("name", "name", patch.name?.trim());
  map("vendor", "vendor", patch.vendor?.trim());
  map("kind", "kind", patch.kind);
  map("description", "description", patch.description, (v) => (v as string).trim() || null);
  map("providerType", "provider_type", patch.providerType);
  map("endpoint", "endpoint", patch.endpoint, (v) => (v as string).trim() || null);
  map("providerModelId", "provider_model_id", patch.providerModelId, (v) => (v as string).trim() || null);
  map("costPerCall", "cost_per_call", patch.costPerCall);
  map("avgLatencyMs", "avg_latency_ms", patch.avgLatencyMs);
  map("baseFailureRate", "base_failure_rate", patch.baseFailureRate);
  map("badge", "badge", patch.badge, (v) => v ?? null);
  if (patch.capabilities !== undefined) {
    setClauses.push("capabilities = @capabilities");
    bind.capabilities = patch.capabilities ? JSON.stringify(patch.capabilities) : null;
  }
  if (patch.enabled !== undefined) {
    setClauses.push("enabled = @enabled");
    bind.enabled = patch.enabled ? 1 : 0;
  }
  if (apiKeyClause) {
    setClauses.push(apiKeyClause.replace(/^, /, ""));
    if (apiKeyValue !== null) bind.apiKeyEncrypted = apiKeyValue;
  }

  db.prepare(`UPDATE models SET ${setClauses.join(", ")} WHERE id = @id`).run(bind);
  return getModel(id)!;
}

export function deleteModel(id: string): void {
  getDb().prepare("DELETE FROM models WHERE id = ?").run(id);
}

export function setEnabled(id: string, enabled: boolean): void {
  getDb()
    .prepare("UPDATE models SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
}

/**
 * 批量更新某 providerType 下所有模型的凭证 / endpoint。
 * 用于 admin "共享凭证" UI —— 改一处同步到该家族下所有 SKU。
 */
export function bulkUpdateCredentials(
  providerTypes: ProviderType[],
  patch: { apiKey?: string; endpoint?: string },
): number {
  if (providerTypes.length === 0) return 0;
  const db = getDb();
  const placeholders = providerTypes.map(() => "?").join(", ");
  const ids = db
    .prepare<ProviderType[], { id: string }>(
      `SELECT id FROM models WHERE provider_type IN (${placeholders})`,
    )
    .all(...providerTypes)
    .map((r) => r.id);

  for (const id of ids) {
    updateModel(id, { apiKey: patch.apiKey, endpoint: patch.endpoint });
  }
  return ids.length;
}
