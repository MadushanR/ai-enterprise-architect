/**
 * app/api/ask-board/route.ts
 * "Ask the board" — two-step post-debate follow-up endpoint.
 *
 * Step 1 (routing): calls meta-llama/llama-3-3-70b-instruct ONCE to identify which
 *   1–3 persona IDs from the debate transcript are most relevant to the user's
 *   question. Returns a JSON array of persona ID strings.
 *
 * Step 2 (response): for each matched persona, loads that persona's full config
 *   (system prompt + model), injects only their own transcript entries as
 *   grounding, and streams an in-character attributed response.
 *
 * SSE event shapes:
 *   { type: "persona-start", agent, name, accentColor }
 *   { type: "chunk",         agent, text }
 *   { type: "persona-done",  agent }
 *   { type: "done" }
 *   { type: "error",         message }
 *
 * Fallback: if routing returns no known IDs, a single "board" response is
 * emitted using the synthesis model.
 *
 * AGENTS.md: routing/synthesis model = meta-llama/llama-3-3-70b-instruct, called
 * ONCE per request, never inside the per-persona loop.
 */

import { NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";
import { loadPersonas } from "@/backend/lib/debate/load-personas";
import type { TranscriptEntry, Objection } from "@/backend/lib/debate/state";

export const maxDuration = 120;

const wx = createWatsonx();
const ROUTING_MODEL = "meta-llama/llama-3-3-70b-instruct";
const FALLBACK_MODEL = "ibm/granite-4-h-small";

interface AskBoardRequestBody {
  message: string;
  synthesis: string;
  transcript?: TranscriptEntry[];
  objections?: Objection[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

// ── Routing step ─────────────────────────────────────────────────────────────

/**
 * Ask the routing model which persona IDs (1–3) best answer the question.
 * Returns a validated array of IDs that are actually present in the transcript.
 */
async function routeToPersonas(
  question: string,
  transcript: TranscriptEntry[],
  knownIds: Set<string>,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string[]> {
  // Build a compact transcript summary for the routing prompt (agent + first 200 chars)
  const transcriptLines = transcript
    .map((e) => `[R${e.round + 1}][${e.agent.toUpperCase()}]: ${e.turn.slice(0, 200)}`)
    .join("\n");

  const historyContext =
    history.length > 0
      ? `\nPRIOR CHAT HISTORY:\n${history
          .slice(-6)
          .map((h) => `${h.role === "user" ? "User" : "Board"}: ${h.content.slice(0, 150)}`)
          .join("\n")}\n`
      : "";

  const routingPrompt = [
    `You are a routing assistant for an Architecture Review Board debate system.`,
    `A user has asked the following follow-up question after the debate concluded:`,
    `"${question}"`,
    historyContext,
    `The debate transcript is:`,
    transcriptLines,
    ``,
    `Based on the question and the transcript, identify the 1 to 3 persona IDs whose`,
    `debate contributions are MOST relevant to answering this specific question.`,
    ``,
    `Available persona IDs: ${[...knownIds].join(", ")}`,
    ``,
    `Respond with ONLY a JSON array of persona ID strings, e.g.: ["sre", "finops"]`,
    `Do not include any explanation or prose — only the JSON array.`,
  ].join("\n");

  try {
    const result = await withRetry(
      () => generateText({ model: wx(ROUTING_MODEL), prompt: routingPrompt, maxOutputTokens: 64 }),
      ROUTING_MODEL
    );

    const raw = result.text.trim();
    // Extract JSON array even if the model wraps it in backticks or prose
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    // Validate: keep only IDs that actually appear in the transcript
    return (parsed as unknown[])
      .filter((id): id is string => typeof id === "string" && knownIds.has(id))
      .slice(0, 3);
  } catch (err) {
    console.warn("[ask-board] routing step failed:", err);
    return [];
  }
}

// ── Per-persona response step ─────────────────────────────────────────────────

async function* streamPersonaResponse(
  personaSystemPrompt: string,
  personaModel: string,
  personaTranscriptEntries: TranscriptEntry[],
  question: string,
  synthesis: string
): AsyncGenerator<string> {
  const theirTurns =
    personaTranscriptEntries.length > 0
      ? `\nYOUR DEBATE CONTRIBUTIONS:\n${personaTranscriptEntries
          .map((e) => `[Round ${e.round + 1}]: ${e.turn}`)
          .join("\n\n")}`
      : "";

  const system = [
    personaSystemPrompt,
    ``,
    `--- POST-DEBATE FOLLOW-UP ---`,
    `The architecture debate has concluded. The final synthesis is:`,
    ``,
    synthesis,
    theirTurns,
    ``,
    `The user is now asking you a follow-up question. Answer from your own perspective`,
    `and expertise, grounded in what you argued during the debate. Be concise and direct.`,
  ].join("\n");

  async function* run(model: string): AsyncGenerator<string> {
    const result = streamText({ model: wx(model), system, messages: [{ role: "user", content: question }], maxOutputTokens: 768 });
    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }

  try {
    yield* run(personaModel);
  } catch {
    console.warn(`[ask-board] ${personaModel} failed — falling back to ${FALLBACK_MODEL}`);
    yield* run(FALLBACK_MODEL);
  }
}

// ── Fallback board response ───────────────────────────────────────────────────

async function* streamBoardFallback(
  question: string,
  synthesis: string,
  transcript: TranscriptEntry[],
  objections: Objection[]
): AsyncGenerator<string> {
  const transcriptSummary =
    transcript.length > 0
      ? `\n\nDEBATE TRANSCRIPT:\n${transcript
          .slice(-10)
          .map((e) => `[R${e.round + 1}][${e.agent.toUpperCase()}]: ${e.turn.slice(0, 300)}`)
          .join("\n")}`
      : "";

  const unresolvedSection =
    objections.length > 0
      ? `\n\nUNRESOLVED OBJECTIONS:\n${objections
          .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
          .join("\n")}`
      : "";

  const system = [
    `You are the Architecture Review Board assistant. An architecture debate just concluded.`,
    `The final synthesis is:\n\n${synthesis}`,
    unresolvedSection,
    transcriptSummary,
    `Respond concisely and technically.`,
  ].join("\n");

  async function* run(model: string): AsyncGenerator<string> {
    const result = streamText({ model: wx(model), system, messages: [{ role: "user", content: question }], maxOutputTokens: 768 });
    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }

  try {
    yield* run(ROUTING_MODEL);
  } catch {
    yield* run(FALLBACK_MODEL);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as AskBoardRequestBody | null;

  if (!body || typeof body.message !== "string" || body.message.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `message` string." },
      { status: 400 }
    );
  }
  if (typeof body.synthesis !== "string" || body.synthesis.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `synthesis` string." },
      { status: 400 }
    );
  }

  const {
    message,
    synthesis,
    transcript = [],
    objections = [],
    history = [],
  } = body;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Load all persona configs so we can match IDs and get system prompts
        const allPersonas = await loadPersonas();
        const personaMap = new Map(allPersonas.map((p) => [p.id, p]));

        // Build set of IDs that actually appear in this debate's transcript
        const transcriptIds = new Set(transcript.map((e) => e.agent));
        const knownIds = new Set([...transcriptIds].filter((id) => personaMap.has(id)));

        // Step 1 — routing
        let matchedIds: string[] = [];
        if (knownIds.size > 0 && transcript.length > 0) {
          matchedIds = await routeToPersonas(message, transcript, knownIds, history);
        }

        if (matchedIds.length === 0) {
          // Fallback: generic board response
          send({ type: "persona-start", agent: "board", name: "Board", accentColor: null });
          for await (const chunk of streamBoardFallback(message, synthesis, transcript, objections)) {
            send({ type: "chunk", agent: "board", text: chunk });
          }
          send({ type: "persona-done", agent: "board" });
        } else {
          // Step 2 — stream each matched persona in sequence
          for (const agentId of matchedIds) {
            const persona = personaMap.get(agentId);
            if (!persona) continue;

            // Only this persona's transcript entries
            const theirEntries = transcript.filter((e) => e.agent === agentId);

            send({
              type: "persona-start",
              agent: persona.id,
              name: persona.name,
              accentColor: persona.accent_color ?? null,
            });

            for await (const chunk of streamPersonaResponse(
              persona.systemPrompt,
              persona.model,
              theirEntries,
              message,
              synthesis
            )) {
              send({ type: "chunk", agent: persona.id, text: chunk });
            }

            send({ type: "persona-done", agent: persona.id });
          }
        }

        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
