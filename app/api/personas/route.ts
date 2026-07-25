/**
 * app/api/personas/route.ts
 * GET /api/personas — returns the active persona list from the loader.
 * Exposes only safe fields: no system prompt body, no file paths.
 * Used by the UI to build agent badges dynamically.
 */
import { NextResponse } from "next/server";
import { loadPersonas } from "@/lib/debate/load-personas";

export async function GET(): Promise<Response> {
  const personas = await loadPersonas();

  const safe = personas.map((p) => ({
    id: p.id,
    name: p.name,
    role_type: p.role_type,
    model: p.model,
    enabled: p.enabled,
    turn_order: p.turn_order,
    accent_color: p.accent_color ?? null,
  }));

  return NextResponse.json(safe);
}
