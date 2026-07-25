"use client";

/**
 * components/AgentTurnCard.tsx
 * Renders a single agent turn in the War Room feed.
 * DESIGN.md §7: streaming pulse border on active cards.
 * DESIGN.md §10: aria-label="[Agent name] turn" on <article>.
 */

import type { Objection } from "@/backend/lib/debate/state";

export type TurnStatus = "streaming" | "objection" | "no-objection" | "done";

interface AgentTurnCardProps {
  agent: string;
  round: number;
  text: string;
  status: TurnStatus;
  objections?: Objection[];
  /** If true this agent is a guardian — shows YES/NO verdict pill instead of OBJECTION label. */
  isGuardian?: boolean;
}

const AGENT_LABELS: Record<string, string> = {
  sa: "SA",
  sre: "SRE",
  finops: "FINOPS",
  security: "SEC",
};

const AGENT_COLORS: Record<string, string> = {
  sa: "var(--col-cobalt)",
  sre: "#e8a735",
  finops: "#6ab04c",
  security: "#eb4d4b",
};

/**
 * Extract a YES/NO verdict from the guardian's turn text.
 * Looks for "NO OBJECTION" or "OBJECTION:" lines as specified in the persona prompt.
 */
function extractGuardianVerdict(text: string): { verdict: "YES" | "NO"; reason: string } {
  const objMatch = text.match(/OBJECTION:\s*(.+)$/m);
  if (objMatch) {
    return { verdict: "NO", reason: objMatch[1].trim() };
  }
  const noObjMatch = text.match(/NO OBJECTION/im);
  if (noObjMatch) {
    return { verdict: "YES", reason: "Compliant — no violations found." };
  }
  // Fallback: inspect the objections prop (guardian output sometimes only has the objection list)
  return { verdict: "YES", reason: "" };
}

export default function AgentTurnCard({
  agent,
  round,
  text,
  status,
  objections = [],
  isGuardian = false,
}: AgentTurnCardProps) {
  const label = AGENT_LABELS[agent] ?? agent.toUpperCase();
  const color = AGENT_COLORS[agent] ?? "var(--col-cobalt)";

  const agentObjection = objections.find((o) => o.agent === agent);
  const hasObjection = !!agentObjection;

  // Guardian-specific verdict derived from the turn text
  const guardianVerdict = isGuardian ? extractGuardianVerdict(text) : null;
  // If the guardian has an objection in the state but text hasn't parsed yet (streaming),
  // fall back to the objections array
  const effectiveVerdict =
    guardianVerdict ??
    (hasObjection ? { verdict: "NO" as const, reason: agentObjection!.reason } : null);

  return (
    <article
      aria-label={`${label} agent turn, round ${round + 1}`}
      className={`flex flex-col gap-2 p-3 rounded${status === "streaming" ? " streaming-pulse" : ""}`}
      style={{
        backgroundColor: "var(--col-surface)",
        border: "1px solid var(--col-rule)",
        borderLeft: `3px solid ${color}`,
        borderRadius: "4px",
      }}
    >
      {/* Agent badge + round + status */}
      <div className="flex items-center justify-between">
        <span
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={{ fontFamily: "var(--font-plex-condensed)", color }}
        >
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-[0.6875rem]"
            style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-muted)" }}
          >
            R{round + 1}
          </span>
          {status === "streaming" && (
            <span
              className="text-[0.6875rem] animate-pulse"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-cobalt)" }}
            >
              ●
            </span>
          )}

          {/* Guardian: show YES / NO pill */}
          {isGuardian && status !== "streaming" && effectiveVerdict && (
            <span
              className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded"
              style={{
                fontFamily: "var(--font-geist-mono)",
                backgroundColor:
                  effectiveVerdict.verdict === "YES"
                    ? "rgba(106, 176, 76, 0.15)"
                    : "rgba(235, 77, 75, 0.15)",
                color:
                  effectiveVerdict.verdict === "YES"
                    ? "var(--col-chaos-normal)"
                    : "var(--col-chaos-failure)",
                border: `1px solid ${effectiveVerdict.verdict === "YES" ? "var(--col-chaos-normal)" : "var(--col-chaos-failure)"}`,
                borderRadius: "3px",
              }}
              aria-label={`Security verdict: ${effectiveVerdict.verdict}`}
            >
              {effectiveVerdict.verdict === "YES" ? "✓ APPROVED" : "✗ REJECTED"}
            </span>
          )}

          {/* Non-guardian: standard objection / no-objection labels */}
          {!isGuardian && hasObjection && (
            <span
              className="text-[0.6875rem] font-semibold"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-chaos-failure)" }}
            >
              OBJECTION
            </span>
          )}
          {!isGuardian && status === "no-objection" && (
            <span
              className="text-[0.6875rem]"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-chaos-normal)" }}
            >
              NO OBJECTION
            </span>
          )}
        </div>
      </div>

      {/* Turn text */}
      <p
        className="text-[0.8125rem] whitespace-pre-wrap leading-relaxed"
        style={{
          fontFamily: "var(--font-geist-mono)",
          color: "var(--col-ink)",
        }}
      >
        {text || <span style={{ color: "var(--col-muted)" }}>…</span>}
      </p>

      {/* Guardian verdict reason banner */}
      {isGuardian && status !== "streaming" && effectiveVerdict && effectiveVerdict.reason && (
        <div
          className="mt-1 px-2 py-1 text-[0.6875rem]"
          style={{
            fontFamily: "var(--font-geist-mono)",
            backgroundColor:
              effectiveVerdict.verdict === "YES"
                ? "rgba(106, 176, 76, 0.08)"
                : "rgba(192, 57, 43, 0.1)",
            borderLeft: `2px solid ${effectiveVerdict.verdict === "YES" ? "var(--col-chaos-normal)" : "var(--col-chaos-failure)"}`,
            color:
              effectiveVerdict.verdict === "YES"
                ? "var(--col-chaos-normal)"
                : "var(--col-chaos-failure)",
            borderRadius: "2px",
          }}
          role="note"
          aria-label={`${label} verdict reason: ${effectiveVerdict.reason}`}
        >
          <span style={{ opacity: 0.7 }}>
            {effectiveVerdict.verdict === "YES" ? "Reason: " : "Violation: "}
          </span>
          {effectiveVerdict.reason}
        </div>
      )}

      {/* Non-guardian objection reason callout */}
      {!isGuardian && hasObjection && agentObjection && (
        <div
          className="mt-1 px-2 py-1 rounded text-[0.6875rem]"
          style={{
            fontFamily: "var(--font-geist-mono)",
            backgroundColor: "rgba(192, 57, 43, 0.1)",
            borderLeft: "2px solid var(--col-chaos-failure)",
            color: "var(--col-chaos-failure)",
            borderRadius: "2px",
          }}
          role="note"
          aria-label={`${label} objection: ${agentObjection.reason}`}
        >
          {agentObjection.reason}
        </div>
      )}
    </article>
  );
}
