import { api } from "./client";
import { KEYS, storage } from "../storage";
import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasViewport, CanvasKind } from "../types";
import { shortId } from "../utils";
import { LumenApiError } from "./index";

export async function listMine(_userId: string): Promise<CanvasDoc[]> {
  try {
    return await api<CanvasDoc[]>("/canvases");
  } catch {
    // Fallback to localStorage during transition
    return storage.get<CanvasDoc[]>(KEYS.canvases, []);
  }
}

export async function get(id: string): Promise<CanvasDoc | null> {
  try {
    return await api<CanvasDoc>(`/canvases/${id}`);
  } catch {
    return storage.get<CanvasDoc[]>(KEYS.canvases, []).find((c) => c.id === id) ?? null;
  }
}

export async function create(
  _userId: string,
  opts?: { kind?: CanvasKind; title?: string },
): Promise<CanvasDoc> {
  try {
    return await api<CanvasDoc>("/canvases", {
      method: "POST",
      body: JSON.stringify({ kind: opts?.kind || "flow", title: opts?.title }),
    });
  } catch {
    // Fallback to localStorage
    const now = new Date().toISOString();
    const doc: CanvasDoc = {
      id: shortId("cv_"), userId: _userId, kind: opts?.kind || "flow",
      title: opts?.title || "未命名画布", nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now,
    };
    storage.set(KEYS.canvases, [doc, ...storage.get<CanvasDoc[]>(KEYS.canvases, [])]);
    return doc;
  }
}

export async function rename(id: string, title: string): Promise<void> {
  try {
    await api(`/canvases/${id}`, { method: "PUT", body: JSON.stringify({ title: title.slice(0, 60) }) });
  } catch { /* noop */ }
}

export async function remove(id: string): Promise<void> {
  try { await api(`/canvases/${id}`, { method: "DELETE" }); } catch { /* noop */ }
  storage.set(KEYS.canvases, storage.get<CanvasDoc[]>(KEYS.canvases, []).filter(c => c.id !== id));
}

export function getSync(id: string): CanvasDoc | null {
  return storage.get<CanvasDoc[]>(KEYS.canvases, []).find((c) => c.id === id) ?? null;
}

/** Write to both backend and localStorage during transition. */
export function saveSync(
  id: string,
  patch: { nodes?: CanvasNode[]; edges?: CanvasEdge[]; viewport?: CanvasViewport; title?: string; coverUrl?: string },
): void {
  // Write localStorage (synchronous for existing code)
  const all = storage.get<CanvasDoc[]>(KEYS.canvases, []);
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  storage.set(KEYS.canvases, all);

  // Fire-and-forget to backend
  void (async () => {
    try { await api(`/canvases/${id}`, { method: "PUT", body: JSON.stringify(patch) }); } catch { /* noop */ }
  })();
}

/** No longer needed — server handles storage. */
export function pruneHeavyFields(): { freedBytes: number; touched: number; fieldHits: Record<string, number> } {
  return { freedBytes: 0, touched: 0, fieldHits: {} };
}

/** No longer needed — server handles storage. */
export function nukeAllNodeAssets(): { freedBytes: number } {
  return { freedBytes: 0 };
}
