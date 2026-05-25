"use client";

import { create } from "zustand";

interface SessionsState {
  /** Bumped whenever something elsewhere wants the recent-generations list refreshed. */
  reloadKey: number;
  bump: () => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  reloadKey: 0,
  bump: () => set((s) => ({ reloadKey: s.reloadKey + 1 })),
}));
