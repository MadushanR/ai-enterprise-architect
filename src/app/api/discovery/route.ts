import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";

const wx = createWatsonx();

export interface CreativeBrief {
  problem: string;
  constraints: string[];
  drivers: string[];
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.idea !== "string" || body.idea.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `idea` string." },
      { status: 400 }
    );
  }

  const { idea } = body as { idea: string };

  const system = [
    "You are a senior enterprise architect assistant.",
    "Your task is to analyse a business idea and produce a structured creative brief.",
    "Return ONLY valid JSON — no markdown fences, no prose outside the JSON object.",
    'The JSON must match: { "problem": string, "constraints": string[], "drivers": string[] }',
    "- problem: one clear sentence stating the core problem the idea is trying to solve.",
    "- constraints: 3–5 hard non-negotiable constraints (regulatory, technical, operational).",
    "- drivers: 3–5 primary success drivers that will determine whether this succeeds.",
  ].join("\n");

  let text: string;
  try {
    ({ text } = await withRetry(
      () => generateText({
        model: wx("ibm/granite-4-h-small"),
        system,
        prompt: `Business idea: ${idea}`,
        maxOutputTokens: 512,
      }),
      "discovery/granite-4-h-small"
    ));
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error && "statusCode" in err
        ? (err as { statusCode: number }).statusCode
        : 0;
    // Still 429 after all retries — surface it to the client with a clear message
    if (statusCode === 429 || statusCode === 403) {
      return NextResponse.json(
        { error: "watsonx rate limit reached — please wait a moment and try again." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "AI service unavailable. Please try again later." },
      { status: 503 }
    );
  }

  let brief: CreativeBrief;
  try {
    brief = JSON.parse(text) as CreativeBrief;
  } catch {
    // Granite sometimes wraps JSON in fences despite the instruction — strip them
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    brief = JSON.parse(cleaned) as CreativeBrief;
  }

  return NextResponse.json(brief);
}
