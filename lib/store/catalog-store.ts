"use client";

import { create } from "zustand";
import { listCustomSync } from "@/lib/api/admin-models";
import type { ModelInfo } from "@/lib/types";

/**
 * In-memory mirror of admin-curated custom models. UI components subscribe
 * to this store; admin actions write through the API and then call reload().
 *
 * Cross-tab sync rides on the `storage` event (see SeedBootstrap).
 */
interface CatalogState {
  customModels: ModelInfo[];
  reload: () => void;
}

export const useCatalogStore = create<CatalogState>((set) => ({
  customModels: [],
  reload: () => {
    if (typeof window === "undefined") return;
    set({ customModels: listCustomSync() });
  },
}));
