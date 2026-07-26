/**
 * lib/debate/agents/debater.ts
 * Generic debater node factory.
 * Takes a PersonaConfig and returns a LangGraph-compatible async node function.
 * Replaces the one-off sa.ts, sre.ts, finops.ts files.
 *
 * The first debater by turn_order is the "proposer" role — its output is parsed
 * for a PROPOSAL: block and updates state.proposal. All others are "reviewers"
 * and must end with OBJECTION: <reason> or NO OBJECTION.
 */
import { streamText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";
import type { PersonaConfig } from "@/backend/lib/debate/load-personas";
import type { DebateState, DebateUpdate, Objection, TranscriptEntry } from "@/backend/lib/debate/state";

const wx = createWatsonx();

const FALLBACK_MODEL = "meta-llama/llama-3-3-70b-instruct";

async function callWithFallback(
  model: string,
  system: string,
  prompt: string,
  maxOutputTokens: number
): Promise<{ text: string; modelUsed: string }> {
  async function run(m: string) {
    const result = await streamText({ model: wx(m), system, prompt, maxOutputTokens });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    return text;
  }

  try {
    return { text: await withRetry(() => run(model), model), modelUsed: model };
  } catch {
    console.warn(`[debater] ${model} failed — falling back to ${FALLBACK_MODEL}`);
    return {
      text: await withRetry(() => run(FALLBACK_MODEL), FALLBACK_MODEL),
      modelUsed: FALLBACK_MODEL,
    };
  }
}

function extractProposal(text: string): string {
  const match = text.match(/PROPOSAL:\s*([\s\S]+?)(?:\n\n|$)/);
  return match ? match[1].trim() : text.trim();
}

function extractObjection(text: string, agentId: string): Objection | null {
  const match = text.match(/OBJECTION:\s*(.+)$/m);
  return match ? { agent: agentId, reason: match[1].trim() } : null;
}

/**
 * Returns an async node function for the given debater persona.
 * @param persona       The parsed persona config from the loader.
 * @param isProposer    True only for the first persona in turn_order (SA role).
 */
export function debaterNode(
  persona: PersonaConfig,
  isProposer: boolean
): (state: DebateState) => Promise<DebateUpdate> {
  return async (state: DebateState): Promise<DebateUpdate> => {
    const objectionContext =
      isProposer && state.objections.length > 0
        ? `\n\nOBJECTIONS FROM PREVIOUS ROUND:\n${state.objections
            .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
            .join("\n")}\n\nAddress these objections in your revised proposal.`
        : "";

    const prompt = isProposer
      ? `Round ${state.round + 1}. Current proposal:\n\n${state.proposal}${objectionContext}`
      : `Round ${state.round + 1}. Evaluate this architecture proposal:\n\n${state.proposal}`;

    const { text, modelUsed } = await callWithFallback(
      persona.model,
      persona.systemPrompt,
      prompt,
      isProposer ? 1024 : 768
    );

    console.log(
      `[${persona.id}][round ${state.round}] model=${modelUsed} proposer=${isProposer} chars=${text.length}`
    );

    const entry: TranscriptEntry = { agent: persona.id, turn: text, round: state.round };

    if (isProposer) {
      return { proposal: extractProposal(text), transcript: [entry] };
    }

    const objection = extractObjection(text, persona.id);
    const withoutMe = state.objections.filter((o) => o.agent !== persona.id);
    const newObjections: Objection[] = objection ? [...withoutMe, objection] : withoutMe;

    return { objections: newObjections, transcript: [entry] };
  };
}

