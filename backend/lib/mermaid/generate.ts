/**
 * lib/mermaid/generate.ts
 * Generates a validated Mermaid graph TD diagram from an architecture description.
 * AGENTS.md / TASKS.md 3.1:
 *   - Uses ibm/granite-4-h-small (debater model, one call)
 *   - Validates with mermaid.parse() before returning
 *   - Retries once on parse failure with an explicit correction prompt
 *   - Never throws on parse failure — returns { diagram, valid, error } so callers
 *     can surface the error gracefully (AGENTS.md known failure mode)
 */
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import mermaid from "mermaid";

const wx = createWatsonx();

const MODEL = "ibm/granite-4-h-small";
const FALLBACK_MODEL = "meta-llama/llama-3-3-70b-instruct";

export interface DiagramResult {
  /** The raw Mermaid string returned/validated. */
  diagram: string;
  /** True if mermaid.parse() accepted the diagram without error. */
  valid: boolean;
  /** Set when valid is false — the parse error message. */
  error?: string;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are an architecture diagramming assistant.",
  "Your sole task is to produce a Mermaid diagram in `graph TD` format.",
  "Rules:",
  "1. Output ONLY the Mermaid code block — no prose, no explanation, no markdown fences.",
  "2. The first line must be exactly `graph TD`.",
  "3. Each node must have a quoted label: e.g.  A[\"API Gateway\"]",
  "4. Use descriptive node IDs (no spaces, max 20 chars).",
  "5. Maximum 20 nodes, maximum 30 edges.",
  "6. Do NOT use subgraphs, classDef, or click directives.",
].join("\n");

function buildPrompt(description: string): string {
  return [
    `Architecture description:\n${description}`,
    `\nGenerate a graph TD Mermaid diagram that visualises the main components and data flows.`,
    `Output ONLY the Mermaid code, nothing else.`,
  ].join("\n");
}

function buildRetryPrompt(description: string, badDiagram: string, parseError: string): string {
  return [
    `Architecture description:\n${description}`,
    `\nYour previous attempt produced invalid Mermaid that failed to parse:`,
    `\`\`\``,
    badDiagram,
    `\`\`\``,
    `Parse error: ${parseError}`,
    `\nFix the syntax and output ONLY the corrected Mermaid code, nothing else.`,
    `The first line must be exactly \`graph TD\`.`,
  ].join("\n");
}

// ── Mermaid extraction ────────────────────────────────────────────────────────

/**
 * Strip markdown code fences if the model wraps the output despite instructions.
 * Returns the raw Mermaid text.
 */
function extractMermaid(raw: string): string {
  // Remove ```mermaid or ``` fences
  const fenced = raw.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

// ── Validation ────────────────────────────────────────────────────────────────

async function validateDiagram(diagram: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // mermaid.parse resolves to true on success, throws/rejects on failure
    await mermaid.parse(diagram);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── LLM call with fallback ────────────────────────────────────────────────────

async function callModel(system: string, prompt: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: wx(MODEL),
      system,
      prompt,
      maxOutputTokens: 1024,
    });
    return text;
  } catch {
    console.warn(`[mermaid/generate] ${MODEL} failed — falling back to ${FALLBACK_MODEL}`);
    const { text } = await generateText({
      model: wx(FALLBACK_MODEL),
      system,
      prompt,
      maxOutputTokens: 1024,
    });
    return text;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a validated Mermaid diagram from an architecture description.
 * Retries once if the first attempt fails parse validation.
 *
 * @param architectureDescription - The synthesis text from the debate engine.
 * @returns DiagramResult with diagram string and validation status.
 */
export async function generateDiagram(architectureDescription: string): Promise<DiagramResult> {
  // ── Attempt 1 ──────────────────────────────────────────────────────────────
  const raw1 = await callModel(SYSTEM_PROMPT, buildPrompt(architectureDescription));
  const diagram1 = extractMermaid(raw1);

  const check1 = await validateDiagram(diagram1);
  if (check1.ok) {
    console.log(`[mermaid/generate] attempt=1 valid chars=${diagram1.length}`);
    return { diagram: diagram1, valid: true };
  }

  console.warn(
    `[mermaid/generate] attempt=1 parse failed: ${check1.error} — retrying`
  );

  // ── Attempt 2 (retry with parse error context) ─────────────────────────────
  const raw2 = await callModel(
    SYSTEM_PROMPT,
    buildRetryPrompt(architectureDescription, diagram1, check1.error ?? "unknown parse error")
  );
  const diagram2 = extractMermaid(raw2);

  const check2 = await validateDiagram(diagram2);
  if (check2.ok) {
    console.log(`[mermaid/generate] attempt=2 valid chars=${diagram2.length}`);
    return { diagram: diagram2, valid: true };
  }

  console.warn(
    `[mermaid/generate] attempt=2 parse failed: ${check2.error} — returning invalid diagram`
  );

  // Return the second attempt even though it's invalid — the caller/UI handles
  // the error state without blank-screening (AGENTS.md known failure mode).
  return { diagram: diagram2, valid: false, error: check2.error };
}
