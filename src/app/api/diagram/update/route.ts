/**
 * app/api/diagram/update/route.ts
 * TASKS.md 4.8 — Diagram update from transcript.
 *
 * POST { transcript: string, currentDiagram: string }
 * Returns: { updatedDiagram, patch, valid, error?, noChanges }
 */
import { NextResponse } from "next/server";
import { updateDiagramFromTranscript } from "@/backend/lib/mermaid/update";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.transcript !== "string" ||
    typeof body.currentDiagram !== "string" ||
    body.transcript.trim().length === 0 ||
    body.currentDiagram.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "Body must include non-empty `transcript` and `currentDiagram` strings." },
      { status: 400 }
    );
  }

  const result = await updateDiagramFromTranscript(
    body.transcript as string,
    body.currentDiagram as string
  );

  return NextResponse.json(result);
}
