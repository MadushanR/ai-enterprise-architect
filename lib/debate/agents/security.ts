/**
 * lib/debate/agents/security.ts
 * Security & Compliance agent node for the LangGraph debate graph.
 * Loads BYOC compliance mandates from /personas/compliance/*.md at runtime.
 * AGENTS.md: ibm/granite-guardian-3-8b (thinking mode via reasoningEffort).
 */
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import type { DebateState, DebateUpdate, Objection, TranscriptEntry } from "@/lib/debate/state";

const wx = createWatsonx();

const MODEL_PRIMARY = "ibm/granite-guardian-3-8b";
const MODEL_FALLBACK = "meta-llama/llama-3-3-70b-instruct";

async function loadPersona(): Promise<string> {
  const path = join(process.cwd(), "personas", "agents", "security.md");
  return readFile(path, "utf-8");
}

async function loadComplianceMandates(): Promise<string> {
  const dir = join(process.cwd(), "personas", "compliance");
  const files = await readdir(dir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const contents = await Promise.all(
    mdFiles.map((f) => readFile(join(dir, f), "utf-8"))
  );
  return contents.join("\n\n---\n\n");
}

function parseObjection(text: string): Objection | null {
  const objMatch = text.match(/OBJECTION:\s*(.+)$/m);
  if (objMatch) {
    return { agent: "security", reason: objMatch[1].trim() };
  }
  return null;
}

export async function securityNode(state: DebateState): Promise<DebateUpdate> {
  const [persona, mandates] = await Promise.all([
    loadPersona(),
    loadComplianceMandates(),
  ]);

  const systemPrompt = `${persona}\n\n## Loaded Compliance Mandates\n\n${mandates}`;

  let fullText = "";
  let modelUsed = MODEL_PRIMARY;

  try {
    // granite-guardian-3-8b: use reasoningEffort for thinking mode
    const result = await generateText({
      model: wx(MODEL_PRIMARY),
      system: systemPrompt,
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal against all loaded compliance mandates:\n\n${state.proposal}`,
      maxOutputTokens: 1024,
      providerOptions: {
        watsonx: { reasoningEffort: "high" },
      },
    });
    fullText = result.text;
  } catch {
    // Fallback: use llama without thinking mode
    modelUsed = MODEL_FALLBACK;
    const result = await generateText({
      model: wx(MODEL_FALLBACK),
      system: systemPrompt,
      prompt: `Round ${state.round + 1}. Evaluate this architecture proposal against all loaded compliance mandates:\n\n${state.proposal}`,
      maxOutputTokens: 1024,
    });
    fullText = result.text;
  }

  console.log(`[SECURITY][round ${state.round}] model=${modelUsed} chars=${fullText.length}`);

  const objection = parseObjection(fullText);

  const withoutSecurity = state.objections.filter((o) => o.agent !== "security");
  const newObjections: Objection[] = objection
    ? [...withoutSecurity, objection]
    : withoutSecurity;

  const entry: TranscriptEntry = {
    agent: "security",
    turn: fullText,
    round: state.round,
  };

  return {
    objections: newObjections,
    transcript: [entry],
  };
}
