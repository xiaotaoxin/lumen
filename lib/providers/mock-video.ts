// Mock video adapter — mirrors mock-image but produces a (poster only)
// video result, matching the original behavior of generate.ts.

import { mockVideoPosterDataUri } from "../mock-assets";
import {
  AdapterError,
  type AdapterEvent,
  type GenerateRequest,
  type ProviderAdapter,
  type ProviderConfig,
  type TestResult,
} from "./base";
import { DEFAULT_VIDEO_SPEC } from "./capabilities";

const TICK_MS = 250;

export const mockVideoAdapter: ProviderAdapter = {
  type: "mock",
  kinds: ["video"],

  describeVideoParams() {
    return DEFAULT_VIDEO_SPEC;
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, latencyMs: Date.now() - startedAt, message: `mock latency ≈ ${cfg.avgLatencyMs}ms` };
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "video") {
      throw new AdapterError("unsupported", "mock-video 只能处理视频请求");
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
      throw new AdapterError("upstream_5xx", "视频生成失败：节点超时");
    }

    yield {
      type: "final",
      kind: "video",
      videoUrl: "",
      videoPosterUrl: mockVideoPosterDataUri(req.prompt),
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
