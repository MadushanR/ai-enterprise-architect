"use client";

/**
 * app/page.tsx
 * Main application shell — three-column war-room layout.
 * DESIGN.md §4: 280px left | flex-grow center | 360px right
 * Phase 2: War Room feed wired to /api/debate SSE stream.
 */

import { useState, useCallback } from "react";
import RoundCounter from "@/src/components/RoundCounter";
import WarRoomFeed from "@/src/components/WarRoomFeed";
import type { CreativeBrief } from "@/src/app/api/discovery/route";

// ── Types ──────────────────────────────────────────────────────
type AppPhase = "idle" | "discovering" | "ready" | "debating" | "synthesised";

// ── Component ──────────────────────────────────────────────────
export default function Home() {
  const [idea, setIdea] = useState("");
  const [brief, setBrief] = useState<CreativeBrief | null>(null);
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(-1);
  const [debateComplete, setDebateComplete] = useState(false);
  const [debateProposal, setDebateProposal] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);

  async function handleAnalyse() {
    if (!idea.trim()) return;
    setPhase("discovering");
    setError(null);
    setBrief(null);
    setDebateProposal(null);
    setSynthesis(null);
    setRound(-1);
    setDebateComplete(false);

    try {
      const res = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreativeBrief;
      setBrief(data);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("idle");
    }
  }

  function handleStartDebate() {
    if (!brief) return;
    // Use the problem + constraints as the initial proposal for the debate
    const initialProposal = [
      `Problem: ${brief.problem}`,
      `Constraints: ${brief.constraints.join("; ")}`,
      `Drivers: ${brief.drivers.join("; ")}`,
    ].join("\n");
    setDebateProposal(initialProposal);
    setPhase("debating");
  }

  const handleRoundChange = useCallback((r: number) => setRound(r), []);

  const handleSynthesis = useCallback((text: string) => {
    setSynthesis(text);
  }, []);

  const handleDebateComplete = useCallback(() => {
    setPhase("synthesised");
    setDebateComplete(true);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-screen bg-base text-ink">

      {/* ── HEADER ────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--col-rule)", backgroundColor: "var(--col-surface)" }}
      >
        <h1
          className="text-[1.1rem] font-semibold tracking-wide uppercase"
          style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-ink)" }}
        >
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Architecture Review Board"}
        </h1>

        <RoundCounter round={round} complete={debateComplete} />

        {/* Health indicator placeholder */}
        <span
          className="text-[0.6875rem] font-mono"
          style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
          title="System health"
        >
          health: —
        </span>
      </header>

      {/* ── THREE-COLUMN BODY ──────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANE — Discovery (280px) ─────────────────── */}
        <aside
          className="flex flex-col gap-4 p-4 overflow-y-auto shrink-0"
          style={{
            width: "280px",
            borderRight: "1px solid var(--col-rule)",
            backgroundColor: "var(--col-surface)",
          }}
        >
          <section aria-labelledby="discovery-heading">
            <h2
              id="discovery-heading"
              className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
              style={{
                fontFamily: "var(--font-plex-condensed)",
                color: "var(--col-muted)",
              }}
            >
              Discovery
            </h2>

            {/* Idea input */}
            <textarea
              id="idea-input"
              rows={6}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your system or business idea…"
              disabled={phase === "discovering"}
              className="w-full resize-none rounded p-3 text-sm"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor: "var(--col-base)",
                color: "var(--col-ink)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
              }}
              aria-label="Business idea input"
            />

            {/* Analyse button */}
            <button
              onClick={handleAnalyse}
              disabled={!idea.trim() || phase === "discovering"}
              className="mt-3 w-full py-2 text-sm font-medium transition-colors"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor:
                  !idea.trim() || phase === "discovering"
                    ? "var(--col-rule)"
                    : "var(--col-cobalt)",
                color:
                  !idea.trim() || phase === "discovering"
                    ? "var(--col-muted)"
                    : "var(--col-ink)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                cursor:
                  !idea.trim() || phase === "discovering"
                    ? "not-allowed"
                    : "pointer",
              }}
              aria-busy={phase === "discovering"}
            >
              {phase === "discovering" ? "Analysing…" : "Analyse"}
            </button>

            {/* Error */}
            {error && (
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--col-chaos-failure)", fontFamily: "var(--font-geist-mono)" }}
                role="alert"
              >
                {error}
              </p>
            )}
          </section>

          {/* Brief preview */}
          {brief && (
            <section
              aria-labelledby="brief-heading"
              className="mt-2"
            >
              <h2
                id="brief-heading"
                className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
                style={{
                  fontFamily: "var(--font-plex-condensed)",
                  color: "var(--col-muted)",
                }}
              >
                Creative Brief
              </h2>

              <div
                className="rounded p-3 text-xs space-y-3"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: "0.8125rem",
                  backgroundColor: "var(--col-base)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "4px",
                  color: "var(--col-ink)",
                }}
              >
                <div>
                  <span style={{ color: "var(--col-muted)" }}>PROBLEM</span>
                  <p className="mt-1">{brief.problem}</p>
                </div>

                <div>
                  <span style={{ color: "var(--col-muted)" }}>CONSTRAINTS</span>
                  <ul className="mt-1 space-y-1 list-none pl-0">
                    {brief.constraints.map((c, i) => (
                      <li key={i} style={{ paddingLeft: "var(--space-2)" }}>
                        <span style={{ color: "var(--col-cobalt)" }}>›</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <span style={{ color: "var(--col-muted)" }}>DRIVERS</span>
                  <ul className="mt-1 space-y-1 list-none pl-0">
                    {brief.drivers.map((d, i) => (
                      <li key={i} style={{ paddingLeft: "var(--space-2)" }}>
                        <span style={{ color: "var(--col-cobalt)" }}>›</span> {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* Start Debate button — shown when brief is ready and debate not started */}
          {brief && (phase === "ready") && (
            <button
              onClick={handleStartDebate}
              className="mt-2 w-full py-2 text-sm font-medium"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor: "var(--col-cobalt)",
                color: "var(--col-ink)",
                border: "1px solid var(--col-cobalt)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              ▶ Start War Room Debate
            </button>
          )}

          {/* Debate/synthesis in-progress indicator in left pane */}
          {phase === "debating" && (
            <p
              className="mt-2 text-[0.6875rem]"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-cobalt)" }}
            >
              Debate running…
            </p>
          )}
          {phase === "synthesised" && (
            <p
              className="mt-2 text-[0.6875rem]"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-chaos-normal)" }}
            >
              ✓ Synthesis complete
            </p>
          )}
        </aside>

        {/* ── CENTER PANE — War Room feed (flex-grow) ─────────── */}
        <main
          className="flex flex-col flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: "var(--col-base)" }}
          aria-label="War Room debate feed"
        >
          {phase === "discovering" && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <span
                className="text-sm animate-pulse"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-cobalt)" }}
              >
                Generating creative brief…
              </span>
            </div>
          )}

          <WarRoomFeed
            proposal={debateProposal}
            onRoundChange={handleRoundChange}
            onSynthesis={handleSynthesis}
            onComplete={handleDebateComplete}
          />
        </main>

        {/* ── RIGHT PANE — Diagram / Chaos / Deck / Audio (360px) ─ */}
        <aside
          className="flex flex-col gap-0 overflow-y-auto shrink-0"
          style={{
            width: "360px",
            borderLeft: "1px solid var(--col-rule)",
            backgroundColor: "var(--col-surface)",
          }}
        >
          {/* Live Diagram placeholder */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="diagram-heading"
          >
            <h2
              id="diagram-heading"
              className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
              style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
            >
              Live Diagram
            </h2>
            <div
              className="flex items-center justify-center"
              style={{
                height: "200px",
                backgroundColor: "var(--col-base)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                color: "var(--col-muted)",
                fontSize: "0.75rem",
                fontFamily: "var(--font-geist-mono)",
              }}
              aria-label="Diagram placeholder"
            >
              diagram — phase 3
            </div>
          </section>

          {/* Chaos Simulator placeholder */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="chaos-heading"
          >
            <h2
              id="chaos-heading"
              className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
              style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
            >
              Chaos Simulator ⭐
            </h2>
            <button
              disabled
              className="w-full py-2 text-sm"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor: "var(--col-rule)",
                color: "var(--col-muted)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                cursor: "not-allowed",
              }}
              aria-label="Simulate Traffic Spike — available after diagram is generated"
            >
              ▶ Simulate Traffic Spike
            </button>
            <p
              className="mt-2 text-xs"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)", fontSize: "0.6875rem" }}
            >
              Available after diagram — phase 4
            </p>
          </section>

          {/* Deck Export placeholder */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="deck-heading"
          >
            <h2
              id="deck-heading"
              className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
              style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
            >
              Deck Export
            </h2>
            <button
              disabled
              className="w-full py-2 text-sm"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor: "var(--col-rule)",
                color: "var(--col-muted)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                cursor: "not-allowed",
              }}
              aria-label="Download pitch deck — available after debate is complete"
            >
              ↓ Download .pptx
            </button>
          </section>

          {/* Audio Upload placeholder */}
          <section
            className="flex flex-col p-4"
            aria-labelledby="audio-heading"
          >
            <h2
              id="audio-heading"
              className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-3"
              style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
            >
              Audio Upload
            </h2>
            <p
              className="text-xs"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)", fontSize: "0.6875rem" }}
            >
              📎 .mp3 upload — phase 4
            </p>
          </section>
        </aside>
      </div>

      {/* ── STATUS BAR ──────────────────────────────────────────── */}
      <footer
        className="flex items-center gap-4 px-4 py-2 text-[0.6875rem] border-t"
        style={{
          fontFamily: "var(--font-geist-mono)",
          color: "var(--col-muted)",
          borderColor: "var(--col-rule)",
          backgroundColor: "var(--col-surface)",
        }}
        role="contentinfo"
      >
        <span>region: {process.env.NEXT_PUBLIC_WATSONX_REGION ?? "us-south"}</span>
        <span aria-hidden="true">│</span>
        <span>model: ibm/granite-4-h-small</span>
        <span aria-hidden="true">│</span>
        <span>
          {phase === "discovering"
            ? "status: analysing idea…"
            : phase === "ready"
            ? "status: brief ready — start debate"
            : phase === "debating"
            ? "status: debate in progress…"
            : phase === "synthesised"
            ? "status: synthesis complete"
            : "status: idle"}
        </span>
      </footer>
    </div>
  );
}
