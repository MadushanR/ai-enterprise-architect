/**
 * lib/chaos/narrative.ts
 * TASKS.md 4.1 — Chaos Simulator narrative generator.
 *
 * Given an architecture description, prompts ibm/granite-4-h-small to emit a
 * 4–6-beat stress narrative that progresses through the chaos state machine:
 *   normal → strain → failure → failover → recovery
 *
 * Each beat identifies which architectural nodes are affected, so the UI can
 * recolor only those nodes without touching the full diagram.
 *
 * Beat timing reference: DESIGN.md §8 — 1400 ms inter-beat delay.
 * State colors reference: DESIGN.md §2 / globals.css --col-chaos-*.
 */
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";

const wx = createWatsonx();

const MODEL          = "ibm/granite-4-h-small";
const FALLBACK_MODEL = "meta-llama/llama-3-3-70b-instruct";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChaosState = "normal" | "strain" | "failure" | "failover" | "recovery";

export interface ChaosBeat {
  /** Which phase of the stress narrative this beat represents. */
  state: ChaosState;
  /** Short human-readable label shown in the UI beat indicator. */
  label: string;
  /**
   * Mermaid node IDs that are affected by this beat.
   * Must match the IDs used in the diagram (e.g. "APIGateway", "DB").
   * The classDef emitter uses these to build `class <nodeId> <state>` lines.
   */
  affectedNodes: string[];
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are a chaos engineering simulation assistant.",
  "Your task: given an architecture description, produce a stress-test narrative",
  "as a JSON array of 4–6 beats that progress through the states:",
  "  normal → strain → failure → failover → recovery",
  "",
  "Rules:",
  "1. Output ONLY valid JSON — no prose, no markdown fences.",
  '2. The response must be a JSON array: [{ "state": ..., "label": ..., "affectedNodes": [...] }, ...]',
  '3. "state" must be one of: normal, strain, failure, failover, recovery',
  '4. "label" is ≤8 words describing what is happening (e.g. "Traffic spike hits API gateway")',
  '5. "affectedNodes" is an array of Mermaid node IDs from the architecture description.',
  "   Use the exact IDs from the diagram — alphanumeric, no spaces.",
  "   If no specific IDs can be inferred, use [\"unknown\"].",
  "6. The sequence must begin with state=normal and end with state=recovery.",
  "7. There must be exactly one beat with state=failure.",
].join("\n");

function buildPrompt(description: string): string {
  return [
    `Architecture description:\n${description}`,
    `\nGenerate the chaos simulation beat sequence as a JSON array.`,
  ].join("\n");
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_STATES = new Set<ChaosState>(["normal", "strain", "failure", "failover", "recovery"]);

function validateBeats(raw: unknown): ChaosBeat[] {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > 6) {
    throw new Error(`Expected 4–6 beats, got ${Array.isArray(raw) ? raw.length : typeof raw}`);
  }

  return raw.map((item: unknown, i: number) => {
    if (!item || typeof item !== "object") throw new Error(`Beat ${i}: not an object`);
    const b = item as Record<string, unknown>;

    if (!VALID_STATES.has(b.state as ChaosState)) {
      throw new Error(`Beat ${i}: invalid state "${String(b.state)}"`);
    }
    if (typeof b.label !== "string" || b.label.trim().length === 0) {
      throw new Error(`Beat ${i}: missing label`);
    }
    if (!Array.isArray(b.affectedNodes) || b.affectedNodes.length === 0) {
      throw new Error(`Beat ${i}: affectedNodes must be a non-empty array`);
    }

    return {
      state: b.state as ChaosState,
      label: String(b.label).trim(),
      affectedNodes: (b.affectedNodes as unknown[]).map((n) => String(n)),
    };
  });
}

// ── LLM call with fallback ────────────────────────────────────────────────────

async function callModel(prompt: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: wx(MODEL),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 512,
    });
    return text;
  } catch {
    console.warn(`[chaos/narrative] ${MODEL} failed — falling back to ${FALLBACK_MODEL}`);
    const { text } = await generateText({
      model: wx(FALLBACK_MODEL),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 512,
    });
    return text;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a 4–6 beat chaos narrative for the given architecture description.
 * Strips markdown fences if the model wraps the JSON despite instructions.
 * Throws if the response cannot be parsed into a valid ChaosBeat[].
 */
export async function generateNarrative(description: string): Promise<ChaosBeat[]> {
  const raw = await callModel(buildPrompt(description));

  // Strip optional ```json fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`[chaos/narrative] JSON parse failed: ${String(err)}\nRaw: ${cleaned.slice(0, 200)}`);
  }

  const beats = validateBeats(parsed);
  console.log(`[chaos/narrative] generated ${beats.length} beats`);
  return beats;
}
