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
 * Strip markdown code fences and trailing non-Mermaid content.
 * Also removes any server log lines that the model output may have
 * captured (e.g. "[SYNTHESIS] model=..." concatenated after the diagram).
 */
function extractMermaid(raw: string): string {
  // 1. Pull content out of ```mermaid or ``` fences
  const fenced = raw.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : raw.trim();

  // 2. Find where the graph block starts
  const graphStart = candidate.search(/^graph\s+(TD|LR|RL|BT|TB)\b/im);
  if (graphStart === -1) return candidate; // no graph block — validator will reject

  const fromGraph = candidate.slice(graphStart);

  // 3. Truncate at the first line that looks like leaked server output.
  // Pattern: lines starting with [ followed by UPPERCASE words (log prefix),
  // or lines starting with " POST " / " GET " (Next.js request log).
  const lines = fromGraph.split("\n");
  const clean: string[] = [];
  for (const line of lines) {
    if (/^\s*\[(?:SYNTHESIS|mermaid|chaos|debate|audio|pptx|git-commit)[\]/]/.test(line)) break;
    if (/^\s*(POST|GET|PUT|DELETE|PATCH)\s+\//.test(line)) break;
    clean.push(line);
  }

  return clean.join("\n").trim();
}

// ── Validation ────────────────────────────────────────────────────────────────
// mermaid.parse() uses DOMPurify which requires a browser window — it cannot
// be called in a Next.js API route (Node.js). We use a lightweight structural
// validator instead: check the graph TD header, detect obvious syntax issues,
// and reject diagrams that would visibly fail in the client renderer.

function validateDiagram(diagram: string): { ok: boolean; error?: string } {
  const trimmed = diagram.trim();

  if (!trimmed) {
    return { ok: false, error: "Empty diagram" };
  }

  // Must start with a recognised Mermaid graph declaration
  if (!/^graph\s+(TD|LR|RL|BT|TB)\b/i.test(trimmed)) {
    return { ok: false, error: "Diagram must start with 'graph TD' (or LR/RL/BT/TB)" };
  }

  // Reject if model leaked server log lines into the diagram
  // (e.g. "[SYNTHESIS] model=..." appended after the Mermaid block)
  if (/\[SYNTHESIS\]|\[mermaid\//.test(trimmed)) {
    return { ok: false, error: "Server log lines leaked into diagram output" };
  }

  // Each non-header line must look like a valid Mermaid statement.
  // We accept: node definitions A["label"], edges A --> B, A -- text --> B,
  // style/class lines, and blank lines. Reject bare prose sentences.
  const lines = trimmed.split("\n").slice(1); // skip the 'graph TD' header
  for (const line of lines) {
    const l = line.trim();
    if (l === "") continue;
    // Valid patterns: edges (-->  ---  ==>  -.->), node defs (A[..] A(...) A{..}),
    // subgraph/end, style/classDef/class, linkStyle, comments (%%)
    const valid =
      /^%%/.test(l) ||                          // comment
      /subgraph|^end$/i.test(l) ||              // subgraph block
      /^style\b|^classDef\b|^class\b|^linkStyle\b/.test(l) || // directives
      /-->|---|==>|-\.-?>|==|~~/.test(l) ||     // edge with any connector
      /^[A-Za-z0-9_]+[\s]*[\[({>]/.test(l) ||  // standalone node definition
      /^[A-Za-z0-9_]+[\s]*$/.test(l);           // bare node reference
    if (!valid) {
      return { ok: false, error: `Unexpected line in diagram: "${l.slice(0, 80)}"` };
    }
  }

  return { ok: true };
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

  const check1 = validateDiagram(diagram1);
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

  const check2 = validateDiagram(diagram2);
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
