// Capability resolution — given a model, return the UI param spec.
// DEFAULT_*_SPEC mirrors the hardcoded UI we had before the refactor, so any
// model whose adapter doesn't implement describe* keeps the same UI.

import type { ImageParamSpec, ModelInfo, VideoParamSpec } from "../types";
import { getAdapter } from "./registry";

/* ───────────────────────── Image — defaults ───────────────────────── */

export const DEFAULT_IMAGE_SPEC: ImageParamSpec = {
  size: {
    mode: "enum",
    default: "1024x1024",
    options: [
      { value: "auto",      label: "智能（由模型决定）", ratio: "auto" },
      { value: "1792x768",  label: "1792×768",          ratio: "21:9" },
      { value: "1792x1024", label: "1792×1024",         ratio: "16:9" },
      { value: "1536x1024", label: "1536×1024",         ratio: "3:2" },
      { value: "1408x1024", label: "1408×1024",         ratio: "4:3" },
      { value: "1024x1024", label: "1024×1024",         ratio: "1:1" },
      { value: "1024x1408", label: "1024×1408",         ratio: "3:4" },
      { value: "1024x1536", label: "1024×1536",         ratio: "2:3" },
      { value: "1024x1792", label: "1024×1792",         ratio: "9:16" },
      { value: "768x768",   label: "768×768",           ratio: "1:1" },
      { value: "512x512",   label: "512×512",           ratio: "1:1" },
    ],
  },
  maxBatch: 4,
  supportsNegativePrompt: true,
  supportsSeed: true,
  supportsReferenceImages: true,
  maxReferenceImages: 9,
  // No defaults extras — adapters opt in.
};

/* ───────────────────────── Video — defaults ───────────────────────── */

export const DEFAULT_VIDEO_SPEC: VideoParamSpec = {
  duration: { mode: "enum", options: [3, 5, 8, 10], default: 5 },
  resolution: {
    mode: "enum",
    default: "720p",
    options: [
      { value: "480p",  label: "480p" },
      { value: "720p",  label: "720p" },
      { value: "1080p", label: "1080p" },
    ],
  },
  camera: {
    mode: "enum",
    default: "static",
    options: [
      { value: "static",     label: "静止" },
      { value: "pan-left",   label: "左移" },
      { value: "pan-right",  label: "右移" },
      { value: "zoom-in",    label: "推近" },
      { value: "zoom-out",   label: "拉远" },
      { value: "orbit",      label: "环绕" },
    ],
  },
  // The current image-to-video page treats the reference as required,
  // so the default keeps that behavior.
  supportsReferenceImage: true,
  requiresReferenceImage: true,
  supportsEndFrame: false,
  supportsNegativePrompt: false,
  supportsSeed: false,
};

/* ───────────────────────── Resolvers ───────────────────────── */

/**
 * Resolve the image param spec for a model. Looks up the adapter's
 * describeImageParams; falls back to DEFAULT_IMAGE_SPEC if the adapter
 * doesn't declare one (or the model is undefined).
 */
export function resolveImageSpec(model: ModelInfo | undefined): ImageParamSpec {
  if (!model) return DEFAULT_IMAGE_SPEC;
  const adapter = getAdapter(model.providerType, "image");
  return adapter.describeImageParams?.(model.providerModelId) ?? DEFAULT_IMAGE_SPEC;
}

export function resolveVideoSpec(model: ModelInfo | undefined): VideoParamSpec {
  if (!model) return DEFAULT_VIDEO_SPEC;
  const adapter = getAdapter(model.providerType, "video");
  return adapter.describeVideoParams?.(model.providerModelId) ?? DEFAULT_VIDEO_SPEC;
}

/* ───────────────────────── State helpers ───────────────────────── */

/**
 * Snap an image param value tuple to be valid under a (possibly new) spec.
 * Used when the user switches model: keep what's still valid, reset what
 * isn't. Common shape: returns the partial that needs updating.
 */
export function snapImageParamsToSpec(
  spec: ImageParamSpec,
  current: { size: string; batch: number; negativePrompt?: string; seed?: number; references?: string[] },
): {
  size: string;
  batch: number;
  negativePrompt?: string;
  seed?: number;
  references?: string[];
} {
  const next = { ...current };
  if (spec.size.mode === "enum") {
    if (!spec.size.options.some((o) => o.value === next.size)) next.size = spec.size.default;
  }
  if (next.batch > spec.maxBatch) next.batch = 1;
  if (next.batch < 1) next.batch = 1;
  if (!spec.supportsNegativePrompt) next.negativePrompt = undefined;
  if (!spec.supportsSeed) next.seed = undefined;
  if (!spec.supportsReferenceImages) next.references = undefined;
  else if (spec.maxReferenceImages && next.references && next.references.length > spec.maxReferenceImages) {
    next.references = next.references.slice(0, spec.maxReferenceImages);
  }
  return next;
}

export function snapVideoParamsToSpec(
  spec: VideoParamSpec,
  current: { duration: number; resolution: string; camera: string; referenceImageUrl?: string; endFrameUrl?: string },
): {
  duration: number;
  resolution: string;
  camera: string;
  referenceImageUrl?: string;
  endFrameUrl?: string;
} {
  const next = { ...current };
  if (spec.duration === "fixed") {
    next.duration = 0;
  } else if (spec.duration.mode === "enum") {
    if (!spec.duration.options.includes(next.duration)) next.duration = spec.duration.default;
  } else {
    if (next.duration < spec.duration.min || next.duration > spec.duration.max) next.duration = spec.duration.default;
  }
  if (spec.resolution === "fixed") {
    next.resolution = "";
  } else if (!spec.resolution.options.some((o) => o.value === next.resolution)) {
    next.resolution = spec.resolution.default;
  }
  if (spec.camera === "none") {
    next.camera = "";
  } else if (spec.camera.mode === "enum" && !spec.camera.options.some((o) => o.value === next.camera)) {
    next.camera = spec.camera.default ?? spec.camera.options[0]?.value ?? "";
  }
  if (!spec.supportsReferenceImage) next.referenceImageUrl = undefined;
  if (!spec.supportsEndFrame) next.endFrameUrl = undefined;
  return next;
}

/**
 * Build the initial extras object from a spec — picks the default value of
 * each declared extra. Used when first selecting a model, or after
 * switching model (extras schema differs, so we always reset).
 */
export function defaultExtras(spec: { extras?: import("../types").ExtraParam[] } | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!spec?.extras) return out;
  for (const ep of spec.extras) {
    if (ep.default !== undefined) out[ep.key] = ep.default;
  }
  return out;
}
