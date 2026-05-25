import * as React from "react";
import type { ModelInfo } from "./types";
import { useCatalogStore } from "./store/catalog-store";
import { listCustomSync } from "./api/admin-models";

/**
 * 内置模型列表。
 *
 * 现在留空 —— 全部模型都通过 /admin/models 自定义配置。
 * 这样管理后台和创作工作台只显示真正配过 API Key 的模型，
 * 不再有 mock 演示卡片混淆视听。
 */
export const BUILT_IN_MODELS: ModelInfo[] = [];

/**
 * Backward-compat aliases. New code should prefer the hooks below so that
 * admin-added custom models flow through automatically.
 */
export const MODELS = BUILT_IN_MODELS;
export const IMAGE_MODELS = BUILT_IN_MODELS.filter((m) => m.kind === "image");
export const VIDEO_MODELS = BUILT_IN_MODELS.filter((m) => m.kind === "video");

/**
 * Resolve a model by id, looking at both the bundled list and the admin's
 * custom store. Used outside of React (mock generators, history rendering),
 * so it reads localStorage directly rather than via a hook.
 */
export function findModel(id: string): ModelInfo | undefined {
  const builtIn = BUILT_IN_MODELS.find((m) => m.id === id);
  if (builtIn) return builtIn;
  return listCustomSync().find((m) => m.id === id);
}

/* ─── Reactive hooks for UI ─── */

/**
 * 一条自定义模型是否"可在工作台点击即用"。Stage-2 起 apiKey 字段在客户端
 * 永远 undefined（已迁服务端 AES-GCM 加密），用 hasApiKey 标识。
 *
 * 必须满足：
 *   1. enabled !== false（admin 没停用）
 *   2. mock → OK（不需 Key / model_id）
 *   3. 真 provider：hasApiKey === true（服务端已为该条记录设置过 Key）+ providerModelId 已填
 */
export function isReadyForUse(m: ModelInfo): boolean {
  if (m.enabled === false) return false;
  if ((m.providerType ?? "mock") === "mock") return true;
  // hasApiKey 是 stage-2 服务端给的；fallback 到 stage-1 草稿态的明文 apiKey 字段（极少用）
  if (!(m.hasApiKey || m.apiKey)) return false;
  if (!m.providerModelId) return false;
  return true;
}

function useEnabledCustom(): ModelInfo[] {
  const customs = useCatalogStore((s) => s.customModels);
  return React.useMemo(
    () => customs.filter(isReadyForUse),
    [customs],
  );
}

export function useImageModels(): ModelInfo[] {
  const customs = useEnabledCustom();
  return React.useMemo(
    () => [
      ...BUILT_IN_MODELS.filter((m) => m.kind === "image"),
      ...customs.filter((m) => m.kind === "image"),
    ],
    [customs],
  );
}

export function useVideoModels(): ModelInfo[] {
  const customs = useEnabledCustom();
  return React.useMemo(
    () => [
      ...BUILT_IN_MODELS.filter((m) => m.kind === "video"),
      ...customs.filter((m) => m.kind === "video"),
    ],
    [customs],
  );
}

export const IMAGE_STYLES = [
  { id: "general", name: "通用" },
  { id: "photo", name: "摄影写实" },
  { id: "anime", name: "动漫" },
  { id: "ink", name: "水墨" },
  { id: "cyber", name: "赛博朋克" },
  { id: "oil", name: "油画" },
  { id: "minimal", name: "极简" },
] as const;
