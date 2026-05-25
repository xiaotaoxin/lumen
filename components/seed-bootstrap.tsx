"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { seedIfNeeded } from "@/lib/seed";
import { KEYS, onStorageError, storage } from "@/lib/storage";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCatalogStore } from "@/lib/store/catalog-store";
import { pruneHeavyFields, nukeAllNodeAssets } from "@/lib/api/canvases";
import { reapStaleRunningSync, pruneGenerationsHeavyFields, nukeAllGenerationsSync } from "@/lib/api/history";
import { isJobLive } from "@/lib/live-jobs";
import { refreshCache, create as createCustomModel } from "@/lib/api/admin-models";
import type { ModelInfo } from "@/lib/types";

/**
 * Runs once on mount:
 *  - seeds the local mock store with demo accounts & fixtures
 *  - hydrates the auth session from localStorage
 *  - hydrates the catalog store with admin-curated custom models
 *  - listens for cross-tab storage events to keep customModels fresh
 *  - surfaces localStorage quota errors as a toast
 */
export function SeedBootstrap() {
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const reloadCatalog = useCatalogStore((s) => s.reload);

  useEffect(() => {
    seedIfNeeded();
    void hydrateAuth();
    reloadCatalog();

    // Stage-2 启动时拉取服务端 model 列表（填充 admin-models 内存缓存），
    // 然后检测是否有 stage-1 留下的 localStorage 旧数据需要一次性上迁。
    void (async () => {
      try {
        await refreshCache();
        await migrateLegacyCustomModels();
        reloadCatalog();
      } catch (err) {
        console.warn("[boot] 拉取服务端模型失败：", err);
      }
    })();

    // 启动时检查 lumen:canvases 是否已经膨胀到接近 localStorage 上限。
    // 如果是，先静默瘦身一次 —— 否则后续所有 saveSync 都会失败。
    // 把 prune / nuke 暴露到 window 上，方便 DevTools 控制台手动跑诊断。
    try {
      // 暴露诊断 API
      (window as unknown as { __lumenPrune?: typeof pruneHeavyFields }).__lumenPrune = pruneHeavyFields;
      (window as unknown as { __lumenNuke?: typeof nukeAllNodeAssets }).__lumenNuke = nukeAllNodeAssets;
      (window as unknown as { __lumenPruneGen?: typeof pruneGenerationsHeavyFields }).__lumenPruneGen = pruneGenerationsHeavyFields;
      (window as unknown as { __lumenNukeGen?: typeof nukeAllGenerationsSync }).__lumenNukeGen = nukeAllGenerationsSync;

      // canvases 启动瘦身
      const rawCanvas = window.localStorage.getItem(KEYS.canvases);
      const canvasKB = rawCanvas ? rawCanvas.length / 1024 : 0;
      if (canvasKB > 4_000) {
        const { freedBytes, touched } = pruneHeavyFields();
        const after = window.localStorage.getItem(KEYS.canvases)?.length ?? 0;
        toast.message(`画布存储 ${canvasKB.toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`, {
          description: touched > 0
            ? `已剥离 ${touched} 个节点的重资产，释放 ${(freedBytes / 1024).toFixed(0)} KB`
            : `没找到大 dataURL；如保存仍失败，控制台跑 __lumenNuke() 强清。`,
          duration: 6000,
        });
      }

      // generations 启动瘦身
      const rawGen = window.localStorage.getItem(KEYS.generations);
      const genKB = rawGen ? rawGen.length / 1024 : 0;
      if (genKB > 4_000) {
        const { freedBytes, touched, fieldHits } = pruneGenerationsHeavyFields();
        const afterG = window.localStorage.getItem(KEYS.generations)?.length ?? 0;
        const hits = Object.entries(fieldHits).map(([k, v]) => `${k}×${v}`).join(" · ") || "无 dataURL";
        toast.message(`生成历史 ${genKB.toFixed(0)} KB → ${(afterG / 1024).toFixed(0)} KB`, {
          description: touched > 0
            ? `已剥离 ${touched} 条记录的图/视频 dataURL，释放 ${(freedBytes / 1024).toFixed(0)} KB · ${hits}`
            : `没找到大 dataURL（${hits}），但条数过多。考虑到「我的作品」删一些旧条目，或控制台跑 __lumenNukeGen() 一键清空所有生成历史。`,
          duration: 9000,
          action: touched === 0
            ? {
                label: "清空全部生成历史",
                onClick: () => {
                  if (!window.confirm("将永久删除所有生成历史记录（不影响账号、画布、主体库）。确定？")) return;
                  const { count, freedBytes: fb } = nukeAllGenerationsSync();
                  toast.success(`已清空 ${count} 条历史，释放 ${(fb / 1024).toFixed(0)} KB · 请刷新页面`);
                },
              }
            : undefined,
        });
      }
    } catch (e) {
      console.warn("[boot] 检查 localStorage 失败：", e);
    }

    // 启动时回收僵尸任务：标签页关闭后没人 publishFinal 的 running 项
    try {
      const reaped = reapStaleRunningSync({ isLive: isJobLive, thresholdMin: 8 });
      if (reaped.length > 0) {
        toast.message(`回收 ${reaped.length} 个失联任务`, {
          description: "这些任务因标签页关闭无法恢复，已自动标记为失败。需要的话请重新生成。",
          duration: 5000,
        });
      }
    } catch (e) {
      console.warn("[boot] reaper 失败：", e);
    }

    // Cross-tab sync: when admin updates customModels in another tab, refresh here.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS.customModels) reloadCatalog();
    };
    window.addEventListener("storage", onStorage);

    let lastShownAt = 0;
    const off = onStorageError(({ key, bytes }) => {
      const now = Date.now();
      if (now - lastShownAt < 4000) return;
      lastShownAt = now;
      const isCanvas = key === KEYS.canvases;
      const isGen = key === KEYS.generations;

      let description: string;
      let action: { label: string; onClick: () => void } | undefined;
      if (isCanvas) {
        description = `写入「${key}」失败（${(bytes / 1024).toFixed(0)} KB）。画布里 dataURL 大图把存储撑爆。`;
        action = {
          label: "一键瘦身",
          onClick: () => {
            const { freedBytes, touched } = pruneHeavyFields();
            toast.success(`已清理 ${touched} 个节点，释放 ${(freedBytes / 1024).toFixed(0)} KB · 请刷新`);
          },
        };
      } else if (isGen) {
        description = `写入「${key}」失败（${(bytes / 1024).toFixed(0)} KB）。生成记录的图/视频 dataURL 累计撑爆 localStorage。`;
        action = {
          label: "瘦身（剥离图片）",
          onClick: () => {
            const { freedBytes, touched, fieldHits } = pruneGenerationsHeavyFields();
            const hits = Object.entries(fieldHits).map(([k, v]) => `${k}×${v}`).join(" · ");
            if (touched === 0) {
              toast.message("没有可剥离的 dataURL", {
                description: "条数过多导致溢出。点这里清空全部生成历史 ↓",
                duration: 6000,
                action: {
                  label: "清空生成历史",
                  onClick: () => {
                    if (!window.confirm("将永久删除所有生成历史。确定？")) return;
                    const { count, freedBytes: fb } = nukeAllGenerationsSync();
                    toast.success(`已清空 ${count} 条 · 释放 ${(fb / 1024).toFixed(0)} KB · 请刷新`);
                  },
                },
              });
            } else {
              toast.success(`已剥离 ${touched} 条记录的图/视频 dataURL · 释放 ${(freedBytes / 1024).toFixed(0)} KB · ${hits}`);
            }
          },
        };
      } else {
        description = `写入「${key}」失败（${(bytes / 1024).toFixed(0)} KB）。请到「我的作品」清理一些旧条目，或接入真后端。`;
      }

      toast.error("本地存储已满", { description, duration: 8000, action });
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      off();
    };
  }, [hydrateAuth, reloadCatalog]);

  return null;
}

/**
 * Stage-1 → Stage-2 迁移：把 localStorage 里的 customModels（明文 apiKey）一次性
 * 上传到 /api/admin/models（服务端 AES-GCM 加密落 SQLite），完成后清掉 localStorage。
 *
 * 仅当 localStorage 里还有数据 + 服务端是空表时才迁，避免重复 / 覆盖。
 */
async function migrateLegacyCustomModels(): Promise<void> {
  const legacyKey = KEYS.customModels;
  const legacy = storage.get<ModelInfo[]>(legacyKey, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  // 服务端列表非空 → 用户已经在新系统下用过了，旧数据视为脏数据丢掉
  const serverList = await refreshCache();
  if (serverList.length > 0) {
    storage.remove(legacyKey);
    console.log(`[boot] 服务端已有 ${serverList.length} 个模型，丢弃 ${legacy.length} 条本地遗留数据`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const m of legacy) {
    try {
      await createCustomModel({
        name: m.name,
        vendor: m.vendor,
        kind: m.kind,
        description: m.description,
        providerType: m.providerType,
        endpoint: m.endpoint,
        apiKey: m.apiKey,                 // ← 明文上传一次，服务端立刻加密
        providerModelId: m.providerModelId,
        costPerCall: m.costPerCall,
        avgLatencyMs: m.avgLatencyMs,
        baseFailureRate: m.baseFailureRate,
        badge: m.badge,
        capabilities: m.capabilities,
        enabled: m.enabled !== false,
      });
      ok += 1;
    } catch (e) {
      console.warn(`[boot] 迁移 ${m.name} 失败：`, e);
      fail += 1;
    }
  }

  if (ok > 0) {
    // 整体成功 → 清掉 localStorage 旧数据
    storage.remove(legacyKey);
    toast.success(`已迁移 ${ok} 个模型到服务端加密存储`, {
      description: fail > 0 ? `${fail} 条失败，请检查控制台日志` : "API Key 已 AES-GCM 加密落盘",
      duration: 8000,
    });
  } else if (fail > 0) {
    toast.error(`${fail} 条模型迁移失败`, {
      description: "已保留 localStorage 旧数据。检查 .lumen-master.key 是否存在并重启",
      duration: 12000,
    });
  }
}
