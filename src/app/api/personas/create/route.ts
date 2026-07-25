/**
 * app/api/personas/create/route.ts
 * POST /api/personas/create — create a new persona file.
 * Body: PersonaCreatePayload (all required AGENTS.md frontmatter fields + system_prompt body)
 * Writes the file and commits via lib/git-commit.ts.
 *
 * AGENTS.md GitOps rule: every persona write must be a real git commit.
 */
import { NextResponse } from "next/server";
import { join } from "path";
import { readdir } from "fs/promises";
import { commitFile } from "@/backend/lib/git-commit";

export interface PersonaCreatePayload {
  id: string;            // slug — unique, lowercase, no spaces
  name: string;
  role_type: "debater" | "guardian";
  model: string;
  enabled: boolean;
  turn_order: number;
  accent_color?: string; // optional hex
  compliance_ref?: string; // guardian only
  system_prompt: string; // markdown body (the persona's system prompt)
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
  lines.push("---");
  lines.push("");
  lines.push(p.system_prompt.trim());
  return lines.join("\n");
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as Partial<PersonaCreatePayload> | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate required fields
  const missing: string[] = [];
  for (const f of ["id", "name", "role_type", "model", "system_prompt"] as const) {
    if (!body[f] || String(body[f]).trim() === "") missing.push(f);
  }
  if (missing.length) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  // Validate id format
  if (!/^[a-z0-9-]+$/.test(body.id!)) {
    return NextResponse.json(
      { error: "id must be lowercase alphanumeric with hyphens only." },
      { status: 400 }
    );
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

  // Check id uniqueness
  const dir = join(process.cwd(), "backend", "personas", "agents");
  const existing = (await readdir(dir)).map((f) => f.replace(/\.md$/, ""));
  if (existing.includes(body.id!)) {
    return NextResponse.json({ error: `Persona id "${body.id}" already exists.` }, { status: 409 });
  }

  const payload: PersonaCreatePayload = {
    id: body.id!,
    name: body.name!,
    role_type: body.role_type,
    model: body.model!,
    enabled: body.enabled ?? true,
    turn_order: body.turn_order ?? (existing.length + 1),
    accent_color: body.accent_color,
    compliance_ref: body.compliance_ref,
    system_prompt: body.system_prompt!,
  };

  const content = buildPersonaFile(payload);
  const filePath = join(dir, `${payload.id}.md`);

  await commitFile(
    filePath,
    content,
    `feat(personas): add persona "${payload.id}" via admin UI`
  );

  return NextResponse.json({ created: true, id: payload.id }, { status: 201 });
}
