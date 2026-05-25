// Resolves (providerType, kind) → adapter. Real adapters are added here as
// they land — until then everything falls back to mock so the app keeps
// working with no regressions.

import type { ModelKind, ProviderType } from "../types";
import { mockImageAdapter } from "./mock-image";
import { mockVideoAdapter } from "./mock-video";
import { openaiImageAdapter } from "./openai-image";
import { replicateImageAdapter } from "./replicate-image";
import { dashscopeImageAdapter } from "./dashscope-image";
import { dashscopeVideoAdapter } from "./dashscope-video";
import { minimaxVideoAdapter } from "./minimax-video";
import { jimengImageAdapter } from "./jimeng-image";
import { jimengVideoAdapter } from "./jimeng-video";
import { arkImageAdapter } from "./ark-image";
import { arkVideoAdapter } from "./ark-video";
import type { ProviderAdapter } from "./base";

const REGISTRY: Partial<Record<ProviderType, Partial<Record<ModelKind, ProviderAdapter>>>> = {
  mock: {
    image: mockImageAdapter,
    video: mockVideoAdapter,
  },
  // ── 阿里云百炼（按家族分组，model_id 在 adapter 内部自动路由到 t2i/t2v/i2v/r2v/edit）──
  "bailian-tongyi": {
    image: dashscopeImageAdapter,
    video: dashscopeVideoAdapter,
  },
  "bailian-qwen": {
    image: dashscopeImageAdapter, // qwen-image-* 系列
  },
  "bailian-thirdparty": {
    image: dashscopeImageAdapter, // kling/* 图像
    video: dashscopeVideoAdapter, // kling/* · vidu/* · pixverse/* 视频
  },
  "openai-image": {
    image: openaiImageAdapter,
  },
  "replicate-image": {
    image: replicateImageAdapter,
  },
  "dashscope-image": {
    image: dashscopeImageAdapter,
  },
  "dashscope-video": {
    video: dashscopeVideoAdapter,
  },
  "minimax-video": {
    video: minimaxVideoAdapter,
  },
  "jimeng-image": {
    image: jimengImageAdapter,
  },
  "jimeng-video": {
    video: jimengVideoAdapter,
  },
  "ark-image": {
    image: arkImageAdapter,
  },
  "ark-video": {
    video: arkVideoAdapter,
  },
};

/**
 * Look up an adapter for a (providerType, kind) pair. When a real adapter is
 * not yet implemented, falls back to the mock for the same kind so the
 * generation still completes — the admin UI is the right place to surface
 * "this provider isn't wired up yet" if we want to be stricter later.
 */
export function getAdapter(providerType: ProviderType | undefined, kind: ModelKind): ProviderAdapter {
  const type = providerType ?? "mock";
  const found = REGISTRY[type]?.[kind];
  if (found) return found;
  return kind === "image" ? mockImageAdapter : mockVideoAdapter;
}

/**
 * Used by the admin UI's 测试调用 button. Same fallback semantics as
 * getAdapter — if the real adapter isn't here yet, the mock answers OK.
 */
export function getAdapterByType(providerType: ProviderType, kind: ModelKind): ProviderAdapter | undefined {
  return REGISTRY[providerType]?.[kind];
}

/**
 * 当前 providerType + kind 是否有真 adapter。`mock` 也算"真 adapter"
 * （它就是 mock 自己）；非 mock 但 REGISTRY 里没条目的（如 stability-image
 * / replicate-video 等占位 type）会返回 false —— 调用时会被 getAdapter
 * 静默降级到 mock，UI 应当对外提示"演示模式 / 真 provider 未接入"。
 */
export function hasRealAdapter(providerType: ProviderType | undefined, kind: ModelKind): boolean {
  if (!providerType || providerType === "mock") return true;
  return !!REGISTRY[providerType]?.[kind];
}
