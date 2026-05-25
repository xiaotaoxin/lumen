/**
 * 导演台资产库预设。所有"添加什么"的元数据都在这里，UI 仅渲染。
 *
 * 4 类资产：
 *   - prop      场景道具（家具 / 树 / 车 / 标记）
 *   - character 角色素体（不同体型 / 性别 / 年龄）
 *   - camera    机位预设（位置 + lookAt + FOV）
 *   - template  模板（一次铺一组角色 + 机位 + 道具）
 *
 * 预设值都是小型 JSON —— 不引入 3D 模型 / 纹理资源。后续接 GLB 时
 * 在这里加 modelUrl 字段，渲染器按 kind 分流即可。
 */

import type {
  DirectorProp,
  DirectorPropKind,
  DirectorCharacter,
  DirectorCamera,
} from "../types";

/* ───────────────────────── 道具 ───────────────────────── */

export interface PropPreset {
  id: string;
  kind: DirectorPropKind;
  name: string;
  /** Emoji icon（先用 emoji 占位，将来换专属 svg 图标） */
  icon: string;
}

export const PROP_PRESETS: PropPreset[] = [
  { id: "chair",        kind: "chair",        name: "椅子",   icon: "🪑" },
  { id: "table-square", kind: "table-square", name: "方桌",   icon: "🟫" },
  { id: "table-round",  kind: "table-round",  name: "圆桌",   icon: "🟠" },
  { id: "sofa",         kind: "sofa",         name: "沙发",   icon: "🛋️" },
  { id: "wall-2m",      kind: "wall-2m",      name: "墙段 2m", icon: "🧱" },
  { id: "wall-3m",      kind: "wall-3m",      name: "墙段 3m", icon: "🧱" },
  { id: "column",       kind: "column",       name: "柱子",   icon: "🏛️" },
  { id: "stairs",       kind: "stairs",       name: "楼梯段", icon: "📐" },
  { id: "tree-small",   kind: "tree-small",   name: "小树",   icon: "🌱" },
  { id: "tree-large",   kind: "tree-large",   name: "大树",   icon: "🌳" },
  { id: "rock",         kind: "rock",         name: "石头",   icon: "🪨" },
  { id: "bush",         kind: "bush",         name: "灌木",   icon: "🌿" },
  { id: "car",          kind: "car",          name: "轿车",   icon: "🚗" },
  { id: "bike",         kind: "bike",         name: "自行车", icon: "🚲" },
  { id: "lamp",         kind: "lamp",         name: "路灯",   icon: "💡" },
  { id: "bench",        kind: "bench",        name: "长椅",   icon: "🪑" },
  { id: "trash-bin",    kind: "trash-bin",    name: "垃圾桶", icon: "🗑️" },
  { id: "arrow",        kind: "arrow",        name: "方向箭头", icon: "➡️" },
  { id: "marker",       kind: "marker",       name: "区域标记", icon: "🟦" },
];

/* ───────────────────────── 人物素体 ───────────────────────── */

export interface CharacterPreset {
  id: string;
  name: string;
  hint: string;
  icon: string;
  build: NonNullable<DirectorCharacter["build"]>;
  scale: number;
  color: string;
  /** 一次添加几个 —— 群众用 */
  count?: number;
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: "standard", name: "标准素体", hint: "标准关节人偶",   icon: "🤖", build: "standard", scale: 1.00, color: "#cccccc" },
  { id: "female",   name: "女性素体", hint: "女性比例关节人偶", icon: "👩", build: "female",   scale: 0.95, color: "#d0c0d8" },
  { id: "child",    name: "儿童素体", hint: "儿童比例关节人偶", icon: "🧒", build: "child",    scale: 0.7,  color: "#e0c8b0" },
  { id: "heavy",    name: "壮实素体", hint: "壮实体型关节人偶", icon: "💪", build: "heavy",    scale: 1.05, color: "#b8b8c0" },
  { id: "slim",     name: "纤细素体", hint: "高挑纤细关节人偶", icon: "🦒", build: "slim",     scale: 1.10, color: "#c8c8d0" },
  { id: "crowd-3",  name: "群众 (3人)", hint: "一排 3 个素体人偶", icon: "👥", build: "standard", scale: 1.00, color: "#bcbcbc", count: 3 },
  { id: "crowd-5",  name: "群众 (5人)", hint: "一排 5 个素体人偶", icon: "👨‍👩‍👧‍👦", build: "standard", scale: 1.00, color: "#bcbcbc", count: 5 },
];

/* ───────────────────────── 机位预设 ───────────────────────── */

export interface CameraPreset {
  id: string;
  name: string;
  pos: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "front-mid",       name: "正面中景",   pos: [0, 1.5, 4],    lookAt: [0, 1.2, 0], fov: 50 },
  { id: "front-close",     name: "正面特写",   pos: [0, 1.65, 1.5], lookAt: [0, 1.6, 0], fov: 35 },
  { id: "front-wide",      name: "正面全景",   pos: [0, 2, 8],      lookAt: [0, 1, 0],   fov: 50 },
  { id: "side-tracking",   name: "侧面跟拍",   pos: [4, 1.5, 0],    lookAt: [0, 1.2, 0], fov: 50 },
  { id: "side-close",      name: "侧面近景",   pos: [2, 1.5, 0],    lookAt: [0, 1.5, 0], fov: 35 },
  { id: "back-mid",        name: "背面中景",   pos: [0, 1.5, -4],   lookAt: [0, 1.2, 0], fov: 50 },
  { id: "high-wide",       name: "俯拍全景",   pos: [0, 8, 5],      lookAt: [0, 0, 0],   fov: 60 },
  { id: "high-45",         name: "45° 俯拍",   pos: [4, 4, 4],      lookAt: [0, 1, 0],   fov: 50 },
  { id: "low-up",          name: "低角度仰拍", pos: [0, 0.5, 3],    lookAt: [0, 1.5, 0], fov: 50 },
  { id: "low-wide",        name: "低角度广角", pos: [0, 0.3, 2],    lookAt: [0, 1.5, 0], fov: 80 },
  { id: "ots-left",        name: "过肩镜头",   pos: [-0.6, 1.6, -1.5], lookAt: [0.5, 1.5, 1], fov: 45 },
  { id: "ots-right",       name: "过肩镜头 (右)", pos: [0.6, 1.6, -1.5],  lookAt: [-0.5, 1.5, 1], fov: 45 },
  { id: "birdseye",        name: "鸟瞰",       pos: [0, 15, 0.01],  lookAt: [0, 0, 0],   fov: 60 },
  { id: "dutch",           name: "荷兰角",     pos: [3, 1.5, 3],    lookAt: [0, 1.2, 0], fov: 50 },
  { id: "long-tracking",   name: "远景跟踪",   pos: [10, 2, 10],    lookAt: [0, 1, 0],   fov: 35 },
  { id: "pov",             name: "POV 第一视角", pos: [0, 1.65, 0.3], lookAt: [0, 1.5, 5], fov: 70 },
];

/* ───────────────────────── 模板 ───────────────────────── */

export interface TemplatePreset {
  id: string;
  name: string;
  hint: string;
  icon: string;
  characters: Array<{ build: CharacterPreset["build"]; scale: number; color: string; pos: [number, number, number]; rotY: number; name: string }>;
  cameras: Array<{ presetId: string; nameOverride?: string; lookAtCharacterIdx?: number }>;
  props: Array<{ kind: DirectorPropKind; pos: [number, number, number]; rotY?: number; scale?: number; name?: string }>;
}

const STD = "standard" as const;

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "blank",
    name: "空白场景",
    hint: "纯网格 + 默认机位",
    icon: "📋",
    characters: [],
    cameras: [{ presetId: "front-mid" }],
    props: [],
  },
  {
    id: "dialogue-2",
    name: "对话双人",
    hint: "2 人面对面 + 中景机位",
    icon: "💬",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [-0.7, 0, 0], rotY: Math.PI / 2,  name: "角色A" },
      { build: STD, scale: 1, color: "#bcbcbc", pos: [0.7, 0, 0],  rotY: -Math.PI / 2, name: "角色B" },
    ],
    cameras: [
      { presetId: "side-tracking", nameOverride: "侧面双人" },
      { presetId: "ots-left", nameOverride: "过肩 A→B" },
      { presetId: "ots-right", nameOverride: "过肩 B→A" },
    ],
    props: [],
  },
  {
    id: "talk-3",
    name: "三人对话",
    hint: "3 人三角站位 + 全景机位",
    icon: "👥",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, 0.6],     rotY: Math.PI, name: "角色A" },
      { build: STD, scale: 1, color: "#b8b8c0", pos: [-0.8, 0, -0.5], rotY: 0.6, name: "角色B" },
      { build: STD, scale: 1, color: "#c0c0c8", pos: [0.8, 0, -0.5],  rotY: -0.6, name: "角色C" },
    ],
    cameras: [{ presetId: "front-wide" }],
    props: [],
  },
  {
    id: "interview",
    name: "采访场景",
    hint: "1 主持 + 1 嘉宾 + 桌子 + 双机位",
    icon: "🎤",
    characters: [
      { build: STD,      scale: 1,    color: "#cccccc", pos: [-0.7, 0, 0], rotY: Math.PI / 2,  name: "主持" },
      { build: "female", scale: 0.95, color: "#d0c0d8", pos: [0.7, 0, 0],  rotY: -Math.PI / 2, name: "嘉宾" },
    ],
    cameras: [
      { presetId: "ots-left",  nameOverride: "主持机位" },
      { presetId: "ots-right", nameOverride: "嘉宾机位" },
    ],
    props: [
      { kind: "table-square", pos: [0, 0, 0], scale: 0.6, name: "采访桌" },
    ],
  },
  {
    id: "monologue",
    name: "独白特写",
    hint: "1 人 + 特写正面机位",
    icon: "🎭",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, 0], rotY: 0, name: "角色A" },
    ],
    cameras: [{ presetId: "front-close" }],
    props: [],
  },
  {
    id: "classroom",
    name: "课堂/演讲",
    hint: "1 讲者 + 3 听众 + 讲台",
    icon: "🎓",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, 1.2],  rotY: Math.PI, name: "讲者" },
      { build: STD, scale: 1, color: "#b8b8c0", pos: [-1.0, 0, -1], rotY: 0, name: "听众1" },
      { build: STD, scale: 1, color: "#bcbcbc", pos: [0, 0, -1],    rotY: 0, name: "听众2" },
      { build: STD, scale: 1, color: "#c0c0c8", pos: [1.0, 0, -1],  rotY: 0, name: "听众3" },
    ],
    cameras: [{ presetId: "back-mid" }],
    props: [
      { kind: "table-square", pos: [0, 0, 1.6], scale: 0.5, name: "讲台" },
    ],
  },
  {
    id: "chase",
    name: "追逐场景",
    hint: "2 人前后 + 侧面跟拍 + 低角度",
    icon: "🏃",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, 0],   rotY: Math.PI / 2, name: "前者" },
      { build: STD, scale: 1, color: "#b8b8c0", pos: [-2, 0, 0],  rotY: Math.PI / 2, name: "追者" },
    ],
    cameras: [
      { presetId: "side-tracking" },
      { presetId: "low-up", nameOverride: "低角度仰拍" },
    ],
    props: [],
  },
  {
    id: "outdoor",
    name: "户外行走",
    hint: "2 人并排 + 侧面跟拍 + 树木路灯",
    icon: "🚶",
    characters: [
      { build: STD,      scale: 1,    color: "#cccccc", pos: [-0.4, 0, 0], rotY: Math.PI / 2, name: "角色A" },
      { build: "female", scale: 0.95, color: "#d0c0d8", pos: [0.4, 0, 0],  rotY: Math.PI / 2, name: "角色B" },
    ],
    cameras: [{ presetId: "side-tracking" }],
    props: [
      { kind: "tree-large", pos: [-3, 0, -2], name: "大树1" },
      { kind: "tree-small", pos: [3, 0, -1.5], name: "小树1" },
      { kind: "lamp",       pos: [-2, 0, 1], name: "路灯1" },
    ],
  },
  {
    id: "conference",
    name: "会议室",
    hint: "4 人围桌 + 全景 + 过肩机位",
    icon: "🏢",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, 1.2],  rotY: Math.PI,        name: "角色A" },
      { build: STD, scale: 1, color: "#b8b8c0", pos: [0, 0, -1.2], rotY: 0,              name: "角色B" },
      { build: STD, scale: 1, color: "#bcbcbc", pos: [-1.4, 0, 0], rotY: Math.PI / 2,    name: "角色C" },
      { build: STD, scale: 1, color: "#c0c0c8", pos: [1.4, 0, 0],  rotY: -Math.PI / 2,   name: "角色D" },
    ],
    cameras: [{ presetId: "high-45" }, { presetId: "ots-left" }],
    props: [
      { kind: "table-square", pos: [0, 0, 0], scale: 1.2, name: "会议桌" },
    ],
  },
  {
    id: "cafe",
    name: "咖啡厅",
    hint: "2 人 + 沙发 + 桌子 + 近景对话",
    icon: "☕",
    characters: [
      { build: STD,      scale: 1,    color: "#cccccc", pos: [-0.6, 0, 0], rotY: Math.PI / 2,  name: "角色A" },
      { build: "female", scale: 0.95, color: "#d0c0d8", pos: [0.6, 0, 0],  rotY: -Math.PI / 2, name: "角色B" },
    ],
    cameras: [{ presetId: "front-mid", nameOverride: "近景对话" }],
    props: [
      { kind: "sofa",         pos: [-1.2, 0, 0], rotY: Math.PI / 2,  name: "沙发1" },
      { kind: "sofa",         pos: [1.2, 0, 0],  rotY: -Math.PI / 2, name: "沙发2" },
      { kind: "table-round",  pos: [0, 0, 0], scale: 0.7, name: "圆桌" },
    ],
  },
  {
    id: "park",
    name: "公园场景",
    hint: "1 人 + 长椅 + 自然环境",
    icon: "🌳",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [0, 0, -0.5], rotY: 0, name: "角色A" },
    ],
    cameras: [{ presetId: "front-wide" }],
    props: [
      { kind: "bench",      pos: [0, 0, -1], name: "长椅" },
      { kind: "tree-large", pos: [-3, 0, -3], name: "大树1" },
      { kind: "tree-small", pos: [3, 0, -2], name: "小树1" },
      { kind: "bush",       pos: [-2, 0, 1.5], name: "灌木1" },
      { kind: "bush",       pos: [2, 0, 2], name: "灌木2" },
    ],
  },
  {
    id: "in-car",
    name: "车内对话",
    hint: "2 人 + 轿车 + POV 与侧面机位",
    icon: "🚗",
    characters: [
      { build: STD, scale: 1, color: "#cccccc", pos: [-0.5, 0, 0], rotY: 0, name: "司机" },
      { build: STD, scale: 1, color: "#b8b8c0", pos: [0.5, 0, 0],  rotY: 0, name: "副驾" },
    ],
    cameras: [{ presetId: "pov" }, { presetId: "side-close" }],
    props: [
      { kind: "car", pos: [0, 0, 0], name: "轿车" },
    ],
  },
];

/* ───────────────────────── 工具：把预设转成实际数据对象 ───────────────────────── */

export function characterFromPreset(p: CharacterPreset, _idx: number): Omit<DirectorCharacter, "id">[] {
  if (!p.count || p.count === 1) {
    return [{
      name: p.name,
      pos: [0, 0, 0],
      rotY: 0,
      scale: p.scale,
      build: p.build,
      color: p.color,
    }];
  }
  // 群众：一排排开
  return Array.from({ length: p.count }).map((_, i) => ({
    name: `${p.name.replace(/\s*\(\d+人?\)/, "")} ${i + 1}`,
    pos: [(i - (p.count! - 1) / 2) * 0.7, 0, 0] as [number, number, number],
    rotY: 0,
    scale: p.scale,
    build: p.build,
    color: p.color,
  }));
}

export function cameraFromPreset(p: CameraPreset, _idx: number, nameOverride?: string): Omit<DirectorCamera, "id"> {
  return {
    name: nameOverride ?? p.name,
    pos: [...p.pos] as [number, number, number],
    lookAtMode: "manual",
    lookAt: [...p.lookAt] as [number, number, number],
    fov: p.fov,
  };
}

export function propFromPreset(p: PropPreset): Omit<DirectorProp, "id"> {
  return {
    kind: p.kind,
    name: p.name,
    pos: [0, 0, 0],
    rotY: 0,
    scale: 1,
  };
}
