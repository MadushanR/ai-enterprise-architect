/**
 * lib/debate/agents/guardian.ts
 * Generic guardian node factory.
 * Takes a PersonaConfig with role_type: guardian, resolves compliance_ref glob
 * at runtime, and calls the guardian model with thinking mode.
 * Replaces the one-off security.ts file.
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { generateText } from "ai";
import { createWatsonx } from "watsonx-ai-provider";
import { withRetry } from "@/backend/lib/with-retry";
import type { PersonaConfig } from "@/backend/lib/debate/load-personas";
import type { DebateState, DebateUpdate, Objection, TranscriptEntry } from "@/backend/lib/debate/state";

const wx = createWatsonx();

const FALLBACK_MODEL = "meta-llama/llama-3-3-70b-instruct";

/**
 * Resolve the compliance_ref glob to file contents.
 * The glob is relative to the repo root (process.cwd()).
 * Supported pattern: "dir/subdir/*.md" — reads all .md files in that directory.
 */
async function loadComplianceFiles(globPattern: string): Promise<string> {
  // Expand simple "dir/*.md" globs — no third-party glob library needed
  const lastSlash = globPattern.lastIndexOf("/");
  const dir = join(process.cwd(), globPattern.slice(0, lastSlash));
  const ext = globPattern.slice(globPattern.lastIndexOf("."));

  const files = (await readdir(dir)).filter((f) => f.endsWith(ext));
  const contents = await Promise.all(files.map((f) => readFile(join(dir, f), "utf-8")));
  return contents.join("\n\n---\n\n");
}

/**
 * Returns an async node function for the given guardian persona.
 */
export function guardianNode(
  persona: PersonaConfig
): (state: DebateState) => Promise<DebateUpdate> {
  return async (state: DebateState): Promise<DebateUpdate> => {
    const mandates = persona.compliance_ref
      ? await loadComplianceFiles(persona.compliance_ref)
      : "";

    const system = [
      persona.systemPrompt,
      mandates ? `\n\n## Loaded Compliance Mandates\n\n${mandates}` : "",
    ].join("");

    const prompt = `Round ${state.round + 1}. Evaluate this architecture proposal against all loaded compliance mandates:\n\n${state.proposal}`;

    let fullText = "";
    let modelUsed = persona.model;

    try {
      const result = await withRetry(
        () =>
          generateText({
            model: wx(persona.model),
            system,
            prompt,
            maxOutputTokens: 1024,
            providerOptions: { watsonx: { reasoningEffort: "high" } },
          }),
        persona.model
      );
      fullText = result.text;
    } catch {
      console.warn(`[${persona.id}] ${persona.model} failed — falling back to ${FALLBACK_MODEL}`);
      modelUsed = FALLBACK_MODEL;
      const result = await withRetry(
        () =>
          generateText({
            model: wx(FALLBACK_MODEL),
            system,
            prompt,
            maxOutputTokens: 1024,
          }),
        FALLBACK_MODEL
      );
      fullText = result.text;
    }

    console.log(
      `[${persona.id}][round ${state.round}] model=${modelUsed} chars=${fullText.length}`
    );

    const objMatch = fullText.match(/OBJECTION:\s*(.+)$/m);
    const objection: Objection | null = objMatch
      ? { agent: persona.id, reason: objMatch[1].trim() }
      : null;

    const withoutMe = state.objections.filter((o) => o.agent !== persona.id);
    const newObjections: Objection[] = objection ? [...withoutMe, objection] : withoutMe;

    const entry: TranscriptEntry = { agent: persona.id, turn: fullText, round: state.round };

    return { objections: newObjections, transcript: [entry] };
  };
}

