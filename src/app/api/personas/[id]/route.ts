/**
 * app/api/personas/[id]/route.ts
 * PATCH  /api/personas/[id] — toggle enabled / runs_after_synthesis fields.
 * PUT    /api/personas/[id] — full edit of all persona fields (rewrites the file).
 * DELETE /api/personas/[id] — remove the persona file from disk + git.
 *
 * Every write goes through commitFile / deleteFile — changes are versioned
 * git commits and take effect on the next debate request without a redeploy.
 *
 * AGENTS.md GitOps rule: every persona edit must be a real git commit.
 */
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { commitFile, deleteFile } from "@/backend/lib/git-commit";
import type { PersonaCreatePayload } from "@/src/app/api/personas/create/route";

// ── Helpers ────────────────────────────────────────────────────────────────

function setFrontmatterField(raw: string, field: string, value: string): string {
  const fmMatch = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!fmMatch) return raw;

  const [, open, yamlBlock, close, body] = fmMatch;
  const lineRegex = new RegExp(`^(${field}\\s*:\\s*).*$`, "m");

  const updatedYaml = lineRegex.test(yamlBlock)
    ? yamlBlock.replace(lineRegex, `$1${value}`)
    : `${yamlBlock}\n${field}: ${value}`;

  return `${open}${updatedYaml}${close}${body}`;
}

function buildPersonaFile(p: PersonaCreatePayload): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${p.id}`);
  lines.push(`name: ${p.name}`);
  lines.push(`role_type: ${p.role_type}`);
  lines.push(`model: ${p.model}`);
  lines.push(`enabled: ${p.enabled}`);
  lines.push(`turn_order: ${p.turn_order}`);
  if (p.accent_color) lines.push(`accent_color: "${p.accent_color}"`);
  if (p.role_type === "guardian" && p.compliance_ref) {
    lines.push(`compliance_ref: "${p.compliance_ref}"`);
  }
  if (p.runs_after_synthesis) lines.push(`runs_after_synthesis: true`);
  lines.push("---");
  lines.push("");
  lines.push(p.system_prompt.trim());
  return lines.join("\n");
}

function validateId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

// ── PATCH — toggle enabled / runs_after_synthesis ─────────────────────────

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

  if (!validateId(id)) {
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

// ── PUT — full persona edit ───────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const body = await request.json().catch(() => null) as Partial<PersonaCreatePayload> | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!validateId(id)) {
    return NextResponse.json({ error: "Invalid persona id." }, { status: 400 });
  }

  // Validate required fields
  const missing: string[] = [];
  for (const f of ["name", "role_type", "model", "system_prompt"] as const) {
    if (!body[f] || String(body[f]).trim() === "") missing.push(f);
  }
  if (missing.length) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  if (body.role_type !== "debater" && body.role_type !== "guardian") {
    return NextResponse.json({ error: "role_type must be debater or guardian." }, { status: 400 });
  }

  if (body.role_type === "guardian" && !body.compliance_ref) {
    return NextResponse.json(
      { error: "Guardian personas require a compliance_ref field." },
      { status: 400 }
    );
  }

  // Ensure the persona file exists before editing
  const filePath = join(process.cwd(), "backend", "personas", "agents", `${id}.md`);
  try {
    await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: `Persona "${id}" not found.` }, { status: 404 });
  }

  const payload: PersonaCreatePayload = {
    id,  // id cannot be changed (it's the filename slug)
    name: body.name!,
    role_type: body.role_type,
    model: body.model!,
    enabled: body.enabled ?? true,
    turn_order: body.turn_order ?? 10,
    accent_color: body.accent_color,
    compliance_ref: body.compliance_ref,
    runs_after_synthesis: body.runs_after_synthesis ?? false,
    system_prompt: body.system_prompt!,
  };

  const content = buildPersonaFile(payload);

  await commitFile(
    filePath,
    content,
    `feat(personas): edit persona "${id}" via admin UI`
  );

  return NextResponse.json({ updated: true, id });
}

// ── DELETE — remove persona file ──────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  if (!validateId(id)) {
    return NextResponse.json({ error: "Invalid persona id." }, { status: 400 });
  }

  const filePath = join(process.cwd(), "backend", "personas", "agents", `${id}.md`);

  // Verify the file exists before deleting
  try {
    await readFile(filePath, "utf-8");
  } catch {
    return NextResponse.json({ error: `Persona "${id}" not found.` }, { status: 404 });
  }

  await deleteFile(
    filePath,
    `feat(personas): delete persona "${id}" via admin UI`
  );

  return NextResponse.json({ deleted: true, id });
}
