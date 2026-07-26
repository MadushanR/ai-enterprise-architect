/**
 * lib/debate/agents/sa.ts
 * Solutions Architect agent node for the LangGraph debate graph.
 * Loads persona from /personas/agents/sa.md, refines the proposal each round,
 * streams tokens via Vercel AI SDK.
 * AGENTS.md: ibm/granite-4-h-small, never synthesis model.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { streamText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";
import type { DebateState, DebateUpdate, TranscriptEntry } from "@/backend/lib/debate/state";

const wx = createWatsonx();

/** Fallback model per AGENTS.md if granite-4-h-small unavailable in region. */
const MODEL_PRIMARY = "ibm/granite-4-h-small";
const MODEL_FALLBACK = "meta-llama/llama-3-3-70b-instruct";

async function loadPersona(): Promise<string> {
  const path = join(process.cwd(), "backend", "personas", "agents", "sa.md");
  return readFile(path, "utf-8");
}

export async function saNode(state: DebateState): Promise<DebateUpdate> {
  const persona = await loadPersona();

  const objectionContext =
    state.objections.length > 0
      ? `\n\nOBJECTIONS FROM PREVIOUS ROUND:\n${state.objections
          .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
          .join("\n")}\n\nAddress these objections in your revised proposal.`
      : "";

  let fullText = "";
  let modelUsed = MODEL_PRIMARY;

  const prompt = `Round ${state.round + 1}. Current proposal:\n\n${state.proposal}${objectionContext}`;

  async function run(model: string) {
    const result = await streamText({ model: wx(model), system: persona, prompt, maxOutputTokens: 1024 });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    return text;
  }

  try {
    fullText = await withRetry(() => run(MODEL_PRIMARY), MODEL_PRIMARY);
  } catch {
    // Fallback per AGENTS.md
    modelUsed = MODEL_FALLBACK;
    fullText = await withRetry(() => run(MODEL_FALLBACK), MODEL_FALLBACK);
  }

  console.log(`[SA][round ${state.round}] model=${modelUsed} chars=${fullText.length}`);

  // Extract the PROPOSAL: block if present, otherwise use full text
  const proposalMatch = fullText.match(/PROPOSAL:\s*([\s\S]+?)(?:\n\n|$)/);
  const newProposal = proposalMatch ? proposalMatch[1].trim() : fullText.trim();

  const entry: TranscriptEntry = {
    agent: "sa",
    turn: fullText,
    round: state.round,
  };

  return {
    proposal: newProposal,
    transcript: [entry],
  };
}

