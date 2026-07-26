/**
 * app/api/chat/route.ts
 * Post-debate chat endpoint.
 * Accepts {message, synthesis, transcript, objections} and streams a response
 * from the synthesis-tier model so the user can ask follow-up questions,
 * resolve objections, or request changes to the architecture.
 *
 * AGENTS.md: synthesis model = meta-llama/llama-3-3-70b-instruct, called ONCE per turn.
 * Streams plain text chunks as SSE { type:"chunk", text } events,
 * terminated by { type:"done" }.
 */
import { NextResponse } from "next/server";
import { streamText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import type { TranscriptEntry, Objection } from "@/backend/lib/debate/state";

export const maxDuration = 120;

const wx = createWatsonx();
const MODEL = "meta-llama/llama-3-3-70b-instruct";
const FALLBACK_MODEL = "ibm/granite-4-h-small";

interface ChatRequestBody {
  message: string;
  synthesis: string;
  transcript?: TranscriptEntry[];
  objections?: Objection[];
  /** Prior turns in this chat session for context continuity. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as ChatRequestBody | null;

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

  const { message, synthesis, transcript = [], objections = [], history = [] } = body;

  const unresolvedSection =
    objections.length > 0
      ? `\n\nUNRESOLVED OBJECTIONS from the debate:\n${objections
          .map((o) => `- [${o.agent.toUpperCase()}]: ${o.reason}`)
          .join("\n")}`
      : "";

  const transcriptSummary =
    transcript.length > 0
      ? `\n\nDEBATE TRANSCRIPT (last ${Math.min(transcript.length, 10)} turns):\n${transcript
          .slice(-10)
          .map((e) => `[R${e.round + 1}][${e.agent.toUpperCase()}]: ${e.turn.slice(0, 300)}…`)
          .join("\n")}`
      : "";

  const systemPrompt = [
    `You are the Architecture Review Board assistant. An architecture debate just concluded.`,
    `The final synthesis is:\n\n${synthesis}`,
    unresolvedSection,
    transcriptSummary,
    `\nThe user may ask you to:`,
    `- Explain or clarify parts of the architecture`,
    `- Resolve specific objections that remain open`,
    `- Propose concrete changes to address concerns`,
    `- Iterate on the design until they are satisfied`,
    `Respond concisely and technically. When proposing changes, clearly state what would be different`,
    `in the architecture and why it resolves the concern.`,
  ].join("\n");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      async function run(model: string) {
        const messages: Parameters<typeof streamText>[0]["messages"] = [
          ...history.map((h) => ({ role: h.role, content: h.content }) as const),
          { role: "user" as const, content: message },
        ];
        const result = streamText({ model: wx(model), system: systemPrompt, messages, maxOutputTokens: 1024 });
        for await (const chunk of result.textStream) {
          send({ type: "chunk", text: chunk });
        }
      }

      try {
        try {
          await run(MODEL);
        } catch {
          console.warn(`[chat] ${MODEL} failed — falling back to ${FALLBACK_MODEL}`);
          await run(FALLBACK_MODEL);
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
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
