/**
 * app/api/pitch-deck/route.ts
 * POST /api/pitch-deck
 * Body: { proposal, synthesis, diagram, transcript, objections, brief }
 * Returns: .pptx binary stream
 *
 * Calls generatePitchDeck(), streams the resulting Buffer back as a download.
 */
import { NextResponse } from "next/server";
import { generatePitchDeck, type PitchDeckInput } from "@/backend/lib/pptx/generate";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Request body is required." }, { status: 400 });
  }

  const { proposal, synthesis, diagram, transcript, objections, brief } =
    body as Partial<PitchDeckInput>;

  if (
    typeof proposal !== "string" || proposal.trim().length === 0 ||
    typeof synthesis !== "string" || synthesis.trim().length === 0 ||
    typeof diagram !== "string" || diagram.trim().length === 0 ||
    !Array.isArray(transcript) ||
    !Array.isArray(objections) ||
    !brief || typeof brief.problem !== "string"
  ) {
    return NextResponse.json(
      {
        error:
          "Body must include: proposal (string), synthesis (string), diagram (string), " +
          "transcript (array), objections (array), brief ({ problem, constraints, drivers }).",
      },
      { status: 400 }
    );
  }

  try {
    const pptxBuffer = await generatePitchDeck({
      proposal,
      synthesis,
      diagram,
      transcript,
      objections,
      brief,
    });

    return new Response(new Uint8Array(pptxBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": 'attachment; filename="architecture-review.pptx"',
        "Content-Length": String(pptxBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/pitch-deck]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate pitch deck." },
      { status: 500 }
    );
  }
}
