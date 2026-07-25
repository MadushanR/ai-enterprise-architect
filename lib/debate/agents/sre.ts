/**
 * lib/debate/agents/sre.ts
 * Site Reliability Engineer agent node for the LangGraph debate graph.
 * Loads persona from /personas/agents/sre.md, evaluates the current proposal,
 * and ends every turn with OBJECTION: <reason> or NO OBJECTION.
 * AGENTS.md: ibm/granite-4-h-small.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { streamText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import type { DebateState, DebateUpdate, Objection, TranscriptEntry } from "@/lib/debate/state";

const wx = createWatsonx();

const MODEL_PRIMARY = "ibm/granite-4-h-small";
const MODEL_FALLBACK = "meta-llama/llama-3-3-70b-instruct";

async function loadPersona(): Promise<string> {
  const path = join(process.cwd(), "personas", "agents", "sre.md");
  return readFile(path, "utf-8");
}

/** Parse the OBJECTION / NO OBJECTION terminal line from the agent's output. */
function parseObjection(text: string): Objection | null {
  const objMatch = text.match(/OBJECTION:\s*(.+)$/m);
  if (objMatch) {
    return { agent: "sre", reason: objMatch[1].trim() };
  }
  return null;
}

export async function sreNode(state: DebateState): Promise<DebateUpdate> {
  const persona = await loadPersona();

  let fullText = "";
  let modelUsed = MODEL_PRIMARY;

  try {
    const result = await streamText({
      model: wx(MODEL_PRIMARY),
      system: persona,
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal for reliability:\n\n${state.proposal}`,
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
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal for reliability:\n\n${state.proposal}`,
      maxOutputTokens: 768,
    });
    for await (const chunk of result.textStream) {
      fullText += chunk;
    }
  }

  console.log(`[SRE][round ${state.round}] model=${modelUsed} chars=${fullText.length}`);

  const objection = parseObjection(fullText);

  // Build new objections list: replace any previous SRE objection
  const withoutSRE = state.objections.filter((o) => o.agent !== "sre");
  const newObjections: Objection[] = objection
    ? [...withoutSRE, objection]
    : withoutSRE;

  const entry: TranscriptEntry = {
    agent: "sre",
    turn: fullText,
    round: state.round,
  };

  return {
    objections: newObjections,
    transcript: [entry],
  };
}
