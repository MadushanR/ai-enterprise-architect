/**
 * app/api/chaos/route.ts
 * TASKS.md 4.3 — Chaos simulator SSE stream.
 *
 * POST { description: string, reducedMotion?: boolean }
 *   → Server-Sent Events, one event per beat:
 *     data: { beat: number, state, label, affectedNodes, patch }
 *
 * Inter-beat delay: 1400 ms (0 ms when reducedMotion: true).
 * DESIGN.md §8: beat timing and reduced-motion contract.
 */
import { NextResponse } from "next/server";
import { generateNarrative } from "@/backend/lib/chaos/narrative";
import { buildClassDefPatch } from "@/backend/lib/chaos/classDef";

export const maxDuration = 120;

const BEAT_DELAY_MS = 1400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.description !== "string" || body.description.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `description` string." },
      { status: 400 }
    );
  }

  const { description, reducedMotion = false } = body as {
    description: string;
    reducedMotion?: boolean;
  };

  const delay = reducedMotion ? 0 : BEAT_DELAY_MS;
  const encoder = new TextEncoder();

  function sseEvent(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const beats = await generateNarrative(description);

        for (let i = 0; i < beats.length; i++) {
          const beat = beats[i];
          const patch = buildClassDefPatch(beat);

          controller.enqueue(
            sseEvent({
              beat: i,
              total: beats.length,
              state: beat.state,
              label: beat.label,
              affectedNodes: beat.affectedNodes,
              patch,
            })
          );

          // Wait before emitting the next beat (skip delay after the last beat)
          if (i < beats.length - 1 && delay > 0) {
            await sleep(delay);
          }
        }

        // Signal completion
        controller.enqueue(
          sseEvent({ type: "done", total: beats.length })
        );
      } catch (err) {
        controller.enqueue(
          sseEvent({
            type: "error",
            message: err instanceof Error ? err.message : "Chaos simulation failed",
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
