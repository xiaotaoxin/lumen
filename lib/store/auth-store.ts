"use client";

import { create } from "zustand";
import * as authApi from "@/lib/api/auth";
import { tryMigrate } from "@/lib/api/auth";

interface AuthState {
  user: authApi.SessionUser | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setUser: (u: authApi.SessionUser | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  hydrate: async () => {
    try {
      // Try to migrate old localStorage users to the backend
      await tryMigrate();
      const u = await authApi.getSession();
      set({ user: u, hydrated: true });
    } catch {
      // Server not reachable — user will need to login again
      set({ user: null, hydrated: true });
    }
  },
  setUser: (u) => set({ user: u }),
  logout: async () => {
    await authApi.logout();
    set({ user: null });
  },
}));
