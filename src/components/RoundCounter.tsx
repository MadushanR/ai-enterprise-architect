"use client";

/**
 * components/RoundCounter.tsx
 * The signature war-room element: a segmented circuit strip showing debate round progress.
 * DESIGN.md §6: three rectangle segments, cobalt fill for active, rule for inactive.
 * Accessibility: role="status", aria-live="polite" (DESIGN.md §10).
 * prefers-reduced-motion: snap state, no closing animation (DESIGN.md §6, §10).
 */

interface RoundCounterProps {
  /** 0-based current round index. -1 = not started. */
  round: number;
  /**
   * Total rounds configured for this session (default 3).
   * Pass 0 for auto mode — segments grow dynamically with no fixed cap.
   */
  total?: number;
  /** True when synthesis has fired (all segments close into a solid bar). */
  complete?: boolean;
}

export default function RoundCounter({ round, total = 3, complete = false }: RoundCounterProps) {
  const autoMode = total === 0;

  // In auto mode the label reflects the current round without a cap.
  const label =
    complete
      ? "Synthesis complete"
      : round < 0
      ? "Debate not started"
      : autoMode
      ? `Round ${round + 1} — auto`
      : `Round ${round + 1} of ${total}`;

  // In auto mode we render as many filled segments as rounds completed, plus
  // one pending segment (to signal "still going"). In fixed mode the count is
  // always `total` segments with the first `round+1` filled.
  const segmentCount = autoMode
    ? Math.max(1, round + 2)   // filled rounds + 1 upcoming
    : total;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex items-center gap-2"
    >
      {/* Circuit segments */}
      <div className="flex items-center gap-[3px]" aria-hidden="true">
        {complete ? (
          /* Synthesis fired: single full-width solid bar */
          <div
            className="h-[10px] bg-cobalt circuit-close"
            style={{ borderRadius: "1px", width: `${segmentCount * 13 + (segmentCount - 1) * 3}px` }}
          />
        ) : (
          Array.from({ length: segmentCount }).map((_, i) => {
            const filled = round >= 0 && i <= round;
            return (
              <div
                key={i}
                className={`h-[10px] w-[13px] transition-colors duration-200${filled ? " segment-filled" : ""}`}
                style={{
                  backgroundColor: filled ? undefined : "var(--col-rule)",
                  borderRadius: "1px",
                }}
              />
            );
          })
        )}
      </div>

      {/* Round label */}
      <span
        className="text-[0.6875rem] font-mono text-muted"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        {label}
      </span>
    </div>
  );
}
