/**
 * lib/debate/state.ts
 * LangGraph state type for the War Room debate engine.
 * AGENTS.md: state machine, not raw LangChain chains.
 * Pure type definitions — no runtime code.
 */
import { Annotation } from "@langchain/langgraph";

// ── Sub-types ──────────────────────────────────────────────────

export interface Objection {
  agent: "sre" | "finops" | "security";
  reason: string;
}

export interface TranscriptEntry {
  agent: "sa" | "sre" | "finops" | "security";
  turn: string;
  round: number;
}

// ── LangGraph Annotation ───────────────────────────────────────

export const DebateAnnotation = Annotation.Root({
  /** Current architecture proposal text (SA's latest version). */
  proposal: Annotation<string>,

  /** 0-based round index. Graph increments this each full round. Max value: 2 (for 3 rounds). */
  round: Annotation<number>,

  /**
   * Outstanding objections from the current round.
   * Replaced each round — only holds the current round's unresolved objections.
   */
  objections: Annotation<Objection[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** True when all agents returned NO OBJECTION in the same round. */
  resolved: Annotation<boolean>,

  /** Full debate history — append-only across all rounds. */
  transcript: Annotation<TranscriptEntry[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

// ── Derived types ──────────────────────────────────────────────

export type DebateState = typeof DebateAnnotation.State;
export type DebateUpdate = typeof DebateAnnotation.Update;
