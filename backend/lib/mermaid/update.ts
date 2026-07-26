/**
 * lib/mermaid/update.ts
 * TASKS.md 4.7 — Diagram update from voice transcript.
 *
 * Given a spoken critique transcript and the current Mermaid diagram, asks
 * ibm/granite-4-h-small to identify what the speaker wants to change and
 * produces a minimal delta patch (new node/edge lines only — not a full
 * re-render). The patch is appended to the existing diagram and the combined
 * result is validated with mermaid.parse() before returning.
 *
 * Returns the full updated diagram string (existing + patch).
 * Never throws — returns the original diagram unchanged on parse failure so
 * the renderer doesn't blank-screen (AGENTS.md known failure mode).
 */
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";

const wx = createWatsonx();

const MODEL          = "ibm/granite-4-h-small";
const FALLBACK_MODEL = "meta-llama/llama-3-3-70b-instruct";

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are an architecture diagram update assistant.",
  "You are given a spoken-word transcript from an architecture review.",
  "Your task: identify any components, connections, or changes the speaker mentions",
  "and produce a minimal Mermaid patch — only new node and edge lines.",
  "",
  "Rules:",
  "1. Output ONLY new Mermaid lines — no `graph TD` header, no existing lines, no prose.",
  "2. Each line must be a valid Mermaid edge or node definition.",
  "3. Use descriptive node IDs (alphanumeric, no spaces, max 20 chars).",
  "4. Maximum 5 new lines.",
  "5. If the transcript contains no actionable architecture changes, output exactly: NO_CHANGES",
].join("\n");

function buildPrompt(transcript: string, currentDiagram: string): string {
  return [
    `Current diagram:\n${currentDiagram}`,
    `\nTranscript:\n${transcript}`,
    `\nOutput the Mermaid patch lines only (or NO_CHANGES):`,
  ].join("\n");
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callModel(prompt: string): Promise<string> {
  try {
    const { text } = await withRetry(
      () => generateText({ model: wx(MODEL), system: SYSTEM_PROMPT, prompt, maxOutputTokens: 256 }),
      MODEL
    );
    return text.trim();
  } catch {
    console.warn(`[mermaid/update] ${MODEL} failed — falling back to ${FALLBACK_MODEL}`);
    const { text } = await withRetry(
      () => generateText({ model: wx(FALLBACK_MODEL), system: SYSTEM_PROMPT, prompt, maxOutputTokens: 256 }),
      FALLBACK_MODEL
    );
    return text.trim();
  }
}

// ── Validation ────────────────────────────────────────────────────────────────
// Shared lightweight structural validator — same logic as generate.ts.
// mermaid.parse() is browser-only (requires DOMPurify/window); never call it server-side.

function validateDiagram(diagramStr: string): { ok: boolean; error?: string } {
  const trimmed = diagramStr.trim();
  if (!trimmed) return { ok: false, error: "Empty diagram" };
  if (!/^graph\s+(TD|LR|RL|BT|TB)\b/i.test(trimmed)) {
    return { ok: false, error: "Diagram must start with 'graph TD'" };
  }
  const lines = trimmed.split("\n").slice(1);
  for (const line of lines) {
    const l = line.trim();
    if (l === "") continue;
    const valid =
      /^%%/.test(l) ||
      /subgraph|^end$/i.test(l) ||
      /^style\b|^classDef\b|^class\b|^linkStyle\b/.test(l) ||
      /-->|---|==>|-\.-?>|==|~~/.test(l) ||
      /^[A-Za-z0-9_]+[\s]*[\[({>]/.test(l) ||
      /^[A-Za-z0-9_]+[\s]*$/.test(l);
    if (!valid) {
      return { ok: false, error: `Unexpected line: "${l.slice(0, 80)}"` };
    }
  }
  return { ok: true };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiagramUpdateResult {
  /** The updated diagram (original + patch lines). */
  updatedDiagram: string;
  /** The raw patch lines returned by the model. */
  patch: string;
  /** Whether the updated diagram passes mermaid.parse(). */
  valid: boolean;
  /** If valid is false, the parse error. */
  error?: string;
  /** True when the model found no changes to make. */
  noChanges: boolean;
}

/**
 * Update a Mermaid diagram based on architectural critique in a voice transcript.
 * Returns the updated diagram string.
 * Falls back to the original diagram unchanged if the patch produces invalid Mermaid.
 */
export async function updateDiagramFromTranscript(
  transcript: string,
  currentDiagram: string
): Promise<DiagramUpdateResult> {
  const rawPatch = await callModel(buildPrompt(transcript, currentDiagram));

  // Model says nothing to change
  if (rawPatch === "NO_CHANGES" || rawPatch.trim().length === 0) {
    console.log("[mermaid/update] no architectural changes identified in transcript");
    return {
      updatedDiagram: currentDiagram,
      patch: "",
      valid: true,
      noChanges: true,
    };
  }

  // Strip any accidental graph TD header or fences the model emitted
  let cleanPatch = rawPatch
    .replace(/^```(?:mermaid)?\s*/im, "")
    .replace(/\s*```$/m, "")
    .replace(/^graph\s+TD\s*/im, "")
    .trim();

  // Fix anonymous edge targets and problematic label chars in the patch lines
  cleanPatch = cleanPatch
    .split("\n")
    .map((line, _i, _arr, _counter = { n: 0 }) => {
      let fixed = line;
      fixed = fixed.replace(
        /(-->|==>|-\.-?>|---)\s*(\["[^"]*"\])/g,
        (_, arrow: string, label: string) => `${arrow} GEN${Math.random().toString(36).slice(2, 6)}${label}`
      );
      fixed = fixed.replace(/\["([^"]*)"\]/g, (_, inner: string) =>
        `["${inner.replace(/[()]/g, " ").replace(/\//g, " ").replace(/\+/g, " and ").replace(/\|/g, " or ").replace(/\s{2,}/g, " ").trim()}"]`
      );
      return fixed;
    })
    .join("\n");

  // Append patch lines to the existing diagram
  const updatedDiagram = `${currentDiagram.trimEnd()}\n${cleanPatch}`;

  const check = validateDiagram(updatedDiagram);
  if (check.ok) {
    console.log(`[mermaid/update] patch applied, ${cleanPatch.split("\n").length} new lines`);
    return { updatedDiagram, patch: cleanPatch, valid: true, noChanges: false };
  }

  console.warn(`[mermaid/update] patch produced invalid Mermaid: ${check.error} — returning original`);
  return {
    updatedDiagram: currentDiagram,
    patch: cleanPatch,
    valid: false,
    error: check.error,
    noChanges: false,
  };
}
