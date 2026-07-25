/**
 * lib/debate/graph.ts
 * LangGraph StateGraph for the War Room debate engine.
 * AGENTS.md: max 3 rounds, loop must be resumable and inspectable.
 * Architecture: SA → SRE → FinOps → Security → [conditional exit or next round]
 */
import { StateGraph, END } from "@langchain/langgraph";
import { DebateAnnotation } from "@/lib/debate/state";
import { saNode } from "@/lib/debate/agents/sa";
import { sreNode } from "@/lib/debate/agents/sre";
import { finopsNode } from "@/lib/debate/agents/finops";
import { securityNode } from "@/lib/debate/agents/security";
import type { DebateState } from "@/lib/debate/state";

const MAX_ROUNDS = 3;

/**
 * Conditional router called after the Security node completes each round.
 * Exits if all objections are cleared OR if max rounds reached.
 * Otherwise increments the round counter and loops back to SA.
 */
function shouldContinue(state: DebateState): "sa" | typeof END {
  const noObjections = state.objections.length === 0;
  const maxReached = state.round >= MAX_ROUNDS - 1;

  if (noObjections || maxReached) {
    if (!noObjections) {
      console.log(
        `[GRAPH] Max rounds reached with ${state.objections.length} unresolved objection(s). Forcing synthesis.`
      );
    }
    return END;
  }

  // Loop: more rounds remain and objections are unresolved
  return "sa";
}

/**
 * Increment round counter node — runs between security and the next SA turn.
 * Keeps the round bump out of individual agent nodes so each node stays single-concern.
 */
async function incrementRound(state: DebateState) {
  return { round: state.round + 1 };
}

// ── Build the graph ────────────────────────────────────────────

const builder = new StateGraph(DebateAnnotation)
  .addNode("sa", saNode)
  .addNode("sre", sreNode)
  .addNode("finops", finopsNode)
  .addNode("security", securityNode)
  .addNode("incrementRound", incrementRound)
  // Linear edges within a round
  .addEdge("__start__", "sa")
  .addEdge("sa", "sre")
  .addEdge("sre", "finops")
  .addEdge("finops", "security")
  // After security: conditional exit or increment + loop
  .addConditionalEdges("security", shouldContinue, {
    sa: "incrementRound",
    [END]: END,
  })
  .addEdge("incrementRound", "sa");

export const debateGraph = builder.compile();
