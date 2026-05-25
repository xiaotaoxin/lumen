"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { VideoComposer } from "@/components/workspace/video-composer";
import { VideoResultCard } from "@/components/workspace/video-result-card";
import { PipelineGuide } from "@/components/workspace/pipeline-guide";
import { findModel, useVideoModels } from "@/lib/catalog";
import { resolveVideoSpec, snapVideoParamsToSpec, defaultExtras } from "@/lib/providers/capabilities";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSessionsStore } from "@/lib/store/sessions-store";
import * as gen from "@/lib/api/generate";
import * as historyApi from "@/lib/api/history";
import * as sessionsApi from "@/lib/api/sessions";
import * as subjectsApi from "@/lib/api/subjects";
import { cancelLiveJob, getLiveJob, isJobLive, subscribeJob } from "@/lib/live-jobs";
import type { Generation, Subject, VideoParams, VideoReferenceMode } from "@/lib/types";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function ImageToVideoPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-muted-foreground">载入中…</div>}>
      <ImageToVideoInner />
    </Suspense>
  );
}

function ImageToVideoInner() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const search = useSearchParams();
  const sessionId = search.get("s");
  const bumpSessions = useSessionsStore((s) => s.bump);
  const sessionsReloadKey = useSessionsStore((s) => s.reloadKey);

  // Sync activeSessionId with the URL via React 19 prev-prop-during-render
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(sessionId);
  const [lastUrlSessionId, setLastUrlSessionId] = React.useState(sessionId);
  if (lastUrlSessionId !== sessionId) {
    setLastUrlSessionId(sessionId);
    setActiveSessionId(sessionId);
  }

  // Composer state
  const [prompt, setPrompt] = React.useState("");
  const videoModels = useVideoModels();
  const [modelId, setModelId] = React.useState(() => videoModels[0]?.id ?? "");
  const [duration, setDuration] = React.useState<VideoParams["duration"]>(5);
  const [resolution, setResolution] = React.useState<VideoParams["resolution"]>("720p");
  const [camera, setCamera] = React.useState<VideoParams["camera"]>("static");
  const [references, setReferences] = React.useState<string[]>([]);
  const [referenceMode, setReferenceMode] = React.useState<VideoReferenceMode>("first-last");
  const [allSubjects, setAllSubjects] = React.useState<Subject[]>([]);

  // 加载主体库
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    subjectsApi.listMine(user.id).then((list) => {
      if (cancelled) return;
      setAllSubjects(list);
    });
    return () => { cancelled = true; };
  }, [user]);

  // 扫描 prompt，找出当前已 @ 的主体
  const attachedSubjects = React.useMemo(() => {
    const found = new Map<string, Subject>();
    for (const s of allSubjects) {
      const re = new RegExp(`@${escapeRegExp(s.name)}(?=\\s|$)`);
      if (re.test(prompt)) found.set(s.id, s);
    }
    return Array.from(found.values());
  }, [prompt, allSubjects]);
  const [negative, setNegative] = React.useState<string>("");
  const [seed, setSeed] = React.useState<number | undefined>();
  const [extras, setExtras] = React.useState<Record<string, unknown>>({});

  // Capability spec for the currently selected video model
  const currentModel = React.useMemo(
    () => videoModels.find((m) => m.id === modelId) ?? findModel(modelId),
    [modelId, videoModels],
  );
  const spec = React.useMemo(() => resolveVideoSpec(currentModel), [currentModel]);

  // Snap incompatible state when model changes (React 19 prev-prop pattern)
  const [lastSpecModelId, setLastSpecModelId] = React.useState(modelId);
  if (lastSpecModelId !== modelId) {
    setLastSpecModelId(modelId);
    const snapped = snapVideoParamsToSpec(spec, {
      duration, resolution, camera,
      referenceImageUrl: references[0],
      endFrameUrl: referenceMode === "first-last" ? references[1] : undefined,
    });
    if (snapped.duration !== duration) setDuration(snapped.duration);
    if (snapped.resolution !== resolution) setResolution(snapped.resolution);
    if (snapped.camera !== camera) setCamera(snapped.camera);
    if (!spec.supportsNegativePrompt) setNegative("");
    if (!spec.supportsSeed) setSeed(undefined);
    setExtras(defaultExtras(spec));
  }

  // Conversation stream
  const [stream, setStream] = React.useState<Generation[]>([]);
  const [progressMap, setProgressMap] = React.useState<Record<string, number>>({});
  const cancelMap = React.useRef<Map<string, () => void>>(new Map());
  const lastLoadedSessionRef = React.useRef<string | null>(null);

  const anyRunning = stream.some((g) => g.status === "running");

  // Sync the stream with storage on external bumps (e.g., sidebar delete).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionsReloadKey]);

  // ?s=<id> → load that session's full conversation
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
    // 加载会话前先回收僵尸任务：超时的 running 自动标 failed，
    // 避免 UI 上永远显示 "0% 生成中" 的死任务。
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
    // 用 id 列表当 dep —— 进度变化不会触发重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.map((g) => g.id).join(",")]);

  const submit = () => {
    if (!user) return;
    const refRequired = spec.requiresReferenceImage === true;
    if (refRequired && references.length === 0) {
      toast.error(`${currentModel?.name ?? "当前模型"} 仅支持图生视频，请先上传至少一张参考图`);
      return;
    }
    if (!prompt.trim()) {
      toast.error("写一句镜头/动作描述");
      return;
    }
    // 把 @ token 在送给上游前展开成完整描述，让模型有上下文。
    // 老 prompt 里仍保留 @名字（短显示用），这里只是给 adapter 看的最终 prompt。
    let finalPrompt = prompt.trim();
    for (let i = references.length - 1; i >= 0; i--) {
      const name = `参考图${i + 1}`;
      const re = new RegExp(`@${escapeRegExp(name)}(?=\\s|$)`, "g");
      finalPrompt = finalPrompt.replace(re, `@${name} (附件中的第 ${i + 1} 张参考图)`);
    }
    for (const s of attachedSubjects) {
      const re = new RegExp(`@${escapeRegExp(s.name)}(?=\\s|$)`, "g");
      finalPrompt = finalPrompt.replace(re, `@${s.name} (${s.description})`);
    }
    // Ensure a session exists. Create lazily on the first turn.
    void (async () => {
      let sid = activeSessionId;
      if (!sid) {
        const created = await sessionsApi.create({
          userId: user.id,
          kind: "video",
          title: prompt.trim().slice(0, 30),
        });
        sid = created.id;
        setActiveSessionId(sid);
        lastLoadedSessionRef.current = sid;
        router.replace(`/app/image-to-video?s=${sid}`);
      }

      const job = gen.generateVideo(
      {
        userId: user.id,
        sessionId: sid,
        modelId,
        prompt: finalPrompt,   // ← 展开 @ token 后的版本送给 adapter
        params: {
          duration, resolution, camera,
          // 兼容旧 adapter：references[0] 当首帧，first-last 模式下 references[1] 当尾帧
          referenceImageUrl: references[0],
          endFrameUrl: referenceMode === "first-last" ? references[1] : undefined,
          references,
          referenceMode,
          subjectIds: attachedSubjects.length ? attachedSubjects.map((s) => s.id) : undefined,
          negativePrompt: negative.trim() || undefined,
          seed,
          extras: Object.keys(extras).length ? extras : undefined,
        },
      },
      (pct, g) => {
        setProgressMap((m) => ({ ...m, [g.id]: pct }));
        setStream((s) => s.map((x) => (x.id === g.id ? { ...x, ...g, status: "running" } : x)));
      },
    );
    cancelMap.current.set(job.id, job.cancel);

    queueMicrotask(() => {
      setStream((s) => [
        ...s,
        {
          id: job.id,
          userId: user.id,
          sessionId: sid ?? undefined,
          kind: "video",
          modelId,
          prompt: finalPrompt,
          status: "running",
          createdAt: new Date().toISOString(),
          videoParams: {
            duration, resolution, camera,
            referenceImageUrl: references[0],
            endFrameUrl: referenceMode === "first-last" ? references[1] : undefined,
            references,
            referenceMode,
            negativePrompt: negative.trim() || undefined,
            seed,
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
      if (final.status === "succeeded") toast.success("视频生成完成（演示无真实视频流）");
      else toast.error(final.errorMessage ?? "生成失败");
    });

    setPrompt("");
    })(); // end async IIFE
  };

  const cancelLatest = async () => {
    const lastRunning = [...stream].reverse().find((g) => g.status === "running");
    if (!lastRunning) return;
    // 1) 同标签页内的 in-flight job：触发 AbortController
    cancelMap.current.get(lastRunning.id)?.();
    cancelMap.current.delete(lastRunning.id);
    // 2) 跨组件挂载的 live-jobs 注册表：也触发它持有的 cancel
    cancelLiveJob(lastRunning.id);
    // 3) 强制写盘 failed —— 处理僵尸：发起任务的标签页已经关掉、
    //    Promise 永远不会到 catch，storage 里仍然是 running。
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
    setPrompt(g.prompt);
    setModelId(g.modelId);
    if (g.videoParams) {
      setDuration(g.videoParams.duration);
      setResolution(g.videoParams.resolution);
      setCamera(g.videoParams.camera);
      // 优先用新 references 字段；回退兼容老 referenceImageUrl + endFrameUrl
      if (g.videoParams.references && g.videoParams.references.length > 0) {
        setReferences(g.videoParams.references);
      } else {
        const legacy = [g.videoParams.referenceImageUrl, g.videoParams.endFrameUrl].filter(Boolean) as string[];
        setReferences(legacy);
      }
      setReferenceMode(g.videoParams.referenceMode ?? (g.videoParams.endFrameUrl ? "first-last" : "universal"));
      setNegative(g.videoParams.negativePrompt ?? "");
      setSeed(g.videoParams.seed);
      setExtras(g.videoParams.extras ?? {});
    }
    toast.message("已恢复参数，按下发送即可重跑");
  };

  const favorite = async (g: Generation) => {
    await historyApi.toggleFavorite(g.id);
    setStream((s) => s.map((x) => (x.id === g.id ? { ...x, favorite: !x.favorite } : x)));
    bumpSessions();
  };

  const remove = async (g: Generation) => {
    // 删除 running 时同步停掉活跃 job，避免后台继续轮询
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

  // Auto-scroll
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

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !anyRunning) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [progressMap, anyRunning]);

  const composer = (
    <VideoComposer
      prompt={prompt}
      onPromptChange={setPrompt}
      modelId={modelId}
      onModelChange={setModelId}
      duration={duration}
      onDurationChange={setDuration}
      resolution={resolution}
      onResolutionChange={setResolution}
      camera={camera}
      onCameraChange={setCamera}
      references={references}
      onReferencesChange={setReferences}
      referenceMode={referenceMode}
      onReferenceModeChange={setReferenceMode}
      attachedSubjects={attachedSubjects}
      allSubjects={allSubjects}
      extras={extras}
      onExtrasChange={setExtras}
      negative={negative}
      onNegativeChange={setNegative}
      seed={seed}
      onSeedChange={setSeed}
      isRunning={anyRunning}
      onSubmit={submit}
      onCancel={cancelLatest}
    />
  );

  if (stream.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 py-10">
          <div className="mb-10 text-center">
            <h1 className="font-display text-4xl tracking-tight md:text-5xl">
              让一张图
              <span className="bg-gradient-to-br from-aurora-300 via-aurora-400 to-brand-500 bg-clip-text text-transparent">
                {" "}动起来{" "}
              </span>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              上传一张静帧 + 一段镜头描述 · Lumen 把它延展成短视频
            </p>
          </div>
          <div className="w-full">{composer}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PipelineGuide />
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-10 px-6 pb-10 pt-10">
          {stream.map((g) => (
            <VideoResultCard
              key={g.id}
              current={g}
              progress={progressMap[g.id] ?? 0}
              onCancel={g.status === "running" ? cancelLatest : undefined}
              onRerun={rerun}
              onFavorite={favorite}
              onDelete={remove}
              onUsePrompt={(p) => setPrompt(p)}
              onUseFrameAsReference={(dataUrl, kind) => {
                // 把帧作为参考图加进 composer 的 references 数组
                // 首帧 → 插入到 0 位置；尾帧 → 追加到末尾；当前帧 → 追加到末尾
                if (referenceMode !== "first-last") setReferenceMode("first-last");
                setReferences((arr) => {
                  if (kind === "first") {
                    return [dataUrl, ...arr.filter((_, i) => i !== 0)].slice(0, 9);
                  }
                  if (kind === "last") {
                    if (arr.length === 0) return [dataUrl];
                    return [arr[0], dataUrl];
                  }
                  return [...arr, dataUrl].slice(0, 9);
                });
              }}
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
