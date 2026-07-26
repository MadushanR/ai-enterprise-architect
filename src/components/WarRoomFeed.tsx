"use client";

/**
 * components/WarRoomFeed.tsx
 * Connects to /api/debate via SSE, renders AgentTurnCard list as tokens arrive.
 * Emits round/synthesis/complete events to parent via callbacks.
 */

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import AgentTurnCard, { type TurnStatus } from "@/src/components/AgentTurnCard";
import type { Objection, TranscriptEntry } from "@/backend/lib/debate/state";
interface TurnDisplay {
  agent: TranscriptEntry["agent"];
  round: number;
  text: string;
  status: TurnStatus;
  objections: Objection[];
}

interface DebateStateSnapshot {
  proposal: string;
  transcript: TranscriptEntry[];
  objections: Objection[];
}

interface WarRoomFeedProps {
  /** The initial proposal to debate — feed is triggered when this is set. */
  proposal: string | null;
  /** Subset of persona IDs to include; if undefined all enabled personas run. */
  agents?: string[];
  /** Subset of persona IDs to run after synthesis. */
  postSynthesisAgents?: string[];
  /** Max rounds cap (1–3). */
  maxRounds?: number;
  /** IDs of personas with role_type:guardian — used to show YES/NO verdict UI. */
  guardianIds?: string[];
  /** If set, only turns from this agent are shown (synthesis always shown). */
  filterAgent?: string;
  /** Called each time a round index is known. */
  onRoundChange?: (round: number) => void;
  /** Called when synthesis text arrives. */
  onSynthesis?: (text: string) => void;
  /** Called when the stream closes (success or error). */
  onComplete?: () => void;
  /** Called once when the debate finishes — passes the final proposal, transcript, and objections. */
  onDebateState?: (state: DebateStateSnapshot) => void;
}

export interface WarRoomFeedHandle {
  stop: () => void;
}

type SSEEvent =
  | { type: "turn"; agent: TranscriptEntry["agent"]; round: number; text: string; objections: Objection[] }
  | { type: "synthesis"; text: string; unresolvedObjections: Objection[]; rounds: number }
  | { type: "error"; message: string };

const WarRoomFeed = forwardRef<WarRoomFeedHandle, WarRoomFeedProps>(function WarRoomFeed(
  {
    proposal,
    agents,
    postSynthesisAgents,
    maxRounds,
    guardianIds = [],
    filterAgent,
    onRoundChange,
    onSynthesis,
    onComplete,
    onDebateState,
  }: WarRoomFeedProps,
  ref
) {
  const [turns, setTurns] = useState<TurnDisplay[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [activePage, setActivePage] = useState<number>(1);
  const abortRef = useRef<AbortController | null>(null);

  useImperativeHandle(ref, () => ({
    stop: () => {
      abortRef.current?.abort();
    },
  }));

  const bottomRef = useRef<HTMLDivElement>(null);
  // Accumulate transcript + last proposal + objections in refs so we can pass
  // them to onDebateState once without triggering re-renders
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const proposalRef = useRef<string>("");
  const objectionsRef = useRef<Objection[]>([]);
  // Track the last proposal we actually started a debate for so that unstable
  // callback references (e.g. a new guardianIds array on each parent render)
  // don't re-fire the effect and create an infinite debate loop.
  const lastStartedProposalRef = useRef<string | null>(null);

  // Auto-scroll to bottom on new turns
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, synthesis, activePage]);

  // Track the highest page (1-indexed) seen so far. t.round is 0-indexed.
  const highestPage = turns.length > 0 ? Math.max(...turns.map((t) => t.round)) + 1 : 1;

  // Track the previous highest page to only auto-advance when a new round starts
  const prevHighestPageRef = useRef(highestPage);

  // Auto-advance activePage when a new round starts
  useEffect(() => {
    if (highestPage > prevHighestPageRef.current) {
      setActivePage(highestPage);
      prevHighestPageRef.current = highestPage;
    }
  }, [highestPage]);

  const startDebate = useCallback(
    async (prop: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setTurns([]);
      setSynthesis(null);
      setFeedError(null);
      setRunning(true);
      setActivePage(1);
      transcriptRef.current = [];
      proposalRef.current = prop;
      objectionsRef.current = [];

      try {
        const res = await fetch("/api/debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposal: prop,
            ...(agents && agents.length > 0 ? { agents } : {}),
            ...(postSynthesisAgents && postSynthesisAgents.length > 0 ? { postSynthesisAgents } : {}),
            ...(maxRounds !== undefined ? { maxRounds } : {}),
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const chunk of lines) {
            if (!chunk.startsWith("data: ")) continue;
            const raw = chunk.slice(6).trim();
            if (!raw) continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(raw) as SSEEvent;
            } catch {
              continue;
            }

            if (event.type === "turn") {
              onRoundChange?.(event.round);
              // Accumulate transcript entry
              const entry: TranscriptEntry = {
                agent: event.agent,
                turn: event.text,
                round: event.round,
              };
              transcriptRef.current = [...transcriptRef.current, entry];
              objectionsRef.current = event.objections;
              setTurns((prev) => {
                // Check if this agent already has a card for this round
                const existing = prev.findIndex(
                  (t) => t.agent === event.agent && t.round === event.round
                );
                const hasObjection = event.objections.some(
                  (o) => o.agent === event.agent
                );
                const status: TurnStatus = hasObjection
                  ? "objection"
                  : "no-objection";
                const card: TurnDisplay = {
                  agent: event.agent,
                  round: event.round,
                  text: event.text,
                  status,
                  objections: event.objections,
                };
                if (existing >= 0) {
                  const next = [...prev];
                  next[existing] = card;
                  return next;
                }
                return [...prev, card];
              });
            } else if (event.type === "synthesis") {
              setSynthesis(event.text);
              onSynthesis?.(event.text);
            } else if (event.type === "error") {
              setFeedError(event.message);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setFeedError(err instanceof Error ? err.message : "Stream error");
        }
      } finally {
        setRunning(false);
        onComplete?.();
        // Pass final debate state to parent for diagram/deck generation
        onDebateState?.({
          proposal: proposalRef.current,
          transcript: transcriptRef.current,
          objections: objectionsRef.current,
        });
      }
    },
    [onRoundChange, onSynthesis, onComplete, onDebateState, agents, postSynthesisAgents, maxRounds, guardianIds]
  );

  // Trigger debate only when the proposal string itself changes.
  // We intentionally exclude `startDebate` from the deps: the function is
  // recreated whenever a parent prop (e.g. guardianIds inline array) gets a
  // new reference on each render, which would otherwise cause an infinite loop.
  useEffect(() => {
    if (proposal && proposal !== lastStartedProposalRef.current) {
      lastStartedProposalRef.current = proposal;
      void startDebate(proposal);
    }
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  if (!proposal && turns.length === 0) {
    return (
      <div className="warroom-empty-state">
        {/* Animated grid background */}
        <div className="warroom-empty-grid" aria-hidden="true" />

        {/* Icon */}
        <div className="warroom-empty-icon" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        {/* Title */}
        <span
          style={{
            fontFamily: "var(--font-plex-condensed)",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--col-ink)",
            opacity: 0.5,
          }}
        >
          War Room
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.75rem",
            color: "var(--col-muted)",
            maxWidth: "280px",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Submit an idea to assemble the board and start the debate
        </span>
      </div>
    );
  }

  const visibleTurns = filterAgent && filterAgent !== "all"
    ? turns.filter((t) => t.agent === filterAgent)
    : turns;

  // t.round is 0-indexed, activePage is 1-indexed
  const pageTurns = visibleTurns.filter((t) => t.round + 1 === activePage);

  // Build a stable agent-order map: first time an agent appears gets an index.
  // Even index → left, odd index → right — gives the alternating chat layout.
  const agentSideMap = new Map<string, "left" | "right">();
  for (const t of turns) {
    if (!agentSideMap.has(t.agent)) {
      agentSideMap.set(t.agent, agentSideMap.size % 2 === 0 ? "left" : "right");
    }
  }

  // Create an array of available rounds for pagination based on the actual rounds reached
  const availableRounds = Array.from({ length: highestPage }, (_, i) => i + 1);

  return (
    <div className="warroom-feed">
      {/* Agent turn cards */}
      {pageTurns.map((t, i) => (
        <AgentTurnCard
          key={`${t.agent}-${t.round}-${i}`}
          agent={t.agent}
          round={t.round}
          text={t.text}
          status={running && t.round + 1 === highestPage && i === pageTurns.length - 1 ? "streaming" : t.status}
          objections={t.objections}
          isGuardian={guardianIds.includes(t.agent)}
          align={agentSideMap.get(t.agent) ?? "left"}
        />
      ))}

      {/* Loading state when debate is running and no turns yet */}
      {running && pageTurns.length === 0 && activePage === highestPage && (
        <div className="warroom-debate-starting">
          <div className="warroom-debate-starting-pulse" />
          <span>Assembling the board…</span>
        </div>
      )}

      {/* Synthesis card - only show on the last page */}
      {synthesis && activePage === highestPage && (
        <section
           aria-labelledby="synthesis-heading"
           className="warroom-synthesis-card"
        >
          <div className="warroom-synthesis-header">
            <div className="warroom-synthesis-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <h3
              id="synthesis-heading"
              className="warroom-synthesis-title"
            >
              Board Synthesis
            </h3>
          </div>
          <p
            className="agent-turn-text"
            style={{
              fontFamily: "var(--font-geist-mono)",
              color: "var(--col-ink)",
            }}
          >
            {synthesis}
          </p>
        </section>
      )}

      {/* Error state */}
      {feedError && (
        <div className="warroom-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>Debate error: {feedError}</span>
        </div>
      )}

      <div ref={bottomRef} aria-hidden="true" />

      {/* Pagination controls at the bottom */}
      {availableRounds.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6 mb-4">
          {availableRounds.map((r) => (
            <button
              key={r}
              onClick={() => setActivePage(r)}
              className={`flex items-center justify-center w-8 h-8 rounded-full border text-[0.8125rem] transition-colors ${
                r === activePage
                  ? "bg-[var(--col-cobalt)] text-[var(--col-base)] border-[var(--col-cobalt)]"
                  : "bg-[var(--col-surface)] text-[var(--col-ink)] border-[var(--col-rule)] hover:border-[var(--col-cobalt)]"
              }`}
              style={{ fontFamily: "var(--font-geist-mono)" }}
              aria-label={`Go to round ${r}`}
              aria-current={r === activePage ? "page" : undefined}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default WarRoomFeed;
