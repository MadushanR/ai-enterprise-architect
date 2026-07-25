/**
 * app/api/diagram/route.ts
 * POST /api/diagram
 * Body: { description: string }
 * Returns: { diagram: string, valid: boolean, error?: string }
 *
 * Calls the Mermaid generation helper which prompts ibm/granite-4-h-small,
 * validates with mermaid.parse(), and retries once on failure.
 */
import { NextResponse } from "next/server";
import { generateDiagram } from "@/backend/lib/mermaid/generate";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.description !== "string" ||
    body.description.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `description` string." },
      { status: 400 }
    );
  }

  const result = await generateDiagram(body.description as string);

  // Always return 200 — the `valid` flag tells the client whether to render or show error.
  // This avoids the blank-screen failure mode described in AGENTS.md.
  return NextResponse.json(result, { status: 200 });
}
