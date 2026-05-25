/**
 * 模块级 in-flight 任务注册表 —— 让生成任务的进度跨组件挂载/路由切换保留。
 *
 * 背景：image-to-video 与 text-to-image 是两个不同路由，从一个会话切到另一个
 * 会话时若 kind 不同，整个 page component 会 unmount。React 组件内的 useRef /
 * useState 会丢，导致重挂载后进度回到 0%。把活跃任务的 lastPct / lastGen /
 * cancel 句柄放到模块级 Map 里，新挂载就能查询并订阅。
 *
 * 注意：这只解决"同一标签页内组件 unmount/remount"的场景。多标签页共享、
 * 整页刷新仍然会丢失（需要 BroadcastChannel + localStorage 才能覆盖；
 * 服务端做任务持久化才能彻底解决，目前不在此模块的范围）。
 */

import type { Generation } from "./types";

export interface LiveJob {
  lastPct: number;
  lastGen: Generation;
  cancel: () => void;
  done: boolean;
  finalGen?: Generation;
}

const jobs = new Map<string, LiveJob>();
const subscribers = new Map<string, Set<(job: LiveJob) => void>>();

export function registerJob(id: string, gen: Generation, cancel: () => void): void {
  jobs.set(id, { lastPct: 0, lastGen: gen, cancel, done: false });
}

export function publishProgress(id: string, pct: number, gen: Generation): void {
  const j = jobs.get(id);
  if (!j || j.done) return;
  j.lastPct = pct;
  j.lastGen = gen;
  subscribers.get(id)?.forEach((s) => s(j));
}

export function publishFinal(id: string, finalGen: Generation): void {
  const j = jobs.get(id);
  if (!j) return;
  j.done = true;
  j.finalGen = finalGen;
  j.lastGen = finalGen;
  if (finalGen.status === "succeeded") j.lastPct = 100;
  subscribers.get(id)?.forEach((s) => s(j));
  // 保留 30 秒，让晚到的订阅者也能拿到 final（之后清理避免内存泄漏）
  setTimeout(() => jobs.delete(id), 30_000);
}

export function getLiveJob(id: string): LiveJob | undefined {
  return jobs.get(id);
}

export function isJobLive(id: string): boolean {
  const j = jobs.get(id);
  return !!j && !j.done;
}

/**
 * 订阅指定任务的进度/完成事件。订阅时会立即用当前状态触发一次回调
 * （便于新挂载的组件追上进度）。返回值是退订函数。
 */
export function subscribeJob(id: string, callback: (job: LiveJob) => void): () => void {
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(callback);
  const j = jobs.get(id);
  if (j) callback(j);
  return () => {
    set!.delete(callback);
    if (set!.size === 0) subscribers.delete(id);
  };
}

export function cancelLiveJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.done) return false;
  j.cancel();
  return true;
}
