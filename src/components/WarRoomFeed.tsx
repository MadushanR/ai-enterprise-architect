"use client";

/**
 * components/WarRoomFeed.tsx
 * Connects to /api/debate via SSE, renders AgentTurnCard list as tokens arrive.
 * Emits round/synthesis/complete events to parent via callbacks.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import AgentTurnCard, { type TurnStatus } from "@/src/components/AgentTurnCard";
import type { Objection, TranscriptEntry } from "@/backend/lib/debate/state";

interface TurnDisplay {
  agent: TranscriptEntry["agent"];
  round: number;
  text: string;
  status: TurnStatus;
  objections: Objection[];
}

interface WarRoomFeedProps {
  /** The initial proposal to debate — feed is triggered when this is set. */
  proposal: string | null;
  /** Called each time a round index is known. */
  onRoundChange?: (round: number) => void;
  /** Called when synthesis text arrives. */
  onSynthesis?: (text: string) => void;
  /** Called when the stream closes (success or error). */
  onComplete?: () => void;
}

type SSEEvent =
  | { type: "turn"; agent: TranscriptEntry["agent"]; round: number; text: string; objections: Objection[] }
  | { type: "synthesis"; text: string; unresolvedObjections: Objection[]; rounds: number }
  | { type: "error"; message: string };

export default function WarRoomFeed({
  proposal,
  onRoundChange,
  onSynthesis,
  onComplete,
}: WarRoomFeedProps) {
  const [turns, setTurns] = useState<TurnDisplay[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new turns
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, synthesis]);

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

      try {
        const res = await fetch("/api/debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposal: prop }),
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
      }
    },
    [onRoundChange, onSynthesis, onComplete]
  );

  // Trigger debate when proposal changes
  useEffect(() => {
    if (proposal) {
      void startDebate(proposal);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [proposal, startDebate]);

  if (!proposal && turns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span
          className="text-sm"
          style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-muted)" }}
        >
          Submit an idea to start the debate
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Agent turn cards */}
      {turns.map((t, i) => (
        <AgentTurnCard
          key={`${t.agent}-${t.round}-${i}`}
          agent={t.agent}
          round={t.round}
          text={t.text}
          status={running && i === turns.length - 1 ? "streaming" : t.status}
          objections={t.objections}
        />
      ))}

      {/* Loading state when debate is running and no turns yet */}
      {running && turns.length === 0 && (
        <div
          className="text-sm animate-pulse"
          style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-cobalt)" }}
        >
          Debate starting…
        </div>
      )}

      {/* Synthesis card */}
      {synthesis && (
        <section
          aria-labelledby="synthesis-heading"
          className="mt-2 p-4 rounded"
          style={{
            backgroundColor: "var(--col-surface)",
            border: "1px solid var(--col-rule)",
            borderLeft: "3px solid var(--col-cobalt)",
            borderRadius: "4px",
          }}
        >
          <h3
            id="synthesis-heading"
            className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2"
            style={{ fontFamily: "var(--font-plex-condensed)", color: "var(--col-cobalt)" }}
          >
            Synthesis
          </h3>
          <p
            className="text-[0.8125rem] whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: "var(--font-geist-mono)", color: "var(--col-ink)" }}
          >
            {synthesis}
          </p>
        </section>
      )}

      {/* Error state */}
      {feedError && (
        <p
          className="text-xs"
          style={{ color: "var(--col-chaos-failure)", fontFamily: "var(--font-geist-mono)" }}
          role="alert"
        >
          Debate error: {feedError}
        </p>
      )}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
