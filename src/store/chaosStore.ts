/**
 * store/chaosStore.ts
 * Shared Zustand store for chaos simulator inputs.
 *
 * Written by the main page before navigating to /chaos;
 * read by the chaos page on mount to auto-start the SSE stream.
 *
 * No persistence — data lives only for the current browser session.
 */
import { create } from "zustand";

interface ChaosStoreState {
  synthesis: string | null;
  diagramSource: string | null;
  setSynthesis: (s: string) => void;
  setDiagramSource: (d: string) => void;
  setInputs: (synthesis: string, diagramSource: string) => void;
}

export const useChaosStore = create<ChaosStoreState>((set) => ({
  synthesis: null,
  diagramSource: null,
  setSynthesis: (synthesis) => set({ synthesis }),
  setDiagramSource: (diagramSource) => set({ diagramSource }),
  setInputs: (synthesis, diagramSource) => set({ synthesis, diagramSource }),
}));
