"use client";

/**
 * app/settings/personas/page.tsx
 * TASKS.md 5.7 — Persona admin UI.
 *
 * Lists all personas (including disabled) from GET /api/personas/all.
 * - Toggle enabled/disabled via PATCH /api/personas/[id]
 * - Add a new persona via POST /api/personas/create
 *
 * Every write goes through the server routes which call commitFile —
 * changes are versioned git commits and take effect on the next debate
 * request without a redeploy.
 *
 * DESIGN.md tokens are used throughout; no new colors introduced.
 */

import { useEffect, useState } from "react";
import type { AdminPersona } from "@/src/app/api/personas/all/route";
import type { PersonaCreatePayload } from "@/src/app/api/personas/create/route";
import ThemeToggle from "@/src/components/ThemeToggle";

// ── Helpers ────────────────────────────────────────────────────────────────────

const ROLE_TYPE_OPTIONS: Array<"debater" | "guardian"> = ["debater", "guardian"];

const DEFAULT_FORM: PersonaCreatePayload = {
  id: "",
  name: "",
  role_type: "debater",
  model: "ibm/granite-4-h-small",
  enabled: true,
  turn_order: 10,
  accent_color: "",
  compliance_ref: "",
  system_prompt: "",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function PersonasAdminPage() {
  const [personas, setPersonas] = useState<AdminPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-persona toggle state  { id → "pending" | "error" }
  const [toggleState, setToggleState] = useState<Record<string, "pending" | "error">>({});

  // New persona form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PersonaCreatePayload>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────

  async function loadPersonas() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/personas/all");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPersonas((await res.json()) as AdminPersona[]);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load personas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPersonas(); }, []);

  // ── Toggle enabled ─────────────────────────────────────────────────────────

  async function handleToggle(id: string, enabled: boolean) {
    setToggleState((s) => ({ ...s, [id]: "pending" }));
    try {
      const res = await fetch(`/api/personas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Optimistic update
      setPersonas((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled } : p))
      );
      setToggleState((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    } catch (e) {
      console.error("[personas/toggle]", e);
      setToggleState((s) => ({ ...s, [id]: "error" }));
    }
  }

  // ── Create persona ─────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setFormSubmitting(true);
    try {
      const res = await fetch("/api/personas/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json() as { created?: boolean; id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setFormSuccess(`Persona "${body.id ?? form.id}" created and committed.`);
      setForm(DEFAULT_FORM);
      setShowForm(false);
      await loadPersonas();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setFormSubmitting(false);
    }
  }

  // ── Styles (shared) ────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.8125rem",
    backgroundColor: "var(--col-base)",
    color: "var(--col-ink)",
    border: "1px solid var(--col-rule)",
    borderRadius: "4px",
    padding: "6px 10px",
    width: "100%",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-plex-condensed)",
    fontSize: "0.6875rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    color: "var(--col-muted)",
    display: "block",
    marginBottom: "4px",
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--col-base)",
        color: "var(--col-ink)",
        fontFamily: "var(--font-geist-sans)",
      }}
    >
      {/* Header */}
      <header
        style={{
          backgroundColor: "var(--col-surface)",
          borderBottom: "1px solid var(--col-rule)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <a
            href="/"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.75rem",
              color: "var(--col-muted)",
              textDecoration: "none",
            }}
            aria-label="Back to main app"
          >
            ← Back
          </a>
          <h1
            style={{
              fontFamily: "var(--font-plex-condensed)",
              fontSize: "1rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--col-ink)",
              margin: 0,
            }}
          >
            Persona Admin
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => { setShowForm((v) => !v); setFormError(null); setFormSuccess(null); }}
            style={{
              fontFamily: "var(--font-geist-sans)",
              fontSize: "0.8125rem",
              backgroundColor: showForm ? "var(--col-rule)" : "var(--col-cobalt)",
              color: showForm ? "var(--col-muted)" : "var(--col-ink)",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
              padding: "6px 14px",
              cursor: "pointer",
            }}
            aria-expanded={showForm}
          >
            {showForm ? "✕ Cancel" : "+ Add Persona"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "24px 16px" }}>

        {/* Success toast */}
        {formSuccess && (
          <div
            role="status"
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              backgroundColor: "rgba(45, 122, 110, 0.12)",
              border: "1px solid var(--col-chaos-normal)",
              borderRadius: "4px",
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.8125rem",
              color: "var(--col-chaos-normal)",
            }}
          >
            ✓ {formSuccess}
          </div>
        )}

        {/* ── Add Persona Form ─────────────────────────────────────────────── */}
        {showForm && (
          <section
            aria-labelledby="add-persona-heading"
            style={{
              marginBottom: "24px",
              padding: "20px",
              backgroundColor: "var(--col-surface)",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
            }}
          >
            <h2
              id="add-persona-heading"
              style={{
                fontFamily: "var(--font-plex-condensed)",
                fontSize: "0.75rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--col-muted)",
                marginTop: 0,
                marginBottom: "16px",
              }}
            >
              New Persona
            </h2>

            <form onSubmit={(e) => { void handleCreate(e); }} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

              {/* id + name row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label htmlFor="f-id" style={labelStyle}>ID (slug) *</label>
                  <input
                    id="f-id"
                    required
                    value={form.id}
                    onChange={(e) => setForm((p) => ({ ...p, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                    placeholder="my-agent"
                    style={inputStyle}
                    aria-describedby="f-id-hint"
                  />
                  <span id="f-id-hint" style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.625rem", color: "var(--col-muted)" }}>
                    lowercase, hyphens only
                  </span>
                </div>
                <div>
                  <label htmlFor="f-name" style={labelStyle}>Display Name *</label>
                  <input
                    id="f-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="My Agent"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* role_type + model row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
                <div>
                  <label htmlFor="f-role" style={labelStyle}>Role Type *</label>
                  <select
                    id="f-role"
                    value={form.role_type}
                    onChange={(e) => setForm((p) => ({ ...p, role_type: e.target.value as "debater" | "guardian" }))}
                    style={{ ...inputStyle, appearance: "auto" }}
                  >
                    {ROLE_TYPE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-model" style={labelStyle}>Model ID *</label>
                  <input
                    id="f-model"
                    required
                    value={form.model}
                    onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                    placeholder="ibm/granite-4-h-small"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* turn_order + accent_color + enabled row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label htmlFor="f-order" style={labelStyle}>Turn Order *</label>
                  <input
                    id="f-order"
                    type="number"
                    min={1}
                    required
                    value={form.turn_order}
                    onChange={(e) => setForm((p) => ({ ...p, turn_order: parseInt(e.target.value) || 1 }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="f-color" style={labelStyle}>Accent Color</label>
                  <input
                    id="f-color"
                    value={form.accent_color ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, accent_color: e.target.value }))}
                    placeholder="#1a6cf6"
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <label style={{ ...labelStyle, marginBottom: "8px" }}>
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                      style={{ marginRight: "6px" }}
                    />
                    Enabled
                  </label>
                </div>
              </div>

              {/* compliance_ref — guardian only */}
              {form.role_type === "guardian" && (
                <div>
                  <label htmlFor="f-compref" style={labelStyle}>Compliance Ref * (guardian)</label>
                  <input
                    id="f-compref"
                    required
                    value={form.compliance_ref ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, compliance_ref: e.target.value }))}
                    placeholder="backend/personas/compliance/*.md"
                    style={inputStyle}
                  />
                </div>
              )}

              {/* System prompt */}
              <div>
                <label htmlFor="f-prompt" style={labelStyle}>System Prompt (markdown body) *</label>
                <textarea
                  id="f-prompt"
                  required
                  rows={8}
                  value={form.system_prompt}
                  onChange={(e) => setForm((p) => ({ ...p, system_prompt: e.target.value }))}
                  placeholder="You are a … Each turn must end with OBJECTION: … or NO OBJECTION"
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              {formError && (
                <p role="alert" style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.75rem", color: "var(--col-chaos-failure)", margin: 0 }}>
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={formSubmitting}
                style={{
                  fontFamily: "var(--font-geist-sans)",
                  fontSize: "0.875rem",
                  backgroundColor: formSubmitting ? "var(--col-rule)" : "var(--col-cobalt)",
                  color: formSubmitting ? "var(--col-muted)" : "var(--col-ink)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "4px",
                  padding: "8px 18px",
                  cursor: formSubmitting ? "not-allowed" : "pointer",
                  alignSelf: "flex-start",
                }}
                aria-busy={formSubmitting}
              >
                {formSubmitting ? "Creating…" : "Create & Commit"}
              </button>
            </form>
          </section>
        )}

        {/* ── Persona List ─────────────────────────────────────────────────── */}
        <section aria-labelledby="persona-list-heading">
          <h2
            id="persona-list-heading"
            style={{
              fontFamily: "var(--font-plex-condensed)",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--col-muted)",
              marginTop: 0,
              marginBottom: "12px",
            }}
          >
            All Personas
          </h2>

          {loading && (
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem", color: "var(--col-muted)" }}
               aria-busy="true">
              Loading…
            </p>
          )}

          {fetchError && (
            <p role="alert" style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem", color: "var(--col-chaos-failure)" }}>
              {fetchError}
            </p>
          )}

          {!loading && !fetchError && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}
                aria-label="Persona list">
              {personas.map((p) => {
                const togglePending = toggleState[p.id] === "pending";
                const toggleError   = toggleState[p.id] === "error";
                const accentColor   = p.accent_color ?? "var(--col-cobalt)";

                return (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "12px 16px",
                      backgroundColor: "var(--col-surface)",
                      border: "1px solid var(--col-rule)",
                      borderLeft: `3px solid ${p.enabled ? accentColor : "var(--col-rule)"}`,
                      borderRadius: "4px",
                      opacity: p.enabled ? 1 : 0.55,
                    }}
                  >
                    {/* Identity */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-plex-condensed)",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            color: p.enabled ? accentColor : "var(--col-muted)",
                          }}
                        >
                          {p.name}
                        </span>
                        <code
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            fontSize: "0.6875rem",
                            color: "var(--col-muted)",
                          }}
                        >
                          {p.id}
                        </code>
                        <span
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            fontSize: "0.6875rem",
                            color: "var(--col-muted)",
                            backgroundColor: "var(--col-base)",
                            border: "1px solid var(--col-rule)",
                            borderRadius: "2px",
                            padding: "1px 5px",
                          }}
                        >
                          {p.role_type}
                        </span>
                        {p.parse_error && (
                          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.6875rem", color: "var(--col-chaos-failure)" }}>
                            PARSE ERROR
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: "0.6875rem",
                          color: "var(--col-muted)",
                          marginTop: "2px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.model} · order {p.turn_order}
                      </div>
                    </div>

                    {/* Toggle */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
                      <button
                        onClick={() => { void handleToggle(p.id, !p.enabled); }}
                        disabled={togglePending}
                        aria-label={`${p.enabled ? "Disable" : "Enable"} persona ${p.name}`}
                        aria-busy={togglePending}
                        style={{
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: "0.6875rem",
                          backgroundColor: togglePending
                            ? "var(--col-rule)"
                            : p.enabled
                            ? "rgba(192, 57, 43, 0.15)"
                            : "rgba(45, 122, 110, 0.15)",
                          color: togglePending
                            ? "var(--col-muted)"
                            : p.enabled
                            ? "var(--col-chaos-failure)"
                            : "var(--col-chaos-normal)",
                          border: `1px solid ${p.enabled ? "var(--col-chaos-failure)" : "var(--col-chaos-normal)"}`,
                          borderRadius: "3px",
                          padding: "3px 10px",
                          cursor: togglePending ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {togglePending ? "…" : p.enabled ? "Disable" : "Enable"}
                      </button>
                      {toggleError && (
                        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.625rem", color: "var(--col-chaos-failure)" }}>
                          Error — retry
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}

              {personas.length === 0 && (
                <li style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem", color: "var(--col-muted)", padding: "16px" }}>
                  No persona files found in backend/personas/agents/.
                </li>
              )}
            </ul>
          )}
        </section>

        {/* Instructions */}
        <section
          style={{
            marginTop: "32px",
            padding: "16px",
            backgroundColor: "var(--col-surface)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            color: "var(--col-muted)",
            lineHeight: 1.7,
          }}
          aria-label="Usage instructions"
        >
          <strong style={{ color: "var(--col-ink)", fontFamily: "var(--font-plex-condensed)", letterSpacing: "0.05em" }}>
            GITOPS NOTE
          </strong>
          <br />
          Every enable/disable toggle and every new persona is written as a git commit.
          Changes take effect on the next debate request without a redeploy.
          Disabled personas stay in git history — never deleted.
        </section>
      </main>
    </div>
  );
}
