"use client";

import * as React from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
  ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Clapperboard, ImageIcon, ImagePlus, Loader2, MousePointerClick,
  Pencil, Plus, Type, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageNode } from "./nodes/image-node";
import { VideoNode } from "./nodes/video-node";
import { TextNode } from "./nodes/text-node";
import { UploadNode } from "./nodes/upload-node";
import { DirectorStageNode } from "./nodes/director-stage-node";
import { AddNodePanel, type AddNodeAction, type TemplateId } from "./add-node-panel";
import * as directorStagesApi from "@/lib/api/director-stages";
import { useAuthStore } from "@/lib/store/auth-store";
import * as canvasesApi from "@/lib/api/canvases";
import * as gen from "@/lib/api/generate";
import * as subjectsApi from "@/lib/api/subjects";
import { findModel, useImageModels, useVideoModels } from "@/lib/catalog";
import { useSpaceToPan } from "@/lib/hooks/use-space-to-pan";
import { shortId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type {
  CanvasDoc, CanvasNode as DocNode, CanvasNodeData, CanvasNodeKind,
  CanvasNodeStatus, GenerationStatus,
} from "@/lib/types";

interface Props {
  canvasId: string;
}

const NODE_TYPES = {
  image: ImageNode,
  video: VideoNode,
  text: TextNode,
  upload: UploadNode,
  "director-stage": DirectorStageNode,
} as const;

function mapStatus(g: GenerationStatus): CanvasNodeStatus {
  if (g === "queued" || g === "running") return "running";
  return g;
}

export function CanvasEditor({ canvasId }: Props) {
  return (
    <ReactFlowProvider>
      <CanvasEditorInner canvasId={canvasId} />
    </ReactFlowProvider>
  );
}

function CanvasEditorInner({ canvasId }: Props) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const rf = useReactFlow();
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const spaceDown = useSpaceToPan();
  const imageModels = useImageModels();
  const videoModels = useVideoModels();

  const [doc, setDoc] = React.useState<CanvasDoc | null>(null);
  const [nodes, setNodes] = React.useState<Node<CanvasNodeData>[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const cancelMap = React.useRef<Map<string, () => void>>(new Map());

  // Add-node panel popup state. `sourceNodeId` is set when the user dragged
  // a connection from a node's handle and dropped on empty canvas — picking a
  // node from the panel will both create it AND wire it to the source.
  const [addPanel, setAddPanel] = React.useState<
    | { kind: "rail" }
    | {
        kind: "anchored";
        screenX: number; screenY: number;
        flowX: number; flowY: number;
        sourceNodeId?: string;
      }
    | null
  >(null);

  // Tracks the node that initiated an in-progress connection drag.
  const connectingFromNodeId = React.useRef<string | null>(null);
  // Tells `onPaneClick` to ignore the very next click — used right after
  // we open the add-node panel from a connection drop, otherwise the same
  // mouseup that ended the drag also fires onPaneClick and wipes the panel.
  const skipNextPaneClick = React.useRef(false);

  // 标记画布是否已经从 localStorage 加载完成。
  // 必须有这个 ref —— 否则初始 nodes=[] 时 useEffect 已经把 flushSave 排队，
  // 异步 get 完成后 setNodes 触发 cleanup（捕获旧的 nodes=[] 闭包），
  // 反向把刚加载的内容覆盖成空数组。
  const loadedRef = React.useRef(false);

  // Load canvas on mount
  React.useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    canvasesApi.get(canvasId).then((d) => {
      if (cancelled || !d) return;
      setDoc(d);
      setTitleDraft(d.title);
      setNodes(d.nodes.map(toFlowNode));
      setEdges(d.edges.map(toFlowEdge));
      // 必须放在 setNodes/setEdges 之后；下一轮 useEffect 重跑时 loadedRef 已为 true
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [canvasId]);

  // Debounced save 600ms。注意：debounce 必须配 flush-on-unmount，否则用户在
  // 600ms 窗口内切走 tab、组件卸载、定时器抛弃，这次改动就永久丢了。
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 立即把当前 nodes/edges/viewport 同步落盘 */
  const flushSave = React.useCallback(() => {
    const vp = rf.getViewport();
    const cover = nodes
      .map((n) => n.data)
      .find((d) => d.kind === "image" && d.status === "succeeded" && d.imageUrls?.[0])
      ?.imageUrls?.[0];
    canvasesApi.saveSync(canvasId, {
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport: vp,
      coverUrl: cover,
    });
  }, [canvasId, nodes, edges, rf]);

  const queueSave = React.useCallback(() => {
    if (!loadedRef.current) return;   // 还没加载完，不要写
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushSave();
    }, 600);
  }, [flushSave]);

  React.useEffect(() => {
    queueSave();
    // useEffect cleanup 在【下一次 effect 运行前】或【组件卸载时】触发。
    // 卸载时立即 flush，防止 600ms 防抖窗口内切 tab 导致状态丢失。
    // 关键：只在已加载完后才 flush —— 否则 cleanup 闭包里的旧 nodes=[] 会
    // 反向把刚加载的内容写成空。
    return () => {
      if (saveTimer.current && loadedRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        flushSave();
      } else if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [nodes, edges, queueSave, flushSave]);

  // 标签页隐藏 / 浏览器即将卸载 时立即 flush（同样要求已加载完）
  React.useEffect(() => {
    const onHide = () => {
      if (saveTimer.current && loadedRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        flushSave();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [flushSave]);

  /* ─── Mutators ─── */

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns) as Node<CanvasNodeData>[]),
    [],
  );
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = React.useCallback((params: Connection) => {
    setEdges((es) => addEdge({ ...params, animated: true }, es));
  }, []);

  /* ─── Drag a connection from a handle and drop on empty canvas ─── */

  const onConnectStart = React.useCallback(
    (_: unknown, params: { nodeId: string | null }) => {
      connectingFromNodeId.current = params.nodeId;
    },
    [],
  );

  const onConnectEnd = React.useCallback(
    (
      event: MouseEvent | TouchEvent,
      connectionState: {
        isValid?: boolean | null;
        fromNode?: { id: string } | null;
      },
    ) => {
      // xyflow v12: when the drag ends on a real handle, isValid === true and
      // onConnect already added the edge. We only act on the falsy cases
      // (`false` = invalid handle, `null/undefined` = dropped on empty pane).
      if (connectionState?.isValid) {
        connectingFromNodeId.current = null;
        return;
      }
      // Prefer the source node id from connectionState (authoritative); fall
      // back to the ref captured in onConnectStart.
      const sourceId = connectionState?.fromNode?.id ?? connectingFromNodeId.current;
      connectingFromNodeId.current = null;
      if (!sourceId) return;

      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const clientX = "clientX" in event
        ? event.clientX
        : event.changedTouches?.[0]?.clientX ?? 0;
      const clientY = "clientY" in event
        ? event.clientY
        : event.changedTouches?.[0]?.clientY ?? 0;
      const flow = rf.screenToFlowPosition({ x: clientX, y: clientY });
      skipNextPaneClick.current = true;
      setAddPanel({
        kind: "anchored",
        screenX: clientX - rect.left,
        screenY: clientY - rect.top,
        flowX: flow.x,
        flowY: flow.y,
        sourceNodeId: sourceId,
      });
    },
    [rf],
  );

  const updateNodeData = React.useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      );
    },
    [],
  );

  const deleteNode = React.useCallback((id: string) => {
    cancelMap.current.get(id)?.();
    cancelMap.current.delete(id);
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  /* ─── Generation ─── */

  const startImageGeneration = React.useCallback(
    (
      nodeId: string,
      prompt: string,
      modelId: string,
      params?: Partial<NonNullable<CanvasNodeData["imageParams"]>>,
    ) => {
      if (!user) return;
      const job = gen.generateImage(
        {
          userId: user.id,
          modelId,
          prompt,
          params: {
            size: params?.size ?? "1024x1024",
            batch: (params?.batch ?? 1) as 1 | 2 | 3 | 4,
            style: params?.style ?? "general",
            negativePrompt: params?.negativePrompt,
            seed: params?.seed,
          },
        },
        (pct) => updateNodeData(nodeId, { status: "running", progress: pct }),
      );
      cancelMap.current.set(nodeId, job.cancel);
      updateNodeData(nodeId, {
        generationId: job.id,
        status: "running",
        progress: 0,
        errorMessage: undefined,
        imageParams: { ...params },
      });
      job.promise.then((final) => {
        cancelMap.current.delete(nodeId);
        updateNodeData(nodeId, {
          status: mapStatus(final.status),
          progress: 100,
          imageUrls: final.imageUrls,
          errorMessage: final.errorMessage,
        });
      });
    },
    [user, updateNodeData],
  );

  const startVideoGeneration = React.useCallback(
    (nodeId: string, prompt: string, modelId: string, referenceImageUrl: string) => {
      if (!user) return;
      const job = gen.generateVideo(
        {
          userId: user.id,
          modelId,
          prompt,
          params: { duration: 5, resolution: "720p", camera: "static", referenceImageUrl },
        },
        (pct) => updateNodeData(nodeId, { status: "running", progress: pct }),
      );
      cancelMap.current.set(nodeId, job.cancel);
      updateNodeData(nodeId, { generationId: job.id, status: "running", progress: 0, errorMessage: undefined });
      job.promise.then((final) => {
        cancelMap.current.delete(nodeId);
        updateNodeData(nodeId, {
          status: mapStatus(final.status),
          progress: 100,
          videoPosterUrl: final.videoPosterUrl,
          videoUrl: final.videoUrl,
          errorMessage: final.errorMessage,
        });
      });
    },
    [user, updateNodeData],
  );

  /* ─── Resolve upstream input image for a node id ─── */

  const resolveInputImage = React.useCallback(
    (nodeId: string): string | undefined => {
      const upstream = edges.find((e) => e.target === nodeId);
      if (!upstream) return undefined;
      const src = nodes.find((x) => x.id === upstream.source);
      return src?.data.imageUrls?.[0];
    },
    [edges, nodes],
  );

  /* ─── Add new node at given flow position ─── */

  const addNode = React.useCallback(
    (kind: CanvasNodeKind, flowPos: { x: number; y: number }, opts?: { autoStart?: boolean }) => {
      const id = shortId("n_");
      const defaultModel = (kind === "video" ? videoModels : imageModels)[0]?.id ?? "";
      const newNode: Node<CanvasNodeData> = {
        id,
        type: kind,
        position: { x: flowPos.x - 144, y: flowPos.y - 80 },
        data: {
          kind,
          prompt: "",
          modelId: kind === "image" || kind === "video" ? defaultModel : "",
          status: "idle",
          progress: 0,
          ...(kind === "image"
            ? { imageParams: { size: "1024x1024", batch: 1, style: "general" } }
            : {}),
        },
      };
      setNodes((ns) => [...ns, newNode]);
      if (opts?.autoStart && kind === "image") {
        // No prompt yet — handled by onGenerate wrapper; nothing to do here
      }
      return id;
    },
    [imageModels, videoModels],
  );

  /* ─── Insert a template (multi-node chain). Returns the "head" node id —
        i.e. the leftmost node that should accept any pending upstream edge. ─── */

  const insertTemplate = React.useCallback(
    (id: TemplateId, flowPos: { x: number; y: number }): string => {
      const NODE_W = 288, GAP = 80;
      switch (id) {
        case "text-to-image":
          return addNode("image", flowPos);
        case "image-to-video": {
          const imgId = addNode("image", { x: flowPos.x - (NODE_W / 2 + GAP / 2), y: flowPos.y });
          const vidId = addNode("video", { x: flowPos.x + (NODE_W / 2 + GAP / 2), y: flowPos.y });
          setTimeout(() => {
            setEdges((es) => addEdge({ source: imgId, target: vidId, sourceHandle: null, targetHandle: null, animated: true } as Connection, es));
          }, 0);
          return imgId;
        }
        case "text-to-video": {
          const txtId = addNode("text", { x: flowPos.x - (NODE_W + GAP), y: flowPos.y });
          const imgId = addNode("image", { x: flowPos.x, y: flowPos.y });
          const vidId = addNode("video", { x: flowPos.x + (NODE_W + GAP), y: flowPos.y });
          setTimeout(() => {
            setEdges((es) => {
              let next = es;
              next = addEdge({ source: txtId, target: imgId, sourceHandle: null, targetHandle: null, animated: true } as Connection, next);
              next = addEdge({ source: imgId, target: vidId, sourceHandle: null, targetHandle: null, animated: true } as Connection, next);
              return next;
            });
          }, 0);
          return txtId;
        }
      }
    },
    [addNode],
  );

  /* ─── Pick handler from AddNodePanel ─── */

  const handleAddNodeAction = React.useCallback(
    (action: AddNodeAction, atFlowPos?: { x: number; y: number }, sourceNodeId?: string) => {
      const vp = rf.getViewport();
      const fallbackPos = atFlowPos ?? {
        x: (window.innerWidth / 2 - vp.x) / vp.zoom,
        y: (window.innerHeight / 2 - vp.y) / vp.zoom,
      };
      const newId = action.kind === "template"
        ? insertTemplate(action.templateId, fallbackPos)
        : addNode(action.kind, fallbackPos);

      if (sourceNodeId && newId) {
        // Wire upstream → freshly-created head node
        setTimeout(() => {
          setEdges((es) => addEdge(
            { source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null, animated: true } as Connection,
            es,
          ));
        }, 0);
      }
      setAddPanel(null);
    },
    [rf, addNode, insertTemplate],
  );

  /* ─── Auto-trigger video gen when input image becomes ready ─── */

  React.useEffect(() => {
    for (const e of edges) {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);
      if (!src || !tgt) continue;
      if (tgt.data.kind !== "video") continue;
      if (tgt.data.status !== "idle") continue;
      if (!tgt.data.prompt.trim()) continue; // need a prompt too
      const refUrl =
        src.data.kind === "image" || src.data.kind === "upload"
          ? src.data.imageUrls?.[0]
          : undefined;
      if (!refUrl) continue;
      // 响应图形状态变化，触发副作用——这是 effect 的合法用法
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startVideoGeneration(tgt.id, tgt.data.prompt, tgt.data.modelId, refUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, nodes]);

  /* ─── Inject per-node callbacks before passing to xyflow ─── */

  const nodesWithCallbacks = React.useMemo<Node<CanvasNodeData>[]>(() => {
    return nodes.map((n) => {
      const baseExtra: Record<string, unknown> = {
        onDelete: () => deleteNode(n.id),
        onPromptChange: (p: string) => updateNodeData(n.id, { prompt: p }),
        onModelChange: (m: string) => updateNodeData(n.id, { modelId: m }),
      };
      if (n.data.kind === "image") {
        baseExtra.onParamsChange = (patch: Partial<NonNullable<CanvasNodeData["imageParams"]>>) => {
          updateNodeData(n.id, {
            imageParams: { ...n.data.imageParams, ...patch },
          });
        };
        baseExtra.onGenerate = () => {
          if (!n.data.prompt.trim()) {
            toast.error("先写一段提示词");
            return;
          }
          startImageGeneration(n.id, n.data.prompt, n.data.modelId, n.data.imageParams);
        };
        // Quick-action variants (上方工具栏的 6 个按钮)：把变体语义映射到
        // prompt 后缀 + params 覆盖，重跑生成。一处改文案 / 一处改参数，
        // 而不是 6 个 onClick 各自实现，方便将来接真模型时把每条独立换掉。
        baseExtra.onQuickGenerate = (opts: {
          promptAppend?: string;
          paramsOverride?: Partial<NonNullable<CanvasNodeData["imageParams"]>>;
          persistAppend?: boolean;
        }) => {
          if (!n.data.prompt.trim()) {
            toast.error("先写一段提示词");
            return;
          }
          const finalPrompt = opts.promptAppend
            ? `${n.data.prompt}${opts.promptAppend}`
            : n.data.prompt;
          const mergedParams = { ...n.data.imageParams, ...opts.paramsOverride };
          if (opts.persistAppend) {
            updateNodeData(n.id, { prompt: finalPrompt, imageParams: mergedParams });
          } else {
            updateNodeData(n.id, { imageParams: mergedParams });
          }
          startImageGeneration(n.id, finalPrompt, n.data.modelId, mergedParams);
        };
        baseExtra.onSaveAsSubject = async (subjectName: string) => {
          if (!user) return;
          const url = n.data.imageUrls?.[0];
          if (!url) {
            toast.error("还没有可存的图像");
            return;
          }
          try {
            await subjectsApi.create(user.id, {
              name: subjectName.trim(),
              description: n.data.prompt.slice(0, 200),
              imageUrl: url,
              tags: ["从画布"],
            });
            toast.success(`已存入主体库：@${subjectName.trim()}`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "存入失败");
          }
        };
        baseExtra.onSetUploadedImage = (url: string) => {
          updateNodeData(n.id, {
            imageUrls: [url],
            status: "succeeded",
            progress: 100,
          });
        };
        baseExtra.onSendToVideo = () => {
          const url = n.data.imageUrls?.[0];
          if (!url) {
            toast.error("还没有可送的图像");
            return;
          }
          // Place a new video node to the right of this image node, then wire
          const NODE_W = 320, GAP = 80;
          const targetPos = { x: n.position.x + NODE_W + GAP, y: n.position.y };
          const vidId = addNode("video", {
            x: targetPos.x + NODE_W / 2,
            y: targetPos.y + 80,
          });
          setTimeout(() => {
            setEdges((es) => addEdge(
              { source: n.id, target: vidId, sourceHandle: null, targetHandle: null, animated: true } as Connection,
              es,
            ));
          }, 0);
          toast.success("已添加视频节点 · 写下镜头描述后按生成");
        };
      } else if (n.data.kind === "video") {
        baseExtra.inputImageUrl = resolveInputImage(n.id);
        baseExtra.onGenerate = () => {
          const ref = resolveInputImage(n.id);
          if (!ref) {
            toast.error("请先从左侧连入一张图像");
            return;
          }
          if (!n.data.prompt.trim()) {
            toast.error("先写一句镜头/动作描述");
            return;
          }
          startVideoGeneration(n.id, n.data.prompt, n.data.modelId, ref);
        };
      } else if (n.data.kind === "upload") {
        baseExtra.onImageChange = (url?: string) => {
          updateNodeData(n.id, {
            imageUrls: url ? [url] : undefined,
            status: url ? "succeeded" : "idle",
          });
        };
      } else if (n.data.kind === "director-stage") {
        baseExtra.onOpen = () => {
          if (!user) return;
          // 懒创建 DirectorStageDoc：第一次打开时建一份
          let dirId = n.data.directorStageId;
          if (!dirId) {
            const doc = directorStagesApi.createSync({
              userId: user.id,
              canvasNodeId: n.id,
              title: n.data.prompt || "导演台",
            });
            dirId = doc.id;
            updateNodeData(n.id, { directorStageId: dirId });
          }
          router.push(`/app/director/${dirId}?back=/app/canvas/${canvasId}`);
        };
      }
      return { ...n, data: { ...n.data, ...baseExtra } as CanvasNodeData };
    });
  }, [nodes, edges, user, canvasId, router, deleteNode, updateNodeData, startImageGeneration, startVideoGeneration, resolveInputImage, addNode]);

  /* ─── Title ─── */

  const saveTitle = async () => {
    if (!doc) return;
    const t = titleDraft.trim() || "未命名画布";
    if (t !== doc.title) {
      await canvasesApi.rename(doc.id, t);
      setDoc({ ...doc, title: t });
    }
    setTitleEditing(false);
  };

  /* ─── Pane double-click → open panel anchored at click position ─── */

  const onPaneDoubleClick = React.useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const flow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setAddPanel({ kind: "anchored", screenX, screenY, flowX: flow.x, flowY: flow.y });
    },
    [rf],
  );

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />载入画布…
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative h-full w-full",
        spaceDown ? "canvas-pan-cursor" : "canvas-default-cursor",
      )}
    >
      {/* Top-left bar */}
      <div className="pointer-events-none absolute left-20 top-4 z-10 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="pointer-events-auto"
          onClick={() => router.push("/app/canvas")}
        >
          <ArrowLeft className="size-4" />
          返回
        </Button>
        {titleEditing ? (
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-sm">
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") { setTitleDraft(doc.title); setTitleEditing(false); }
              }}
              className="h-7 w-56 text-sm"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setTitleEditing(true)}
            className="pointer-events-auto group flex items-center gap-1.5 rounded-lg border border-transparent bg-card/80 px-3 py-1.5 text-sm font-medium backdrop-blur hover:border-border"
          >
            <span className="font-display tracking-tight">{doc.title}</span>
            <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onMoveEnd={() => queueSave()}
        onDoubleClick={onPaneDoubleClick}
        onPaneClick={() => {
          if (skipNextPaneClick.current) {
            skipNextPaneClick.current = false;
            return;
          }
          setAddPanel(null);
        }}
        // Space-to-pan: hold space → drag canvas to pan; otherwise canvas
        // drag is disabled (clicks still work for deselect / double-click add).
        panOnDrag={spaceDown ? [0] : false}
        nodesDraggable={!spaceDown}
        nodeTypes={NODE_TYPES}
        defaultViewport={doc.viewport}
        fitView={doc.nodes.length > 0}
        fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={3}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background gap={24} size={1} className="bg-background" />
        <Controls
          className="!border !border-border !bg-card !shadow-md [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground hover:[&>button]:!bg-secondary"
          showInteractive={false}
        />
        <MiniMap
          pannable zoomable
          className="!border !border-border !bg-card"
          nodeColor={(n) => {
            const data = n.data as CanvasNodeData;
            if (data.kind === "video") return "oklch(0.78 0.15 195)";
            if (data.kind === "text") return "oklch(0.55 0.02 80)";
            if (data.kind === "upload") return "oklch(0.86 0.14 75)";
            return "oklch(0.74 0.18 65)";
          }}
        />
      </ReactFlow>

      {/* Left tool rail */}
      <CanvasLeftRail
        active={addPanel?.kind === "rail"}
        onToggleAdd={() => setAddPanel((p) => p?.kind === "rail" ? null : { kind: "rail" })}
        onQuickAdd={(kind) => handleAddNodeAction({ kind } as AddNodeAction)}
      />

      {/* Add-node panel — rail mode (anchored to left rail) */}
      {addPanel?.kind === "rail" && (
        <div className="absolute left-16 top-32 z-20">
          <AddNodePanel onPick={(action) => handleAddNodeAction(action)} />
        </div>
      )}

      {/* Add-node panel — anchored mode (double-click OR drop-end of connection drag) */}
      {addPanel?.kind === "anchored" && (
        <div
          className="absolute z-20"
          style={{ left: addPanel.screenX, top: addPanel.screenY }}
        >
          <AddNodePanel
            onPick={(action) =>
              handleAddNodeAction(
                action,
                { x: addPanel.flowX, y: addPanel.flowY },
                addPanel.sourceNodeId,
              )
            }
          />
        </div>
      )}

      {/* Empty state hint + quick template chips */}
      {nodes.length === 0 && !addPanel && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-6 text-center">
          <div className="font-display text-3xl tracking-tight">
            从一个想法
            <span className="bg-gradient-to-br from-brand-300 via-brand-500 to-aurora-400 bg-clip-text text-transparent"> 开始 </span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur">
            <MousePointerClick className="size-4 text-brand-400" />
            <span className="font-medium">双击</span>
            <span>画布的任意位置 · 自由生成或挑选模板</span>
          </div>
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
            <QuickChip
              icon={<ImageIcon className="size-3.5" />}
              label="文生图"
              onClick={() => handleAddNodeAction({ kind: "template", templateId: "text-to-image" })}
            />
            <QuickChip
              icon={<Clapperboard className="size-3.5" />}
              label="图生视频"
              onClick={() => handleAddNodeAction({ kind: "template", templateId: "image-to-video" })}
            />
            <QuickChip
              icon={<Wand2 className="size-3.5" />}
              label="文字生视频"
              onClick={() => handleAddNodeAction({ kind: "template", templateId: "text-to-video" })}
            />
            <QuickChip
              icon={<ImagePlus className="size-3.5" />}
              label="上传图片"
              onClick={() => handleAddNodeAction({ kind: "upload" })}
            />
            <QuickChip
              icon={<Type className="size-3.5" />}
              label="文本节点"
              onClick={() => handleAddNodeAction({ kind: "text" })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function QuickChip({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand-400/40 hover:bg-secondary"
    >
      {icon}
      {label}
    </button>
  );
}

function CanvasLeftRail({
  active, onToggleAdd, onQuickAdd,
}: {
  active: boolean;
  onToggleAdd: () => void;
  onQuickAdd: (kind: CanvasNodeKind) => void;
}) {
  return (
    <aside className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-border bg-card/90 p-1.5 shadow-lg backdrop-blur">
      <RailBtn
        active={active}
        icon={<Plus className="size-4" />}
        label="添加节点"
        onClick={onToggleAdd}
      />
      <div className="my-1 h-px w-6 bg-border" />
      <RailBtn icon={<ImageIcon className="size-4" />} label="图像节点" onClick={() => onQuickAdd("image")} />
      <RailBtn icon={<Clapperboard className="size-4" />} label="视频节点" onClick={() => onQuickAdd("video")} />
      <RailBtn icon={<Type className="size-4" />} label="文本节点" onClick={() => onQuickAdd("text")} />
      <RailBtn icon={<ImagePlus className="size-4" />} label="上传图片" onClick={() => onQuickAdd("upload")} />
    </aside>
  );
}

function RailBtn({
  active, icon, label, onClick,
}: { active?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

/* ─── Mappers ─── */

function toFlowNode(n: DocNode): Node<CanvasNodeData> {
  return { id: n.id, type: n.type, position: n.position, data: n.data };
}

function fromFlowNode(n: Node<CanvasNodeData>): DocNode {
  // Strip ephemeral helpers (callbacks, resolved input) before persisting
  const data = n.data as CanvasNodeData & {
    onDelete?: unknown; onPromptChange?: unknown; onModelChange?: unknown;
    onGenerate?: unknown; onImageChange?: unknown; inputImageUrl?: unknown;
  };
  const rest: CanvasNodeData = {
    kind: data.kind,
    prompt: data.prompt,
    modelId: data.modelId,
    status: data.status,
    progress: data.progress,
    imageUrls: data.imageUrls,
    videoPosterUrl: data.videoPosterUrl,
    videoUrl: data.videoUrl,
    errorMessage: data.errorMessage,
    generationId: data.generationId,
    imageParams: data.imageParams,
    videoParams: data.videoParams,
    directorStageId: data.directorStageId,
  };
  return {
    id: n.id,
    type: (n.type as CanvasNodeKind) ?? "image",
    position: n.position,
    data: rest,
  };
}

function toFlowEdge(e: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }): Edge {
  return {
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    animated: true,
  };
}

function fromFlowEdge(e: Edge) {
  return {
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  };
}
