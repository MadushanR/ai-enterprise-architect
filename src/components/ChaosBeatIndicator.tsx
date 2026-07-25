"use client";

/**
 * components/ChaosBeatIndicator.tsx
 * TASKS.md 4.4 — Chaos beat progress indicator.
 *
 * Renders a row of filled/empty circles (● ● ○ ○ ○ ○) showing how far
 * through the beat sequence the simulation has progressed.
 *
 * Each active circle is colored using the state color for that beat.
 * DESIGN.md §8: reduced-motion — no transition animations when
 * prefers-reduced-motion: reduce is active.
 * DESIGN.md §10: role="status", aria-live="polite".
 *
 * Props:
 *   beats      — full beat list (for coloring)
 *   current    — 0-based index of the active beat (-1 = not started)
 *   total      — total beat count (used to render placeholder dots before beats load)
 *   stateLabel — human-readable label for the current beat
 */

import type { ChaosState } from "@/backend/lib/chaos/narrative";
export type { ChaosState };

interface BeatInfo {
  state: ChaosState;
}

interface ChaosBeatIndicatorProps {
  beats: BeatInfo[];
  current: number;
  total: number;
  stateLabel: string;
}

// Maps each state to its DESIGN.md §2 color token value
const STATE_COLOR: Record<ChaosState, string> = {
  normal:   "var(--col-chaos-normal)",
  strain:   "var(--col-chaos-strain)",
  failure:  "var(--col-chaos-failure)",
  failover: "#7c5cd8",
  recovery: "var(--col-chaos-recovery)",
};

export default function ChaosBeatIndicator({
  beats,
  current,
  total,
  stateLabel,
}: ChaosBeatIndicatorProps) {
  const dotCount = total > 0 ? total : 6; // show 6 placeholder dots before beats arrive

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={current >= 0 ? `Chaos beat ${current + 1} of ${total}: ${stateLabel}` : "Chaos simulation idle"}
      style={{ display: "flex", flexDirection: "column", gap: "6px" }}
    >
      {/* Dot row */}
      <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
        {Array.from({ length: dotCount }).map((_, i) => {
          const beat = beats[i];
          const filled = i <= current && current >= 0;
          const stateColor = beat ? STATE_COLOR[beat.state] : "var(--col-rule)";

          return (
            <span
              key={i}
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: filled ? stateColor : "var(--col-rule)",
                border: `1px solid ${filled ? stateColor : "var(--col-muted)"}`,
                // No transition — reduced-motion compliance; color snaps instantly
              }}
            />
          );
        })}
      </div>

      {/* State label */}
      {current >= 0 && stateLabel && (
        <span
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            color: beats[current] ? STATE_COLOR[beats[current].state] : "var(--col-muted)",
          }}
        >
          {stateLabel}
        </span>
      )}
    </div>
  );
}
