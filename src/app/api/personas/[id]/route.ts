/**
 * app/api/personas/[id]/route.ts
 * PATCH /api/personas/[id] — toggle enabled field on a persona file.
 * Body: { enabled: boolean }
 * Writes the updated frontmatter and commits via lib/git-commit.ts.
 *
 * AGENTS.md GitOps rule: every persona edit must be a real git commit.
 */
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { commitFile } from "@/backend/lib/git-commit";

function setFrontmatterField(raw: string, field: string, value: string): string {
  // Replace the field's value in the YAML frontmatter block.
  // Handles both quoted and unquoted values.
  const fmMatch = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!fmMatch) return raw;

  const [, open, yamlBlock, close, body] = fmMatch;
  const lineRegex = new RegExp(`^(${field}\\s*:\\s*).*$`, "m");

  const updatedYaml = lineRegex.test(yamlBlock)
    ? yamlBlock.replace(lineRegex, `$1${value}`)
    : `${yamlBlock}\n${field}: ${value}`;

  return `${open}${updatedYaml}${close}${body}`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || (typeof body.enabled !== "boolean" && typeof body.runs_after_synthesis !== "boolean")) {
    return NextResponse.json(
      { error: "Body must include `enabled` (boolean) or `runs_after_synthesis` (boolean)." },
      { status: 400 }
    );
  }

  // Sanitise id — must be a valid persona slug (alphanum + hyphens only)
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid persona id." }, { status: 400 });
  }

  const filePath = join(process.cwd(), "backend", "personas", "agents", `${id}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: `Persona "${id}" not found.` }, { status: 404 });
  }

  let updated = raw;
  const changes: string[] = [];

  if (typeof body.enabled === "boolean") {
    updated = setFrontmatterField(updated, "enabled", String(body.enabled));
    changes.push(body.enabled ? "enable" : "disable");
  }

  if (typeof body.runs_after_synthesis === "boolean") {
    if (body.runs_after_synthesis) {
      updated = setFrontmatterField(updated, "runs_after_synthesis", "true");
    } else {
      // Remove the line entirely when false (keep frontmatter clean)
      updated = updated.replace(/^runs_after_synthesis:\s*.*\r?\n/m, "");
    }
    changes.push(`runs_after_synthesis=${body.runs_after_synthesis}`);
  }

  await commitFile(
    filePath,
    updated,
    `feat(personas): ${changes.join(", ")} persona "${id}" via admin UI`
  );

  return NextResponse.json({ id, enabled: body.enabled, runs_after_synthesis: body.runs_after_synthesis });
}
