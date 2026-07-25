/**
 * lib/debate/load-personas.ts
 * Runtime persona loader — reads all /personas/agents/*.md files, parses YAML
 * frontmatter, validates required fields, and returns a sorted, capped array
 * of PersonaConfig objects ready for the debate graph to consume.
 *
 * AGENTS.md rules enforced here:
 * - max 6 active role_type:debater personas (warn + truncate, never throw)
 * - enabled: false files are skipped silently
 * - malformed frontmatter skips the file with a warning (never crashes debate)
 * - duplicate ids are rejected (first occurrence wins, others warned + skipped)
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export type RoleType = "debater" | "guardian";

export interface PersonaConfig {
  /** File path the config was loaded from (absolute). */
  filePath: string;
  /** Unique slug identifier (from frontmatter `id`). */
  id: string;
  /** Display name shown in the UI agent badge. */
  name: string;
  /** Determines which node factory to use. */
  role_type: RoleType;
  /** watsonx model ID to call for this persona. */
  model: string;
  /** Whether this persona participates in the debate. */
  enabled: boolean;
  /** Ascending sort key — lower = earlier in each round. */
  turn_order: number;
  /** Optional hex accent color for the UI badge. */
  accent_color?: string;
  /** Guardian only: glob pattern for BYOC compliance files. */
  compliance_ref?: string;
  /** System prompt text (markdown body below the frontmatter fence). */
  systemPrompt: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_DEBATERS = 6;
const REQUIRED_FIELDS = ["id", "name", "role_type", "model", "enabled", "turn_order"] as const;

// ── Frontmatter parser ──────────────────────────────────────────────────────

/**
 * Minimal YAML frontmatter parser.
 * Handles the subset used in persona files: string, boolean, and integer scalars.
 * Avoids a full js-yaml dependency for a controlled schema.
 */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yamlBlock, body] = match;
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    // Strip inline comments
    const valStr = rawVal.replace(/\s+#.*$/, "").trim();

    // Remove surrounding quotes
    const unquoted = valStr.replace(/^["']|["']$/g, "");

    // Coerce booleans and integers
    if (unquoted === "true") meta[key] = true;
    else if (unquoted === "false") meta[key] = false;
    else if (/^\d+$/.test(unquoted)) meta[key] = parseInt(unquoted, 10);
    else meta[key] = unquoted;
  }

  return { meta, body: body.trim() };
}

/** Validate that a parsed meta object satisfies the PersonaConfig contract. */
function validateMeta(
  meta: Record<string, unknown>,
  filePath: string
): PersonaConfig | null {
  for (const field of REQUIRED_FIELDS) {
    if (meta[field] === undefined || meta[field] === "") {
      console.warn(`[load-personas] ${filePath}: missing required field "${field}" — skipping`);
      return null;
    }
  }

  const role_type = meta.role_type as string;
  if (role_type !== "debater" && role_type !== "guardian") {
    console.warn(`[load-personas] ${filePath}: invalid role_type "${role_type}" — skipping`);
    return null;
  }

  if (role_type === "guardian" && !meta.compliance_ref) {
    console.warn(`[load-personas] ${filePath}: guardian persona missing compliance_ref — skipping`);
    return null;
  }

  if (role_type === "debater" && meta.compliance_ref) {
    console.warn(`[load-personas] ${filePath}: debater persona has compliance_ref — field ignored`);
  }

  return {
    filePath,
    id: String(meta.id),
    name: String(meta.name),
    role_type,
    model: String(meta.model),
    enabled: Boolean(meta.enabled),
    turn_order: Number(meta.turn_order),
    accent_color: meta.accent_color ? String(meta.accent_color) : undefined,
    compliance_ref: meta.compliance_ref ? String(meta.compliance_ref) : undefined,
    systemPrompt: "", // filled in after body is known
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load, validate, filter, and sort all persona configs from /personas/agents/.
 * Returns only enabled personas, sorted by turn_order ascending.
 * Debater count is capped at MAX_DEBATERS; excess entries are warned and dropped.
 */
export async function loadPersonas(): Promise<PersonaConfig[]> {
  const dir = join(process.cwd(), "personas", "agents");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

  const configs: PersonaConfig[] = [];
  const seenIds = new Set<string>();

  await Promise.all(
    files.map(async (file) => {
      const filePath = join(dir, file);
      const raw = await readFile(filePath, "utf-8");

      const parsed = parseFrontmatter(raw);
      if (!parsed) {
        console.warn(`[load-personas] ${filePath}: no frontmatter block found — skipping`);
        return;
      }

      const config = validateMeta(parsed.meta, filePath);
      if (!config) return;

      if (!config.enabled) return; // silently skip disabled personas

      if (seenIds.has(config.id)) {
        console.warn(`[load-personas] duplicate id "${config.id}" in ${filePath} — skipping`);
        return;
      }
      seenIds.add(config.id);

      config.systemPrompt = parsed.body;
      configs.push(config);
    })
  );

  // Sort by turn_order ascending
  configs.sort((a, b) => a.turn_order - b.turn_order);

  // Enforce debater cap
  const debaters = configs.filter((c) => c.role_type === "debater");
  if (debaters.length > MAX_DEBATERS) {
    const excess = debaters.slice(MAX_DEBATERS);
    console.warn(
      `[load-personas] ${debaters.length} debater personas enabled; ` +
        `cap is ${MAX_DEBATERS}. Dropping: ${excess.map((c) => c.id).join(", ")}`
    );
    const dropIds = new Set(excess.map((c) => c.id));
    return configs.filter((c) => !dropIds.has(c.id));
  }

  return configs;
}
