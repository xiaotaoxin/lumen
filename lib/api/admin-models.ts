/**
 * Stage-2 客户端 admin-models API。
 *
 * 这层封装服务端 /api/admin/models 真接口（DB + AES-GCM 加密）。
 * client 永远拿不到 apiKey 明文 —— GET 返回的 ModelInfo 上 apiKey 字段恒为 undefined，
 * hasApiKey: boolean 表明服务端是否已为该条记录设置过 Key。
 *
 * 兼容旧调用面：函数签名与 stage-1 localStorage 版本完全一致。
 * 同步函数（listCustomSync / readAll）改为返回内存缓存，由初始 GET 填充；
 * 这是为了让 useCatalogStore.hydrate() 在不引入 async 风暴的情况下立即可用。
 */

import type { ImageCapability, ModelInfo, ModelKind, ProviderType } from "../types";
import { LumenApiError } from "./index";

export interface CustomModelInput {
  name: string;
  vendor: string;
  kind: ModelKind;
  description?: string;
  providerType?: ProviderType;
  endpoint?: string;
  apiKey?: string;
  providerModelId?: string;
  costPerCall?: number;
  avgLatencyMs?: number;
  baseFailureRate?: number;
  badge?: ModelInfo["badge"];
  capabilities?: ImageCapability[];
  enabled?: boolean;
}

/* ─── 内存缓存（同步访问入口） ────────────────────────────────────────
 * useCatalogStore.hydrate() 用 listCustomSync()，需要立刻拿到结果而不是 Promise。
 * 我们把上一次成功 GET 的列表缓存到内存里 —— 启动时立刻 fire-and-forget 一次 GET
 * 来填充。后续每次 mutation 完成后用最新结果回填。
 */
let memoryCache: ModelInfo[] = [];
let bootInflight: Promise<ModelInfo[]> | null = null;

interface ServerDto {
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

function dtoToModelInfo(d: ServerDto): ModelInfo {
  return {
    ...d,
    isCustom: true,
    // apiKey 永不回传给客户端 —— 仅用 hasApiKey 表示"已设置 / 未设置"
    apiKey: undefined,
    hasApiKey: d.hasApiKey,
  };
}

async function fetchList(): Promise<ModelInfo[]> {
  const res = await fetch("/api/admin/models", { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new LumenApiError(
      "INVALID_CREDENTIALS",
      body.error ?? `加载失败 (HTTP ${res.status})`,
    );
  }
  const json = (await res.json()) as { models: ServerDto[] };
  const list = json.models.map(dtoToModelInfo);
  memoryCache = list;
  return list;
}

/* ─── 公共 API ─── */

export async function listCustom(): Promise<ModelInfo[]> {
  return fetchList();
}

/**
 * 同步入口（用于 store hydrate）。第一次返回内存缓存（可能空）；
 * 启动时 SeedBootstrap 应该立刻调一次 listCustom() 把缓存填满。
 */
export function listCustomSync(): ModelInfo[] {
  // 触发首次后台加载（仅第一次）
  if (memoryCache.length === 0 && !bootInflight && typeof window !== "undefined") {
    bootInflight = fetchList().catch((e) => {
      console.warn("[admin-models] 首次加载失败：", e);
      return memoryCache;
    });
  }
  return memoryCache;
}

/** 强制刷新内存缓存。SeedBootstrap 启动时调一次，mutation 后也可显式触发。 */
export async function refreshCache(): Promise<ModelInfo[]> {
  return fetchList();
}

export async function create(input: CustomModelInput): Promise<ModelInfo> {
  const res = await fetch("/api/admin/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 400 && /同名/.test(body.error ?? "")) {
      throw new LumenApiError("USERNAME_TAKEN", body.error);
    }
    throw new LumenApiError("INVALID_CREDENTIALS", body.error ?? "创建失败");
  }
  const json = (await res.json()) as { model: ServerDto };
  const m = dtoToModelInfo(json.model);
  await fetchList(); // 回填缓存
  return m;
}

export async function update(
  id: string,
  patch: Partial<CustomModelInput>,
): Promise<ModelInfo> {
  const res = await fetch(`/api/admin/models/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) throw new LumenApiError("NOT_FOUND", body.error ?? "模型不存在");
    if (res.status === 400 && /同名/.test(body.error ?? "")) {
      throw new LumenApiError("USERNAME_TAKEN", body.error);
    }
    throw new LumenApiError("INVALID_CREDENTIALS", body.error ?? "更新失败");
  }
  const json = (await res.json()) as { model: ServerDto };
  const m = dtoToModelInfo(json.model);
  await fetchList();
  return m;
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  await update(id, { enabled });
}

export async function remove(id: string): Promise<void> {
  const res = await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new LumenApiError("INVALID_CREDENTIALS", body.error ?? "删除失败");
  }
  await fetchList();
}

/**
 * Stage-2 共享凭证批量更新 —— admin "家族凭证" UI 用。
 * 一次更新某些 providerType 下所有模型的 apiKey + endpoint。
 */
export async function bulkUpdateCredentials(
  providerTypes: ProviderType[],
  patch: { apiKey?: string; endpoint?: string },
): Promise<number> {
  const res = await fetch("/api/admin/models/bulk-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerTypes, ...patch }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new LumenApiError("INVALID_CREDENTIALS", body.error ?? "更新失败");
  }
  const json = (await res.json()) as { updated: number };
  await fetchList();
  return json.updated;
}
