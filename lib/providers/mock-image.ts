// Mock image adapter — preserves the original behavior of generate.ts so all
// built-in models keep working untouched after the dispatch refactor.

import { mockImageDataUri } from "../mock-assets";
import {
  AdapterError,
  type AdapterEvent,
  type GenerateRequest,
  type ProviderAdapter,
  type ProviderConfig,
  type TestResult,
} from "./base";
import { DEFAULT_IMAGE_SPEC } from "./capabilities";

const TICK_MS = 200;

export const mockImageAdapter: ProviderAdapter = {
  type: "mock",
  kinds: ["image"],

  describeImageParams() {
    // Mock is the most permissive — exposes the full default UI.
    return DEFAULT_IMAGE_SPEC;
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true, latencyMs: Date.now() - startedAt, message: `mock latency ≈ ${cfg.avgLatencyMs}ms` };
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") {
      throw new AdapterError("unsupported", "mock-image 只能处理图像请求");
    }
    const totalMs = cfg.avgLatencyMs * (0.7 + Math.random() * 0.6);
    const startedAt = Date.now();

    while (true) {
      if (req.signal?.aborted) {
        throw new AdapterError("cancelled", "已取消");
      }
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(99, (elapsed / totalMs) * 100);
      yield { type: "progress", pct };
      if (elapsed >= totalMs) break;
      await sleep(TICK_MS, req.signal);
    }

    if (Math.random() < cfg.baseFailureRate) {
      throw new AdapterError("upstream_5xx", "上游模型暂时不可用，请重试或更换模型");
    }

    const params = req.params;
    const seedKey = [
      req.prompt,
      params.style,
      params.mode ?? "idea",
      (params.subjectIds ?? []).join(","),
      String((params.references ?? []).length),
    ].join(":");
    const imageUrls = Array.from({ length: params.batch }, (_, k) => mockImageDataUri(seedKey, k));

    yield {
      type: "final",
      kind: "image",
      imageUrls,
      cost: cfg.costPerCall,
    };
  },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AdapterError("cancelled", "已取消"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AdapterError("cancelled", "已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
