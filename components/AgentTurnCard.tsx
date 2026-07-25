"use client";

/**
 * components/AgentTurnCard.tsx
 * Renders a single agent turn in the War Room feed.
 * DESIGN.md §7: streaming pulse border on active cards.
 * DESIGN.md §10: aria-label="[Agent name] turn" on <article>.
 */

import type { Objection } from "@/lib/debate/state";

export type TurnStatus = "streaming" | "objection" | "no-objection" | "done";

interface AgentTurnCardProps {
  agent: string;
  round: number;
  text: string;
  status: TurnStatus;
  objections?: Objection[];
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

export default function AgentTurnCard({
  agent,
  round,
  text,
  status,
  objections = [],
}: AgentTurnCardProps) {
  const label = AGENT_LABELS[agent] ?? agent.toUpperCase();
  const color = AGENT_COLORS[agent] ?? "var(--col-cobalt)";

  const agentObjection = objections.find((o) => o.agent === agent);
  const hasObjection = !!agentObjection;

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
          {hasObjection && (
            <span
              className="text-[0.6875rem] font-semibold"
              style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-chaos-failure)" }}
            >
              OBJECTION
            </span>
          )}
          {status === "no-objection" && (
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

      {/* Objection reason callout */}
      {hasObjection && agentObjection && (
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
