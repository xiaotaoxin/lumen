/**
 * 角色姿势预设 —— 用度数填，工具函数转弧度。
 * 每个预设是 DirectorCharacterPose 的 partial，缺省字段=默认站立的 0。
 */

import type { DirectorCharacterPose } from "../types";

const D2R = Math.PI / 180;

function deg(x: number): number {
  return x * D2R;
}

export const DEFAULT_POSE: DirectorCharacterPose = {
  bodyTilt: 0, bodyTwist: 0, bodyLean: 0,
  torsoTilt: 0, torsoTwist: 0, torsoLean: 0,
  headPitch: 0, headYaw: 0, headRoll: 0,
  shoulderL: { forward: 0, out: 0, twist: 0 },
  shoulderR: { forward: 0, out: 0, twist: 0 },
  elbowL: 0, elbowR: 0,
  hipL: { forward: 0, out: 0, twist: 0 },
  hipR: { forward: 0, out: 0, twist: 0 },
  kneeL: 0, kneeR: 0,
};

function makePose(patch: Partial<{
  bodyTilt: number; bodyTwist: number; bodyLean: number;
  torsoTilt: number; torsoTwist: number; torsoLean: number;
  headPitch: number; headYaw: number; headRoll: number;
  shoulderL: Partial<DirectorCharacterPose["shoulderL"]>;
  shoulderR: Partial<DirectorCharacterPose["shoulderR"]>;
  elbowL: number; elbowR: number;
  hipL: Partial<DirectorCharacterPose["hipL"]>;
  hipR: Partial<DirectorCharacterPose["hipR"]>;
  kneeL: number; kneeR: number;
}>): DirectorCharacterPose {
  return {
    ...DEFAULT_POSE,
    ...patch,
    shoulderL: { ...DEFAULT_POSE.shoulderL, ...(patch.shoulderL ?? {}) },
    shoulderR: { ...DEFAULT_POSE.shoulderR, ...(patch.shoulderR ?? {}) },
    hipL: { ...DEFAULT_POSE.hipL, ...(patch.hipL ?? {}) },
    hipR: { ...DEFAULT_POSE.hipR, ...(patch.hipR ?? {}) },
  };
}

export interface PosePreset {
  id: string;
  name: string;
  pose: DirectorCharacterPose;
}

/* ───────────────────────── 一组常用姿势预设（28 个） ───────────────────────── */

export const POSE_PRESETS: PosePreset[] = [
  { id: "stand",     name: "站立", pose: makePose({}) },
  { id: "tpose",     name: "T 型", pose: makePose({
      shoulderL: { out: deg(-90) }, shoulderR: { out: deg(90) },
    }) },
  { id: "walk",      name: "行走", pose: makePose({
      shoulderL: { forward: deg(-25) }, shoulderR: { forward: deg(25) },
      elbowL: deg(20), elbowR: deg(20),
      hipL: { forward: deg(20) }, hipR: { forward: deg(-20) },
      kneeL: deg(15), kneeR: deg(5),
    }) },
  { id: "run",       name: "跑步", pose: makePose({
      bodyTilt: deg(15),
      shoulderL: { forward: deg(-50) }, shoulderR: { forward: deg(60) },
      elbowL: deg(80), elbowR: deg(80),
      hipL: { forward: deg(45) }, hipR: { forward: deg(-30) },
      kneeL: deg(60), kneeR: deg(20),
    }) },
  { id: "jump",      name: "跳跃", pose: makePose({
      shoulderL: { forward: deg(-100), out: deg(20) },
      shoulderR: { forward: deg(-100), out: deg(-20) },
      elbowL: deg(20), elbowR: deg(20),
      hipL: { forward: deg(20) }, hipR: { forward: deg(20) },
      kneeL: deg(40), kneeR: deg(40),
    }) },
  { id: "crouch",    name: "蹲伏", pose: makePose({
      bodyTilt: deg(20),
      hipL: { forward: deg(80) }, hipR: { forward: deg(80) },
      kneeL: deg(120), kneeR: deg(120),
    }) },
  { id: "surrender", name: "投降", pose: makePose({
      shoulderL: { forward: deg(-180), out: deg(-30) },
      shoulderR: { forward: deg(-180), out: deg(30) },
      elbowL: deg(20), elbowR: deg(20),
    }) },
  { id: "push",      name: "推", pose: makePose({
      bodyTilt: deg(15),
      shoulderL: { forward: deg(-90) }, shoulderR: { forward: deg(-90) },
      elbowL: deg(20), elbowR: deg(20),
    }) },
  { id: "sit",       name: "坐姿", pose: makePose({
      hipL: { forward: deg(90) }, hipR: { forward: deg(90) },
      kneeL: deg(90), kneeR: deg(90),
    }) },
  { id: "kneel-one", name: "单膝跪", pose: makePose({
      hipL: { forward: deg(0) }, kneeL: deg(0),
      hipR: { forward: deg(90) }, kneeR: deg(150),
    }) },
  { id: "kneel-both", name: "双膝跪", pose: makePose({
      hipL: { forward: deg(60) }, hipR: { forward: deg(60) },
      kneeL: deg(150), kneeR: deg(150),
    }) },
  { id: "wave",      name: "招手", pose: makePose({
      shoulderR: { forward: deg(-150), out: deg(20) },
      elbowR: deg(60),
    }) },
  { id: "point",     name: "指向", pose: makePose({
      shoulderR: { forward: deg(-90) },
      elbowR: deg(0),
    }) },
  { id: "raise-hand", name: "举手", pose: makePose({
      shoulderL: { forward: deg(-170) },
      elbowL: deg(0),
    }) },
  { id: "celebrate", name: "庆祝", pose: makePose({
      shoulderL: { forward: deg(-160), out: deg(-30) },
      shoulderR: { forward: deg(-160), out: deg(30) },
      elbowL: deg(30), elbowR: deg(30),
      headPitch: deg(-15),
    }) },
  { id: "bow",       name: "鞠躬", pose: makePose({
      bodyTilt: deg(45),
      headPitch: deg(15),
    }) },
  { id: "speak",     name: "演讲", pose: makePose({
      shoulderL: { forward: deg(-40), out: deg(-20) },
      shoulderR: { forward: deg(-40), out: deg(20) },
      elbowL: deg(80), elbowR: deg(80),
    }) },
  { id: "akimbo",    name: "叉腰", pose: makePose({
      shoulderL: { out: deg(-50) }, shoulderR: { out: deg(50) },
      elbowL: deg(110), elbowR: deg(110),
    }) },
  { id: "think",     name: "思考", pose: makePose({
      shoulderR: { forward: deg(-50), out: deg(20) },
      elbowR: deg(140),
      headPitch: deg(10), headYaw: deg(15),
    }) },
  { id: "lean",      name: "倚靠", pose: makePose({
      bodyLean: deg(-15),
      shoulderL: { out: deg(-15) }, shoulderR: { out: deg(15) },
      hipL: { out: deg(-5) }, hipR: { out: deg(5) },
    }) },
  { id: "stretch",   name: "伸懒腰", pose: makePose({
      bodyTilt: deg(-10),
      shoulderL: { forward: deg(-160), out: deg(-15) },
      shoulderR: { forward: deg(-160), out: deg(15) },
    }) },
  { id: "phone",     name: "看手机", pose: makePose({
      shoulderL: { forward: deg(-50) }, shoulderR: { forward: deg(-50) },
      elbowL: deg(110), elbowR: deg(110),
      headPitch: deg(35),
    }) },
  { id: "photo",     name: "拍照", pose: makePose({
      shoulderL: { forward: deg(-90), out: deg(-15) },
      shoulderR: { forward: deg(-90), out: deg(15) },
      elbowL: deg(70), elbowR: deg(70),
    }) },
  { id: "fight",     name: "格斗", pose: makePose({
      bodyTwist: deg(20),
      shoulderL: { forward: deg(-60), out: deg(-10) },
      shoulderR: { forward: deg(-90), out: deg(10) },
      elbowL: deg(90), elbowR: deg(60),
      hipL: { forward: deg(20) }, hipR: { forward: deg(-15) },
      kneeL: deg(20), kneeR: deg(15),
    }) },
  { id: "dance",     name: "舞蹈", pose: makePose({
      bodyLean: deg(10), bodyTwist: deg(15),
      shoulderL: { forward: deg(-100), out: deg(-30) },
      shoulderR: { forward: deg(0), out: deg(60) },
      elbowL: deg(60), elbowR: deg(40),
      hipL: { out: deg(-15) }, hipR: { out: deg(5) },
      kneeR: deg(20),
    }) },
];
