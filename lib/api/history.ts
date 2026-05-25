import { api } from "./client";
import type { Generation, ModelKind } from "../types";

export async function listMine(
  _userId?: string,
  filters?: { kind?: ModelKind; modelId?: string; favorite?: boolean },
): Promise<Generation[]> {
  const params = new URLSearchParams();
  if (filters?.kind) params.set("kind", filters.kind);
  if ((filters as Record<string, unknown> | null)?.sessionId) {
    params.set("sessionId", (filters as Record<string, unknown>).sessionId as string);
  }
  const qs = params.toString();
  const list = await api<Generation[]>(`/generations${qs ? "?" + qs : ""}`);
  // Apply client-side filters that the API doesn't support directly
  return list.filter(g => {
    if (filters?.favorite && !g.favorite) return false;
    return true;
  });
}

export async function toggleFavorite(id: string): Promise<void> {
  const current = await api<Generation>(`/generations/${id}`);
  await api(`/generations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ favorite: !current.favorite }),
  });
}

export async function remove(id: string): Promise<void> {
  await api(`/generations/${id}`, { method: "DELETE" });
}

export async function update(g: Generation): Promise<void> {
  await api(`/generations/${g.id}`, {
    method: "PATCH",
    body: JSON.stringify(g),
  });
}

export async function get(id: string): Promise<Generation | null> {
  try {
    return await api<Generation>(`/generations/${id}`);
  } catch {
    return null;
  }
}

/**
 * Reap stale running generations. Now server-side — the backend handles
 * zombie cleanup. This stub remains for API compatibility.
 */
export function reapStaleRunningSync(_opts: {
  isLive: (id: string) => boolean;
  thresholdMin?: number;
}): string[] {
  return [];
}

/**
 * No longer needed — data is stored server-side, no localStorage quota.
 * Stub retained for API compatibility.
 */
export function pruneGenerationsHeavyFields(): {
  freedBytes: number;
  touched: number;
  fieldHits: Record<string, number>;
} {
  return { freedBytes: 0, touched: 0, fieldHits: {} };
}

/**
 * No longer needed. Stub retained for API compatibility.
 */
export function nukeAllGenerationsSync(): { count: number; freedBytes: number } {
  return { count: 0, freedBytes: 0 };
}
