"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CenterComposer } from "@/components/workspace/center-composer";
import { ImageResultGrid } from "@/components/workspace/image-result-grid";
import { IMAGE_STYLES, findModel, useImageModels } from "@/lib/catalog";
import { resolveImageSpec, snapImageParamsToSpec, defaultExtras } from "@/lib/providers/capabilities";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSessionsStore } from "@/lib/store/sessions-store";
import * as gen from "@/lib/api/generate";
import * as historyApi from "@/lib/api/history";
import { cancelLiveJob, getLiveJob, isJobLive, subscribeJob } from "@/lib/live-jobs";
import * as sessionsApi from "@/lib/api/sessions";
import * as subjectsApi from "@/lib/api/subjects";
import type { Generation, ImageParams, PromptMode, Subject } from "@/lib/types";

export default function TextToImagePage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-muted-foreground">载入中…</div>}>
      <TextToImageInner />
    </Suspense>
  );
}

function TextToImageInner() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const search = useSearchParams();
  const sessionId = search.get("s");
  const bumpSessions = useSessionsStore((s) => s.bump);
  const sessionsReloadKey = useSessionsStore((s) => s.reloadKey);

  // Live session id during this render (may differ from URL until we navigate).
  // Sync with the URL using the React 19 prev-prop-during-render pattern.
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(sessionId);
  const [lastUrlSessionId, setLastUrlSessionId] = React.useState(sessionId);
  if (lastUrlSessionId !== sessionId) {
    setLastUrlSessionId(sessionId);
    setActiveSessionId(sessionId);
  }

  // Composer state
  const [prompt, setPrompt] = React.useState("");
  const [mode, setMode] = React.useState<PromptMode>("idea");
  const [references, setReferences] = React.useState<string[]>([]);
  const [allSubjects, setAllSubjects] = React.useState<Subject[]>([]);
  const [subjectReloadKey, setSubjectReloadKey] = React.useState(0);

  const [negative, setNegative] = React.useState("");
  const imageModels = useImageModels();
  const [modelId, setModelId] = React.useState(() => imageModels[0]?.id ?? "");
  const [size, setSize] = React.useState<ImageParams["size"]>("1024x1024");
  const [batch, setBatch] = React.useState<ImageParams["batch"]>(1);
  const [style, setStyle] = React.useState<string>(IMAGE_STYLES[0].id);
  const [extras, setExtras] = React.useState<Record<string, unknown>>({});

  // Capability spec for the currently selected model — drives the composer's
  // 高级参数 popover (which inputs to render, which to hide, plus model-specific
  // extras like dall-e-3 quality / wanx prompt_extend).
  const currentModel = React.useMemo(
    () => imageModels.find((m) => m.id === modelId) ?? findModel(modelId),
    [modelId, imageModels],
  );
  const spec = React.useMemo(() => resolveImageSpec(currentModel), [currentModel]);

  // When model changes, snap incompatible state. Use the React 19 prev-prop-
  // during-render pattern (avoids the set-state-in-effect lint error).
  const [lastSpecModelId, setLastSpecModelId] = React.useState(modelId);
  if (lastSpecModelId !== modelId) {
    setLastSpecModelId(modelId);
    const snapped = snapImageParamsToSpec(spec, {
      size, batch, negativePrompt: negative || undefined,
      references,
    });
    if (snapped.size !== size) setSize(snapped.size);
    if (snapped.batch !== batch) setBatch(snapped.batch);
    if ((snapped.negativePrompt ?? "") !== negative) setNegative(snapped.negativePrompt ?? "");
    if (snapped.references !== references) setReferences(snapped.references ?? []);
    // extras schema differs per model — always reset to the new model's defaults
    setExtras(defaultExtras(spec));
  }

  // Conversation stream — newest at the end. Each entry is one generation.
  const [stream, setStream] = React.useState<Generation[]>([]);
  // Per-generation progress 0..100, keyed by generation id
  const [progressMap, setProgressMap] = React.useState<Record<string, number>>({});
  // Active job cancels, keyed by generation id, so we can cancel any running item.
  const cancelMap = React.useRef<Map<string, () => void>>(new Map());
  // Last loaded session id — guards against re-loading the same one
  const lastLoadedSessionRef = React.useRef<string | null>(null);

  // Track whether any item in the stream is currently running
  const anyRunning = stream.some((g) => g.status === "running");

  // Load subjects
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    subjectsApi.listMine(user.id).then((list) => {
      if (cancelled) return;
      setAllSubjects(list);
    });
    return () => { cancelled = true; };
  }, [user, subjectReloadKey]);

  // Sync the stream with storage whenever something elsewhere bumps sessions
  // (e.g., the sidebar deletes a generation). Drop any items that no longer
  // exist; refresh metadata (favorite, status, urls) for items that do.
  React.useEffect(() => {
    if (!user) return;
    if (stream.length === 0) return;
    let cancelled = false;
    historyApi.listMine(user.id).then((all) => {
      if (cancelled) return;
      const map = new Map(all.map((g) => [g.id, g]));
      setStream((prev) => {
        const next = prev
          .map((g) => map.get(g.id) ?? null)
          .filter((g): g is Generation => g !== null);
        if (next.length === prev.length && next.every((g, i) => g === prev[i])) {
          return prev;
        }
        return next;
      });
    });
    return () => { cancelled = true; };
    // intentionally don't depend on `stream` itself — we only want this to run
    // when reloadKey advances, otherwise we'd re-fetch on every local edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionsReloadKey]);

  // When ?s=<id> changes, load that session's stream. When ?s= goes away
  // (user clicked "新建创作"), clear the stream back to the blank greeting.
  React.useEffect(() => {
    if (!sessionId) {
      if (lastLoadedSessionRef.current) {
        setStream([]);
        setProgressMap({});
        lastLoadedSessionRef.current = null;
      }
      return;
    }
    if (lastLoadedSessionRef.current === sessionId) return;
    let cancelled = false;
    // 加载会话前先回收僵尸任务（同 image-to-video 处理）
    const reaped = historyApi.reapStaleRunningSync({ isLive: isJobLive, thresholdMin: 8 });
    if (reaped.length > 0) {
      bumpSessions();
    }
    sessionsApi.listGenerations(sessionId).then((list) => {
      if (cancelled) return;
      lastLoadedSessionRef.current = sessionId;
      // 切回会话时优先采用 live-jobs 模块里的实时数据（跨页面挂载也保留），
      // 让 storage 里的"running 0%"快照不会把活跃任务的进度覆盖回 0。
      setStream(list.map((g) => {
        const live = getLiveJob(g.id);
        return live && !live.done ? live.lastGen : g;
      }));
      setProgressMap(Object.fromEntries(list.map((g) => {
        if (g.status === "succeeded") return [g.id, 100];
        const live = getLiveJob(g.id);
        if (live) return [g.id, live.lastPct];
        return [g.id, 0];
      })));
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  // 订阅当前 stream 中所有还活着的 job —— 这样组件 unmount 后再 mount 也能继续吃进度
  React.useEffect(() => {
    const unsubs = stream
      .filter((g) => g.status === "running" && isJobLive(g.id))
      .map((g) => subscribeJob(g.id, (job) => {
        setProgressMap((m) => ({ ...m, [g.id]: job.lastPct }));
        if (job.done && job.finalGen) {
          setStream((s) => s.map((x) => x.id === g.id ? job.finalGen! : x));
        } else {
          setStream((s) => s.map((x) => x.id === g.id ? { ...x, ...job.lastGen, status: "running" } : x));
        }
      }));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.map((g) => g.id).join(",")]);

  const attachedSubjects = React.useMemo(() => {
    const found = new Map<string, Subject>();
    for (const s of allSubjects) {
      const re = new RegExp(`@${escapeRegExp(s.name)}(?=\\s|$)`);
      if (re.test(prompt)) found.set(s.id, s);
    }
    return Array.from(found.values());
  }, [prompt, allSubjects]);

  const buildFinalPrompt = (): string => {
    let p = prompt.trim();
    // Expand @-tokens so the upstream model has the full context. References
    // get expanded into "@参考图N (附件第 N 张)"; subjects get the description.
    for (let i = references.length - 1; i >= 0; i--) {
      const name = `参考图${i + 1}`;
      const re = new RegExp(`@${escapeRegExp(name)}(?=\\s|$)`, "g");
      p = p.replace(re, `@${name} (附件中的第 ${i + 1} 张参考图)`);
    }
    for (const s of attachedSubjects) {
      const re = new RegExp(`@${escapeRegExp(s.name)}(?=\\s|$)`, "g");
      p = p.replace(re, `@${s.name} (${s.description})`);
    }
    if (mode === "script") p = `[剧本模式 / 多镜头叙事]\n${p}`;
    if (references.length > 0) p = `${p}\n[附 ${references.length} 张参考图]`;
    return p;
  };

  const submit = () => {
    if (!user) return;
    if (!prompt.trim()) {
      toast.error("先写一段提示词或一段剧本吧");
      return;
    }

    // Ensure a session exists. Create lazily on the first turn of a brand-new
    // conversation; reuse it for subsequent turns.
    void (async () => {
      let sid = activeSessionId;
      if (!sid) {
        const created = await sessionsApi.create({
          userId: user.id,
          kind: "image",
          title: prompt.trim().slice(0, 30),
        });
        sid = created.id;
        setActiveSessionId(sid);
        lastLoadedSessionRef.current = sid;
        router.replace(`/app/text-to-image?s=${sid}`);
      }

      const job = gen.generateImage(
      {
        userId: user.id,
        sessionId: sid,
        modelId,
        prompt: buildFinalPrompt(),
        params: {
          size, batch, style,
          negativePrompt: negative.trim() || undefined,
          mode,
          references: references.length ? references : undefined,
          subjectIds: attachedSubjects.length ? attachedSubjects.map((s) => s.id) : undefined,
          extras: Object.keys(extras).length ? extras : undefined,
        },
      },
      (pct, g) => {
        setProgressMap((m) => ({ ...m, [g.id]: pct }));
        setStream((s) => s.map((x) => (x.id === g.id ? { ...x, ...g, status: "running" } : x)));
      },
    );
    cancelMap.current.set(job.id, job.cancel);

    // Append a placeholder running entry immediately
    queueMicrotask(() => {
      setStream((s) => [
        ...s,
        {
          id: job.id,
          userId: user.id,
          sessionId: sid ?? undefined,
          kind: "image",
          modelId,
          prompt: buildFinalPrompt(),
          status: "running",
          createdAt: new Date().toISOString(),
          imageParams: {
            size, batch, style,
            negativePrompt: negative.trim() || undefined,
            mode,
            references: references.length ? references : undefined,
            subjectIds: attachedSubjects.length ? attachedSubjects.map((s) => s.id) : undefined,
            extras: Object.keys(extras).length ? extras : undefined,
          },
        } as Generation,
      ]);
      setProgressMap((m) => ({ ...m, [job.id]: 0 }));
    });

    bumpSessions();

    job.promise.then((final) => {
      cancelMap.current.delete(final.id);
      setProgressMap((m) => ({ ...m, [final.id]: 100 }));
      setStream((s) => s.map((x) => (x.id === final.id ? final : x)));
      bumpSessions();
      if (final.status === "succeeded") toast.success("生成完成");
      else toast.error(final.errorMessage ?? "生成失败");
    });

    // Clear the prompt so the next message can be written
    setPrompt("");
    })(); // end async IIFE
  };

  const cancelLatest = async () => {
    const lastRunning = [...stream].reverse().find((g) => g.status === "running");
    if (!lastRunning) return;
    cancelMap.current.get(lastRunning.id)?.();
    cancelMap.current.delete(lastRunning.id);
    cancelLiveJob(lastRunning.id);
    // 强制写盘 failed —— 处理发起任务的标签页已关闭的僵尸
    const failed: Generation = {
      ...lastRunning,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "已取消",
    };
    await historyApi.update(failed);
    setStream((s) => s.map((g) => g.id === lastRunning.id ? failed : g));
    bumpSessions();
  };

  const rerun = (g: Generation) => {
    setPrompt(g.prompt.replace(/^\[剧本模式.*?\]\n/, "").replace(/\n\[附 \d+ 张参考图\]$/, ""));
    setModelId(g.modelId);
    if (g.imageParams) {
      setSize(g.imageParams.size);
      setBatch(g.imageParams.batch);
      setStyle(g.imageParams.style);
      setNegative(g.imageParams.negativePrompt ?? "");
      if (g.imageParams.mode) setMode(g.imageParams.mode);
      setReferences(g.imageParams.references ?? []);
      setExtras(g.imageParams.extras ?? {});
    }
    toast.message("已恢复参数，按下发送即可重跑");
  };

  const favorite = async (g: Generation) => {
    await historyApi.toggleFavorite(g.id);
    setStream((s) => s.map((x) => (x.id === g.id ? { ...x, favorite: !x.favorite } : x)));
    bumpSessions();
  };

  const remove = async (g: Generation) => {
    if (g.status === "running") {
      cancelMap.current.get(g.id)?.();
      cancelMap.current.delete(g.id);
      cancelLiveJob(g.id);
    }
    await historyApi.remove(g.id);
    setStream((s) => s.filter((x) => x.id !== g.id));
    bumpSessions();
    toast.success("已删除");
  };

  // Auto-scroll the stream container to bottom whenever it grows or the
  // last running item's progress advances.
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const lastLength = React.useRef(0);
  React.useEffect(() => {
    if (!scrollerRef.current) return;
    if (stream.length !== lastLength.current) {
      lastLength.current = stream.length;
      scrollerRef.current.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [stream.length]);

  // Also scroll to the running item's bottom as progress updates so users
  // see the loading card stay in view, but only if user is already near bottom.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !anyRunning) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [progressMap, anyRunning]);

  const composer = (
    <CenterComposer
      prompt={prompt}
      onPromptChange={setPrompt}
      mode={mode}
      onModeChange={setMode}
      modelId={modelId}
      onModelChange={setModelId}
      size={size}
      onSizeChange={setSize}
      batch={batch}
      onBatchChange={setBatch}
      style={style}
      onStyleChange={setStyle}
      negative={negative}
      onNegativeChange={setNegative}
      references={references}
      onReferencesChange={setReferences}
      extras={extras}
      onExtrasChange={setExtras}
      attachedSubjects={attachedSubjects}
      allSubjects={allSubjects}
      onSubjectsChanged={() => setSubjectReloadKey((k) => k + 1)}
      isRunning={anyRunning}
      onSubmit={submit}
      onCancel={cancelLatest}
    />
  );

  // Empty state — centered greeting + composer
  if (stream.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 py-10">
          <div className="mb-10 text-center">
            <h1 className="font-display text-4xl tracking-tight md:text-5xl">
              今天创作点
              <span className="bg-gradient-to-br from-brand-300 via-brand-500 to-aurora-400 bg-clip-text text-transparent">
                {" "}什么{" "}
              </span>
              ？
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              输入想法或一段剧本，按下发送 · Lumen 会把它点亮
            </p>
          </div>
          <div className="w-full">{composer}</div>
        </div>
      </div>
    );
  }

  // Conversation stream — list of generation cards above, composer pinned at bottom
  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-10 px-6 pb-10 pt-10">
          {stream.map((g) => (
            <ImageResultGrid
              key={g.id}
              current={g}
              progress={progressMap[g.id] ?? 0}
              onCancel={g.status === "running" ? cancelLatest : undefined}
              onRerun={rerun}
              onFavorite={favorite}
              onDelete={remove}
              onUsePrompt={(p) => setPrompt(p)}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl px-6 py-4">{composer}</div>
      </div>
    </div>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
