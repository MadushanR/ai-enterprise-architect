/**
 * app/api/debate/route.ts
 * Streaming debate API: POST {proposal} → Server-Sent Events per agent turn → synthesis.
 * AGENTS.md: loop is a LangGraph StateGraph, max 3 rounds.
 * Each agent turn is emitted as an SSE event as soon as it completes.
 */
import { NextResponse } from "next/server";
import { buildDebateGraph } from "@/lib/debate/graph";
import { synthesize } from "@/lib/debate/synthesis";
import type { DebateState, TranscriptEntry } from "@/lib/debate/state";

export const maxDuration = 300; // Allow long-running debate (Vercel/Edge limit)

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.proposal !== "string" ||
    body.proposal.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `proposal` string." },
      { status: 400 }
    );
  }

  const { proposal } = body as { proposal: string };

  const encoder = new TextEncoder();

  function sseEvent(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let lastState: DebateState | null = null;
      let prevTranscriptLength = 0;

      try {
        // Build graph dynamically from persona loader, then stream
        const graph = await buildDebateGraph();
        for await (const event of await graph.stream(
          {
            proposal,
            round: 0,
            objections: [],
            resolved: false,
            transcript: [],
          },
          { streamMode: "values" }
        )) {
          const state = event as DebateState;
          lastState = state;

          // Emit any new transcript entries since last event
          const newEntries: TranscriptEntry[] = state.transcript.slice(
            prevTranscriptLength
          );
          prevTranscriptLength = state.transcript.length;

          for (const entry of newEntries) {
            controller.enqueue(
              sseEvent({
                type: "turn",
                agent: entry.agent,
                round: entry.round,
                text: entry.turn,
                objections: state.objections,
              })
            );
          }
        }

        // Synthesis — single call outside the loop
        if (lastState) {
          const synthesis = await synthesize(lastState);
          controller.enqueue(
            sseEvent({
              type: "synthesis",
              text: synthesis,
              unresolvedObjections: lastState.objections,
              rounds: lastState.round + 1,
            })
          );
        }
      } catch (err) {
        controller.enqueue(
          sseEvent({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          })
        );
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
