"use client";

/**
 * app/chaos/page.tsx
 * Live chaos simulation page — animated architecture diagram.
 *
 * Layout:
 *   Top bar     — back button · title · scenario picker · re-run button
 *   Progress bar — fills + changes color as beats arrive
 *   Main area:
 *     Left  (~62%) — MermaidRenderer with:
 *                     • per-state CSS animation on affected nodes (shake/spawn/glow/ripple)
 *                     • HTML overlay badges (✕ failure / ↑ failover / ✓ recovery)
 *                     • expanding ring particle on each event
 *                     • live state banner at top of diagram
 *     Right (~38%) — scrollable beat log with slide-in cards
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MermaidRenderer from "@/src/components/MermaidRenderer";
import type { MermaidRendererHandle } from "@/src/components/MermaidRenderer";
import LiveEdgePackets from "@/src/components/LiveEdgePackets";
import { parseClassDefPatch } from "@/backend/lib/chaos/classDef";
import type { ChaosState } from "@/backend/lib/chaos/narrative";
import { useChaosStore } from "@/src/store/chaosStore";

// ── Constants ──────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<ChaosState, string> = {
  normal:   "var(--col-chaos-normal)",
  strain:   "var(--col-chaos-strain)",
  failure:  "var(--col-chaos-failure)",
  failover: "#7c5cd8",
  recovery: "var(--col-chaos-recovery)",
};

const STATE_LABEL_COLOR: Record<ChaosState, string> = {
  normal:   "#2d7a6e",
  strain:   "#c98a1a",
  failure:  "#c0392b",
  failover: "#7c5cd8",
  recovery: "#3b7a57",
};

const STATE_HEX: Record<ChaosState, string> = {
  normal:   "#2d7a6e",
  strain:   "#e8a735",
  failure:  "#ef4444",
  failover: "#7c5cd8",
  recovery: "#22c55e",
};

/** Badge icon per state */
const STATE_BADGE_ICON: Record<ChaosState, string> = {
  normal:   "●",
  strain:   "!",
  failure:  "✕",
  failover: "↑",
  recovery: "✓",
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface BeatCard {
  index: number;
  state: ChaosState;
  label: string;
  affectedNodes: string[];
  timestamp: number;
}

/** An HTML overlay badge placed over a diagram node */
interface OverlayBadge {
  id: string;
  nodeId: string;
  state: ChaosState;
  x: number;
  y: number;
  visible: boolean;
}

/** An expanding ring particle */
interface Ring {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  return `t+${(ms / 1000).toFixed(1)}s`;
}

/**
 * Find the center (x, y) of a Mermaid node group relative to its container div.
 * Returns null if the node cannot be found.
 */
function getNodeCenter(
  container: HTMLDivElement,
  nodeId: string
): { x: number; y: number; w: number; h: number } | null {
  const selectors = [
    `[data-node-id="${nodeId}"]`,
    `[data-id="${nodeId}"]`,
    `[id^="flowchart-${nodeId}-"]`,
  ];

  for (const sel of selectors) {
    const el = container.querySelector<SVGElement>(sel);
    if (el) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      return {
        x: elRect.left - containerRect.left + elRect.width / 2,
        y: elRect.top  - containerRect.top  + elRect.height / 2,
        w: elRect.width,
        h: elRect.height,
      };
    }
  }

  // Fallback: text-content scan
  const nodes = Array.from(container.querySelectorAll<SVGElement>("g.node"));
  for (const g of nodes) {
    if (g.querySelector(".label")?.textContent?.includes(nodeId)) {
      const containerRect = container.getBoundingClientRect();
      const elRect = g.getBoundingClientRect();
      return {
        x: elRect.left - containerRect.left + elRect.width / 2,
        y: elRect.top  - containerRect.top  + elRect.height / 2,
        w: elRect.width,
        h: elRect.height,
      };
    }
  }
  return null;
}

/**
 * Highlight edges in the SVG that visually connect to any of the given nodeIds.
 * Mermaid renders edges as <path> elements inside .edgePaths. We find edges
 * whose id contains a nodeId substring and add a temporary CSS class.
 */
function flashEdges(container: HTMLDivElement, nodeIds: string[], state: ChaosState) {
  const color = STATE_HEX[state];
  // All edge paths
  const edgePaths = Array.from(container.querySelectorAll<SVGPathElement>(".edgePaths path, .edgePath path"));

  for (const path of edgePaths) {
    const pathId = path.id ?? path.parentElement?.id ?? "";
    const matches = nodeIds.some((nid) => pathId.toLowerCase().includes(nid.toLowerCase()));
    if (matches) {
      // Temporarily override stroke color and add flash class
      const originalStroke = path.style.stroke;
      path.style.stroke = color;
      path.style.strokeWidth = "2.5";
      path.classList.add("chaos-edge-active");
      setTimeout(() => {
        path.classList.remove("chaos-edge-active");
        path.style.stroke = originalStroke;
        path.style.strokeWidth = "";
      }, 1300);
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChaosSimulatorPage() {
  const router = useRouter();
  const { synthesis, diagramSource } = useChaosStore();

  const diagramRef = useRef<MermaidRendererHandle>(null);
  const reducedMotionRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  // Track the wrapper div for overlay positioning
  const overlayWrapperRef = useRef<HTMLDivElement>(null);
  // Stable ref to the SVG container div — set once onRendered fires
  const [svgContainerEl, setSvgContainerEl] = useState<HTMLDivElement | null>(null);

  // Chaos simulation state
  const [beatCards, setBeatCards]           = useState<BeatCard[]>([]);
  const [chaosCurrent, setChaosCurrent]     = useState(-1);
  const [chaosTotal, setChaosTotal]         = useState(0);
  const [chaosRunning, setChaosRunning]     = useState(false);
  const [chaosComplete, setChaosComplete]   = useState(false);
  const [currentState, setCurrentState]     = useState<ChaosState | null>(null);
  const [currentStateLabel, setCurrentStateLabel] = useState("");
  const [selectedScenario, setSelectedScenario]   = useState("");
  // Track when Mermaid finishes injecting SVG — needed by LiveEdgePackets
  const [diagramRendered, setDiagramRendered] = useState(false);

  // Live overlay badges and rings
  const [badges, setBadges] = useState<OverlayBadge[]>([]);
  const [rings,  setRings]  = useState<Ring[]>([]);

  // ── Reduced motion ──────────────────────────────────────────────────────────
  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // ── Auto-start ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (synthesis && diagramSource) {
      const t = setTimeout(() => handleSimulate(), 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll beat log ────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [beatCards.length]);

  // ── Overlay helpers ─────────────────────────────────────────────────────────

  /**
   * Place a floating badge over each affected node, then auto-remove after delay.
   * Only placed when the diagram has been rendered and the container is available.
   */
  const spawnBadges = useCallback((nodeIds: string[], state: ChaosState) => {
    if (reducedMotionRef.current) return;
    const container = diagramRef.current?.getSvgContainer();
    if (!container) return;

    const newBadges: OverlayBadge[] = [];
    for (const nodeId of nodeIds) {
      const pos = getNodeCenter(container, nodeId);
      if (!pos) continue;
      newBadges.push({
        id: `${nodeId}-${state}-${Date.now()}-${Math.random()}`,
        nodeId,
        state,
        x: pos.x,
        y: pos.y - pos.h / 2 - 12,
        visible: true,
      });
    }

    if (newBadges.length === 0) return;

    setBadges((prev) => [...prev, ...newBadges]);

    // Fade out after 2.5 s, remove after 3 s
    const ids = newBadges.map((b) => b.id);
    setTimeout(() => {
      setBadges((prev) => prev.map((b) => ids.includes(b.id) ? { ...b, visible: false } : b));
    }, 2500);
    setTimeout(() => {
      setBadges((prev) => prev.filter((b) => !ids.includes(b.id)));
    }, 3000);
  }, []);

  /**
   * Spawn expanding ring particles at each affected node center.
   */
  const spawnRings = useCallback((nodeIds: string[], state: ChaosState) => {
    if (reducedMotionRef.current) return;
    const container = diagramRef.current?.getSvgContainer();
    if (!container) return;

    const newRings: Ring[] = [];
    for (const nodeId of nodeIds) {
      const pos = getNodeCenter(container, nodeId);
      if (!pos) continue;
      newRings.push({
        id: `ring-${nodeId}-${Date.now()}-${Math.random()}`,
        x: pos.x,
        y: pos.y,
        color: STATE_HEX[state],
        size: Math.max(pos.w, pos.h) * 0.85,
      });
    }

    if (newRings.length === 0) return;

    setRings((prev) => [...prev, ...newRings]);
    const ids = newRings.map((r) => r.id);
    // Remove rings after animation completes (0.9 s)
    setTimeout(() => {
      setRings((prev) => prev.filter((r) => !ids.includes(r.id)));
    }, 950);
  }, []);

  // ── Main simulate handler ───────────────────────────────────────────────────

  async function handleSimulate() {
    if (!synthesis || chaosRunning) return;

    // Reset state
    setBeatCards([]);
    setChaosCurrent(-1);
    setChaosTotal(0);
    setChaosComplete(false);
    setCurrentState(null);
    setCurrentStateLabel("");
    setChaosRunning(true);
    setBadges([]);
    setRings([]);
    startTimeRef.current = Date.now();

    let res: Response;
    try {
      res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: synthesis,
          reducedMotion: reducedMotionRef.current,
          scenario: selectedScenario,
        }),
      });
    } catch {
      setChaosRunning(false);
      return;
    }

    if (!res.ok || !res.body) {
      setChaosRunning(false);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const chunk of lines) {
        if (!chunk.startsWith("data: ")) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(chunk.slice(6));
        } catch {
          continue;
        }

        if (event.type === "done") {
          setChaosComplete(true);
          break outer;
        }
        if (event.type === "error") {
          console.error("[chaos]", event.message);
          break outer;
        }

        // ── Normal beat event ──────────────────────────────────────────────
        const beatIndex     = event.beat          as number;
        const total         = event.total         as number;
        const state         = event.state         as ChaosState;
        const label         = event.label         as string;
        const affectedNodes = event.affectedNodes as string[];
        const patch         = event.patch         as string;
        const elapsed       = Date.now() - startTimeRef.current;

        setChaosTotal(total);
        setChaosCurrent(beatIndex);
        setCurrentState(state);
        setCurrentStateLabel(label);

        setBeatCards((prev) => [
          ...prev,
          { index: beatIndex, state, label, affectedNodes, timestamp: elapsed },
        ]);

        // ── Diagram mutations ──────────────────────────────────────────────
        if (diagramRef.current?.isRendered()) {
          // 1. Recolour nodes
          const nodeStyles = parseClassDefPatch(patch);
          diagramRef.current.applyClassDefs(nodeStyles);

          // 2. CSS animation on node groups (shake / spawn / glow / ripple)
          diagramRef.current.animateNodes(affectedNodes, state);

          // 3. Flash connected edges
          const svgContainer = diagramRef.current.getSvgContainer();
          if (svgContainer && !reducedMotionRef.current) {
            flashEdges(svgContainer, affectedNodes, state);
          }

          // 4. Expanding ring particles
          spawnRings(affectedNodes, state);

          // 5. Floating badge overlays
          spawnBadges(affectedNodes, state);
        }
      }
    }

    setChaosRunning(false);
  }

  // ── Empty state ───────────────────────────────────────────────────────────────

  if (!synthesis || !diagramSource) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "var(--col-base)",
          color: "var(--col-muted)",
          fontFamily: "var(--font-geist-mono)",
          gap: "12px",
        }}
      >
        <span style={{ fontSize: "0.875rem" }}>No simulation data available.</span>
        <button
          onClick={() => router.push("/")}
          style={{
            fontSize: "0.75rem",
            color: "var(--col-cobalt)",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          ← Back to War Room
        </button>
      </div>
    );
  }

  // ── Progress ──────────────────────────────────────────────────────────────────

  const progressPct =
    chaosTotal > 0 ? Math.round(((chaosCurrent + 1) / chaosTotal) * 100) : 0;

  const currentBeat  = beatCards[chaosCurrent] ?? null;
  const progressColor = currentBeat
    ? STATE_LABEL_COLOR[currentBeat.state]
    : "var(--col-cobalt)";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--col-base)",
        color: "var(--col-ink)",
        overflow: "hidden",
      }}
    >
      {/* ── Top bar ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid var(--col-rule)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => router.push("/")}
            style={{
              fontSize: "0.8125rem",
              fontFamily: "var(--font-geist-sans)",
              color: "var(--col-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            ← War Room
          </button>

          <h1
            style={{
              fontFamily: "var(--font-plex-condensed)",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--col-muted)",
              margin: 0,
            }}
          >
            Chaos Simulator
          </h1>

          {/* Live state indicator pill */}
          {(chaosRunning || chaosComplete) && currentState && (
            <div
              className="chaos-state-banner"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 10px",
                borderRadius: "12px",
                backgroundColor: `${STATE_HEX[currentState]}22`,
                border: `1px solid ${STATE_HEX[currentState]}66`,
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: STATE_HEX[currentState],
                  display: "inline-block",
                  animation: chaosRunning ? "chaos-spin 1.2s linear infinite" : "none",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: STATE_HEX[currentState],
                }}
              >
                {currentState}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            disabled={chaosRunning}
            style={{
              fontSize: "0.8125rem",
              fontFamily: "var(--font-geist-sans)",
              padding: "4px 8px",
              backgroundColor: "var(--col-surface)",
              color: "var(--col-ink)",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
            }}
          >
            <option value="">Traffic Spike (Default)</option>
            <option value="Database Failure & Failover">Database Failure & Failover</option>
            <option value="Regional Outage">Regional Outage</option>
            <option value="DDoS Attack">DDoS Attack</option>
            <option value="Data Corruption">Data Corruption</option>
          </select>

          <button
            onClick={() => handleSimulate()}
            disabled={chaosRunning}
            style={{
              fontSize: "0.8125rem",
              fontFamily: "var(--font-geist-sans)",
              padding: "5px 12px",
              backgroundColor: chaosRunning ? "var(--col-rule)" : "var(--col-chaos-strain)",
              color: chaosRunning ? "var(--col-muted)" : "#0e1117",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
              cursor: chaosRunning ? "not-allowed" : "pointer",
            }}
            aria-busy={chaosRunning}
          >
            {chaosRunning ? "Simulating…" : chaosComplete ? "↺ Re-run" : "▶ Run"}
          </button>
        </div>
      </header>

      {/* ── Progress bar ── */}
      <div
        style={{
          height: "3px",
          backgroundColor: "var(--col-rule)",
          flexShrink: 0,
        }}
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Simulation progress"
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            backgroundColor: progressColor,
            transition: reducedMotionRef.current
              ? "none"
              : "width 0.35s ease, background-color 0.4s ease",
          }}
        />
      </div>

      {/* ── Main split area ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left: Live Diagram ── */}
        <div
          style={{
            flex: "0 0 62%",
            borderRight: "1px solid var(--col-rule)",
            padding: "16px",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {/* Panel header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: "0.6875rem",
                fontFamily: "var(--font-plex-condensed)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--col-muted)",
              }}
            >
              Live Architecture Diagram
            </span>

            {/* Node legend */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {(["normal","strain","failure","failover","recovery"] as ChaosState[]).map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      backgroundColor: STATE_HEX[s],
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.5625rem",
                      fontFamily: "var(--font-geist-mono)",
                      color: "var(--col-muted)",
                      textTransform: "capitalize",
                    }}
                  >
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Diagram + overlay wrapper */}
          <div
            ref={overlayWrapperRef}
            className="chaos-live-diagram"
            style={{ flex: 1, position: "relative" }}
          >
            <MermaidRenderer
              ref={diagramRef}
              diagram={diagramSource}
              valid={true}
              onRendered={() => {
                setDiagramRendered(true);
                setSvgContainerEl(diagramRef.current?.getSvgContainer() ?? null);
              }}
            />

            {/* SVG packet-flow overlay — dots traveling along every edge */}
            <LiveEdgePackets
              svgContainer={svgContainerEl}
              currentState={currentState}
              affectedNodes={beatCards[chaosCurrent]?.affectedNodes ?? []}
              reducedMotion={reducedMotionRef.current}
              diagramRendered={diagramRendered}
            />

            {/* HTML overlay for badges and rings */}
            <div className="chaos-overlay">
              {/* Expanding ring particles */}
              {rings.map((ring) => (
                <div
                  key={ring.id}
                  className="chaos-ring"
                  style={{
                    left: ring.x - ring.size / 2,
                    top:  ring.y - ring.size / 2,
                    width:  ring.size,
                    height: ring.size,
                    color: ring.color,
                  }}
                />
              ))}

              {/* State badges floating over nodes */}
              {badges.map((badge) => (
                <div
                  key={badge.id}
                  className="chaos-badge-overlay"
                  style={{
                    left:          badge.x - 12,
                    top:           badge.y - 12,
                    width:         24,
                    height:        24,
                    backgroundColor: STATE_HEX[badge.state],
                    color:           badge.state === "strain" ? "#0e1117" : "#fff",
                    opacity:         badge.visible ? 1 : 0,
                    transition:      "opacity 0.4s ease",
                    fontSize:        "10px",
                    fontWeight:      900,
                    boxShadow:       `0 0 10px ${STATE_HEX[badge.state]}88`,
                  }}
                >
                  {STATE_BADGE_ICON[badge.state]}
                </div>
              ))}
            </div>

            {/* Beat label banner (bottom of diagram) */}
            {currentStateLabel && (chaosRunning || chaosComplete) && (
              <div
                key={currentStateLabel}
                className="chaos-state-banner"
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 12px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(10, 14, 23, 0.88)",
                  border: `1px solid ${currentState ? STATE_HEX[currentState] : "var(--col-rule)"}55`,
                  backdropFilter: "blur(4px)",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {currentState && (
                  <span
                    style={{
                      fontSize: "0.5625rem",
                      fontFamily: "var(--font-geist-mono)",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: STATE_HEX[currentState],
                      padding: "1px 5px",
                      borderRadius: "3px",
                      backgroundColor: `${STATE_HEX[currentState]}22`,
                    }}
                  >
                    {currentState}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontFamily: "var(--font-geist-sans)",
                    color: "var(--col-ink)",
                  }}
                >
                  {currentStateLabel}
                </span>
                {chaosRunning && (
                  <span
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      backgroundColor: currentState ? STATE_HEX[currentState] : "var(--col-cobalt)",
                      display: "inline-block",
                      animation: "chaos-spin 0.9s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Beat log ── */}
        <div
          style={{
            flex: "0 0 38%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px 8px",
              borderBottom: "1px solid var(--col-rule)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: "0.6875rem",
                fontFamily: "var(--font-plex-condensed)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--col-muted)",
              }}
            >
              Event Log
            </span>
            {chaosTotal > 0 && (
              <span
                style={{
                  fontSize: "0.5625rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--col-muted)",
                  backgroundColor: "var(--col-surface)",
                  padding: "1px 6px",
                  borderRadius: "3px",
                  border: "1px solid var(--col-rule)",
                }}
              >
                {chaosCurrent + 1} / {chaosTotal}
              </span>
            )}
          </div>

          {/* Scrollable cards */}
          <div
            role="log"
            aria-live="polite"
            aria-label="Chaos simulation event log"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {beatCards.length === 0 && !chaosRunning && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--col-muted)",
                }}
              >
                {chaosComplete ? "Simulation complete." : "Waiting to start…"}
              </span>
            )}

            {beatCards.map((card) => (
              <BeatLogCard key={`${card.index}-${card.state}`} card={card} />
            ))}

            {/* Spinner while waiting for first beat */}
            {chaosRunning && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--col-muted)",
                  paddingTop: "2px",
                }}
              >
                <span className="chaos-spinner" aria-hidden="true" />
                {chaosCurrent >= 0
                  ? `Beat ${chaosCurrent + 1} / ${chaosTotal} · ${currentStateLabel}`
                  : "Generating narrative…"}
              </div>
            )}

            {chaosComplete && (
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--col-chaos-recovery)",
                  paddingTop: "4px",
                }}
              >
                ✓ Simulation complete — {chaosTotal} beat{chaosTotal !== 1 ? "s" : ""}
              </div>
            )}

            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Beat log card sub-component ────────────────────────────────────────────────

function BeatLogCard({ card }: { card: BeatCard }) {
  const stateColor = STATE_LABEL_COLOR[card.state];
  const stateHex   = STATE_HEX[card.state];

  return (
    <div
      className="chaos-log-card-enter"
      style={{
        backgroundColor: "var(--col-surface)",
        border: "1px solid var(--col-rule)",
        borderLeft: `3px solid ${stateColor}`,
        borderRadius: "4px",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      {/* Header row: state badge + timestamp */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            backgroundColor: stateColor,
            color: card.state === "strain" ? "#0e1117" : "#fff",
            fontSize: "0.5625rem",
            fontFamily: "var(--font-geist-mono)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: "3px",
          }}
        >
          {STATE_BADGE_ICON[card.state]} {card.state}
        </span>
        <span
          style={{
            fontSize: "0.625rem",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--col-muted)",
          }}
        >
          {formatRelativeTime(card.timestamp)}
        </span>
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: "0.8125rem",
          fontFamily: "var(--font-geist-sans)",
          color: "var(--col-ink)",
          lineHeight: 1.4,
        }}
      >
        {card.label}
      </span>

      {/* Affected nodes */}
      {card.affectedNodes.length > 0 && card.affectedNodes[0] !== "unknown" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {card.affectedNodes.map((n) => (
            <span
              key={n}
              style={{
                fontSize: "0.5625rem",
                fontFamily: "var(--font-geist-mono)",
                color: stateHex,
                backgroundColor: `${stateHex}18`,
                border: `1px solid ${stateHex}44`,
                borderRadius: "3px",
                padding: "1px 5px",
              }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
