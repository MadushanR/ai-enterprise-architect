/**
 * app/api/personas/all/route.ts
 * GET /api/personas/all — returns ALL personas including disabled ones.
 * Used exclusively by the admin UI (/settings/personas).
 * Returns system prompt body and file path so the admin can display/edit them.
 *
 * Unlike GET /api/personas (which filters enabled:true for the debate engine),
 * this route exposes every parsed persona file with all safe fields.
 */
import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

// Inline the frontmatter parser rather than importing from load-personas
// to avoid the loader's enabled-filter and avoid coupling admin to debate logic.
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const [, yamlBlock, body] = match;
  const meta: Record<string, unknown> = {};
  for (const line of yamlBlock.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    const valStr = rawVal.replace(/\s+#.*$/, "").trim();
    const unquoted = valStr.replace(/^["']|["']$/g, "");
    if (unquoted === "true") meta[key] = true;
    else if (unquoted === "false") meta[key] = false;
    else if (/^\d+$/.test(unquoted)) meta[key] = parseInt(unquoted, 10);
    else meta[key] = unquoted;
  }
  return { meta, body: body.trim() };
}

export interface AdminPersona {
  id: string;
  name: string;
  role_type: "debater" | "guardian";
  model: string;
  enabled: boolean;
  turn_order: number;
  accent_color: string | null;
  compliance_ref: string | null;
  /** When true, this persona runs after synthesis instead of during debate rounds. */
  runs_after_synthesis: boolean;
  system_prompt: string;
  /** Filename only (e.g. "sa.md") — used to build PATCH URLs. */
  filename: string;
  /** True if frontmatter failed to parse. */
  parse_error: boolean;
}

export async function GET(): Promise<Response> {
  const dir = join(process.cwd(), "backend", "personas", "agents");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();

  const personas: AdminPersona[] = await Promise.all(
    files.map(async (filename) => {
      const raw = await readFile(join(dir, filename), "utf-8");
      const parsed = parseFrontmatter(raw);

      if (!parsed) {
        return {
          id: filename.replace(/\.md$/, ""),
          name: filename,
          role_type: "debater" as const,
          model: "",
          enabled: false,
          turn_order: 99,
          accent_color: null,
          compliance_ref: null,
          runs_after_synthesis: false,
          system_prompt: raw,
          filename,
          parse_error: true,
        };
      }

      const m = parsed.meta;
      return {
        id: String(m.id ?? filename.replace(/\.md$/, "")),
        name: String(m.name ?? filename),
        role_type: (m.role_type === "guardian" ? "guardian" : "debater") as "debater" | "guardian",
        model: String(m.model ?? ""),
        enabled: Boolean(m.enabled),
        turn_order: Number(m.turn_order ?? 99),
        accent_color: m.accent_color ? String(m.accent_color) : null,
        compliance_ref: m.compliance_ref ? String(m.compliance_ref) : null,
        runs_after_synthesis: m.runs_after_synthesis === true,
        system_prompt: parsed.body,
        filename,
        parse_error: false,
      };
    })
  );

  // Sort enabled first, then by turn_order
  personas.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.turn_order - b.turn_order;
  });

  return NextResponse.json(personas);
}
