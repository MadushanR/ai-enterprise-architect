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
import { useRouter } from "next/navigation";
import RoundCounter from "@/src/components/RoundCounter";
import WarRoomFeed, { type WarRoomFeedHandle } from "@/src/components/WarRoomFeed";
import ChatPanel, { type PersonaSummary, type ChatMessage } from "@/src/components/ChatPanel";
import MermaidRenderer, { type MermaidRendererHandle } from "@/src/components/MermaidRenderer";
import AudioPanel from "@/src/components/AudioPanel";
import type { CreativeBrief } from "@/src/app/api/discovery/route";
import type { DiagramResult } from "@/backend/lib/mermaid/generate";
import type { Objection, TranscriptEntry } from "@/backend/lib/debate/state";
import { useChaosStore } from "@/src/store/chaosStore";
import ThemeToggle from "@/src/components/ThemeToggle";

// ── Types ──────────────────────────────────────────────────────
type AppPhase = "idle" | "discovering" | "ready" | "debating" | "synthesised";

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
  const router = useRouter();
  const { setInputs: setChaosInputs, setReturnSnapshot, clearReturnSnapshot, returnSnapshot } = useChaosStore();
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
  const [diagramExpanded, setDiagramExpanded] = useState(false);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [deckLoading, setDeckLoading] = useState(false);
  const [boardMessages, setBoardMessages] = useState<ChatMessage[]>([]);
  // Phase 4 — full simulation runs on /chaos page (useChaosStore + router.push)
  const diagramRef = useRef<MermaidRendererHandle>(null);
  // Ref to WarRoomFeed so we can imperatively stop the debate
  const warRoomRef = useRef<WarRoomFeedHandle>(null);
  // Detect prefers-reduced-motion for the chaos delay flag
  const reducedMotionRef = useRef(false);
  // Personas loaded from API for agent selector
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [postSynthesisAgents, setPostSynthesisAgents] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  // Persona filter for the War Room feed — "all" shows every turn
  const [personaFilter, setPersonaFilter] = useState<string>("all");
  // Resizable left pane — clamped between 180 and 520 px
  const [leftWidth, setLeftWidth] = useState(280);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Resizable right pane — clamped between 250 and 600 px
  const [rightWidth, setRightWidth] = useState(360);
  const rightDragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Phase 6.1 — live health badge
  const [health, setHealth] = useState<HealthState>({
    status: "pending",
    label: "—",
    title: "Checking watsonx…",
  });
  // Phase 6.2 — session persistence
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [sessionSavedFlash, setSessionSavedFlash] = useState(false);

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

    try {
      setPhase("discovering");
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
      setEditableBrief(data);
      setPhase("ready");
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

  const handleStopDebate = useCallback(() => {
    warRoomRef.current?.stop();
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

  // Determine the proposer (lowest turn_order among selected debaters)
  // This persona cannot be moved to post-synthesis.
  const proposerId = useMemo(() => {
    const activeDebaters = personas.filter(p => p.role_type === "debater" && selectedAgents.includes(p.id));
    activeDebaters.sort((a, b) => a.turn_order - b.turn_order);
    return activeDebaters.length > 0 ? activeDebaters[0].id : null;
  }, [personas, selectedAgents]);

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

  // ── Right-pane resize drag handlers ─────────────────────────────
  const handleRightResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    rightDragStateRef.current = { startX: e.clientX, startWidth: rightWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [rightWidth]);

  const handleRightResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rightDragStateRef.current) return;
    const delta = rightDragStateRef.current.startX - e.clientX;
    const next = Math.min(600, Math.max(250, rightDragStateRef.current.startWidth + delta));
    setRightWidth(next);
  }, []);

  const handleRightResizeEnd = useCallback(() => {
    rightDragStateRef.current = null;
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

  function handleExportAll() {
    const slug = idea.trim().slice(0, 40).replace(/\s+/g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "war-room";
    const payload = {
      exportedAt: new Date().toISOString(),
      discovery: idea,
      creativeBrief: editableBrief ?? brief,
      entireDebateConvo: {
        transcript,
        objections,
        synthesis,
      },
      askTheBoardConvo: boardMessages,
      diagram: diagram ?? null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `war-room-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

  // Load saved sessions and personas from storage/API once on mount (client only)
  useEffect(() => {
    setSavedSessions(loadSessionsFromStorage());

    async function fetchPersonas() {
      try {
        const res = await fetch("/api/personas");
        if (res.ok) {
          const data = (await res.json()) as PersonaSummary[];
          setPersonas(data);
          // Default: all enabled personas selected
          setSelectedAgents(data.map((p) => p.id));
          setPostSynthesisAgents(data.filter((p) => p.runs_after_synthesis).map((p) => p.id));
        }
      } catch (err) {
        console.error("Failed to load personas:", err);
      }
    }
    fetchPersonas();
  }, []);

  // ── Rehydrate state after returning from /chaos ──────────────
  useEffect(() => {
    if (!returnSnapshot) return;
    setIdea(returnSnapshot.idea);
    setBrief(returnSnapshot.brief);
    setEditableBrief(returnSnapshot.brief);
    setBriefEditing(false);
    setTranscript(returnSnapshot.transcript);
    setObjections(returnSnapshot.objections);
    setSynthesis(returnSnapshot.synthesis);
    setDiagram(returnSnapshot.diagram);
    setFinalProposal(returnSnapshot.finalProposal);
    setDebateComplete(returnSnapshot.debateComplete);
    setDebateProposal(null);
    setRound(-1);
    setPhase("synthesised");
    setError(null);
    clearReturnSnapshot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Flash confirmation for 2 s
    setSessionSavedFlash(true);
    setTimeout(() => setSessionSavedFlash(false), 2000);
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

  // Close expanded diagram on Escape key
  useEffect(() => {
    if (!diagramExpanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDiagramExpanded(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [diagramExpanded]);

  function handleSimulateChaos() {
    if (!synthesis || !diagram?.valid || !brief) return;
    setReturnSnapshot({
      idea,
      brief,
      transcript,
      objections,
      synthesis,
      diagram,
      finalProposal,
      debateComplete,
    });
    setChaosInputs(synthesis, diagram.diagram);
    router.push("/chaos");
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-base text-ink">

      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="app-header flex items-center justify-between px-4 py-3">
        <h1 className="app-title">
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Architecture Review Board"}
        </h1>

        <RoundCounter round={round} total={maxRounds} complete={debateComplete} />

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
              className={`status-dot status-dot--${
                health.status === "ok"
                  ? "ok"
                  : health.status === "warn"
                  ? "warn"
                  : health.status === "error"
                  ? "error"
                  : "pending"
              }`}
            />
            health: {health.label}
          </span>
          <a
            href="/settings/personas"
            className="btn btn-ghost"
            style={{ padding: "3px 8px", textDecoration: "none" }}
            aria-label="Persona admin settings"
          >
            ⚙ Personas
          </a>
          <ThemeToggle />
        </div>
      </header>

      {/* ── THREE-COLUMN BODY ──────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANE — Discovery (resizable, default 280px) ── */}
        <aside
          className="pane-left flex flex-col gap-4 p-4 overflow-y-auto shrink-0"
          style={{ width: `${leftWidth}px` }}
        >
          <section aria-labelledby="discovery-heading">
            <h2 id="discovery-heading" className="section-heading section-heading--discovery">
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
              className="input-field resize-none"
              aria-label="Business idea input"
            />

            {/* Analyse button */}
            <button
              onClick={handleAnalyse}
              disabled={!idea.trim() || phase === "discovering"}
              className="btn btn-primary mt-3 w-full py-2"
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
                <h2 id="brief-heading" className="section-heading section-heading--brief mb-0">
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
                  className="panel-card panel-card--highlight space-y-3"
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "0.8125rem",
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
                  className="panel-card text-xs space-y-3"
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "0.8125rem",
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

          {/* War Room Config — agent selector + rounds, shown before debate starts or when synthesised */}
          {brief && (phase === "ready" || phase === "synthesised") && personas.length > 0 && (
            <section aria-labelledby="warroom-config-heading" className="mt-3">
              <h2 id="warroom-config-heading" className="section-heading section-heading--warroom">
                War Room Config
              </h2>
              <div className="panel-card space-y-3">
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
                        <div
                          key={p.id}
                          className="flex items-center justify-between"
                          style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
                        >
                          <label className="flex items-center gap-2 cursor-pointer select-none">
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
                          {p.role_type === "debater" && p.id !== proposerId && isChecked && (
                            <button
                              onClick={() => {
                                setPostSynthesisAgents(prev => 
                                  prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                                );
                              }}
                              className="select-none"
                              style={{
                                fontSize: "0.6rem",
                                color: postSynthesisAgents.includes(p.id) ? accentColor : "var(--col-muted)",
                                border: `1px solid ${postSynthesisAgents.includes(p.id) ? accentColor : "var(--col-rule)"}`,
                                borderRadius: "2px",
                                padding: "0 4px",
                                background: postSynthesisAgents.includes(p.id) ? `${accentColor}1A` : "none",
                                cursor: "pointer"
                              }}
                              title={postSynthesisAgents.includes(p.id) ? "Runs after synthesis" : "Click to run after synthesis"}
                            >
                              {postSynthesisAgents.includes(p.id) ? "▸ after synthesis" : "run after synthesis"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Rounds selector */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[0.6875rem]"
                    style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
                  >
                    ROUNDS
                  </span>
                  {/* AUTO toggle */}
                  <label
                    className="flex items-center gap-1 cursor-pointer select-none"
                    style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
                  >
                    <input
                      type="checkbox"
                      checked={maxRounds === 0}
                      onChange={(e) => setMaxRounds(e.target.checked ? 0 : 3)}
                      style={{ accentColor: "var(--col-cobalt)" }}
                      aria-label="Auto mode — debate until all agents agree"
                    />
                    <span style={{ color: maxRounds === 0 ? "var(--col-cobalt)" : "var(--col-muted)" }}>
                      AUTO
                    </span>
                  </label>
                  {/* Fixed-count input — hidden in auto mode */}
                  {maxRounds !== 0 && (
                    <>
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
                    </>
                  )}
                  {maxRounds === 0 && (
                    <span
                      className="text-[0.6875rem]"
                      style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
                    >
                      until consensus
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Start Debate button */}
          {brief && (phase === "ready" || phase === "synthesised") && (
            <button
              onClick={() => {
                if (phase === "synthesised") {
                  setDebateComplete(false);
                  setRound(-1);
                  setSynthesis(null);
                  setFinalProposal(null);
                  setDiagram(null);
                  setTranscript([]);
                  setObjections([]);
                  setBoardMessages([]);
                }
                handleStartDebate();
              }}
              disabled={selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0}
              className="btn btn-primary mt-2 w-full py-2"
              title={
                selectedAgents.filter((id) => personas.find((p) => p.id === id && p.role_type === "debater")).length === 0
                  ? "Select at least one debater agent"
                  : undefined
              }
            >
              {phase === "synthesised" ? "↺ Restart War Room Debate" : "▶ Start War Room Debate"}
            </button>
          )}

          {/* Debate/synthesis in-progress indicator + stop button in left pane */}
          {phase === "debating" && (
            <div className="mt-2 flex flex-col gap-2">
              <p
                className="text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-cobalt)" }}
              >
                Debate running…
              </p>
              <button
                onClick={handleStopDebate}
                className="btn btn-danger w-full py-1.5 text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)" }}
                title="Abort the running debate and go to synthesis"
              >
                ■ Stop
              </button>
            </div>
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
                className="btn btn-secondary w-full py-1.5 text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)" }}
                title="Save this debate session to browser storage"
              >
                {sessionSavedFlash ? "✓ Saved" : "↓ Save Session"}
              </button>
            </div>
          )}

          {/* ── Load Session picker (task 6.2) — show when idle OR just after saving ── */}
          {(phase === "idle" || phase === "synthesised") && savedSessions.length > 0 && (
            <section aria-labelledby="load-session-heading" className="mt-3">
              <h2 id="load-session-heading" className="section-heading section-heading--session">
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
          className="resize-handle"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />

        {/* ── CENTER PANE — War Room feed (flex-grow) ─────────── */}
        <main
          className="bg-blueprint flex flex-col flex-1 overflow-y-auto"
          aria-label="War Room debate feed"
        >
          <div className="flex flex-col flex-1 p-6">
            {/* ── Persona filter bar — always sticky at top of conversation ── */}
            {personas.length > 0 && (
              <div
                className="flex items-center justify-end mb-4"
                style={{ gap: "8px" }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "0.6875rem",
                    color: "var(--col-muted)",
                  }}
                >
                  View:
                </span>
                <select
                  value={personaFilter}
                  onChange={(e) => setPersonaFilter(e.target.value)}
                  aria-label="Filter War Room feed by persona"
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "0.6875rem",
                    padding: "3px 8px",
                    backgroundColor: "var(--col-surface)",
                    color: personaFilter !== "all" ? "var(--col-cobalt)" : "var(--col-ink)",
                    border: `1px solid ${personaFilter !== "all" ? "var(--col-cobalt)" : "var(--col-rule)"}`,
                    borderRadius: "3px",
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  <option value="all">All personas</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              ref={warRoomRef}
              proposal={debateProposal}
              agents={selectedAgents.length > 0 ? selectedAgents : undefined}
              postSynthesisAgents={postSynthesisAgents.length > 0 ? postSynthesisAgents : undefined}
              maxRounds={maxRounds}
              guardianIds={guardianIds}
              filterAgent={personaFilter}
              onRoundChange={handleRoundChange}
              onSynthesis={handleSynthesis}
              onComplete={handleDebateComplete}
              onDebateState={handleDebateState}
            />
          </div>

          {/* ── Post-debate chat — visible once synthesis is complete ── */}
          {phase === "synthesised" && synthesis && (
            <ChatPanel
              synthesis={synthesis}
              transcript={transcript}
              objections={objections}
              personas={personas}
              onMessagesChange={setBoardMessages}
            />
          )}
        </main>

        {/* ── RESIZE HANDLE — drag to resize right pane ─────────── */}
        <div
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          className="resize-handle"
          onPointerDown={handleRightResizeStart}
          onPointerMove={handleRightResizeMove}
          onPointerUp={handleRightResizeEnd}
          onPointerCancel={handleRightResizeEnd}
        />

        {/* ── RIGHT PANE — Diagram / Chaos / Deck / Audio ─ */}
        <aside
          className="pane-right flex flex-col gap-0 overflow-y-auto shrink-0"
          style={{
            width: `${rightWidth}px`,
          }}
        >
          {/* Live Diagram */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="diagram-heading"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 id="diagram-heading" className="section-heading section-heading--diagram mb-0">
                Live Diagram
              </h2>
              {/* Generate button — enabled only when synthesis is ready */}
              <button
                onClick={handleGenerateDiagram}
                disabled={!synthesis || diagramLoading}
                className="btn btn-primary text-[0.6875rem] px-2 py-1"
                style={{ fontFamily: "var(--font-geist-mono)" }}
                aria-busy={diagramLoading}
              >
                {diagramLoading ? "Generating…" : diagram ? "Regenerate" : "Generate"}
              </button>
            </div>

            {diagram ? (
              <button
                onClick={() => diagram.valid && setDiagramExpanded(true)}
                aria-label="Expand diagram"
                style={{
                  display: "block",
                  width: "100%",
                  padding: 0,
                  background: "none",
                  border: "none",
                  cursor: diagram.valid ? "zoom-in" : "default",
                  textAlign: "left",
                }}
              >
                <MermaidRenderer
                  ref={diagramRef}
                  diagram={diagram.diagram}
                  valid={diagram.valid}
                  parseError={diagram.error}
                />
                {diagram.valid && (
                  <p
                    style={{
                      marginTop: "4px",
                      fontSize: "0.6rem",
                      fontFamily: "var(--font-geist-mono)",
                      color: "var(--col-muted)",
                      textAlign: "right",
                      letterSpacing: "0.04em",
                    }}
                  >
                    click to expand
                  </p>
                )}
              </button>
            ) : (
              <div
                className="panel-card flex items-center justify-center"
                style={{
                  height: "200px",
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

          {/* Diagram lightbox modal */}
          {diagramExpanded && diagram?.valid && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Expanded architecture diagram"
              onClick={() => setDiagramExpanded(false)}
              onKeyDown={(e) => e.key === "Escape" && setDiagramExpanded(false)}
              tabIndex={-1}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                backgroundColor: "rgba(0,0,0,0.82)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px",
              }}
            >
              {/* Stop click-through on the inner panel */}
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "relative",
                  width: "min(1200px, 95vw)",
                  maxHeight: "90vh",
                  backgroundColor: "var(--col-base)",
                  border: "1px solid var(--col-rule)",
                  borderRadius: "6px",
                  overflowY: "auto",
                  padding: "24px",
                }}
              >
                <button
                  onClick={() => setDiagramExpanded(false)}
                  aria-label="Close expanded diagram"
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "12px",
                    background: "none",
                    border: "none",
                    color: "var(--col-muted)",
                    fontSize: "1.25rem",
                    lineHeight: 1,
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: "3px",
                  }}
                >
                  ×
                </button>
                <p
                  style={{
                    marginBottom: "16px",
                    fontSize: "0.6875rem",
                    fontFamily: "var(--font-plex-condensed)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--col-muted)",
                  }}
                >
                  Architecture Diagram
                </p>
                <MermaidRenderer
                  diagram={diagram.diagram}
                  valid={diagram.valid}
                  parseError={diagram.error}
                />
              </div>
            </div>
          )}

          {/* Chaos Simulator */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="chaos-heading"
          >
            <h2 id="chaos-heading" className="section-heading section-heading--chaos">
              Chaos Simulator
            </h2>

            <button
              onClick={handleSimulateChaos}
              disabled={!diagram?.valid}
              className="btn btn-chaos w-full py-2"
              aria-label="Simulate Chaos"
            >
              ▶ Simulate Chaos
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

          {/* Export */}
          <section
            className="flex flex-col p-4 border-b"
            style={{ borderColor: "var(--col-rule)" }}
            aria-labelledby="deck-heading"
          >
            <h2 id="deck-heading" className="section-heading section-heading--export">
              Export
            </h2>
            <div className="flex flex-col gap-2">
              {/* Export All — JSON bundle, no diagram required */}
              <button
                onClick={handleExportAll}
                disabled={!synthesis}
                className="btn btn-primary w-full py-2"
                aria-label="Export all war room data as JSON"
                title="Downloads brief, transcript, objections, synthesis and diagram as a single JSON file"
              >
                ↓ Export All (.json)
              </button>

              {/* Pitch deck — requires a valid diagram */}
              <button
                onClick={handleDownloadDeck}
                disabled={!synthesis || !diagram?.valid || deckLoading}
                className="btn btn-secondary w-full py-2"
                aria-label="Download pitch deck"
                aria-busy={deckLoading}
              >
                {deckLoading ? "Building deck…" : "↓ Download .pptx"}
              </button>
            </div>
            {synthesis && !diagram?.valid && (
              <p
                className="mt-2 text-[0.6875rem]"
                style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
              >
                Generate a diagram to unlock .pptx
              </p>
            )}
          </section>

          {/* Audio Upload */}
          <section
            className="flex flex-col p-4"
            aria-labelledby="audio-heading"
          >
            <h2 id="audio-heading" className="section-heading section-heading--audio">
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
      <footer className="app-footer flex items-center gap-4 px-4 py-2 border-t" role="contentinfo">
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
