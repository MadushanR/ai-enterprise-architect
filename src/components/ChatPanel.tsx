"use client";

/**
 * components/ChatPanel.tsx
 * Post-debate "Ask the board" panel.
 * Routes each follow-up question to the specific persona(s) from the debate
 * transcript who are most relevant, and streams attributed in-character responses.
 *
 * Uses /api/ask-board (two-step routing + per-persona response) instead of the
 * generic /api/chat endpoint. Each assistant message is attributed with a persona
 * badge (name + accent color dot).
 */

import { useRef, useState, useEffect, useCallback } from "react";
import type { TranscriptEntry, Objection } from "@/backend/lib/debate/state";

// PersonaSummary is the public shape returned by /api/personas
export interface PersonaSummary {
  id: string;
  name: string;
  role_type: "debater" | "guardian";
  model: string;
  enabled: boolean;
  turn_order: number;
  accent_color: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** True while streaming. */
  streaming?: boolean;
  /** Persona ID for attributed assistant messages. */
  agent?: string;
  /** Display name for the badge label. */
  agentName?: string;
  /** Hex accent color for the badge dot. */
  accentColor?: string | null;
}

interface ChatPanelProps {
  synthesis: string;
  transcript: TranscriptEntry[];
  objections: Objection[];
  /** Loaded personas — used to resolve accent colors for the "board" fallback. */
  personas: PersonaSummary[];
}

export default function ChatPanel({
  synthesis,
  transcript,
  objections,
  personas,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Build a quick lookup from persona ID → accent_color
  const personaColorMap = Object.fromEntries(
    personas.map((p) => [p.id, p.accent_color])
  );

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setError(null);
      setInput("");
      setLoading(true);

      // History to send: all completed messages (no streaming ones)
      const historyToSend = messages
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.role, content: m.content }));

      // Append user message — no assistant placeholder yet (personas arrive via persona-start)
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
      ]);

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const res = await fetch("/api/ask-board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            synthesis,
            transcript,
            objections,
            history: historyToSend,
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
            const raw = chunk.slice(6).trim();
            if (!raw) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (event.type === "persona-start") {
              const agent = event.agent as string;
              const agentName = (event.name as string | undefined) ?? agent.toUpperCase();
              const accentColor =
                (event.accentColor as string | null | undefined) ??
                personaColorMap[agent] ??
                null;

              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "",
                  streaming: true,
                  agent,
                  agentName,
                  accentColor,
                },
              ]);
            } else if (event.type === "chunk") {
              const agent = event.agent as string;
              setMessages((prev) => {
                // Find the last streaming assistant message for this agent
                const idx = [...prev].reverse().findIndex(
                  (m) => m.role === "assistant" && m.agent === agent && m.streaming
                );
                if (idx < 0) return prev;
                const realIdx = prev.length - 1 - idx;
                const next = [...prev];
                next[realIdx] = {
                  ...next[realIdx],
                  content: next[realIdx].content + (event.text as string),
                };
                return next;
              });
            } else if (event.type === "persona-done") {
              const agent = event.agent as string;
              setMessages((prev) => {
                const idx = [...prev].reverse().findIndex(
                  (m) => m.role === "assistant" && m.agent === agent && m.streaming
                );
                if (idx < 0) return prev;
                const realIdx = prev.length - 1 - idx;
                const next = [...prev];
                next[realIdx] = { ...next[realIdx], streaming: false };
                return next;
              });
            } else if (event.type === "done") {
              // All personas have responded; nothing extra to do
              break outer;
            } else if (event.type === "error") {
              setError(event.message as string);
              // Remove any empty streaming placeholders
              setMessages((prev) => prev.filter((m) => !(m.streaming && !m.content)));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Stream error");
          setMessages((prev) => prev.filter((m) => !(m.streaming && !m.content)));
        }
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [loading, messages, synthesis, transcript, objections, personaColorMap]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const hasUnresolved = objections.length > 0;

  return (
    <section
      aria-labelledby="chat-heading"
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--col-rule)",
        backgroundColor: "var(--col-base)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 24px 8px",
          borderBottom: "1px solid var(--col-rule)",
          backgroundColor: "var(--col-surface)",
        }}
      >
        <h2
          id="chat-heading"
          style={{
            fontFamily: "var(--font-plex-condensed)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--col-muted)",
            margin: 0,
          }}
        >
          Ask the Board
        </h2>
        {hasUnresolved && (
          <span
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.625rem",
              fontWeight: 600,
              padding: "1px 6px",
              backgroundColor: "rgba(192, 57, 43, 0.1)",
              color: "var(--col-chaos-failure)",
              border: "1px solid var(--col-chaos-failure)",
              borderRadius: "3px",
            }}
            title={objections.map((o) => `[${o.agent.toUpperCase()}]: ${o.reason}`).join("\n")}
            aria-label={`${objections.length} unresolved objection${objections.length > 1 ? "s" : ""}`}
          >
            {objections.length} unresolved
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.625rem",
            color: "var(--col-muted)",
            marginLeft: "auto",
          }}
        >
          ↵ send · shift+↵ newline
        </span>
      </div>

      {/* Message list */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: "220px",
          maxHeight: "420px",
          overflowY: "auto",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <p
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.8125rem",
              color: "var(--col-muted)",
              textAlign: "center",
              marginTop: "32px",
            }}
          >
            {hasUnresolved
              ? `Ask the board to resolve ${objections.length} unresolved objection${objections.length > 1 ? "s" : ""}, or ask why any decision was made.`
              : "Ask the board why any decision was made — board members respond in character from the debate."}
          </p>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {/* Badge label */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontFamily: "var(--font-plex-condensed)",
                fontSize: "0.625rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: msg.role === "user" ? "var(--col-cobalt)" : "var(--col-muted)",
              }}
            >
              {/* Accent color dot for attributed persona messages */}
              {msg.role === "assistant" && msg.accentColor && (
                <span
                  style={{
                    display: "inline-block",
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: msg.accentColor,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
              )}
              {msg.role === "user" ? "You" : (msg.agentName ?? "Board")}
            </span>

            {/* Message bubble */}
            <div
              style={{
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor:
                  msg.role === "user" ? "rgba(52, 120, 246, 0.10)" : "var(--col-surface)",
                border:
                  msg.role === "user"
                    ? "1px solid rgba(52, 120, 246, 0.25)"
                    : "1px solid var(--col-rule)",
                borderLeft:
                  msg.role === "assistant"
                    ? `3px solid ${msg.accentColor ?? "var(--col-cobalt)"}`
                    : undefined,
                fontFamily: "var(--font-geist-mono)",
                fontSize: "0.8125rem",
                color: "var(--col-ink)",
                lineHeight: "1.6",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              aria-label={
                msg.role === "user"
                  ? "Your message"
                  : `${msg.agentName ?? "Board"} response`
              }
            >
              {msg.content || (msg.streaming ? (
                <span style={{ color: msg.accentColor ?? "var(--col-cobalt)" }} className="animate-pulse">
                  ●
                </span>
              ) : null)}
            </div>
          </div>
        ))}

        {error && (
          <p
            role="alert"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.75rem",
              color: "var(--col-chaos-failure)",
            }}
          >
            Error: {error}
          </p>
        )}

        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* Input area */}
      <div
        style={{
          padding: "8px 24px 16px",
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
          borderTop: "1px solid var(--col-rule)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          rows={2}
          placeholder={
            hasUnresolved
              ? `Ask about the ${objections.length} unresolved objection${objections.length > 1 ? "s" : ""}, or ask why any decision was made…`
              : `Ask the board why any decision was made — e.g. "why not Kafka?"`
          }
          style={{
            flex: 1,
            resize: "none",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.8125rem",
            padding: "8px 10px",
            backgroundColor: "var(--col-surface)",
            color: "var(--col-ink)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            outline: "none",
            lineHeight: "1.5",
          }}
          aria-label="Chat message input"
        />
        <button
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || loading}
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.8125rem",
            padding: "8px 16px",
            backgroundColor:
              !input.trim() || loading ? "var(--col-rule)" : "var(--col-cobalt)",
            color: !input.trim() || loading ? "var(--col-muted)" : "var(--col-ink)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            cursor: !input.trim() || loading ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            alignSelf: "stretch",
          }}
          aria-label="Send message"
          aria-busy={loading}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </section>
  );
}
