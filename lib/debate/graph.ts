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
import { DebateAnnotation } from "@/lib/debate/state";
import { loadPersonas } from "@/lib/debate/load-personas";
import { debaterNode } from "@/lib/debate/agents/debater";
import { guardianNode } from "@/lib/debate/agents/guardian";
import type { DebateState, DebateUpdate } from "@/lib/debate/state";

const MAX_ROUNDS = 3;

// ── Round conductor node ────────────────────────────────────────────────────
// Runs all non-proposer debaters + all guardians concurrently within one round,
// merges their partial state updates, then returns the combined result.

async function makeRoundNode(
  personas: Awaited<ReturnType<typeof loadPersonas>>
): Promise<(state: DebateState) => Promise<DebateUpdate>> {
  const proposer = personas.filter((p) => p.role_type === "debater")[0];
  const reviewers = personas
    .filter((p) => p.role_type === "debater")
    .slice(1);
  const guardians = personas.filter((p) => p.role_type === "guardian");

  const proposerFn = debaterNode(proposer, true);
  const reviewerFns = reviewers.map((p) => debaterNode(p, false));
  const guardianFns = guardians.map((p) => guardianNode(p));

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

    // Step 2: all reviewers and guardians run concurrently on the updated proposal
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
        // Also handle removals (agent returned no objection → it removed itself)
        const updateAgentIds = new Set(
          (update.objections as typeof state.objections).map((o) => o.agent)
        );
        const relevantAgents = [...reviewerFns, ...guardianFns]
          .map((_, i) => concurrentFns[i])
          .map((_, i) => [...reviewers, ...guardians][i]?.id)
          .filter(Boolean);
        for (const aid of relevantAgents) {
          if (!updateAgentIds.has(aid) && aid !== undefined) {
            // The update came from this agent and had no objection for it
          }
        }
      }
      if (Array.isArray(update.transcript)) {
        mergedTranscript.push(...(update.transcript as typeof state.transcript));
      }
    }

    return {
      proposal: afterProposer.proposal,
      objections: mergedObjections,
      transcript: mergedTranscript,
    };
  };
}

/**
 * Builds and compiles the debate graph for the given personas.
 * Called once per debate session from the API route.
 */
export async function buildDebateGraph() {
  const personas = await loadPersonas();

  if (personas.filter((p) => p.role_type === "debater").length === 0) {
    throw new Error(
      "[debate/graph] No enabled debater personas found in /personas/agents/. " +
        "At least one persona with role_type: debater must be enabled."
    );
  }

  const roundNode = await makeRoundNode(personas);

  async function incrementRound(state: DebateState): Promise<DebateUpdate> {
    return { round: state.round + 1 };
  }

  function shouldContinue(state: DebateState): "round" | typeof END {
    const noObjections = state.objections.length === 0;
    const maxReached = state.round >= MAX_ROUNDS - 1;

    if (noObjections || maxReached) {
      if (!noObjections) {
        console.log(
          `[graph] Max rounds reached with ${state.objections.length} unresolved objection(s). Forcing synthesis.`
        );
      }
      return END;
    }
    return "round";
  }

  return new StateGraph(DebateAnnotation)
    .addNode("round", roundNode)
    .addNode("incrementRound", incrementRound)
    .addEdge("__start__", "round")
    .addConditionalEdges("round", shouldContinue, {
      round: "incrementRound",
      [END]: END,
    })
    .addEdge("incrementRound", "round")
    .compile();
}
