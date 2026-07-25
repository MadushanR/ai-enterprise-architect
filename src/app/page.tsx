"use client";

/**
 * app/page.tsx
 * Main application shell — three-column war-room layout.
 * DESIGN.md §4: 280px left | flex-grow center | 360px right
 * Phase 2: War Room feed wired to /api/debate SSE stream.
 * Phase 3: Diagram pane (MermaidRenderer) + Download Deck button wired.
 * Phase 4: Chaos Simulator wired — SSE beats recolor diagram via imperative handle.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import RoundCounter from "@/src/components/RoundCounter";
import WarRoomFeed from "@/src/components/WarRoomFeed";
import MermaidRenderer, { type MermaidRendererHandle } from "@/src/components/MermaidRenderer";
import ChaosBeatIndicator, { type ChaosState } from "@/src/components/ChaosBeatIndicator";
import AudioPanel from "@/src/components/AudioPanel";
import type { CreativeBrief } from "@/src/app/api/discovery/route";
import type { DiagramResult } from "@/backend/lib/mermaid/generate";
import type { Objection, TranscriptEntry } from "@/backend/lib/debate/state";
import { parseClassDefPatch } from "@/backend/lib/chaos/classDef";

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
  // Phase 3 state
  const [finalProposal, setFinalProposal] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [objections, setObjections] = useState<Objection[]>([]);
  const [diagram, setDiagram] = useState<DiagramResult | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [deckLoading, setDeckLoading] = useState(false);
  // Phase 4 — chaos simulator state
  const [chaosBeats, setChaosBeats] = useState<Array<{ state: ChaosState; label: string }>>([]);
  const [chaosCurrent, setChaosCurrent] = useState(-1);
  const [chaosLabel, setChaosLabel] = useState("");
  const [chaosRunning, setChaosRunning] = useState(false);
  const [chaosTotal, setChaosTotal] = useState(0);
  // Ref to the rendered MermaidRenderer so we can call applyClassDefs imperatively
  const diagramRef = useRef<MermaidRendererHandle>(null);
  // Detect prefers-reduced-motion for the chaos delay flag
  const reducedMotionRef = useRef(false);

  async function handleAnalyse() {
    if (!idea.trim()) return;
    setPhase("discovering");
    setError(null);
    setBrief(null);
    setDebateProposal(null);
    setSynthesis(null);
    setRound(-1);
    setDebateComplete(false);
    setDiagram(null);
    setFinalProposal(null);
    setTranscript([]);
    setObjections([]);
    setChaosBeats([]);
    setChaosCurrent(-1);
    setChaosLabel("");
    setChaosRunning(false);
    setChaosTotal(0);

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

  // Receive final debate state from WarRoomFeed for diagram/deck generation
  const handleDebateState = useCallback(
    (data: { proposal: string; transcript: TranscriptEntry[]; objections: Objection[] }) => {
      setFinalProposal(data.proposal);
      setTranscript(data.transcript);
      setObjections(data.objections);
    },
    []
  );

  async function handleGenerateDiagram() {
    if (!synthesis) return;
    setDiagramLoading(true);
    setDiagram(null);
    try {
      const res = await fetch("/api/diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: synthesis }),
      });
      const data = (await res.json()) as DiagramResult & { error?: string };
      setDiagram(data);
    } catch (err) {
      setDiagram({ diagram: "", valid: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setDiagramLoading(false);
    }
  }

  async function handleDownloadDeck() {
    if (!synthesis || !finalProposal || !diagram || !brief) return;
    setDeckLoading(true);
    try {
      const res = await fetch("/api/pitch-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal: finalProposal,
          synthesis,
          diagram: diagram.diagram,
          transcript,
          objections,
          brief,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "architecture-review.pptx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[deck download]", err);
    } finally {
      setDeckLoading(false);
    }
  }

  // ── Phase 4: Chaos Simulator ────────────────────────────────

  // Detect prefers-reduced-motion once on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  }, []);

  async function handleSimulateChaos() {
    if (!synthesis || !diagram?.valid) return;
    setChaosBeats([]);
    setChaosCurrent(-1);
    setChaosLabel("");
    setChaosRunning(true);
    setChaosTotal(0);

    try {
      const res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: synthesis,
          reducedMotion: reducedMotionRef.current,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          if (!chunk.startsWith("data: ")) continue;
          const raw = chunk.slice(6).trim();
          if (!raw) continue;

          let event: Record<string, unknown>;
          try { event = JSON.parse(raw) as Record<string, unknown>; }
          catch { continue; }

          if (event.type === "done") break;
          if (event.type === "error") {
            console.error("[chaos]", event.message);
            break;
          }

          // Beat event
          const beatIndex = event.beat as number;
          const state = event.state as ChaosState;
          const label = event.label as string;
          const total = event.total as number;
          const patch = event.patch as string;

          setChaosTotal(total);
          setChaosCurrent(beatIndex);
          setChaosLabel(label);
          setChaosBeats((prev) => {
            const next = [...prev];
            // Fill any gaps with the incoming beat
            while (next.length <= beatIndex) next.push({ state, label });
            next[beatIndex] = { state, label };
            return next;
          });

          // Apply classDef patch to the live SVG — no re-render
          if (diagramRef.current?.isRendered()) {
            const nodeStyles = parseClassDefPatch(patch);
            diagramRef.current.applyClassDefs(nodeStyles);
          }
        }
      }
    } catch (err) {
      console.error("[chaos simulate]", err);
    } finally {
      setChaosRunning(false);
    }
  }

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

        {/* Right-side header controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            className="text-[0.6875rem] font-mono"
            style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
            title="System health"
          >
            health: —
          </span>
          <a
            href="/settings/personas"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.6875rem",
              color: "var(--col-muted)",
              textDecoration: "none",
              border: "1px solid var(--col-rule)",
              borderRadius: "3px",
              padding: "2px 8px",
            }}
            aria-label="Persona admin settings"
          >
            ⚙ Personas
          </a>
        </div>
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
            onDebateState={handleDebateState}
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
          {/* Live Diagram */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="diagram-heading"
          >
            <div className="flex items-center justify-between mb-3">
              <h2
                id="diagram-heading"
                className="text-[0.6875rem] font-semibold uppercase tracking-widest"
                style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
              >
                Live Diagram
              </h2>
              {/* Generate button — enabled only when synthesis is ready */}
              <button
                onClick={handleGenerateDiagram}
                disabled={!synthesis || diagramLoading}
                className="text-[0.6875rem] px-2 py-1"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  backgroundColor: !synthesis || diagramLoading ? "var(--col-rule)" : "var(--col-cobalt)",
                  color: !synthesis || diagramLoading ? "var(--col-muted)" : "var(--col-ink)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "3px",
                  cursor: !synthesis || diagramLoading ? "not-allowed" : "pointer",
                }}
                aria-busy={diagramLoading}
              >
                {diagramLoading ? "Generating…" : diagram ? "Regenerate" : "Generate"}
              </button>
            </div>

            {diagram ? (
              <MermaidRenderer
                ref={diagramRef}
                diagram={diagram.diagram}
                valid={diagram.valid}
                parseError={diagram.error}
              />
            ) : (
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
                aria-label="Diagram placeholder — generate after synthesis"
              >
                {synthesis ? "click Generate →" : "available after synthesis"}
              </div>
            )}
          </section>

          {/* Chaos Simulator */}
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
              Chaos Simulator
            </h2>

            {/* Beat indicator — shown once a simulation has run */}
            {chaosBeats.length > 0 && (
              <div className="mb-3">
                <ChaosBeatIndicator
                  beats={chaosBeats}
                  current={chaosCurrent}
                  total={chaosTotal}
                  stateLabel={chaosLabel}
                />
              </div>
            )}

            <button
              onClick={handleSimulateChaos}
              disabled={!diagram?.valid || chaosRunning}
              className="w-full py-2 text-sm font-medium"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor:
                  !diagram?.valid || chaosRunning ? "var(--col-rule)" : "var(--col-chaos-strain)",
                color:
                  !diagram?.valid || chaosRunning ? "var(--col-muted)" : "#0e1117",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                cursor: !diagram?.valid || chaosRunning ? "not-allowed" : "pointer",
              }}
              aria-label="Simulate Traffic Spike"
              aria-busy={chaosRunning}
            >
              {chaosRunning ? "Simulating…" : chaosCurrent >= 0 ? "↺ Re-simulate" : "▶ Simulate Traffic Spike"}
            </button>

            {!diagram?.valid && (
              <p
                className="mt-2 text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
              >
                Generate a valid diagram first
              </p>
            )}
          </section>

          {/* Deck Export */}
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
              onClick={handleDownloadDeck}
              disabled={!synthesis || !diagram?.valid || deckLoading}
              className="w-full py-2 text-sm font-medium"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor:
                  !synthesis || !diagram?.valid || deckLoading
                    ? "var(--col-rule)"
                    : "var(--col-cobalt)",
                color:
                  !synthesis || !diagram?.valid || deckLoading
                    ? "var(--col-muted)"
                    : "var(--col-ink)",
                border: "1px solid var(--col-rule)",
                borderRadius: "4px",
                cursor:
                  !synthesis || !diagram?.valid || deckLoading ? "not-allowed" : "pointer",
              }}
              aria-label="Download pitch deck"
              aria-busy={deckLoading}
            >
              {deckLoading ? "Building deck…" : "↓ Download .pptx"}
            </button>
            {synthesis && !diagram?.valid && (
              <p
                className="mt-1 text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
              >
                Generate a valid diagram first
              </p>
            )}
          </section>

          {/* Audio Upload */}
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
            <AudioPanel
              currentDiagram={diagram?.valid ? diagram.diagram : null}
              onDiagramUpdate={(updatedDiagram) => {
                setDiagram((prev) =>
                  prev ? { ...prev, diagram: updatedDiagram, valid: true } : prev
                );
              }}
            />
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
