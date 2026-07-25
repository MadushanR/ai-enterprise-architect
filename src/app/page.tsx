"use client";

/**
 * app/page.tsx
 * Main application shell — three-column war-room layout.
 * DESIGN.md §4: 280px left | flex-grow center | 360px right
 * Phase 2: War Room feed wired to /api/debate SSE stream.
 * Phase 3: Diagram pane (MermaidRenderer) + Download Deck button wired.
 * Phase 4: Chaos Simulator wired — SSE beats recolor diagram via imperative handle.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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

interface PersonaSummary {
  id: string;
  name: string;
  role_type: "debater" | "guardian";
  accent_color: string | null;
  enabled: boolean;
  turn_order: number;
}

// ── Session persistence types (task 6.2) ───────────────────────
const SESSION_KEY = "arb:sessions";
const MAX_SESSIONS = 5;

interface SavedSession {
  id: string;            // ISO timestamp used as key
  idea: string;
  brief: import("@/src/app/api/discovery/route").CreativeBrief;
  transcript: import("@/backend/lib/debate/state").TranscriptEntry[];
  objections: import("@/backend/lib/debate/state").Objection[];
  synthesis: string;
  diagram: import("@/backend/lib/mermaid/generate").DiagramResult | null;
}

function loadSessionsFromStorage(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession[]) : [];
  } catch {
    return [];
  }
}

function saveSessionsToStorage(sessions: SavedSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  } catch {
    // quota exceeded — ignore silently
  }
}

// ── Health badge types ──────────────────────────────────────────
type HealthStatus = "pending" | "ok" | "warn" | "error";
interface HealthState {
  status: HealthStatus;
  label: string; // short model name or error blurb
  title: string; // full tooltip text
}

// ── Component ──────────────────────────────────────────────────
export default function Home() {
  const [idea, setIdea] = useState("");
  const [brief, setBrief] = useState<CreativeBrief | null>(null);
  const [editableBrief, setEditableBrief] = useState<CreativeBrief | null>(null);
  const [briefEditing, setBriefEditing] = useState(false);
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
  // Personas loaded from API for agent selector
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  // Resizable left pane — clamped between 180 and 520 px
  const [leftWidth, setLeftWidth] = useState(280);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Phase 6.1 — live health badge
  const [health, setHealth] = useState<HealthState>({
    status: "pending",
    label: "—",
    title: "Checking watsonx…",
  });
  // Phase 6.2 — session persistence
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);

  async function handleAnalyse() {
    if (!idea.trim()) return;
    setPhase("discovering");
    setError(null);
    setBrief(null);
    setEditableBrief(null);
    setBriefEditing(false);
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
      // Load personas in parallel with brief generation
      const [res, personaRes] = await Promise.all([
        fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea }),
        }),
        fetch("/api/personas"),
      ]);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreativeBrief;
      setBrief(data);
      setEditableBrief(data);
      setPhase("ready");
      if (personaRes.ok) {
        const pData = (await personaRes.json()) as PersonaSummary[];
        setPersonas(pData);
        // Default: all enabled personas selected
        setSelectedAgents(pData.map((p) => p.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("idle");
    }
  }

  function handleStartDebate() {
    const activeBrief = editableBrief ?? brief;
    if (!activeBrief) return;
    // Use the (possibly edited) brief as the initial proposal for the debate
    const initialProposal = [
      `Problem: ${activeBrief.problem}`,
      `Constraints: ${activeBrief.constraints.join("; ")}`,
      `Drivers: ${activeBrief.drivers.join("; ")}`,
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

  // Stable guardian ID list — memoized so the array reference only changes when
  // personas actually changes (prevents WarRoomFeed from re-running the debate
  // on every parent render due to an unstable `guardianIds` prop).
  const guardianIds = useMemo(
    () => personas.filter((p) => p.role_type === "guardian").map((p) => p.id),
    [personas]
  );

  // Receive final debate state from WarRoomFeed for diagram/deck generation
  const handleDebateState = useCallback(
    (data: { proposal: string; transcript: TranscriptEntry[]; objections: Objection[] }) => {
      setFinalProposal(data.proposal);
      setTranscript(data.transcript);
      setObjections(data.objections);
    },
    []
  );

  // ── Left-pane resize drag handlers ──────────────────────────────
  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: leftWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [leftWidth]);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    const delta = e.clientX - dragStateRef.current.startX;
    const next = Math.min(520, Math.max(180, dragStateRef.current.startWidth + delta));
    setLeftWidth(next);
  }, []);

  const handleResizeEnd = useCallback(() => {
    dragStateRef.current = null;
  }, []);

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

  // ── Phase 6.2: Session persistence ──────────────────────────

  // Load saved sessions from localStorage once on mount (client only)
  useEffect(() => {
    setSavedSessions(loadSessionsFromStorage());
  }, []);

  function handleSaveSession() {
    if (!brief || !synthesis) return;
    const entry: SavedSession = {
      id: new Date().toISOString(),
      idea,
      brief,
      transcript,
      objections,
      synthesis,
      diagram,
    };
    setSavedSessions((prev) => {
      // Prepend newest; trim to max
      const next = [entry, ...prev].slice(0, MAX_SESSIONS);
      saveSessionsToStorage(next);
      return next;
    });
  }

  function handleLoadSession(sessionId: string) {
    const s = savedSessions.find((x) => x.id === sessionId);
    if (!s) return;
    setIdea(s.idea);
    setBrief(s.brief);
    setEditableBrief(s.brief);
    setBriefEditing(false);
    setTranscript(s.transcript);
    setObjections(s.objections);
    setSynthesis(s.synthesis);
    setFinalProposal(null);
    setDiagram(s.diagram);
    setDebateComplete(true);
    setDebateProposal(null);
    setRound(-1);
    setPhase("synthesised");
    setError(null);
    setChaosBeats([]);
    setChaosCurrent(-1);
    setChaosLabel("");
    setChaosRunning(false);
    setChaosTotal(0);
  }

  // ── Phase 6.1: Live health badge ────────────────────────────
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/health/watsonx");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          ok: boolean;
          probeModel?: string;
          missingRequiredModels?: string[];
          error?: string;
          step?: string;
        };
        if (!data.ok) {
          setHealth({
            status: "error",
            label: data.step ?? "error",
            title: data.error ?? "watsonx unreachable",
          });
          return;
        }
        const missing = data.missingRequiredModels ?? [];
        const shortModel = (data.probeModel ?? "").split("/").pop() ?? "ok";
        if (missing.length > 0) {
          setHealth({
            status: "warn",
            label: shortModel,
            title: `Connected. Missing models: ${missing.join(", ")}`,
          });
        } else {
          setHealth({
            status: "ok",
            label: shortModel,
            title: `All required models available (${data.probeModel})`,
          });
        }
      } catch (err) {
        setHealth({
          status: "error",
          label: "offline",
          title: err instanceof Error ? err.message : "Health check failed",
        });
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

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

      outer: while (true) {
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

          // Break the outer reader loop directly — inner break only exits the for.
          if (event.type === "done") break outer;
          if (event.type === "error") {
            console.error("[chaos]", event.message);
            break outer;
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
          {/* ── Live health badge (task 6.1) ── */}
          <span
            className="text-[0.6875rem] font-mono"
            style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)", display: "flex", alignItems: "center", gap: "5px" }}
            title={health.title}
            aria-label={`System health: ${health.title}`}
          >
            {/* Coloured status dot */}
            <span
              style={{
                display: "inline-block",
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                flexShrink: 0,
                backgroundColor:
                  health.status === "ok"
                    ? "var(--col-chaos-recovery)"
                    : health.status === "warn"
                    ? "#f59e0b"
                    : health.status === "error"
                    ? "var(--col-chaos-failure)"
                    : "var(--col-muted)",
              }}
            />
            health: {health.label}
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

        {/* ── LEFT PANE — Discovery (resizable, default 280px) ── */}
        <aside
          className="flex flex-col gap-4 p-4 overflow-y-auto shrink-0"
          style={{
            width: `${leftWidth}px`,
            borderRight: "none",
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

          {/* Creative Brief — editable */}
          {editableBrief && (
            <section
              aria-labelledby="brief-heading"
              className="mt-2"
            >
              <div className="flex items-center justify-between mb-2">
                <h2
                  id="brief-heading"
                  className="text-[0.6875rem] font-semibold uppercase tracking-widest"
                  style={{
                    fontFamily: "var(--font-plex-condensed)",
                    color: "var(--col-muted)",
                  }}
                >
                  Creative Brief
                </h2>
                {phase === "ready" && (
                  <button
                    onClick={() => setBriefEditing((v) => !v)}
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: "0.6875rem",
                      color: briefEditing ? "var(--col-cobalt)" : "var(--col-muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "0",
                    }}
                    aria-label={briefEditing ? "Collapse brief editor" : "Edit creative brief"}
                  >
                    {briefEditing ? "▲ collapse" : "✎ edit"}
                  </button>
                )}
              </div>

              {briefEditing && phase === "ready" ? (
                /* ── Edit mode ── */
                <div
                  className="rounded p-3 space-y-3"
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "0.8125rem",
                    backgroundColor: "var(--col-base)",
                    border: "1px solid var(--col-cobalt)",
                    borderRadius: "4px",
                    color: "var(--col-ink)",
                  }}
                >
                  <div>
                    <label
                      className="text-[0.6875rem] block mb-1"
                      style={{ color: "var(--col-muted)" }}
                      htmlFor="brief-problem"
                    >
                      PROBLEM
                    </label>
                    <textarea
                      id="brief-problem"
                      rows={3}
                      value={editableBrief.problem}
                      onChange={(e) =>
                        setEditableBrief((b) => b ? { ...b, problem: e.target.value } : b)
                      }
                      className="w-full resize-none rounded p-2 text-[0.8125rem]"
                      style={{
                        fontFamily: "var(--font-geist-mono)",
                        backgroundColor: "var(--col-surface)",
                        color: "var(--col-ink)",
                        border: "1px solid var(--col-rule)",
                        borderRadius: "3px",
                      }}
                    />
                  </div>

                  <div>
                    <label
                      className="text-[0.6875rem] block mb-1"
                      style={{ color: "var(--col-muted)" }}
                    >
                      CONSTRAINTS
                    </label>
                    {editableBrief.constraints.map((c, i) => (
                      <div key={i} className="flex gap-1 mb-1">
                        <input
                          type="text"
                          value={c}
                          onChange={(e) =>
                            setEditableBrief((b) => {
                              if (!b) return b;
                              const next = [...b.constraints];
                              next[i] = e.target.value;
                              return { ...b, constraints: next };
                            })
                          }
                          className="flex-1 rounded px-2 py-1 text-[0.8125rem]"
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            backgroundColor: "var(--col-surface)",
                            color: "var(--col-ink)",
                            border: "1px solid var(--col-rule)",
                            borderRadius: "3px",
                          }}
                          aria-label={`Constraint ${i + 1}`}
                        />
                        <button
                          onClick={() =>
                            setEditableBrief((b) => {
                              if (!b) return b;
                              const next = b.constraints.filter((_, j) => j !== i);
                              return { ...b, constraints: next };
                            })
                          }
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            fontSize: "0.75rem",
                            color: "var(--col-chaos-failure)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "0 4px",
                          }}
                          aria-label="Remove constraint"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setEditableBrief((b) => b ? { ...b, constraints: [...b.constraints, ""] } : b)
                      }
                      style={{
                        fontFamily: "var(--font-geist-mono)",
                        fontSize: "0.6875rem",
                        color: "var(--col-cobalt)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "0",
                      }}
                    >
                      + add constraint
                    </button>
                  </div>

                  <div>
                    <label
                      className="text-[0.6875rem] block mb-1"
                      style={{ color: "var(--col-muted)" }}
                    >
                      DRIVERS
                    </label>
                    {editableBrief.drivers.map((d, i) => (
                      <div key={i} className="flex gap-1 mb-1">
                        <input
                          type="text"
                          value={d}
                          onChange={(e) =>
                            setEditableBrief((b) => {
                              if (!b) return b;
                              const next = [...b.drivers];
                              next[i] = e.target.value;
                              return { ...b, drivers: next };
                            })
                          }
                          className="flex-1 rounded px-2 py-1 text-[0.8125rem]"
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            backgroundColor: "var(--col-surface)",
                            color: "var(--col-ink)",
                            border: "1px solid var(--col-rule)",
                            borderRadius: "3px",
                          }}
                          aria-label={`Driver ${i + 1}`}
                        />
                        <button
                          onClick={() =>
                            setEditableBrief((b) => {
                              if (!b) return b;
                              const next = b.drivers.filter((_, j) => j !== i);
                              return { ...b, drivers: next };
                            })
                          }
                          style={{
                            fontFamily: "var(--font-geist-mono)",
                            fontSize: "0.75rem",
                            color: "var(--col-chaos-failure)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "0 4px",
                          }}
                          aria-label="Remove driver"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setEditableBrief((b) => b ? { ...b, drivers: [...b.drivers, ""] } : b)
                      }
                      style={{
                        fontFamily: "var(--font-geist-mono)",
                        fontSize: "0.6875rem",
                        color: "var(--col-cobalt)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "0",
                      }}
                    >
                      + add driver
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Read mode ── */
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
                    <p className="mt-1">{editableBrief.problem}</p>
                  </div>

                  <div>
                    <span style={{ color: "var(--col-muted)" }}>CONSTRAINTS</span>
                    <ul className="mt-1 space-y-1 list-none pl-0">
                      {editableBrief.constraints.map((c, i) => (
                        <li key={i} style={{ paddingLeft: "var(--space-2)" }}>
                          <span style={{ color: "var(--col-cobalt)" }}>›</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <span style={{ color: "var(--col-muted)" }}>DRIVERS</span>
                    <ul className="mt-1 space-y-1 list-none pl-0">
                      {editableBrief.drivers.map((d, i) => (
                        <li key={i} style={{ paddingLeft: "var(--space-2)" }}>
                          <span style={{ color: "var(--col-cobalt)" }}>›</span> {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* War Room Config — agent selector + rounds, shown before debate starts */}
          {brief && phase === "ready" && personas.length > 0 && (
            <section aria-labelledby="warroom-config-heading" className="mt-3">
              <h2
                id="warroom-config-heading"
                className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-2"
                style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
              >
                War Room Config
              </h2>
              <div
                className="rounded p-3 space-y-3"
                style={{
                  backgroundColor: "var(--col-base)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "4px",
                }}
              >
                {/* Agent checkboxes */}
                <div>
                  <span
                    className="text-[0.6875rem] block mb-2"
                    style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
                  >
                    AGENTS
                  </span>
                  <div className="space-y-1">
                    {personas.map((p) => {
                      const accentColor = p.accent_color ?? "var(--col-cobalt)";
                      const isChecked = selectedAgents.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 cursor-pointer select-none"
                          style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setSelectedAgents((prev) =>
                                isChecked
                                  ? prev.filter((id) => id !== p.id)
                                  : [...prev, p.id]
                              )
                            }
                            style={{ accentColor }}
                            aria-label={`Include ${p.name}`}
                          />
                          <span style={{ color: accentColor, fontWeight: 600, fontSize: "0.6875rem" }}>
                            {p.id.toUpperCase()}
                          </span>
                          <span style={{ color: "var(--col-ink)" }}>{p.name}</span>
                          {p.role_type === "guardian" && (
                            <span
                              style={{
                                fontSize: "0.6rem",
                                color: "var(--col-muted)",
                                border: "1px solid var(--col-rule)",
                                borderRadius: "2px",
                                padding: "0 3px",
                              }}
                            >
                              guardian
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Rounds selector */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="rounds-input"
                    className="text-[0.6875rem]"
                    style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
                  >
                    ROUNDS
                  </label>
                  <input
                    id="rounds-input"
                    type="number"
                    min={1}
                    value={maxRounds}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1) setMaxRounds(v);
                    }}
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: "0.8125rem",
                      width: "56px",
                      padding: "3px 6px",
                      backgroundColor: "var(--col-surface)",
                      color: "var(--col-ink)",
                      border: "1px solid var(--col-cobalt)",
                      borderRadius: "3px",
                      textAlign: "center",
                    }}
                    aria-label="Number of debate rounds"
                  />
                  <span
                    className="text-[0.6875rem]"
                    style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
                  >
                    max
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Start Debate button — shown when brief is ready and debate not started */}
          {brief && phase === "ready" && (
            <button
              onClick={handleStartDebate}
              disabled={selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0}
              className="mt-2 w-full py-2 text-sm font-medium"
              style={{
                fontFamily: "var(--font-geist-sans)",
                fontSize: "0.875rem",
                backgroundColor:
                  selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0
                    ? "var(--col-rule)"
                    : "var(--col-cobalt)",
                color:
                  selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0
                    ? "var(--col-muted)"
                    : "var(--col-ink)",
                border: "1px solid var(--col-cobalt)",
                borderRadius: "4px",
                cursor:
                  selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
              title={
                selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0
                  ? "Select at least one debater agent"
                  : undefined
              }
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
            <div className="mt-2 flex flex-col gap-2">
              <p
                className="text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-chaos-normal)" }}
              >
                ✓ Synthesis complete
              </p>
              {/* ── Save Session button (task 6.2) ── */}
              <button
                onClick={handleSaveSession}
                className="w-full py-1.5 text-[0.6875rem]"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  backgroundColor: "var(--col-surface)",
                  color: "var(--col-muted)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                title="Save this debate session to browser storage"
              >
                ↓ Save Session
              </button>
            </div>
          )}

          {/* ── Load Session picker (task 6.2) — only when idle and sessions exist ── */}
          {phase === "idle" && savedSessions.length > 0 && (
            <section aria-labelledby="load-session-heading" className="mt-3">
              <h2
                id="load-session-heading"
                className="text-[0.6875rem] font-semibold uppercase tracking-widest mb-2"
                style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
              >
                Load Session
              </h2>
              <select
                onChange={(e) => { if (e.target.value) handleLoadSession(e.target.value); }}
                defaultValue=""
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: "0.8125rem",
                  width: "100%",
                  padding: "5px 8px",
                  backgroundColor: "var(--col-base)",
                  color: "var(--col-ink)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                aria-label="Select a saved session to restore"
              >
                <option value="" disabled>
                  — choose saved session —
                </option>
                {savedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.id).toLocaleString()} · {s.idea.slice(0, 40)}{s.idea.length > 40 ? "…" : ""}
                  </option>
                ))}
              </select>
            </section>
          )}
        </aside>

        {/* ── RESIZE HANDLE — drag to resize left pane ─────────── */}
        <div
          role="separator"
          aria-label="Resize briefing panel"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          style={{
            width: "5px",
            flexShrink: 0,
            cursor: "col-resize",
            backgroundColor: "var(--col-rule)",
            transition: "background-color 0.15s",
            userSelect: "none",
            touchAction: "none",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--col-cobalt)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--col-rule)"; }}
        />

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
            agents={selectedAgents.length > 0 ? selectedAgents : undefined}
            maxRounds={maxRounds}
            guardianIds={guardianIds}
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
