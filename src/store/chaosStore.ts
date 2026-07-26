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
import type { CreativeBrief } from "@/src/app/api/discovery/route";
import type { DiagramResult } from "@/backend/lib/mermaid/generate";
import type { Objection, TranscriptEntry } from "@/backend/lib/debate/state";

/** Full snapshot of page.tsx state saved before navigating to /chaos. */
export interface ChaosReturnSnapshot {
  idea: string;
  brief: CreativeBrief;
  transcript: TranscriptEntry[];
  objections: Objection[];
  synthesis: string;
  diagram: DiagramResult | null;
  finalProposal: string | null;
  debateComplete: boolean;
}

interface ChaosStoreState {
  synthesis: string | null;
  diagramSource: string | null;
  setSynthesis: (s: string) => void;
  setDiagramSource: (d: string) => void;
  setInputs: (synthesis: string, diagramSource: string) => void;
  /** Snapshot of the main page state, persisted across the /chaos navigation. */
  returnSnapshot: ChaosReturnSnapshot | null;
  setReturnSnapshot: (snap: ChaosReturnSnapshot) => void;
  clearReturnSnapshot: () => void;
}

export const useChaosStore = create<ChaosStoreState>((set) => ({
  synthesis: null,
  diagramSource: null,
  setSynthesis: (synthesis) => set({ synthesis }),
  setDiagramSource: (diagramSource) => set({ diagramSource }),
  setInputs: (synthesis, diagramSource) => set({ synthesis, diagramSource }),
  returnSnapshot: null,
  setReturnSnapshot: (returnSnapshot) => set({ returnSnapshot }),
  clearReturnSnapshot: () => set({ returnSnapshot: null }),
}));
