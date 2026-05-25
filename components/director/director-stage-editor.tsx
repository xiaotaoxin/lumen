"use client";

/**
 * 导演台 —— 3D 构图编辑器（参考 xwow / Dreamina 同类工具）。
 *
 * 设计目标：用极简 3D 替代分镜手稿——角色摆位、相机机位 + FOV 调节，
 * 出图前先把构图做对，避免反复试 prompt。
 *
 * 范围（v1）：
 * - 多角色（简化人形）+ 多机位
 * - 选中后用 TransformControls 拖动 / 旋转
 * - 右侧属性面板（位置 / FOV / LookAt 目标）
 * - 右下角小窗实时预览主机位画面
 * - "确认构图" 截屏，回写到画布节点
 *
 * 不做（v2 再说）：导入 GLB 模型、灯光编辑、动画时间轴、骨骼。
 */

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, TransformControls } from "@react-three/drei";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, Box as BoxIcon, Camera as CameraIcon, ChevronUp, Eye, EyeOff,
  Globe, LayoutGrid, Loader2, Lock, Magnet, Maximize2, Monitor, Move, Plus,
  Redo2, RotateCcw, RotateCw, Square, Tag, Trash2, Undo2, Unlock,
  User as UserIcon, ScanEye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAuthStore } from "@/lib/store/auth-store";
import * as directorStagesApi from "@/lib/api/director-stages";
import * as canvasesApi from "@/lib/api/canvases";
import { shortId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AssetLibrary } from "./asset-library";
import { PropMesh } from "./prop-mesh";
import {
  characterFromPreset,
  cameraFromPreset,
  propFromPreset,
  CAMERA_PRESETS,
  type PropPreset,
  type CharacterPreset,
  type CameraPreset,
  type TemplatePreset,
} from "@/lib/director/asset-presets";
import { POSE_PRESETS, DEFAULT_POSE } from "@/lib/director/pose-presets";
import type {
  DirectorStageDoc,
  DirectorCamera,
  DirectorCharacter,
  DirectorCharacterPose,
  DirectorProp,
  DirectorAspectRatio,
} from "@/lib/types";

const ASPECT_RATIOS: Array<{ id: DirectorAspectRatio; w: number; h: number }> = [
  { id: "16:9", w: 16, h: 9 },
  { id: "9:16", w: 9,  h: 16 },
  { id: "4:3",  w: 4,  h: 3 },
  { id: "3:4",  w: 3,  h: 4 },
  { id: "1:1",  w: 1,  h: 1 },
  { id: "21:9", w: 21, h: 9 },
];

function aspectToCss(ratio: DirectorAspectRatio): string {
  const r = ASPECT_RATIOS.find((x) => x.id === ratio) ?? ASPECT_RATIOS[0];
  return `${r.w} / ${r.h}`;
}

interface Props {
  docId: string;
  backHref: string;
}

type SelectionKind = "character" | "camera" | "prop";
interface Selection {
  kind: SelectionKind;
  id: string;
}

type GizmoMode = "translate" | "rotate" | "scale";
type LeftPanel = "outline" | "assets";

export function DirectorStageEditor({ docId, backHref }: Props) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [doc, setDoc] = React.useState<DirectorStageDoc | null>(null);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [gizmoMode, setGizmoMode] = React.useState<GizmoMode>("translate");
  const [saving, setSaving] = React.useState(false);
  const [leftPanel, setLeftPanel] = React.useState<LeftPanel>("outline");
  const [showLabels, setShowLabels] = React.useState(true);
  const [panoramic, setPanoramic] = React.useState(false);
  const [openDropdown, setOpenDropdown] = React.useState<"aspect" | null>(null);
  const [snap, setSnap] = React.useState(false);

  // 视图命令（俯视 / 正面 / 重置）—— 通过 ref 由 Canvas 内的 ViewController 实现
  const viewCommandsRef = React.useRef<{
    topView: () => void;
    frontView: () => void;
    resetView: () => void;
  } | null>(null);

  // 撤销 / 重做栈：debounced snapshot 防止滑块拖动炸栈
  const undoStackRef = React.useRef<DirectorStageDoc[]>([]);
  const redoStackRef = React.useRef<DirectorStageDoc[]>([]);
  const pendingSnapshotRef = React.useRef<DirectorStageDoc | null>(null);
  const snapshotTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const skipHistoryRef = React.useRef(false);
  const [historyTick, setHistoryTick] = React.useState(0);

  // Load doc
  React.useEffect(() => {
    const d = directorStagesApi.getSync(docId);
    if (!d) {
      toast.error("导演台数据不存在");
      router.replace(backHref);
      return;
    }
    // 从外部 (localStorage) 同步状态进入 React —— 这是 effect 该做的事，
    // 但 react-hooks/set-state-in-effect 会误报，逐行豁免
    /* eslint-disable react-hooks/set-state-in-effect */
    setDoc(d);
    setSelection({ kind: "camera", id: d.activeCameraId ?? d.cameras[0]?.id });
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Debounced auto-save
  const saveTimer = React.useRef<NodeJS.Timeout | null>(null);
  const queueSave = React.useCallback((next: DirectorStageDoc) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      directorStagesApi.saveSync(next.id, {
        cameras: next.cameras,
        characters: next.characters,
        props: next.props,
        activeCameraId: next.activeCameraId,
        title: next.title,
        aspectRatio: next.aspectRatio,
      });
    }, 500);
  }, []);

  const queueSnapshot = React.useCallback((oldDoc: DirectorStageDoc) => {
    // 撤销栈"批量合并"：500ms 内连续修改算一次操作（用于滑块连续拖动）
    if (skipHistoryRef.current) return;
    if (!pendingSnapshotRef.current) {
      pendingSnapshotRef.current = oldDoc;
    }
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      if (pendingSnapshotRef.current) {
        undoStackRef.current.push(pendingSnapshotRef.current);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
        pendingSnapshotRef.current = null;
        setHistoryTick((n) => n + 1);
      }
    }, 500);
  }, []);

  const updateDoc = React.useCallback((patch: Partial<DirectorStageDoc>) => {
    setDoc((prev) => {
      if (!prev) return prev;
      queueSnapshot(prev);
      const next = { ...prev, ...patch };
      queueSave(next);
      return next;
    });
  }, [queueSave, queueSnapshot]);

  const undo = React.useCallback(() => {
    if (undoStackRef.current.length === 0 && !pendingSnapshotRef.current) return;
    // 若还有 pending snapshot（正在拖滑块），先 flush
    if (pendingSnapshotRef.current) {
      undoStackRef.current.push(pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    }
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setDoc((cur) => {
      if (cur) {
        redoStackRef.current.push(cur);
        if (redoStackRef.current.length > 50) redoStackRef.current.shift();
      }
      return prev;
    });
    skipHistoryRef.current = true;
    queueSave(prev);
    queueMicrotask(() => { skipHistoryRef.current = false; });
    setHistoryTick((n) => n + 1);
  }, [queueSave]);

  const redo = React.useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    setDoc((cur) => {
      if (cur) {
        undoStackRef.current.push(cur);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      }
      return next;
    });
    skipHistoryRef.current = true;
    queueSave(next);
    queueMicrotask(() => { skipHistoryRef.current = false; });
    setHistoryTick((n) => n + 1);
  }, [queueSave]);

  // canUndo/canRedo 从 refs 派生 —— 用 useMemo + historyTick 触发刷新
  const { canUndo, canRedo } = React.useMemo(() => ({
    /* eslint-disable react-hooks/refs */
    canUndo: undoStackRef.current.length > 0 || !!pendingSnapshotRef.current,
    canRedo: redoStackRef.current.length > 0,
    /* eslint-enable react-hooks/refs */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [historyTick]);

  const updateCharacter = (id: string, patch: Partial<DirectorCharacter>) => {
    if (!doc) return;
    // 锁定瞬间：如果当前选中就是它，把选中清掉，避免 TransformControls 残留指向
    if (patch.locked && selection?.kind === "character" && selection.id === id) {
      setSelection(null);
    }
    updateDoc({
      characters: doc.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };
  const updateCamera = (id: string, patch: Partial<DirectorCamera>) => {
    if (!doc) return;
    updateDoc({
      cameras: doc.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };
  const updateProp = (id: string, patch: Partial<DirectorProp>) => {
    if (!doc) return;
    if (patch.locked && selection?.kind === "prop" && selection.id === id) {
      setSelection(null);
    }
    updateDoc({
      props: (doc.props ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  /* ─── 资产库 picker 处理 ─── */

  const pickProp = (preset: PropPreset) => {
    if (!doc) return;
    const next: DirectorProp = { id: shortId("prop_"), ...propFromPreset(preset) };
    updateDoc({ props: [...(doc.props ?? []), next] });
    setSelection({ kind: "prop", id: next.id });
  };

  const pickCharacter = (preset: CharacterPreset) => {
    if (!doc) return;
    const startIdx = doc.characters.length;
    const draft = characterFromPreset(preset, startIdx).map((c, i) => ({
      ...c,
      id: shortId("chr_"),
      // 把每个加进来的角色横向偏移一点，避免叠在一起
      pos: c.pos[0] === 0 && c.pos[2] === 0
        ? [c.pos[0] + (startIdx + i) * 0.8, c.pos[1], c.pos[2]] as [number, number, number]
        : c.pos,
    }));
    updateDoc({ characters: [...doc.characters, ...draft] });
    setSelection({ kind: "character", id: draft[0].id });
  };

  const pickCamera = (preset: CameraPreset) => {
    if (!doc) return;
    const c: DirectorCamera = {
      id: shortId("cam_"),
      ...cameraFromPreset(preset, doc.cameras.length),
    };
    updateDoc({ cameras: [...doc.cameras, c], activeCameraId: c.id });
    setSelection({ kind: "camera", id: c.id });
  };

  const pickTemplate = (preset: TemplatePreset) => {
    if (!doc) return;
    if (doc.characters.length > 0 || doc.cameras.length > 1 || (doc.props?.length ?? 0) > 0) {
      if (!confirm(`将"${preset.name}"模板套到当前场景上？这会清空现有的角色 / 道具，并替换机位列表。`)) return;
    }
    const newChars: DirectorCharacter[] = preset.characters.map((c) => ({
      id: shortId("chr_"),
      name: c.name,
      pos: c.pos,
      rotY: c.rotY,
      scale: c.scale,
      build: c.build,
      color: c.color,
    }));
    const newCams: DirectorCamera[] = preset.cameras.map((cam) => {
      const base = CAMERA_PRESETS.find((cp) => cp.id === cam.presetId) ?? CAMERA_PRESETS[0];
      return {
        id: shortId("cam_"),
        ...cameraFromPreset(base, 0, cam.nameOverride),
      };
    });
    if (newCams.length === 0) {
      newCams.push({ id: shortId("cam_"), ...cameraFromPreset(CAMERA_PRESETS[0], 0) });
    }
    const newProps: DirectorProp[] = preset.props.map((p) => ({
      id: shortId("prop_"),
      kind: p.kind,
      name: p.name ?? p.kind,
      pos: p.pos,
      rotY: p.rotY ?? 0,
      scale: p.scale ?? 1,
    }));
    updateDoc({
      characters: newChars,
      cameras: newCams,
      props: newProps,
      activeCameraId: newCams[0].id,
    });
    setSelection(newChars[0]
      ? { kind: "character", id: newChars[0].id }
      : { kind: "camera", id: newCams[0].id });
    toast.success(`模板「${preset.name}」已应用`);
  };

  const addCharacter = () => {
    if (!doc) return;
    const idx = doc.characters.length;
    const next: DirectorCharacter = {
      id: shortId("chr_"),
      name: `角色${String.fromCharCode(65 + idx)}`,
      pos: [Math.random() * 4 - 2, 0, Math.random() * 2 - 1],
      rotY: 0,
      scale: 1,
    };
    updateDoc({ characters: [...doc.characters, next] });
    setSelection({ kind: "character", id: next.id });
  };

  const addCamera = () => {
    if (!doc) return;
    const idx = doc.cameras.length;
    const next: DirectorCamera = {
      id: shortId("cam_"),
      name: `机位${idx + 1}`,
      pos: [Math.random() * 4 - 2, 2, 5],
      lookAtMode: "manual",
      lookAt: [0, 1.2, 0],
      fov: 50,
    };
    updateDoc({ cameras: [...doc.cameras, next], activeCameraId: next.id });
    setSelection({ kind: "camera", id: next.id });
  };

  /** 按 kind + id 删除（不依赖当前 selection），供大纲行的删除按钮使用 */
  const deleteItem = (kind: SelectionKind, id: string) => {
    if (!doc) return;
    if (kind === "character") {
      // 同步清掉所有指向被删角色的相机 lookAt 跟随，避免悬空引用
      const cleanedCameras = doc.cameras.map((c) =>
        c.lookAtMode === id ? { ...c, lookAtMode: "manual" as const } : c,
      );
      updateDoc({
        characters: doc.characters.filter((c) => c.id !== id),
        cameras: cleanedCameras,
      });
    } else if (kind === "prop") {
      updateDoc({ props: (doc.props ?? []).filter((p) => p.id !== id) });
    } else {
      const next = doc.cameras.filter((c) => c.id !== id);
      if (next.length === 0) {
        toast.error("至少保留一个机位");
        return;
      }
      const newActive = doc.activeCameraId === id ? next[0].id : doc.activeCameraId;
      updateDoc({ cameras: next, activeCameraId: newActive });
    }
    // 如果删的是当前选中的，清空选中
    if (selection?.kind === kind && selection.id === id) setSelection(null);
  };

  const deleteSelection = () => {
    if (!selection) return;
    deleteItem(selection.kind, selection.id);
  };

  const duplicateSelection = () => {
    if (!doc || !selection) return;
    if (selection.kind === "character") {
      const src = doc.characters.find((c) => c.id === selection.id);
      if (!src) return;
      const copy: DirectorCharacter = {
        ...src,
        id: shortId("chr_"),
        name: `${src.name} 副本`,
        pos: [src.pos[0] + 1, src.pos[1], src.pos[2]],
      };
      updateDoc({ characters: [...doc.characters, copy] });
      setSelection({ kind: "character", id: copy.id });
    } else if (selection.kind === "prop") {
      const src = (doc.props ?? []).find((p) => p.id === selection.id);
      if (!src) return;
      const copy: DirectorProp = {
        ...src,
        id: shortId("prop_"),
        name: `${src.name} 副本`,
        pos: [src.pos[0] + 0.5, src.pos[1], src.pos[2]],
      };
      updateDoc({ props: [...(doc.props ?? []), copy] });
      setSelection({ kind: "prop", id: copy.id });
    } else {
      const src = doc.cameras.find((c) => c.id === selection.id);
      if (!src) return;
      const copy: DirectorCamera = {
        ...src,
        id: shortId("cam_"),
        name: `${src.name} 副本`,
        pos: [src.pos[0] + 0.5, src.pos[1], src.pos[2]],
      };
      updateDoc({ cameras: [...doc.cameras, copy] });
      setSelection({ kind: "camera", id: copy.id });
    }
  };

  // 主画布的 ref，用来截图
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const confirmComposition = async () => {
    if (!doc || !user) return;
    setSaving(true);
    try {
      // 1) 把 debounce 中未落盘的 queueSave / 撤销快照 全部 flush 掉，避免丢最后一笔
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }

      // 2) 把当前主预览画面转成 dataURL
      const thumb = canvasRef.current?.toDataURL("image/jpeg", 0.7) ?? undefined;

      // 3) 写入完整 doc（含 props / aspectRatio）+ 缩略图
      directorStagesApi.saveSync(doc.id, {
        cameras: doc.cameras,
        characters: doc.characters,
        props: doc.props,
        activeCameraId: doc.activeCameraId,
        aspectRatio: doc.aspectRatio,
        title: doc.title,
        thumbnailDataUrl: thumb,
      });

      // 4) 同步到关联的画布节点（若有）
      if (doc.canvasNodeId) {
        const m = backHref.match(/\/app\/canvas\/([^/?#]+)/);
        const canvasId = m?.[1];
        if (canvasId) {
          const canvasDoc = canvasesApi.getSync(canvasId);
          if (canvasDoc) {
            const nextNodes = canvasDoc.nodes.map((n: typeof canvasDoc.nodes[number]) =>
              n.id === doc.canvasNodeId
                ? { ...n, data: { ...n.data, thumbnailDataUrl: thumb, prompt: doc.title } }
                : n,
            );
            canvasesApi.saveSync(canvasId, { nodes: nextNodes });
          }
        }
      }
      toast.success("构图已保存");
      router.push(backHref);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!doc) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />载入中…
      </div>
    );
  }

  const activeCamera = doc.cameras.find((c) => c.id === doc.activeCameraId) ?? doc.cameras[0];
  const selectedChar = selection?.kind === "character"
    ? (doc.characters.find((c) => c.id === selection.id) ?? null) : null;
  const selectedCam = selection?.kind === "camera"
    ? (doc.cameras.find((c) => c.id === selection.id) ?? null) : null;
  const selectedProp = selection?.kind === "prop"
    ? ((doc.props ?? []).find((p) => p.id === selection.id) ?? null) : null;
  const aspectRatio: DirectorAspectRatio = doc.aspectRatio ?? "16:9";

  return (
    <div className="relative flex h-full w-full bg-[#0b0b0f] text-zinc-100">
      <KeyboardShortcuts
        setGizmoMode={setGizmoMode}
        onSnap={() => setSnap((v) => !v)}
        onTopView={() => viewCommandsRef.current?.topView()}
        onFrontView={() => viewCommandsRef.current?.frontView()}
        onResetView={() => viewCommandsRef.current?.resetView()}
        onUndo={undo}
        onRedo={redo}
        onEscape={() => {
          if (panoramic) setPanoramic(false);
          else setOpenDropdown(null);
        }}
      />
      {/* ─── 顶部工具栏 ─── */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-[#101015]/90 px-4 py-2 backdrop-blur-xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(backHref)}
          className="text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
        >
          <ArrowLeft className="size-4" />返回
        </Button>
        <Input
          value={doc.title}
          onChange={(e) => updateDoc({ title: e.target.value })}
          className="h-7 w-48 border-zinc-800 bg-zinc-900/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-amber-400/50 focus-visible:ring-amber-400/20"
        />
        <div className="flex-1" />

        {/* ─── 居中的操作提示胶囊 ─── */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#16161b]/90 px-3 py-1 text-[11px] backdrop-blur-xl shadow-lg shadow-black/30">
            <HintItem kbd="左键点击" desc="选中" />
            <HintDivider />
            <HintItem kbd="左键拖拽" desc="旋转" />
            <HintItem kbd="右键拖拽" desc="平移" />
            <HintItem kbd="滚轮" desc="视图缩放" />
            <HintDivider />
            <HintItem kbd="W" desc="移动" mono />
            <HintItem kbd="R" desc="旋转" mono />
            <HintItem kbd="S" desc="缩放" mono />
          </div>
        </div>

        <div className="flex-1" />
      </div>

      {/* ─── 左侧：tab 切换条（大纲 / 资产）─── */}
      <div className="absolute left-4 top-14 z-20 flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#101015]/90 p-1 backdrop-blur-xl shadow-lg shadow-black/40">
        <button
          type="button"
          onClick={() => setLeftPanel("outline")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
            leftPanel === "outline"
              ? "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/25"
              : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
          )}
        >
          <LayoutGrid className="size-3.5" />大纲
        </button>
        <button
          type="button"
          onClick={() => setLeftPanel("assets")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
            leftPanel === "assets"
              ? "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/25"
              : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
          )}
        >
          <BoxIcon className="size-3.5" />资产
        </button>
      </div>

      {/* ─── 左侧：大纲面板 ─── */}
      {leftPanel === "outline" && (
        <div className="absolute left-4 top-[5.5rem] z-20 w-56 rounded-xl border border-white/[0.06] bg-[#101015]/90 p-2 text-xs text-zinc-200 backdrop-blur-xl shadow-2xl shadow-black/40">
          <div className="mb-2 space-y-0.5">
            <SectionLabel>角色 · {doc.characters.length}</SectionLabel>
            {doc.characters.map((c) => (
              <OutlineRow
                key={c.id}
                icon={<UserIcon className="size-3.5" />}
                label={c.name}
                active={selection?.kind === "character" && selection.id === c.id}
                hidden={c.hidden}
                locked={c.locked}
                onClick={() => { if (!c.locked) setSelection({ kind: "character", id: c.id }); }}
                onToggleHidden={() => updateCharacter(c.id, { hidden: !c.hidden })}
                onToggleLocked={() => updateCharacter(c.id, { locked: !c.locked })}
                onDelete={() => deleteItem("character", c.id)}
              />
            ))}
            <OutlineAddRow label="添加角色" onClick={addCharacter} />
          </div>
          {(doc.props?.length ?? 0) > 0 && (
            <div className="mb-2 space-y-0.5">
              <SectionLabel>道具 · {doc.props!.length}</SectionLabel>
              {doc.props!.map((p) => (
                <OutlineRow
                  key={p.id}
                  icon={<BoxIcon className="size-3.5" />}
                  label={p.name}
                  active={selection?.kind === "prop" && selection.id === p.id}
                  hidden={p.hidden}
                  locked={p.locked}
                  onClick={() => { if (!p.locked) setSelection({ kind: "prop", id: p.id }); }}
                  onToggleHidden={() => updateProp(p.id, { hidden: !p.hidden })}
                  onToggleLocked={() => updateProp(p.id, { locked: !p.locked })}
                  onDelete={() => deleteItem("prop", p.id)}
                />
              ))}
            </div>
          )}
          <div className="space-y-0.5">
            <SectionLabel>机位 · {doc.cameras.length}</SectionLabel>
            {doc.cameras.map((c) => (
              <OutlineRow
                key={c.id}
                icon={<CameraIcon className="size-3.5" />}
                label={c.name}
                active={selection?.kind === "camera" && selection.id === c.id}
                activeCamera={doc.activeCameraId === c.id}
                hidden={c.hidden}
                onClick={() => setSelection({ kind: "camera", id: c.id })}
                onSetActive={() => updateDoc({ activeCameraId: c.id })}
                onToggleHidden={() => {
                  const willHide = !c.hidden;
                  // 如果要把当前主机位隐藏，自动切到第一个仍可见的机位作为主预览
                  if (willHide && doc.activeCameraId === c.id) {
                    const firstVisible = doc.cameras.find((cam) => cam.id !== c.id && !cam.hidden);
                    updateDoc({
                      cameras: doc.cameras.map((cam) => cam.id === c.id ? { ...cam, hidden: true } : cam),
                      activeCameraId: firstVisible?.id ?? doc.activeCameraId,
                    });
                  } else {
                    updateCamera(c.id, { hidden: willHide });
                  }
                }}
                onDelete={() => deleteItem("camera", c.id)}
              />
            ))}
            <OutlineAddRow label="添加机位" onClick={addCamera} />
          </div>
        </div>
      )}

      {/* ─── 左侧：资产库面板 ─── */}
      {leftPanel === "assets" && (
        <div className="absolute left-4 top-[5.5rem] z-20">
          <AssetLibrary
            onClose={() => setLeftPanel("outline")}
            onPickProp={pickProp}
            onPickCharacter={pickCharacter}
            onPickCamera={pickCamera}
            onPickTemplate={pickTemplate}
          />
        </div>
      )}

      {/* ─── 主 3D 视图 ─── */}
      <Canvas
        camera={{ position: [6, 5, 8], fov: 45 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
        className="!h-full !w-full"
      >
        <color attach="background" args={["#0a0a0c"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 8, 5]} intensity={0.8} />
        <Grid
          position={[0, 0, 0]}
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#2a2a30"
          sectionSize={5}
          sectionThickness={1.2}
          sectionColor="#3a3a45"
          fadeDistance={40}
          fadeStrength={1.5}
          followCamera={false}
          infiniteGrid={false}
        />
        {/* 主轴线（红 X / 绿 Y / 蓝 Z）*/}
        <axesHelper args={[10]} />

        {/* 角色（隐藏的不渲染） */}
        {doc.characters.filter((c) => !c.hidden).map((c) => (
          <Mannequin
            key={c.id}
            character={c}
            selected={selection?.kind === "character" && selection.id === c.id}
            onSelect={() => { if (!c.locked) setSelection({ kind: "character", id: c.id }); }}
            onChange={(patch) => updateCharacter(c.id, patch)}
            gizmoMode={gizmoMode}
            showLabel={showLabels}
            snap={snap}
            locked={c.locked}
          />
        ))}

        {/* 道具（隐藏的不渲染） */}
        {(doc.props ?? []).filter((p) => !p.hidden).map((p) => (
          <PropObject
            key={p.id}
            prop={p}
            selected={selection?.kind === "prop" && selection.id === p.id}
            onSelect={() => { if (!p.locked) setSelection({ kind: "prop", id: p.id }); }}
            onChange={(patch) => updateProp(p.id, patch)}
            gizmoMode={gizmoMode}
            showLabel={showLabels}
            snap={snap}
            locked={p.locked}
          />
        ))}

        {/* 机位（隐藏的不画 gizmo，但相机本身仍可作为主机位预览源） */}
        {doc.cameras.filter((c) => !c.hidden).map((c) => (
          <CameraGizmo
            key={c.id}
            camera={c}
            isActive={c.id === doc.activeCameraId}
            selected={selection?.kind === "camera" && selection.id === c.id}
            onSelect={() => setSelection({ kind: "camera", id: c.id })}
            onChange={(patch) => updateCamera(c.id, patch)}
            gizmoMode={gizmoMode}
            showLabel={showLabels}
            snap={snap}
          />
        ))}

        <SceneOrbitControls hasSelection={!!selection} />
        <ViewController commandsRef={viewCommandsRef} />

        {/* 右下角 XYZ 罗盘 */}
        <GizmoHelper alignment="top-right" margin={[60, 90]}>
          <GizmoViewport
            axisColors={["#f97373", "#86efac", "#7dd3fc"]}
            labelColor="#0a0a0c"
          />
        </GizmoHelper>
      </Canvas>

      {/* ─── 右侧：属性面板 ─── */}
      {(selectedChar || selectedCam || selectedProp) && (
        <PropertiesPanel
          character={selectedChar}
          camera={selectedCam}
          prop={selectedProp}
          characters={doc.characters}
          onCharacterChange={(patch) => selectedChar && updateCharacter(selectedChar.id, patch)}
          onCameraChange={(patch) => selectedCam && updateCamera(selectedCam.id, patch)}
          onPropChange={(patch) => selectedProp && updateProp(selectedProp.id, patch)}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
          onClose={() => setSelection(null)}
        />
      )}

      {/* ─── 右下：主机位预览 ─── */}
      {activeCamera && !panoramic && (
        <div className="absolute bottom-20 right-4 z-20 overflow-hidden rounded-xl border border-white/[0.06] bg-[#101015]/95 backdrop-blur-xl shadow-2xl shadow-black/40"
             style={{
               // 横屏比例固定 288 宽，竖屏比例固定 200px 高（避免撑到挡住属性面板）
               width: aspectRatio === "9:16" || aspectRatio === "3:4" ? `${(200 * (aspectRatio === "9:16" ? 9 : 3)) / (aspectRatio === "9:16" ? 16 : 4)}px` : "288px",
             }}
        >
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2 py-1 text-[10px] text-zinc-300">
            <CameraIcon className="size-3 text-amber-300" />
            <span className="truncate font-medium">{activeCamera.name}</span>
            <span className="ml-auto rounded border border-zinc-700/60 bg-zinc-800/80 px-1 text-zinc-400">
              FOV {activeCamera.fov}°
            </span>
            <span className="rounded bg-amber-400/15 px-1 text-amber-200 ring-1 ring-amber-400/25">{aspectRatio}</span>
          </div>
          <div className="w-full" style={{ aspectRatio: aspectToCss(aspectRatio) }}>
            <Canvas
              camera={{ position: activeCamera.pos, fov: activeCamera.fov }}
              className="!h-full !w-full"
            >
              <color attach="background" args={["#0a0a0c"]} />
              <ambientLight intensity={0.55} />
              <directionalLight position={[5, 8, 5]} intensity={0.8} />
              <PreviewCameraSync camera={activeCamera} characters={doc.characters} />
              <Grid
                args={[40, 40]} cellSize={1} cellThickness={0.6} cellColor="#2a2a30"
                sectionSize={5} sectionThickness={1.2} sectionColor="#3a3a45"
                fadeDistance={40} fadeStrength={1.5} infiniteGrid={false}
              />
              {doc.characters.map((c) => (
                <group key={c.id} position={c.pos} rotation={[0, c.rotY, 0]} scale={c.scale}>
                  <MannequinMesh character={c} highlight={false} />
                </group>
              ))}
              {(doc.props ?? []).map((p) => (
                <group key={p.id} position={p.pos} rotation={[0, p.rotY, 0]} scale={p.scale}>
                  <PropMesh kind={p.kind} highlight={false} />
                </group>
              ))}
            </Canvas>
          </div>
        </div>
      )}

      {/* ─── 全景预览（覆盖整个视口的主机位画面）─── */}
      {panoramic && activeCamera && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/95">
          <div
            className="overflow-hidden rounded-xl border border-amber-400/30 shadow-2xl shadow-black/60"
            style={{ aspectRatio: aspectToCss(aspectRatio), maxHeight: "82vh", maxWidth: "92vw" }}
          >
            <Canvas
              camera={{ position: activeCamera.pos, fov: activeCamera.fov }}
              className="!h-full !w-full"
            >
              <color attach="background" args={["#0a0a0c"]} />
              <ambientLight intensity={0.55} />
              <directionalLight position={[5, 8, 5]} intensity={0.8} />
              <PreviewCameraSync camera={activeCamera} characters={doc.characters} />
              <Grid
                args={[40, 40]} cellSize={1} cellThickness={0.6} cellColor="#2a2a30"
                sectionSize={5} sectionThickness={1.2} sectionColor="#3a3a45"
                fadeDistance={40} fadeStrength={1.5} infiniteGrid={false}
              />
              {doc.characters.map((c) => (
                <group key={c.id} position={c.pos} rotation={[0, c.rotY, 0]} scale={c.scale}>
                  <MannequinMesh character={c} highlight={false} />
                </group>
              ))}
              {(doc.props ?? []).map((p) => (
                <group key={p.id} position={p.pos} rotation={[0, p.rotY, 0]} scale={p.scale}>
                  <PropMesh kind={p.kind} highlight={false} />
                </group>
              ))}
            </Canvas>
          </div>
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-xs text-zinc-500">
            全景预览 · 按 ESC 或点底部「全景」退出
          </div>
        </div>
      )}

      {/* ─── 底部右侧：视图工具栏 ─── */}
      <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-[#101015]/90 px-2 py-1.5 backdrop-blur-xl shadow-2xl shadow-black/40">
        {/* 全景 */}
        <ViewToolbarButton
          icon={<Globe className="size-3.5" />}
          label="全景"
          active={panoramic}
          onClick={() => setPanoramic((v) => !v)}
        />
        {/* 标签 */}
        <ViewToolbarButton
          icon={<Tag className="size-3.5" />}
          label="标签"
          active={showLabels}
          onClick={() => setShowLabels((v) => !v)}
        />
        {/* 比例 */}
        <div className="relative">
          <ViewToolbarButton
            icon={<Monitor className="size-3.5" />}
            label={aspectRatio}
            active={openDropdown === "aspect"}
            onClick={() => setOpenDropdown(openDropdown === "aspect" ? null : "aspect")}
            chevronUp
          />
          {openDropdown === "aspect" && (
            <div className="absolute bottom-full right-0 mb-1.5 w-28 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1a1a20]/95 py-1 shadow-2xl shadow-black/50 backdrop-blur-xl">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    updateDoc({ aspectRatio: r.id });
                    setOpenDropdown(null);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-[12px] transition-colors",
                    r.id === aspectRatio
                      ? "bg-amber-400/15 font-medium text-amber-100"
                      : "text-zinc-300 hover:bg-zinc-800/60",
                  )}
                >
                  {r.id}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mx-1 h-5 w-px bg-zinc-700/60" />
        <Button
          size="sm"
          onClick={confirmComposition}
          disabled={saving}
          className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:bg-amber-500/40"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          确认构图
        </Button>
      </div>

      {/* ─── 底部中间：变换工具栏 ─── */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/[0.06] bg-[#101015]/90 px-2 py-1.5 backdrop-blur-xl shadow-2xl shadow-black/40">
        <ToolButton
          active={gizmoMode === "translate"}
          icon={<Move className="size-3.5" />}
          label="移动"
          shortcut="W"
          onClick={() => setGizmoMode("translate")}
        />
        <ToolButton
          active={gizmoMode === "rotate"}
          icon={<RotateCw className="size-3.5" />}
          label="旋转"
          shortcut="R"
          onClick={() => setGizmoMode("rotate")}
        />
        <ToolButton
          active={gizmoMode === "scale"}
          icon={<Maximize2 className="size-3.5" />}
          label="缩放"
          shortcut="S"
          onClick={() => setGizmoMode("scale")}
        />
        <div className="mx-1 h-4 w-px bg-zinc-700/60" />
        <ToolButton
          active={snap}
          icon={<Magnet className="size-3.5" />}
          label="吸附"
          shortcut="G"
          onClick={() => setSnap((v) => !v)}
        />
        <ToolButton
          icon={<ScanEye className="size-3.5" />}
          label="俯视"
          shortcut="T"
          onClick={() => viewCommandsRef.current?.topView()}
        />
        <ToolButton
          icon={<Square className="size-3.5" />}
          label="正面"
          shortcut="E"
          onClick={() => viewCommandsRef.current?.frontView()}
        />
        <ToolButton
          icon={<RotateCcw className="size-3.5" />}
          label="重置"
          shortcut="Q"
          onClick={() => viewCommandsRef.current?.resetView()}
        />
        <div className="mx-1 h-4 w-px bg-zinc-700/60" />
        <ToolButton
          icon={<Undo2 className="size-3.5" />}
          label="撤销"
          shortcut="⌘Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolButton
          icon={<Redo2 className="size-3.5" />}
          label="重做"
          shortcut="⌘⇧Z"
          disabled={!canRedo}
          onClick={redo}
        />
      </div>
    </div>
  );
}

/* ────────────────────────── 子组件 ────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pb-0.5 pt-1.5 text-[9px] font-medium uppercase tracking-widest text-zinc-500">
      {children}
    </div>
  );
}

function OutlineRow({
  icon, label, active, activeCamera,
  hidden, locked,
  onClick, onSetActive, onToggleHidden, onToggleLocked, onDelete,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeCamera?: boolean;
  hidden?: boolean;
  locked?: boolean;
  onClick: () => void;
  onSetActive?: () => void;
  onToggleHidden?: () => void;
  onToggleLocked?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer transition-colors",
        active
          ? "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/25"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
        hidden && "opacity-50",
      )}
      onClick={onClick}
    >
      {icon}
      <span className={cn("truncate flex-1", locked && "italic")}>{label}</span>
      {onSetActive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSetActive(); }}
          className={cn(
            "rounded p-0.5 transition-opacity",
            activeCamera ? "text-amber-300" : "text-zinc-600 opacity-0 group-hover:opacity-100",
          )}
          title="设为主机位（右下预览）"
        >
          <ScanEye className="size-3" />
        </button>
      )}
      {onToggleHidden && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className={cn(
            "rounded p-0.5 transition-opacity hover:text-zinc-100",
            hidden
              ? "text-zinc-500 opacity-100"
              : "text-zinc-600 opacity-0 group-hover:opacity-100",
          )}
          title={hidden ? "显示" : "隐藏"}
        >
          {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
      )}
      {onToggleLocked && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleLocked(); }}
          className={cn(
            "rounded p-0.5 transition-opacity hover:text-zinc-100",
            locked
              ? "text-amber-300 opacity-100"
              : "text-zinc-600 opacity-0 group-hover:opacity-100",
          )}
          title={locked ? "解锁" : "锁定"}
        >
          {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function OutlineAddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
    >
      <Plus className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}

function HintItem({
  kbd, desc, mono,
}: {
  kbd: string;
  desc: string;
  mono?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <kbd className={cn(
        "rounded-md border border-zinc-700/70 bg-zinc-800/80 text-zinc-200 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]",
        mono
          ? "flex h-5 min-w-[20px] items-center justify-center px-1 font-mono text-[10px] font-medium"
          : "px-1.5 py-0.5 text-[10px] font-medium",
      )}>
        {kbd}
      </kbd>
      <span className="text-zinc-400">{desc}</span>
    </span>
  );
}

function HintDivider() {
  return <span className="h-3.5 w-px bg-zinc-700/60" />;
}

function ViewToolbarButton({
  active, icon, label, onClick, chevronUp,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  chevronUp?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/25"
          : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
      )}
    >
      {icon}
      <span>{label}</span>
      {chevronUp && <ChevronUp className="size-3 opacity-60" />}
    </button>
  );
}

function ToolButton({
  active, icon, label, shortcut, onClick, disabled,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors",
        disabled
          ? "cursor-not-allowed text-zinc-600"
          : active
            ? "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/25"
            : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
      )}
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <span className={cn(
          "ml-0.5 rounded border px-1 text-[9px]",
          disabled
            ? "border-zinc-800 bg-zinc-900/60 text-zinc-700"
            : active
              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
              : "border-zinc-700/60 bg-zinc-800/80 text-zinc-400",
        )}>{shortcut}</span>
      )}
    </button>
  );
}

function SceneOrbitControls({ hasSelection }: { hasSelection: boolean }) {
  // hasSelection 时仍允许 orbit；TransformControls 通过事件捕获机制
  // 自动接管在 gizmo 上的拖拽，所以这里不必关闭 enableRotate
  void hasSelection;
  return (
    <OrbitControls
      makeDefault
      enableRotate
      enableZoom
      enablePan
      mouseButtons={{
        LEFT: 0,    // ROTATE
        MIDDLE: 1,  // DOLLY
        RIGHT: 2,   // PAN
      }}
      maxDistance={50}
      minDistance={2}
    />
  );
}

function KeyboardShortcuts({
  setGizmoMode, onSnap, onTopView, onFrontView, onResetView, onUndo, onRedo, onEscape,
}: {
  setGizmoMode: (m: GizmoMode) => void;
  onSnap?: () => void;
  onTopView?: () => void;
  onFrontView?: () => void;
  onResetView?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onEscape?: () => void;
}) {
  const refs = React.useRef({ setGizmoMode, onSnap, onTopView, onFrontView, onResetView, onUndo, onRedo, onEscape });
  React.useEffect(() => {
    refs.current = { setGizmoMode, onSnap, onTopView, onFrontView, onResetView, onUndo, onRedo, onEscape };
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      const r = refs.current;
      // Cmd/Ctrl + Z / Shift+Z
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) r.onRedo?.();
        else r.onUndo?.();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        r.onRedo?.();
        return;
      }
      // 单键快捷
      switch (e.key) {
        case "w": case "W": r.setGizmoMode("translate"); break;
        case "r": case "R": r.setGizmoMode("rotate"); break;
        case "s": case "S": r.setGizmoMode("scale"); break;
        case "g": case "G": r.onSnap?.(); break;
        case "t": case "T": r.onTopView?.(); break;
        case "e": case "E": r.onFrontView?.(); break;
        case "q": case "Q": r.onResetView?.(); break;
        case "Escape": r.onEscape?.(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/* ────────────────────────── 主视图相机视角控制 ────────────────────────── */

interface ViewCommands {
  topView: () => void;
  frontView: () => void;
  resetView: () => void;
}

function ViewController({
  commandsRef,
}: {
  commandsRef: React.MutableRefObject<ViewCommands | null>;
}) {
  const { camera, controls } = useThree() as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | undefined };
  React.useEffect(() => {
    const setView = (pos: [number, number, number], target: [number, number, number]) => {
      camera.position.set(...pos);
      camera.lookAt(...target);
      if (controls && controls.target) {
        controls.target.set(...target);
        controls.update();
      }
    };
    commandsRef.current = {
      topView:    () => setView([0, 18, 0.001], [0, 0, 0]),
      frontView:  () => setView([0, 1.5, 8],    [0, 1, 0]),
      resetView:  () => setView([6, 5, 8],      [0, 0, 0]),
    };
    return () => { commandsRef.current = null; };
  }, [camera, controls, commandsRef]);
  return null;
}

/* ────────────────────────── 角色（人形）────────────────────────── */

interface MannequinProps {
  character: DirectorCharacter;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DirectorCharacter>) => void;
  gizmoMode: GizmoMode;
  showLabel?: boolean;
  snap?: boolean;
  locked?: boolean;
}

function Mannequin({ character, selected, onSelect, onChange, gizmoMode, showLabel, snap, locked }: MannequinProps) {
  const groupRef = React.useRef<THREE.Group>(null);

  const onTransform = () => {
    const g = groupRef.current;
    if (!g) return;
    onChange({
      pos: [g.position.x, g.position.y, g.position.z],
      rotY: g.rotation.y,
      scale: g.scale.x,
    });
  };

  return (
    <>
      <group
        ref={groupRef}
        position={character.pos}
        rotation={[0, character.rotY, 0]}
        scale={character.scale}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <MannequinMesh character={character} highlight={selected} />
        {showLabel && <SceneLabel y={2.0} text={character.name} accent={selected} />}
      </group>
      {selected && !locked && (
        <TransformControls
          object={groupRef as unknown as React.RefObject<THREE.Object3D>}
          mode={gizmoMode === "scale" ? "scale" : gizmoMode}
          onObjectChange={onTransform}
          size={0.8}
          translationSnap={snap ? 0.5 : null}
          rotationSnap={snap ? Math.PI / 12 : null}
          scaleSnap={snap ? 0.1 : null}
        />
      )}
    </>
  );
}

function SceneLabel({ y, text, accent }: { y: number; text: string; accent?: boolean }) {
  return (
    <Html
      position={[0, y, 0]}
      center
      distanceFactor={8}
      occlude={false}
      style={{ pointerEvents: "none" }}
    >
      <div
        className={cn(
          "select-none rounded-md border px-2 py-0.5 font-mono text-[11px] leading-tight whitespace-nowrap shadow",
          accent
            ? "border-amber-400/40 bg-amber-400/15 text-amber-100 backdrop-blur"
            : "border-white/10 bg-zinc-900/80 text-zinc-200 backdrop-blur",
        )}
      >
        {text}
      </div>
    </Html>
  );
}

/**
 * 可摆姿势的 Mannequin —— 用嵌套 group 实现简化骨骼层级：
 *   root（身体整体倾斜）
 *     hip 中心（躯干 / 头 / 双臂枢轴 / 双腿枢轴）
 *
 * 每个 group 代表一个关节，旋转作用于"该关节之后的所有子骨骼"。
 */
function MannequinMesh({ character, highlight }: { character: DirectorCharacter; highlight: boolean }) {
  const color = highlight ? "#ffaa44" : (character.color ?? "#cccccc");
  const build = character.build ?? "standard";
  const torsoTop  = build === "heavy" ? 0.24 : build === "slim" ? 0.14 : build === "female" ? 0.16 : 0.18;
  const torsoBot  = build === "heavy" ? 0.28 : build === "slim" ? 0.16 : build === "female" ? 0.20 : 0.22;
  const limbR     = build === "heavy" ? 0.075 : build === "slim" ? 0.045 : 0.06;
  const headR     = build === "child" ? 0.15 : 0.13;
  const p = character.pose ?? DEFAULT_POSE;

  // 关节几何：上臂 / 前臂 / 大腿 / 小腿 长度
  const upperArmLen = 0.34;
  const foreArmLen  = 0.32;
  const thighLen    = 0.42;
  const shinLen     = 0.42;

  // 髋部 y 坐标 = 大腿+小腿总长（让脚底正好落地）
  const hipY = thighLen + shinLen; // 0.84

  return (
    <group rotation={[p.bodyTilt, p.bodyTwist, p.bodyLean]}>
      {/* 髋部锚点（根） */}
      <group position={[0, hipY, 0]}>

        {/* 躯干（旋转作用于头 + 双臂） */}
        <group rotation={[p.torsoTilt, p.torsoTwist, p.torsoLean]}>
          {/* 躯干本体（中心在 +0.35，等于 0.7 长度的一半） */}
          <mesh position={[0, 0.35, 0]} castShadow>
            <cylinderGeometry args={[torsoTop, torsoBot, 0.7, 16]} />
            <meshStandardMaterial color={color} />
          </mesh>

          {/* 颈 / 头 */}
          <group position={[0, 0.78, 0]} rotation={[p.headPitch, p.headYaw, p.headRoll]}>
            <mesh position={[0, 0.1, 0]} castShadow>
              <sphereGeometry args={[headR, 16, 16]} />
              <meshStandardMaterial color={color} />
            </mesh>
          </group>

          {/* 左肩 → 上臂 → 肘 → 前臂 */}
          <Arm
            sign={-1}
            shoulderOffset={[-(torsoTop + 0.05), 0.62, 0]}
            shoulderRot={[p.shoulderL.forward, p.shoulderL.twist, p.shoulderL.out]}
            elbow={p.elbowL}
            color={color} limbR={limbR}
            upperArmLen={upperArmLen} foreArmLen={foreArmLen}
          />
          <Arm
            sign={1}
            shoulderOffset={[(torsoTop + 0.05), 0.62, 0]}
            shoulderRot={[p.shoulderR.forward, p.shoulderR.twist, p.shoulderR.out]}
            elbow={p.elbowR}
            color={color} limbR={limbR}
            upperArmLen={upperArmLen} foreArmLen={foreArmLen}
          />
        </group>

        {/* 左腿 */}
        <Leg
          hipOffset={[-0.1, 0, 0]}
          hipRot={[p.hipL.forward, p.hipL.twist, p.hipL.out]}
          knee={p.kneeL}
          color={color} limbR={limbR + 0.02}
          thighLen={thighLen} shinLen={shinLen}
        />
        {/* 右腿 */}
        <Leg
          hipOffset={[0.1, 0, 0]}
          hipRot={[p.hipR.forward, p.hipR.twist, p.hipR.out]}
          knee={p.kneeR}
          color={color} limbR={limbR + 0.02}
          thighLen={thighLen} shinLen={shinLen}
        />
      </group>

      {/* 脚下圆环 —— 跟随身体倾斜会脱地，所以放在最外层（没倾斜） */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.25, 0.3, 32]} />
        <meshBasicMaterial color={highlight ? "#ffaa44" : "#666"} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* —— 简化骨骼子组件 —— */

function Arm({
  sign, shoulderOffset, shoulderRot, elbow, color, limbR, upperArmLen, foreArmLen,
}: {
  sign: -1 | 1;
  shoulderOffset: [number, number, number];
  shoulderRot: [number, number, number];
  elbow: number;
  color: string;
  limbR: number;
  upperArmLen: number;
  foreArmLen: number;
}) {
  void sign;
  return (
    <group position={shoulderOffset} rotation={shoulderRot}>
      {/* 上臂：从肩往下挂（cylinder 默认沿 Y，中心在 -upperArmLen/2） */}
      <mesh position={[0, -upperArmLen / 2, 0]} castShadow>
        <cylinderGeometry args={[limbR, limbR, upperArmLen, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* 肘枢轴 */}
      <group position={[0, -upperArmLen, 0]} rotation={[elbow, 0, 0]}>
        <mesh position={[0, -foreArmLen / 2, 0]} castShadow>
          <cylinderGeometry args={[limbR * 0.9, limbR * 0.9, foreArmLen, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

function Leg({
  hipOffset, hipRot, knee, color, limbR, thighLen, shinLen,
}: {
  hipOffset: [number, number, number];
  hipRot: [number, number, number];
  knee: number;
  color: string;
  limbR: number;
  thighLen: number;
  shinLen: number;
}) {
  return (
    <group position={hipOffset} rotation={hipRot}>
      <mesh position={[0, -thighLen / 2, 0]} castShadow>
        <cylinderGeometry args={[limbR, limbR, thighLen, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <group position={[0, -thighLen, 0]} rotation={[knee, 0, 0]}>
        <mesh position={[0, -shinLen / 2, 0]} castShadow>
          <cylinderGeometry args={[limbR * 0.9, limbR * 0.9, shinLen, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

/* ────────────────────────── 道具 ────────────────────────── */

interface PropObjectProps {
  prop: DirectorProp;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DirectorProp>) => void;
  gizmoMode: GizmoMode;
  showLabel?: boolean;
  snap?: boolean;
  locked?: boolean;
}

function PropObject({ prop, selected, onSelect, onChange, gizmoMode, showLabel, snap, locked }: PropObjectProps) {
  const groupRef = React.useRef<THREE.Group>(null);

  const onTransform = () => {
    const g = groupRef.current;
    if (!g) return;
    onChange({
      pos: [g.position.x, g.position.y, g.position.z],
      rotY: g.rotation.y,
      scale: g.scale.x,
    });
  };

  return (
    <>
      <group
        ref={groupRef}
        position={prop.pos}
        rotation={[0, prop.rotY, 0]}
        scale={prop.scale}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <PropMesh kind={prop.kind} highlight={selected} />
        {showLabel && <SceneLabel y={1.3} text={prop.name} accent={selected} />}
      </group>
      {selected && !locked && (
        <TransformControls
          object={groupRef as unknown as React.RefObject<THREE.Object3D>}
          mode={gizmoMode === "scale" ? "scale" : gizmoMode}
          onObjectChange={onTransform}
          size={0.7}
          translationSnap={snap ? 0.5 : null}
          rotationSnap={snap ? Math.PI / 12 : null}
          scaleSnap={snap ? 0.1 : null}
        />
      )}
    </>
  );
}

/* ────────────────────────── 相机 Gizmo ────────────────────────── */

interface CameraGizmoProps {
  camera: DirectorCamera;
  isActive: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DirectorCamera>) => void;
  gizmoMode: GizmoMode;
  showLabel?: boolean;
  snap?: boolean;
}

function CameraGizmo({ camera, isActive, selected, onSelect, onChange, gizmoMode, showLabel, snap }: CameraGizmoProps) {
  const groupRef = React.useRef<THREE.Group>(null);

  // 朝向 lookAt
  React.useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.lookAt(new THREE.Vector3(...camera.lookAt));
  }, [camera.lookAt, camera.pos]);

  const onTransform = () => {
    const g = groupRef.current;
    if (!g) return;
    onChange({ pos: [g.position.x, g.position.y, g.position.z] });
  };

  const color = isActive ? "#ff5577" : selected ? "#ffaa44" : "#aaccff";
  // 简单的视锥 frustum 可视化
  const aspect = 16 / 9;
  const near = 0.5;
  const far = 2.5;
  const halfH = Math.tan((camera.fov * Math.PI) / 360) * far;
  const halfW = halfH * aspect;

  return (
    <>
      <group
        ref={groupRef}
        position={camera.pos}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        {/* 相机壳体 */}
        <mesh>
          <boxGeometry args={[0.3, 0.22, 0.4]} />
          <meshStandardMaterial color={color} />
        </mesh>
        {/* 镜头 */}
        <mesh position={[0, 0, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.1, 16]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        {/* 视锥线框 */}
        <FrustumLines near={near} far={far} halfW={halfW} halfH={halfH} color={color} />
        {showLabel && <SceneLabel y={0.5} text={camera.name} accent={selected || isActive} />}
      </group>
      {selected && (
        <TransformControls
          object={groupRef as unknown as React.RefObject<THREE.Object3D>}
          mode={gizmoMode === "rotate" ? "rotate" : "translate"}
          onObjectChange={onTransform}
          size={0.6}
          translationSnap={snap ? 0.5 : null}
          rotationSnap={snap ? Math.PI / 12 : null}
        />
      )}
    </>
  );
}

function FrustumLines({
  near, far, halfW, halfH, color,
}: { near: number; far: number; halfW: number; halfH: number; color: string }) {
  const points = React.useMemo(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // 4 条从光心到远平面 4 角的线
    const tl = v(-halfW,  halfH, far);
    const tr = v( halfW,  halfH, far);
    const bl = v(-halfW, -halfH, far);
    const br = v( halfW, -halfH, far);
    const o = v(0, 0, 0);
    return [
      o, tl, o, tr, o, br, o, bl,
      // 远平面四边
      tl, tr, tr, br, br, bl, bl, tl,
    ];
  }, [near, far, halfW, halfH]);

  const geom = React.useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return g;
  }, [points]);

  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color={color} transparent opacity={0.6} />
    </lineSegments>
  );
}

/* ────────────────────────── 预览视图 sync ────────────────────────── */

/**
 * 把预览 Canvas 内的相机同步成 activeCamera 的参数（位置 + lookAt + FOV）。
 * 这样右下角小窗实时反映主机位画面。
 */
function PreviewCameraSync({
  camera, characters,
}: { camera: DirectorCamera; characters: DirectorCharacter[] }) {
  const { camera: cam } = useThree();
  useFrame(() => {
    cam.position.set(...camera.pos);
    if (cam instanceof THREE.PerspectiveCamera) {
      // r3f / three.js 的标准模式：每帧 mutate 相机参数，lint 误报
      // eslint-disable-next-line
      cam.fov = camera.fov;
      cam.updateProjectionMatrix();
    }
    if (camera.lookAtMode !== "manual") {
      const targetChar = characters.find((c) => c.id === camera.lookAtMode);
      if (targetChar) {
        cam.lookAt(targetChar.pos[0], targetChar.pos[1] + 1.2, targetChar.pos[2]);
        return;
      }
    }
    cam.lookAt(...camera.lookAt);
  });
  return null;
}

/* ────────────────────────── 属性面板 ────────────────────────── */

function PropertiesPanel({
  character, camera, prop, characters,
  onCharacterChange, onCameraChange, onPropChange,
  onDuplicate, onDelete, onClose,
}: {
  character: DirectorCharacter | null;
  camera: DirectorCamera | null;
  prop: DirectorProp | null;
  characters: DirectorCharacter[];
  onCharacterChange: (patch: Partial<DirectorCharacter>) => void;
  onCameraChange: (patch: Partial<DirectorCamera>) => void;
  onPropChange: (patch: Partial<DirectorProp>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // 仅对 character 有 "姿势" tab；camera / prop 时强制为 "属性"
  const [tab, setTab] = React.useState<"props" | "pose">("props");
  // React 19 prev-prop-during-render 模式：选中类型变化时强制 tab。
  // 关键：character?.id 在 null 时是 undefined，必须用 ?? null 归一化，否则
  // undefined !== null 永远为 true，触发 setLastCharId 无限循环。
  const charId = character?.id ?? null;
  const [lastCharId, setLastCharId] = React.useState<string | null>(charId);
  if (charId !== lastCharId) {
    setLastCharId(charId);
    if (!character) setTab("props");
  }

  return (
    <div className="absolute right-4 top-14 z-20 flex max-h-[calc(100vh-22rem)] w-80 flex-col rounded-xl border border-white/[0.06] bg-[#101015]/90 text-zinc-200 backdrop-blur-xl shadow-2xl shadow-black/40">
      {/* 头部：tabs + 关闭 */}
      <div className="flex items-center border-b border-white/[0.06] px-3 pt-2">
        <div className="flex flex-1 items-center gap-3">
          <button
            type="button"
            onClick={() => setTab("props")}
            className={cn(
              "relative pb-2 text-xs font-medium transition-colors",
              tab === "props" ? "text-amber-300" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            属性
            {tab === "props" && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-amber-400" />}
          </button>
          {character && (
            <button
              type="button"
              onClick={() => setTab("pose")}
              className={cn(
                "relative pb-2 text-xs font-medium transition-colors",
                tab === "pose" ? "text-amber-300" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              姿势
              {tab === "pose" && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-amber-400" />}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pb-2 text-zinc-500 hover:text-zinc-100"
        >
          ✕
        </button>
      </div>

      {/* 内容区可滚动 */}
      <div className="flex-1 overflow-y-auto p-3">

      {character && tab === "props" && (
        <div className="space-y-3">
          <Field label="名称">
            <Input
              value={character.name}
              onChange={(e) => onCharacterChange({ name: e.target.value })}
              className="h-7 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100 focus-visible:border-amber-400/50"
            />
          </Field>
          <Vec3Field label="位置" value={character.pos} onChange={(v) => onCharacterChange({ pos: v })} />
          <Field label={`旋转（Y 轴）· ${(character.rotY * 180 / Math.PI).toFixed(0)}°`}>
            <Slider
              min={-180} max={180} step={1}
              value={character.rotY * 180 / Math.PI}
              onChange={(v) => onCharacterChange({ rotY: (v * Math.PI) / 180 })}
            />
          </Field>
          <Field label={`缩放 · ${character.scale.toFixed(2)}`}>
            <Slider
              min={0.5} max={2} step={0.05}
              value={character.scale}
              onChange={(v) => onCharacterChange({ scale: v })}
            />
          </Field>
          <Field label="体型">
            <select
              value={character.build ?? "standard"}
              onChange={(e) => onCharacterChange({ build: e.target.value as DirectorCharacter["build"] })}
              className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-100 focus-visible:border-amber-400/50 focus-visible:outline-none"
            >
              <option value="standard">🤖 标准素体</option>
              <option value="female">👩 女性素体</option>
              <option value="child">🧒 儿童素体</option>
              <option value="heavy">💪 壮实素体</option>
              <option value="slim">🦒 纤细素体</option>
            </select>
          </Field>
          <Field label="颜色">
            <ColorPickerField
              value={character.color ?? "#cccccc"}
              onChange={(c) => onCharacterChange({ color: c })}
            />
          </Field>
        </div>
      )}

      {character && tab === "pose" && (
        <PoseEditor
          pose={character.pose ?? DEFAULT_POSE}
          onPoseChange={(patch) =>
            onCharacterChange({
              pose: { ...(character.pose ?? DEFAULT_POSE), ...patch },
            })
          }
          onResetPose={() => onCharacterChange({ pose: DEFAULT_POSE })}
        />
      )}

      {prop && (
        <div className="space-y-3">
          <Field label="名称">
            <Input
              value={prop.name}
              onChange={(e) => onPropChange({ name: e.target.value })}
              className="h-7 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100 focus-visible:border-amber-400/50"
            />
          </Field>
          <Vec3Field label="位置" value={prop.pos} onChange={(v) => onPropChange({ pos: v })} />
          <Field label={`旋转（Y 轴）· ${(prop.rotY * 180 / Math.PI).toFixed(0)}°`}>
            <Slider
              min={-180} max={180} step={1}
              value={prop.rotY * 180 / Math.PI}
              onChange={(v) => onPropChange({ rotY: (v * Math.PI) / 180 })}
            />
          </Field>
          <Field label={`缩放 · ${prop.scale.toFixed(2)}`}>
            <Slider
              min={0.3} max={3} step={0.05}
              value={prop.scale}
              onChange={(v) => onPropChange({ scale: v })}
            />
          </Field>
        </div>
      )}

      {camera && (
        <div className="space-y-3">
          <Field label="名称">
            <Input
              value={camera.name}
              onChange={(e) => onCameraChange({ name: e.target.value })}
              className="h-7 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100 focus-visible:border-amber-400/50"
            />
          </Field>
          <Vec3Field label="位置" value={camera.pos} onChange={(v) => onCameraChange({ pos: v })} />
          <Field label="LookAt 目标">
            <select
              value={camera.lookAtMode}
              onChange={(e) => onCameraChange({ lookAtMode: e.target.value })}
              className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-100 focus-visible:border-amber-400/50 focus-visible:outline-none"
            >
              <option value="manual">手动坐标</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>跟随：{c.name}</option>
              ))}
            </select>
          </Field>
          {camera.lookAtMode === "manual" && (
            <Vec3Field
              label="LookAt 坐标"
              value={camera.lookAt}
              onChange={(v) => onCameraChange({ lookAt: v })}
            />
          )}
          <Field label={`FOV · ${camera.fov}°`}>
            <Slider
              min={20} max={120} step={1}
              value={camera.fov}
              onChange={(v) => onCameraChange({ fov: v })}
            />
          </Field>
        </div>
      )}

      </div>

      {/* 底部操作 */}
      <div className="flex gap-2 border-t border-white/[0.06] p-3">
        <Button
          size="sm"
          className="flex-1 border border-zinc-700/70 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800"
          onClick={onDuplicate}
        >
          复制
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-red-500/90 text-zinc-50 hover:bg-red-500"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />删除
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────── 姿势编辑器 ────────────────────────── */

function PoseEditor({
  pose, onPoseChange, onResetPose,
}: {
  pose: DirectorCharacterPose;
  onPoseChange: (patch: Partial<DirectorCharacterPose>) => void;
  onResetPose: () => void;
}) {
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      {/* ─── 姿势预设 ─── */}
      <div>
        <div className="mb-2 flex items-center">
          <Label className="text-[10px] uppercase tracking-widest text-zinc-500">姿势预设</Label>
          <button
            type="button"
            onClick={() => { onResetPose(); setActivePresetId("stand"); }}
            className="ml-auto flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
          >
            <RotateCcw className="size-3" />重置
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {POSE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPoseChange(p.pose);
                setActivePresetId(p.id);
              }}
              className={cn(
                "rounded-md border px-1 py-1 text-[10.5px] transition-colors",
                activePresetId === p.id
                  ? "border-amber-400/40 bg-amber-400/15 text-amber-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-amber-400/30 hover:bg-amber-400/5",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 身体 ─── */}
      <PoseSection title="身体">
        <PoseGroupLabel>身体</PoseGroupLabel>
        <DegreeRow label="前倾" min={-45} max={45}
          rad={pose.bodyTilt} onRad={(v) => onPoseChange({ bodyTilt: v })} />
        <DegreeRow label="转身" min={-90} max={90}
          rad={pose.bodyTwist} onRad={(v) => onPoseChange({ bodyTwist: v })} />
        <DegreeRow label="侧倾" min={-45} max={45}
          rad={pose.bodyLean} onRad={(v) => onPoseChange({ bodyLean: v })} />

        <PoseGroupLabel>躯干</PoseGroupLabel>
        <DegreeRow label="前倾" min={-45} max={45}
          rad={pose.torsoTilt} onRad={(v) => onPoseChange({ torsoTilt: v })} />
        <DegreeRow label="扭转" min={-90} max={90}
          rad={pose.torsoTwist} onRad={(v) => onPoseChange({ torsoTwist: v })} />
        <DegreeRow label="侧倾" min={-30} max={30}
          rad={pose.torsoLean} onRad={(v) => onPoseChange({ torsoLean: v })} />

        <PoseGroupLabel>头部</PoseGroupLabel>
        <DegreeRow label="点头" min={-60} max={60}
          rad={pose.headPitch} onRad={(v) => onPoseChange({ headPitch: v })} />
        <DegreeRow label="转头" min={-90} max={90}
          rad={pose.headYaw} onRad={(v) => onPoseChange({ headYaw: v })} />
        <DegreeRow label="歪头" min={-45} max={45}
          rad={pose.headRoll} onRad={(v) => onPoseChange({ headRoll: v })} />
      </PoseSection>

      {/* ─── 手臂 ─── */}
      <PoseSection title="手臂">
        <PoseGroupLabel>肩</PoseGroupLabel>
        <SideHeader />
        <DegreeRow label="前举" side="L" min={-180} max={45}
          rad={pose.shoulderL.forward}
          onRad={(v) => onPoseChange({ shoulderL: { ...pose.shoulderL, forward: v } })} />
        <DegreeRow label="外展" side="L" min={-90} max={120}
          rad={pose.shoulderL.out}
          onRad={(v) => onPoseChange({ shoulderL: { ...pose.shoulderL, out: v } })} />
        <DegreeRow label="扭转" side="L" min={-90} max={90}
          rad={pose.shoulderL.twist}
          onRad={(v) => onPoseChange({ shoulderL: { ...pose.shoulderL, twist: v } })} />
        <DegreeRow label="前举" side="R" min={-180} max={45}
          rad={pose.shoulderR.forward}
          onRad={(v) => onPoseChange({ shoulderR: { ...pose.shoulderR, forward: v } })} />
        <DegreeRow label="外展" side="R" min={-120} max={90}
          rad={pose.shoulderR.out}
          onRad={(v) => onPoseChange({ shoulderR: { ...pose.shoulderR, out: v } })} />
        <DegreeRow label="扭转" side="R" min={-90} max={90}
          rad={pose.shoulderR.twist}
          onRad={(v) => onPoseChange({ shoulderR: { ...pose.shoulderR, twist: v } })} />

        <PoseGroupLabel>肘</PoseGroupLabel>
        <DegreeRow label="弯曲" side="L" min={0} max={150}
          rad={pose.elbowL} onRad={(v) => onPoseChange({ elbowL: v })} />
        <DegreeRow label="弯曲" side="R" min={0} max={150}
          rad={pose.elbowR} onRad={(v) => onPoseChange({ elbowR: v })} />
      </PoseSection>

      {/* ─── 腿部 ─── */}
      <PoseSection title="腿部">
        <PoseGroupLabel>髋</PoseGroupLabel>
        <SideHeader />
        <DegreeRow label="前抬" side="L" min={-30} max={120}
          rad={pose.hipL.forward}
          onRad={(v) => onPoseChange({ hipL: { ...pose.hipL, forward: v } })} />
        <DegreeRow label="外展" side="L" min={-30} max={45}
          rad={pose.hipL.out}
          onRad={(v) => onPoseChange({ hipL: { ...pose.hipL, out: v } })} />
        <DegreeRow label="扭转" side="L" min={-45} max={45}
          rad={pose.hipL.twist}
          onRad={(v) => onPoseChange({ hipL: { ...pose.hipL, twist: v } })} />
        <DegreeRow label="前抬" side="R" min={-30} max={120}
          rad={pose.hipR.forward}
          onRad={(v) => onPoseChange({ hipR: { ...pose.hipR, forward: v } })} />
        <DegreeRow label="外展" side="R" min={-45} max={30}
          rad={pose.hipR.out}
          onRad={(v) => onPoseChange({ hipR: { ...pose.hipR, out: v } })} />
        <DegreeRow label="扭转" side="R" min={-45} max={45}
          rad={pose.hipR.twist}
          onRad={(v) => onPoseChange({ hipR: { ...pose.hipR, twist: v } })} />

        <PoseGroupLabel>膝</PoseGroupLabel>
        <DegreeRow label="弯曲" side="L" min={0} max={150}
          rad={pose.kneeL} onRad={(v) => onPoseChange({ kneeL: v })} />
        <DegreeRow label="弯曲" side="R" min={0} max={150}
          rad={pose.kneeR} onRad={(v) => onPoseChange({ kneeR: v })} />
      </PoseSection>
    </div>
  );
}

function PoseSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium tracking-wider text-zinc-300">{title}</div>
      <div className="space-y-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2">
        {children}
      </div>
    </div>
  );
}

function PoseGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 pb-0.5 text-[10px] font-medium tracking-wider text-zinc-500">{children}</div>
  );
}

function SideHeader() {
  return null; // 占位（视觉用 row 内的 L/R 徽章表示）
}

function DegreeRow({
  label, min, max, rad, onRad, side,
}: {
  label: string;
  min: number;
  max: number;
  /** 当前值（弧度） */
  rad: number;
  onRad: (rad: number) => void;
  side?: "L" | "R";
}) {
  const deg = Math.round((rad * 180) / Math.PI);
  return (
    <div className="grid grid-cols-[18px_36px_1fr_28px] items-center gap-1.5 text-[10.5px]">
      {side ? (
        <span className={cn(
          "rounded text-center text-[9px] font-bold",
          side === "L" ? "bg-amber-400/20 text-amber-200" : "bg-zinc-700/40 text-zinc-300",
        )}>{side === "L" ? "左" : "右"}</span>
      ) : <span />}
      <span className="text-zinc-400">{label}</span>
      <input
        type="range"
        min={min} max={max} step={1}
        value={deg}
        onChange={(e) => onRad((Number(e.target.value) * Math.PI) / 180)}
        className="h-1 w-full appearance-none rounded-full bg-zinc-800 accent-amber-400"
      />
      <span className="text-right tabular-nums text-zinc-500">{deg}°</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</Label>
      {children}
    </div>
  );
}

/**
 * 颜色选择 —— 色板按钮 + hex 文本输入 + 8 个快捷色板。
 */
function ColorPickerField({
  value, onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const swatches = ["#cccccc", "#d0c0d8", "#e0c8b0", "#b8b8c0", "#c8c8d0", "#3a8eff", "#ff7a59", "#5b8a3a"];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="relative h-9 w-12 overflow-hidden rounded-md border-2 border-zinc-700/70 transition-colors hover:border-amber-400/50"
          style={{ backgroundColor: value }}
          aria-label="打开颜色选择器"
        >
          <input
            ref={inputRef}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-hidden
          />
        </button>
        <input
          value={value.toUpperCase()}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
              onChange(v.startsWith("#") ? v : `#${v}`);
            }
          }}
          spellCheck={false}
          className="h-7 flex-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 font-mono text-[11px] tabular-nums text-zinc-100 focus-visible:border-amber-400/50 focus-visible:outline-none"
        />
      </div>
      <div className="flex gap-1">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              "h-5 w-5 rounded-md border transition-transform hover:scale-110",
              s.toLowerCase() === value.toLowerCase()
                ? "border-amber-400/70 ring-1 ring-amber-400/40"
                : "border-zinc-700/60",
            )}
            style={{ backgroundColor: s }}
            aria-label={`快捷色 ${s}`}
          />
        ))}
      </div>
    </div>
  );
}

function Vec3Field({
  label, value, onChange,
}: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}) {
  const set = (idx: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [...value] as [number, number, number];
    next[idx] = isNaN(v) ? 0 : v;
    onChange(next);
  };
  // 三轴用三种主色提示（红 X / 绿 Y / 蓝 Z），跟 3D 主轴呼应
  const axisColors = ["text-rose-400/80", "text-emerald-400/80", "text-sky-400/80"];
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</Label>
      <div className="grid grid-cols-3 gap-1.5">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <div key={axis} className="relative">
            <span className={cn(
              "absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-medium",
              axisColors[i],
            )}>
              {axis}
            </span>
            <Input
              type="number"
              step={0.1}
              value={Number(value[i].toFixed(2))}
              onChange={(e) => set(i as 0 | 1 | 2, parseFloat(e.target.value))}
              className="h-7 border-zinc-800 bg-zinc-900/60 pl-5 text-[11px] tabular-nums text-zinc-100 focus-visible:border-amber-400/50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
