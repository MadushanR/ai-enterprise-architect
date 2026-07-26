/**
 * lib/debate/graph.ts
 * LangGraph StateGraph for the War Room debate engine.
 * Dynamically built from the persona loader — does not hardcode node names.
 * AGENTS.md rules:
 *   - Max 3 rounds, then forced synthesis.
 *   - Per-round calls run concurrently (Promise.all) — never sequentially.
 *   - Graph is resumable and inspectable via LangGraph state.
 */
import { StateGraph, END } from "@langchain/langgraph";
import { DebateAnnotation } from "@/backend/lib/debate/state";
import { loadPersonas } from "@/backend/lib/debate/load-personas";
import { debaterNode } from "@/backend/lib/debate/agents/debater";
import { guardianNode } from "@/backend/lib/debate/agents/guardian";
import type { DebateState, DebateUpdate } from "@/backend/lib/debate/state";

const DEFAULT_MAX_ROUNDS = 3;
/** Safety ceiling when auto mode is on (maxRounds = 0). */
const AUTO_MAX_ROUNDS = 10;

// ── Round conductor node ────────────────────────────────────────────────────
// Runs all non-proposer debaters + all guardians concurrently within one round,
// merges their partial state updates, then returns the combined result.

async function makeRoundNode(
  personas: Awaited<ReturnType<typeof loadPersonas>>
): Promise<(state: DebateState) => Promise<DebateUpdate>> {
  const debaters = personas.filter((p) => p.role_type === "debater");
  const guardians = personas.filter((p) => p.role_type === "guardian");

  // Proposer = first debater by turn_order (lowest).
  // Builder   = last debater by turn_order (highest) when id === "builder".
  //             Falls back to undefined if no builder persona is loaded.
  // Mid-reviewers = all debaters in between.
  const proposer = debaters[0];
  const builderPersona = debaters.find((p) => p.id === "builder");
  const midReviewers = debaters.slice(1).filter((p) => p.id !== "builder");

  const proposerFn = debaterNode(proposer, true);
  const reviewerFns = midReviewers.map((p) => debaterNode(p, false));
  const guardianFns = guardians.map((p) => guardianNode(p));
  const builderFn = builderPersona ? debaterNode(builderPersona, false) : null;

  return async (state: DebateState): Promise<DebateUpdate> => {
    // Step 1: proposer refines the design
    const proposerUpdate = await proposerFn(state);

    // Merge proposer output into a working state copy for downstream nodes
    const proposerTranscript = Array.isArray(proposerUpdate.transcript)
      ? (proposerUpdate.transcript as typeof state.transcript)
      : [];
    const afterProposer: DebateState = {
      ...state,
      proposal: (proposerUpdate.proposal as string | undefined) ?? state.proposal,
      transcript: [...state.transcript, ...proposerTranscript],
    };

    // Step 2: all mid-reviewers and guardians run concurrently on the updated proposal
    const concurrentFns = [...reviewerFns, ...guardianFns];
    const concurrentUpdates = await Promise.all(
      concurrentFns.map((fn) => fn(afterProposer))
    );

    // Merge: accumulate all objections and transcript entries
    let mergedObjections = [...afterProposer.objections];
    const mergedTranscript: typeof state.transcript = Array.isArray(proposerUpdate.transcript)
      ? [...(proposerUpdate.transcript as typeof state.transcript)]
      : [];

    for (const update of concurrentUpdates) {
      if (update.objections !== undefined) {
        // Each update carries the full objections array for its agent;
        // merge by replacing that agent's slot.
        for (const obj of update.objections as typeof state.objections) {
          mergedObjections = mergedObjections.filter((o) => o.agent !== obj.agent);
          mergedObjections.push(obj);
        }
      }
      if (Array.isArray(update.transcript)) {
        mergedTranscript.push(...(update.transcript as typeof state.transcript));
      }
    }

    // Step 3: builder runs last — after all objections from reviewers + guardians
    // are collected — so it sees the full picture before producing its build plan.
    if (builderFn) {
      const afterReviewers: DebateState = {
        ...afterProposer,
        objections: mergedObjections,
        transcript: [...afterProposer.transcript, ...mergedTranscript],
      };
      const builderUpdate = await builderFn(afterReviewers);

      if (builderUpdate.objections !== undefined) {
        for (const obj of builderUpdate.objections as typeof state.objections) {
          mergedObjections = mergedObjections.filter((o) => o.agent !== obj.agent);
          mergedObjections.push(obj);
        }
      }
      if (Array.isArray(builderUpdate.transcript)) {
        mergedTranscript.push(...(builderUpdate.transcript as typeof state.transcript));
      }
    }

    return {
      proposal: afterProposer.proposal,
      objections: mergedObjections,
      transcript: mergedTranscript,
    };
  };
}

export interface DebateGraphOptions {
  /** Subset of persona IDs to include; if empty/undefined, all enabled personas are used. */
  agentFilter?: string[];
  /**
   * Maximum rounds to run (1–N). Defaults to DEFAULT_MAX_ROUNDS.
   * Pass 0 to enable auto mode: rounds continue until all agents agree (no objections),
   * with a hard safety cap of AUTO_MAX_ROUNDS to prevent infinite loops.
   */
  maxRounds?: number;
}

/**
 * Builds and compiles the debate graph for the given personas.
 * Called once per debate session from the API route.
 */
export async function buildDebateGraph(options: DebateGraphOptions = {}) {
  const allPersonas = await loadPersonas();

  // Apply agent filter if provided
  const personas =
    options.agentFilter && options.agentFilter.length > 0
      ? allPersonas.filter((p) => options.agentFilter!.includes(p.id))
      : allPersonas;

  if (personas.filter((p) => p.role_type === "debater").length === 0) {
    throw new Error(
      "[debate/graph] No enabled debater personas found in /personas/agents/. " +
        "At least one persona with role_type: debater must be enabled."
    );
  }

  const autoMode = options.maxRounds === 0;
  const maxRounds = autoMode
    ? AUTO_MAX_ROUNDS
    : Math.max(1, options.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const roundNode = await makeRoundNode(personas);

  async function incrementRound(state: DebateState): Promise<DebateUpdate> {
    return { round: state.round + 1 };
  }

  function shouldContinue(state: DebateState): "conduct" | typeof END {
    const noObjections = state.objections.length === 0;
    const maxReached = state.round >= maxRounds - 1;

    if (noObjections) return END;

    if (maxReached) {
      console.log(
        autoMode
          ? `[graph] Auto mode: safety cap (${AUTO_MAX_ROUNDS} rounds) reached with ${state.objections.length} unresolved objection(s). Forcing synthesis.`
          : `[graph] Max rounds reached with ${state.objections.length} unresolved objection(s). Forcing synthesis.`
      );
      return END;
    }

    return "conduct";
  }

  return new StateGraph(DebateAnnotation)
    .addNode("conduct", roundNode)
    .addNode("tick", incrementRound)
    .addEdge("__start__", "conduct")
    .addConditionalEdges("conduct", shouldContinue, {
      conduct: "tick",
      [END]: END,
    })
    .addEdge("tick", "conduct")
    .compile();
}
