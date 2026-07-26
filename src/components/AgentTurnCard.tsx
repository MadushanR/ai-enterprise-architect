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
  /** Conversation side — left bubbles have left accent border, right bubbles are right-aligned with right accent. */
  align?: "left" | "right";
}

const AGENT_LABELS: Record<string, string> = {
  sa: "SA",
  sre: "SRE",
  finops: "FINOPS",
  security: "SEC",
};

const AGENT_FULL_NAMES: Record<string, string> = {
  sa: "Solutions Architect",
  sre: "Site Reliability",
  finops: "FinOps",
  security: "Security",
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
 * Returns null when neither signal is found — the caller should then fall back to
 * the objections array rather than assuming approved.
 */
function extractGuardianVerdict(text: string): { verdict: "YES" | "NO"; reason: string } | null {
  const objMatch = text.match(/OBJECTION:\s*(.+)$/m);
  if (objMatch) {
    return { verdict: "NO", reason: objMatch[1].trim() };
  }
  const noObjMatch = text.match(/NO OBJECTION/im);
  if (noObjMatch) {
    return { verdict: "YES", reason: "Compliant — no violations found." };
  }
  // Neither signal found — return null so the caller uses the objections array.
  return null;
}

export default function AgentTurnCard({
  agent,
  round,
  text,
  status,
  objections = [],
  isGuardian = false,
  align = "left",
}: AgentTurnCardProps) {
  const label = AGENT_LABELS[agent] ?? agent.toUpperCase();
  const fullName = AGENT_FULL_NAMES[agent] ?? agent;
  const color = AGENT_COLORS[agent] ?? "var(--col-cobalt)";

  const agentObjection = objections.find((o) => o.agent === agent);
  const hasObjection = !!agentObjection;

  // Guardian-specific verdict derived from the turn text.
  // extractGuardianVerdict returns null when the text contains neither signal,
  // so we then fall back to the objections array (hasObjection → NO, else null = no badge).
  const guardianVerdict = isGuardian ? extractGuardianVerdict(text) : null;
  const effectiveVerdict =
    guardianVerdict ??
    (isGuardian && hasObjection
      ? { verdict: "NO" as const, reason: agentObjection!.reason }
      : null);

  const isRight = align === "right";

  return (
    <article
      aria-label={`${label} agent turn, round ${round + 1}`}
      className={`agent-turn-card${status === "streaming" ? " agent-turn-card--streaming" : ""}`}
      style={{
        ["--agent-color" as string]: color,
        marginLeft: isRight ? "8%" : "0",
        marginRight: isRight ? "0" : "8%",
        animationDelay: `${Math.random() * 0.1}s`,
      }}
    >
      {/* ── Card header: avatar + name + meta ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        {/* Agent avatar */}
        <div
          className="agent-avatar"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 18%, var(--col-surface-raised))`,
            border: `1.5px solid ${color}`,
            color: color,
          }}
          aria-hidden="true"
        >
          {label.slice(0, 2)}
        </div>

        {/* Name + round info */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: isRight ? "flex-end" : "flex-start",
            gap: "1px",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontFamily: "var(--font-plex-condensed)",
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: color,
              }}
            >
              {fullName}
            </span>

            {/* Streaming indicator */}
            {status === "streaming" && (
              <span className="agent-typing-dots" aria-label="typing">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>

          <span
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.625rem",
              color: "var(--col-muted)",
              letterSpacing: "0.04em",
            }}
          >
            Round {round + 1}
          </span>
        </div>

        {/* Status badges */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {/* Guardian verdict pill */}
          {isGuardian && status !== "streaming" && effectiveVerdict && (
            <span
              className="agent-verdict-pill"
              style={{
                backgroundColor:
                  effectiveVerdict.verdict === "YES"
                    ? "rgba(106, 176, 76, 0.12)"
                    : "rgba(235, 77, 75, 0.12)",
                color:
                  effectiveVerdict.verdict === "YES"
                    ? "var(--col-chaos-normal)"
                    : "var(--col-chaos-failure)",
                borderColor:
                  effectiveVerdict.verdict === "YES"
                    ? "rgba(106, 176, 76, 0.3)"
                    : "rgba(235, 77, 75, 0.3)",
              }}
              aria-label={`Security verdict: ${effectiveVerdict.verdict}`}
            >
              {effectiveVerdict.verdict === "YES" ? "✓ Approved" : "✗ Rejected"}
            </span>
          )}

          {/* Debater objection pill */}
          {!isGuardian && hasObjection && (
            <span
              className="agent-verdict-pill"
              style={{
                backgroundColor: "rgba(235, 77, 75, 0.12)",
                color: "var(--col-chaos-failure)",
                borderColor: "rgba(235, 77, 75, 0.3)",
              }}
            >
              ⚡ Objection
            </span>
          )}
          {!isGuardian && status === "no-objection" && (
            <span
              className="agent-verdict-pill"
              style={{
                backgroundColor: "rgba(106, 176, 76, 0.12)",
                color: "var(--col-chaos-normal)",
                borderColor: "rgba(106, 176, 76, 0.3)",
              }}
            >
              ✓ No objection
            </span>
          )}
        </div>
      </div>

      {/* ── Accent divider ── */}
      <div
        style={{
          height: "1px",
          margin: "8px 0 6px",
          background: `linear-gradient(${isRight ? "to left" : "to right"}, ${color}, transparent 80%)`,
          opacity: 0.3,
        }}
        aria-hidden="true"
      />

      {/* ── Turn text ── */}
      <p
        className="agent-turn-text"
        style={{
          fontFamily: "var(--font-geist-mono)",
          color: "var(--col-ink)",
        }}
      >
        {text || <span style={{ color: "var(--col-muted)" }}>…</span>}
      </p>

      {/* ── Guardian verdict reason banner ── */}
      {isGuardian && status !== "streaming" && effectiveVerdict && effectiveVerdict.reason && (
        <div
          className="agent-callout"
          style={{
            backgroundColor:
              effectiveVerdict.verdict === "YES"
                ? "rgba(106, 176, 76, 0.06)"
                : "rgba(192, 57, 43, 0.08)",
            borderLeftColor:
              effectiveVerdict.verdict === "YES"
                ? "var(--col-chaos-normal)"
                : "var(--col-chaos-failure)",
            color:
              effectiveVerdict.verdict === "YES"
                ? "var(--col-chaos-normal)"
                : "var(--col-chaos-failure)",
          }}
          role="note"
          aria-label={`${label} verdict reason: ${effectiveVerdict.reason}`}
        >
          <span style={{ opacity: 0.6, fontWeight: 600 }}>
            {effectiveVerdict.verdict === "YES" ? "Reason " : "Violation "}
          </span>
          {effectiveVerdict.reason}
        </div>
      )}

      {/* ── Non-guardian objection reason callout ── */}
      {!isGuardian && hasObjection && agentObjection && (
        <div
          className="agent-callout"
          style={{
            backgroundColor: "rgba(192, 57, 43, 0.08)",
            borderLeftColor: "var(--col-chaos-failure)",
            color: "var(--col-chaos-failure)",
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
