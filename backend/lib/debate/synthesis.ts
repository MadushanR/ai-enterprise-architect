/**
 * lib/debate/synthesis.ts
 * Single synthesis step — called ONCE after the debate graph completes.
 * AGENTS.md: meta-llama/llama-3-3-70b-instruct, NEVER inside the debate loop.
 * Produces a canonical architecture description for diagram + pitch-deck generation.
 */
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import type { DebateState } from "@/backend/lib/debate/state";
import { withRetry } from "@/backend/lib/with-retry";

const wx = createWatsonx();

const MODEL_SYNTHESIS = "meta-llama/llama-3-3-70b-instruct";

/**
 * Convert the final debate state into a canonical architecture description.
 * If unresolved objections remain (max-rounds forced exit), they are flagged
 * explicitly in the output — never silently dropped.
 *
 * @returns synthesis text string
 */
export async function synthesize(state: DebateState): Promise<string> {
  const transcriptText = state.transcript
    .map(
      (e) =>
        `[Round ${e.round + 1}][${e.agent.toUpperCase()}]:\n${e.turn}`
    )
    .join("\n\n---\n\n");

  const unresolvedSection =
    state.objections.length > 0
      ? `\n\nNOTE: The following objections were NOT resolved when synthesis was triggered:\n${state.objections
          .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
          .join("\n")}\nThese must be flagged explicitly in the synthesis output.`
      : "";

  const prompt = [
    `You are producing the final synthesis from an architecture review board debate.`,
    `Below is the full debate transcript. Produce a canonical architecture description`,
    `that incorporates the final proposal and addresses the resolved objections.`,
    unresolvedSection,
    `\n\n## Debate Transcript\n\n${transcriptText}`,
    `\n\n## Final Proposal\n\n${state.proposal}`,
    `\n\nProduce a clear, structured architecture description (300–500 words) suitable`,
    `for generating a Mermaid diagram and a 5-slide pitch deck.`,
    `If there are unresolved objections, include a section titled "UNRESOLVED OBJECTIONS" at the end.`,
  ].join("\n");

  // Fallback: if synthesis model fails, use the last SA proposal directly
  let text: string;
  try {
    const result = await withRetry(
      () => generateText({ model: wx(MODEL_SYNTHESIS), prompt, maxOutputTokens: 1024 }),
      MODEL_SYNTHESIS
    );
    text = result.text;
    console.log(`[SYNTHESIS] model=${MODEL_SYNTHESIS} chars=${text.length}`);
  } catch (err) {
    console.warn(
      `[SYNTHESIS] ${MODEL_SYNTHESIS} failed, falling back to last SA proposal:`,
      err
    );
    // Task 5.2 fallback: use last SA proposal as synthesis output
    text = [
      state.proposal,
      state.objections.length > 0
        ? `\n\nUNRESOLVED OBJECTIONS:\n${state.objections
            .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
            .join("\n")}`
        : "",
    ]
      .join("")
      .trim();
  }

  return text;
}
