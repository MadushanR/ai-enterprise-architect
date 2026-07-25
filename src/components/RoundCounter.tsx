"use client";

/**
 * components/RoundCounter.tsx
 * The signature war-room element: a segmented circuit strip showing debate round progress.
 * DESIGN.md §6: three rectangle segments, cobalt fill for active, rule for inactive.
 * Accessibility: role="status", aria-live="polite" (DESIGN.md §10).
 * prefers-reduced-motion: snap state, no closing animation (DESIGN.md §6, §10).
 */

const TOTAL_ROUNDS = 3;

interface RoundCounterProps {
  /** 0-based current round index. -1 = not started. */
  round: number;
  /** True when synthesis has fired (all segments close into a solid bar). */
  complete?: boolean;
}

export default function RoundCounter({ round, complete = false }: RoundCounterProps) {
  const label =
    complete
      ? "Synthesis complete"
      : round < 0
      ? "Debate not started"
      : `Round ${round + 1} of ${TOTAL_ROUNDS}`;

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
            className="h-[10px] w-[43px] bg-cobalt circuit-close"
            style={{ borderRadius: "1px" }}
          />
        ) : (
          Array.from({ length: TOTAL_ROUNDS }).map((_, i) => {
            const filled = round >= 0 && i <= round;
            return (
              <div
                key={i}
                className="h-[10px] w-[13px] transition-colors duration-200"
                style={{
                  backgroundColor: filled
                    ? "var(--col-cobalt)"
                    : "var(--col-rule)",
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
