"use client";

import * as React from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges,
  type Node, type NodeChange,
  ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Clapperboard, ImageIcon, Loader2, Pencil, Type, UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FreeformImageNode } from "./nodes/freeform-image-node";
import { FreeformVideoNode } from "./nodes/freeform-video-node";
import { FreeformTextNode } from "./nodes/freeform-text-node";
import * as canvasesApi from "@/lib/api/canvases";
import { useSpaceToPan } from "@/lib/hooks/use-space-to-pan";
import { cn, formatRelativeTime, shortId } from "@/lib/utils";
import type {
  CanvasDoc, CanvasNode as DocNode, CanvasNodeData, CanvasNodeKind,
} from "@/lib/types";

interface Props { canvasId: string; }

const NODE_TYPES = {
  upload: FreeformImageNode,
  "media-video": FreeformVideoNode,
  text: FreeformTextNode,
} as const;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function FreeformCanvasEditor({ canvasId }: Props) {
  return (
    <ReactFlowProvider>
      <FreeformInner canvasId={canvasId} />
    </ReactFlowProvider>
  );
}

function FreeformInner({ canvasId }: Props) {
  const router = useRouter();
  const rf = useReactFlow();
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const spaceDown = useSpaceToPan();

  const [doc, setDoc] = React.useState<CanvasDoc | null>(null);
  const [nodes, setNodes] = React.useState<Node<CanvasNodeData>[]>([]);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  // Active alignment guides during a drag — flow-coord positions
  const [guides, setGuides] = React.useState<Array<{ axis: "x" | "y"; pos: number }>>([]);

  // Load
  React.useEffect(() => {
    let cancelled = false;
    canvasesApi.get(canvasId).then((d) => {
      if (cancelled || !d) return;
      setDoc(d);
      setTitleDraft(d.title);
      setNodes(d.nodes.map(toFlowNode));
    });
    return () => { cancelled = true; };
  }, [canvasId]);

  // Debounced save
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSave = React.useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const vp = rf.getViewport();
      const cover = nodes
        .map((n) => n.data)
        .find((d) => d.imageUrls?.[0])
        ?.imageUrls?.[0];
      canvasesApi.saveSync(canvasId, {
        nodes: nodes.map(fromFlowNode),
        edges: [],
        viewport: vp,
        coverUrl: cover,
      });
    }, 600);
  }, [canvasId, nodes, rf]);

  React.useEffect(() => { queueSave(); }, [nodes, queueSave]);

  /* ─── Mutators ─── */

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) =>
      setNodes((ns) => applyNodeChanges(changes, ns) as Node<CanvasNodeData>[]),
    [],
  );

  const updateNodeData = React.useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [],
  );

  const deleteNode = React.useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, []);

  /* ─── Add new media node at flow position ─── */

  const addMediaFromDataUrl = React.useCallback(
    (kind: "image" | "video", dataUrl: string, atFlowPos?: { x: number; y: number }) => {
      const vp = rf.getViewport();
      const fallbackPos = atFlowPos ?? {
        x: (window.innerWidth / 2 - vp.x) / vp.zoom,
        y: (window.innerHeight / 2 - vp.y) / vp.zoom,
      };
      const id = shortId("n_");
      const nodeKind: CanvasNodeKind = kind === "image" ? "upload" : "media-video";
      const w = kind === "image" ? 240 : 320;
      const h = kind === "image" ? 240 : 180;
      const newNode: Node<CanvasNodeData> = {
        id,
        type: nodeKind,
        position: { x: fallbackPos.x - w / 2, y: fallbackPos.y - h / 2 },
        width: w,
        height: h,
        data: {
          kind: nodeKind,
          prompt: "",
          modelId: "",
          status: "succeeded",
          progress: 100,
          ...(kind === "image"
            ? { imageUrls: [dataUrl] }
            : { videoUrl: dataUrl }),
        },
      };
      setNodes((ns) => [...ns, newNode]);
      return id;
    },
    [rf],
  );

  const addTextNode = React.useCallback((atFlowPos?: { x: number; y: number }) => {
    const vp = rf.getViewport();
    const fallbackPos = atFlowPos ?? {
      x: (window.innerWidth / 2 - vp.x) / vp.zoom,
      y: (window.innerHeight / 2 - vp.y) / vp.zoom,
    };
    const id = shortId("n_");
    const w = 240, h = 100;
    const newNode: Node<CanvasNodeData> = {
      id,
      type: "text",
      position: { x: fallbackPos.x - w / 2, y: fallbackPos.y - h / 2 },
      width: w,
      height: h,
      data: {
        kind: "text",
        prompt: "",
        modelId: "",
        status: "idle",
      },
    };
    setNodes((ns) => [...ns, newNode]);
    return id;
  }, [rf]);

  /* ─── File ingestion (upload / paste / drop) ─── */

  const ingestFile = React.useCallback(
    (file: File, atFlowPos?: { x: number; y: number }) => {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) {
        toast.error(`不支持的文件类型：${file.type || file.name}`);
        return;
      }
      const cap = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (file.size > cap) {
        toast.error(`${file.name} 超过 ${cap / 1024 / 1024} MB`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        addMediaFromDataUrl(isImage ? "image" : "video", reader.result as string, atFlowPos);
      };
      reader.readAsDataURL(file);
    },
    [addMediaFromDataUrl],
  );

  const ingestFiles = React.useCallback(
    (files: FileList, atFlowPos?: { x: number; y: number }) => {
      // Cascade additional files slightly so they don't all stack on one spot
      Array.from(files).forEach((f, i) => {
        const offset = atFlowPos
          ? { x: atFlowPos.x + i * 24, y: atFlowPos.y + i * 24 }
          : undefined;
        ingestFile(f, offset);
      });
    },
    [ingestFile],
  );

  /* ─── Window-level paste from clipboard ─── */

  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Ignore paste when focused inside an input (so pasting into title or text node works)
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      files.forEach((f, i) => {
        ingestFile(f, undefined);
        if (i === 0) toast.success("已从剪贴板粘贴");
      });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestFile]);

  /* ─── Drag-and-drop file from OS ─── */

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);
  const onDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear when leaving the wrapper boundary
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);
  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      ingestFiles(files, flow);
    },
    [rf, ingestFiles],
  );

  /* ─── Alignment guides + snapping during drag ─── */

  const SNAP_THRESHOLD = 6; // flow-coord px

  const onNodeDrag = React.useCallback(
    (_event: unknown, draggedNode: Node<CanvasNodeData>) => {
      const all = rf.getNodes();
      const dragged = all.find((n) => n.id === draggedNode.id);
      if (!dragged) return;
      const dW = dragged.measured?.width ?? dragged.width ?? 240;
      const dH = dragged.measured?.height ?? dragged.height ?? 240;
      const dLeft = draggedNode.position.x;
      const dTop = draggedNode.position.y;
      const dCx = dLeft + dW / 2;
      const dCy = dTop + dH / 2;
      const dRight = dLeft + dW;
      const dBottom = dTop + dH;

      let snapDx: number | null = null;
      let snapDy: number | null = null;
      const activeGuides: Array<{ axis: "x" | "y"; pos: number }> = [];

      for (const other of all) {
        if (other.id === draggedNode.id) continue;
        const oW = other.measured?.width ?? other.width ?? 240;
        const oH = other.measured?.height ?? other.height ?? 240;
        const oLeft = other.position.x;
        const oTop = other.position.y;
        const oCx = oLeft + oW / 2;
        const oCy = oTop + oH / 2;
        const oRight = oLeft + oW;
        const oBottom = oTop + oH;

        // Vertical guides (snap on x): match dragged's L/Center/R against other's L/Center/R
        for (const [d, label] of [[dLeft, "L"], [dCx, "C"], [dRight, "R"]] as const) {
          for (const o of [oLeft, oCx, oRight]) {
            const diff = o - d;
            if (Math.abs(diff) < SNAP_THRESHOLD) {
              activeGuides.push({ axis: "x", pos: o });
              if (snapDx === null || Math.abs(diff) < Math.abs(snapDx)) snapDx = diff;
            }
          }
          void label;
        }
        // Horizontal guides (snap on y)
        for (const d of [dTop, dCy, dBottom]) {
          for (const o of [oTop, oCy, oBottom]) {
            const diff = o - d;
            if (Math.abs(diff) < SNAP_THRESHOLD) {
              activeGuides.push({ axis: "y", pos: o });
              if (snapDy === null || Math.abs(diff) < Math.abs(snapDy)) snapDy = diff;
            }
          }
        }
      }

      // Dedup guides
      const uniq = Array.from(new Map(activeGuides.map((g) => [`${g.axis}:${g.pos}`, g])).values());
      setGuides(uniq);

      if (snapDx !== null || snapDy !== null) {
        const newPos = {
          x: draggedNode.position.x + (snapDx ?? 0),
          y: draggedNode.position.y + (snapDy ?? 0),
        };
        setNodes((ns) =>
          ns.map((n) => (n.id === draggedNode.id ? { ...n, position: newPos } : n)),
        );
      }
    },
    [rf],
  );

  const onNodeDragStop = React.useCallback(() => setGuides([]), []);

  /* ─── Inject per-node callbacks ─── */

  const nodesWithCallbacks = React.useMemo<Node<CanvasNodeData>[]>(() => {
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        onDelete: () => deleteNode(n.id),
        onPromptChange:
          n.data.kind === "text"
            ? (p: string) => updateNodeData(n.id, { prompt: p })
            : undefined,
      } as CanvasNodeData,
    }));
  }, [nodes, deleteNode, updateNodeData]);

  /* ─── Title ─── */

  const saveTitle = async () => {
    if (!doc) return;
    const t = titleDraft.trim() || "未命名自由画布";
    if (t !== doc.title) {
      await canvasesApi.rename(doc.id, t);
      setDoc({ ...doc, title: t });
    }
    setTitleEditing(false);
  };

  /* ─── Right side panel: list of items ─── */

  const items = React.useMemo(() => {
    return nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      thumb: n.data.imageUrls?.[0] ?? n.data.videoPosterUrl,
      label: n.data.prompt?.slice(0, 28) ||
        (n.data.kind === "upload" ? "图片"
          : n.data.kind === "media-video" ? "视频"
            : "文本"),
    }));
  }, [nodes]);

  const focusNode = React.useCallback((id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    rf.setCenter(node.position.x + 120, node.position.y + 80, { duration: 400, zoom: 1.2 });
  }, [nodes, rf]);

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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
            <span className="ml-2 rounded-full bg-aurora-400/15 px-1.5 py-0.5 text-[10px] font-medium text-aurora-400">
              自由画布
            </span>
            <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={[]}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={() => queueSave()}
        defaultViewport={doc.viewport}
        // Space-to-pan: while space is held, drag canvas pans (Figma-style);
        // otherwise drag = lasso-select. Nodes also become non-draggable while
        // panning so dragging over a node keeps panning instead of moving it.
        panOnDrag={spaceDown ? [0] : false}
        selectionOnDrag={!spaceDown}
        nodesDraggable={!spaceDown}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        fitView={doc.nodes.length > 0}
        fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
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
            if (data.kind === "media-video") return "oklch(0.78 0.15 195)";
            if (data.kind === "text") return "oklch(0.55 0.02 80)";
            return "oklch(0.86 0.14 75)";
          }}
        />
      </ReactFlow>

      {/* Left tool rail */}
      <FreeformLeftRail
        onUpload={() => fileInputRef.current?.click()}
        onAddText={() => addTextNode()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Right side panel — items list */}
      <FreeformRightPanel
        items={items}
        onFocus={focusNode}
        onDelete={deleteNode}
      />

      {/* Alignment guides — rendered in screen space, refreshed on drag */}
      {guides.length > 0 && (
        <GuideOverlay
          guides={guides}
          flowToScreen={(p) => rf.flowToScreenPosition(p)}
          getViewportRect={() => wrapperRef.current?.getBoundingClientRect()}
        />
      )}

      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-brand-500/8 ring-4 ring-inset ring-brand-400/40">
          <div className="rounded-2xl border border-brand-400/60 bg-card px-6 py-4 text-center shadow-xl">
            <UploadCloud className="mx-auto size-8 text-brand-400" />
            <div className="mt-2 font-display text-lg">松开即可加入画布</div>
            <p className="mt-1 text-xs text-muted-foreground">支持图片 / 视频，多选可一次拖入</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && !dragOver && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-4 text-center">
          <div className="font-display text-3xl tracking-tight">
            收集你的
            <span className="bg-gradient-to-br from-aurora-300 via-aurora-400 to-brand-500 bg-clip-text text-transparent"> 灵感 </span>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            上传图片视频 · 拖入文件 · <span className="font-mono">Ctrl + V</span> 直接粘贴截图
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Left tool rail ─── */

function FreeformLeftRail({
  onUpload, onAddText,
}: { onUpload: () => void; onAddText: () => void }) {
  return (
    <aside className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-border bg-card/90 p-1.5 shadow-lg backdrop-blur">
      <RailBtn icon={<UploadCloud className="size-4" />} label="上传" onClick={onUpload} />
      <div className="my-1 h-px w-6 bg-border" />
      <RailBtn icon={<ImageIcon className="size-4" />} label="上传图片" onClick={onUpload} />
      <RailBtn icon={<Clapperboard className="size-4" />} label="上传视频" onClick={onUpload} />
      <RailBtn icon={<Type className="size-4" />} label="添加文本" onClick={onAddText} />
    </aside>
  );
}

function RailBtn({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {icon}
    </button>
  );
}

/* ─── Right side panel — items list ─── */

function FreeformRightPanel({
  items, onFocus, onDelete,
}: {
  items: Array<{ id: string; kind: string; thumb?: string; label: string }>;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <aside className="absolute right-4 top-4 bottom-4 z-10 flex w-56 flex-col rounded-2xl border border-border bg-card/85 shadow-lg backdrop-blur">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        素材 · {items.length}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((it) => (
          <div
            key={it.id}
            className="group flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-secondary"
          >
            <button
              type="button"
              onClick={() => onFocus(it.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <div className="size-9 shrink-0 overflow-hidden rounded-md bg-secondary">
                {it.thumb ? (
                  <img src={it.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {it.kind === "media-video" ? (
                      <Clapperboard className="size-3.5 text-muted-foreground" />
                    ) : it.kind === "text" ? (
                      <Type className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="size-3.5 text-muted-foreground" />
                    )}
                  </div>
                )}
              </div>
              <span className="line-clamp-1 text-[11px] leading-snug text-muted-foreground group-hover:text-foreground">
                {it.label}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(it.id)}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label="删除"
              title="删除"
            >
              <span className="text-xs">×</span>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ─── Mappers ─── */

function toFlowNode(n: DocNode): Node<CanvasNodeData> {
  return { id: n.id, type: n.type, position: n.position, data: n.data };
}

function fromFlowNode(n: Node<CanvasNodeData>): DocNode {
  const data = n.data as CanvasNodeData & {
    onDelete?: unknown; onPromptChange?: unknown;
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
  };
  return {
    id: n.id,
    type: (n.type as CanvasNodeKind) ?? "upload",
    position: n.position,
    data: rest,
  };
}

/* ─── Guide overlay — draws the active alignment lines in screen space ─── */

function GuideOverlay({
  guides, flowToScreen, getViewportRect,
}: {
  guides: Array<{ axis: "x" | "y"; pos: number }>;
  flowToScreen: (p: { x: number; y: number }) => { x: number; y: number };
  getViewportRect: () => DOMRect | undefined;
}) {
  const rect = getViewportRect();
  if (!rect) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      width={rect.width}
      height={rect.height}
    >
      {guides.map((g, i) => {
        if (g.axis === "x") {
          const screen = flowToScreen({ x: g.pos, y: 0 });
          const x = screen.x - rect.left;
          return (
            <line
              key={`gx-${i}-${g.pos}`}
              x1={x} y1={0} x2={x} y2={rect.height}
              stroke="oklch(0.74 0.18 65)"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.85}
            />
          );
        }
        const screen = flowToScreen({ x: 0, y: g.pos });
        const y = screen.y - rect.top;
        return (
          <line
            key={`gy-${i}-${g.pos}`}
            x1={0} y1={y} x2={rect.width} y2={y}
            stroke="oklch(0.74 0.18 65)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

// suppress unused — kept for future
void formatRelativeTime;
void cn;
