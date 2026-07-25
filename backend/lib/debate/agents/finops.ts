/**
 * lib/debate/agents/finops.ts
 * FinOps analyst agent node for the LangGraph debate graph.
 * Same pattern as sre.ts — loads persona, streams, parses OBJECTION/NO OBJECTION.
 * AGENTS.md: ibm/granite-4-h-small.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { streamText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import type { DebateState, DebateUpdate, Objection, TranscriptEntry } from "@/backend/lib/debate/state";

const wx = createWatsonx();

const MODEL_PRIMARY = "ibm/granite-4-h-small";
const MODEL_FALLBACK = "meta-llama/llama-3-3-70b-instruct";

async function loadPersona(): Promise<string> {
  const path = join(process.cwd(), "backend", "personas", "agents", "finops.md");
  return readFile(path, "utf-8");
}

function parseObjection(text: string): Objection | null {
  const objMatch = text.match(/OBJECTION:\s*(.+)$/m);
  if (objMatch) {
    return { agent: "finops", reason: objMatch[1].trim() };
  }
  return null;
}

export async function finopsNode(state: DebateState): Promise<DebateUpdate> {
  const persona = await loadPersona();

  let fullText = "";
  let modelUsed = MODEL_PRIMARY;

  try {
    const result = await streamText({
      model: wx(MODEL_PRIMARY),
      system: persona,
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal for cost and unit economics:\n\n${state.proposal}`,
      maxOutputTokens: 768,
    });
    for await (const chunk of result.textStream) {
      fullText += chunk;
    }
  } catch {
    modelUsed = MODEL_FALLBACK;
    const result = await streamText({
      model: wx(MODEL_FALLBACK),
      system: persona,
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal for cost and unit economics:\n\n${state.proposal}`,
      maxOutputTokens: 768,
    });
    for await (const chunk of result.textStream) {
      fullText += chunk;
    }
  }

  console.log(`[FINOPS][round ${state.round}] model=${modelUsed} chars=${fullText.length}`);

  const objection = parseObjection(fullText);

  const withoutFinOps = state.objections.filter((o) => o.agent !== "finops");
  const newObjections: Objection[] = objection
    ? [...withoutFinOps, objection]
    : withoutFinOps;

  const entry: TranscriptEntry = {
    agent: "finops",
    turn: fullText,
    round: state.round,
  };

  return {
    objections: newObjections,
    transcript: [entry],
  };
}

