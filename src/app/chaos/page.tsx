"use client";

/**
 * app/chaos/page.tsx
 * Dedicated live chaos simulation page.
 *
 * Layout:
 *   Top bar  — back button · title · re-run button
 *   Progress bar — fills as beats arrive
 *   Main area:
 *     Left  (~60%) — MermaidRenderer; nodes pulse on each beat
 *     Right (~40%) — live beat log (cards stream in)
 *
 * Data source: useChaosStore (written by main page before navigation).
 * If the store is empty the page shows an empty state with a back link.
 *
 * SSE reader replicates the labeled outer: loop from page.tsx lines 440-492.
 * Pulse animation is gated by prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MermaidRenderer from "@/src/components/MermaidRenderer";
import type { MermaidRendererHandle } from "@/src/components/MermaidRenderer";
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

// ── Types ──────────────────────────────────────────────────────────────────────

interface BeatCard {
  index: number;
  state: ChaosState;
  label: string;
  affectedNodes: string[];
  timestamp: number; // ms since simulation start
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  return `t+${(ms / 1000).toFixed(1)}s`;
}

// Apply a brief CSS class to affected SVG nodes in the rendered diagram
function pulseSvgNodes(
  container: HTMLDivElement | null,
  nodeIds: string[],
  reducedMotion: boolean
) {
  if (reducedMotion || !container) return;
  for (const nodeId of nodeIds) {
    const targets = [
      ...Array.from(container.querySelectorAll<SVGElement>(
        `[data-node-id="${nodeId}"], [data-id="${nodeId}"]`
      )),
      ...Array.from(container.querySelectorAll<SVGElement>(
        `[id^="flowchart-${nodeId}-"]`
      )),
    ];

    for (const el of targets) {
      el.querySelectorAll<SVGElement>("rect, circle, polygon, ellipse").forEach((shape) => {
        shape.classList.add("chaos-pulse-active");
        setTimeout(() => shape.classList.remove("chaos-pulse-active"), 650);
      });
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChaosSimulatorPage() {
  const router = useRouter();
  const { synthesis, diagramSource } = useChaosStore();

  const diagramRef = useRef<MermaidRendererHandle>(null);
  // We need the underlying DOM container for the pulse helper
  const diagramContainerRef = useRef<HTMLDivElement>(null);
  const reducedMotionRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Chaos simulation state
  const [beatCards, setBeatCards] = useState<BeatCard[]>([]);
  const [chaosCurrent, setChaosCurrent] = useState(-1);
  const [chaosTotal, setChaosTotal] = useState(0);
  const [chaosRunning, setChaosRunning] = useState(false);
  const [chaosComplete, setChaosComplete] = useState(false);
  const [currentStateLabel, setCurrentStateLabel] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("");

  // Detect reduced motion on mount
  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Auto-start on mount when store has data
  useEffect(() => {
    if (synthesis && diagramSource) {
      // Small delay lets MermaidRenderer finish its first render
      const t = setTimeout(() => handleSimulate(), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll beat log to bottom on each new card
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [beatCards.length]);

  async function handleSimulate() {
    if (!synthesis || chaosRunning) return;

    // Reset state
    setBeatCards([]);
    setChaosCurrent(-1);
    setChaosTotal(0);
    setChaosComplete(false);
    setCurrentStateLabel("");
    setChaosRunning(true);
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

        // Normal beat event
        const beatIndex = event.beat as number;
        const total = event.total as number;
        const state = event.state as ChaosState;
        const label = event.label as string;
        const affectedNodes = event.affectedNodes as string[];
        const patch = event.patch as string;
        const elapsed = Date.now() - startTimeRef.current;

        setChaosTotal(total);
        setChaosCurrent(beatIndex);
        setCurrentStateLabel(label);

        setBeatCards((prev) => [
          ...prev,
          { index: beatIndex, state, label, affectedNodes, timestamp: elapsed },
        ]);

        // Apply node colors to Mermaid diagram
        if (diagramRef.current?.isRendered()) {
          const nodeStyles = parseClassDefPatch(patch);
          diagramRef.current.applyClassDefs(nodeStyles);

          // Pulse affected nodes (gated by reduced-motion)
          pulseSvgNodes(
            diagramContainerRef.current,
            affectedNodes,
            reducedMotionRef.current
          );
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

  const currentBeat = beatCards[chaosCurrent] ?? null;
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
            transition: reducedMotionRef.current ? "none" : "width 0.3s ease, background-color 0.3s ease",
          }}
        />
      </div>

      {/* ── Main split area ── */}
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* ── Left: Diagram ── */}
        <div
          style={{
            flex: "0 0 60%",
            borderRight: "1px solid var(--col-rule)",
            padding: "16px",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: "0.6875rem",
              fontFamily: "var(--font-plex-condensed)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--col-muted)",
              marginBottom: "12px",
            }}
          >
            Architecture Diagram
          </div>
          {/* Wrapper div we pass to pulseSvgNodes */}
          <div ref={diagramContainerRef} className="chaos-live-diagram" style={{ flex: 1 }}>
            <MermaidRenderer
              ref={diagramRef}
              diagram={diagramSource}
              valid={true}
            />
          </div>
        </div>

        {/* ── Right: Beat log ── */}
        <div
          style={{
            flex: "0 0 40%",
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
              gap: "10px",
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
              <BeatLogCard key={card.index} card={card} />
            ))}

            {/* Status footer */}
            {chaosRunning && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--col-muted)",
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

  return (
    <div
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
            display: "inline-block",
            backgroundColor: stateColor,
            color: "#0e1117",
            fontSize: "0.625rem",
            fontFamily: "var(--font-geist-mono)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: "3px",
          }}
        >
          {card.state}
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
      {card.affectedNodes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {card.affectedNodes.map((nodeId) => (
            <span
              key={nodeId}
              style={{
                fontSize: "0.625rem",
                fontFamily: "var(--font-geist-mono)",
                color: stateColor,
                backgroundColor: "var(--col-base)",
                border: `1px solid ${stateColor}`,
                borderRadius: "3px",
                padding: "1px 5px",
              }}
            >
              {nodeId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
