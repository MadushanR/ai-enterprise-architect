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
  runs_after_synthesis?: boolean;
}

export interface ChatMessage {
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
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

export default function ChatPanel({
  synthesis,
  transcript,
  objections,
  personas,
  onMessagesChange,
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
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

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
      className="chat-panel"
    >
      {/* ── Header ── */}
      <div className="chat-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className="chat-panel-header-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <h2 id="chat-heading" className="chat-panel-title">
            Ask the Board
          </h2>
          {hasUnresolved && (
            <span
              className="agent-verdict-pill"
              style={{
                backgroundColor: "rgba(235, 77, 75, 0.12)",
                color: "var(--col-chaos-failure)",
                borderColor: "rgba(235, 77, 75, 0.3)",
              }}
              title={objections.map((o) => `[${o.agent.toUpperCase()}]: ${o.reason}`).join("\n")}
              aria-label={`${objections.length} unresolved objection${objections.length > 1 ? "s" : ""}`}
            >
              {objections.length} unresolved
            </span>
          )}
        </div>
        <span className="chat-panel-hint">
          ↵ send · shift+↵ newline
        </span>
      </div>

      {/* ── Message list ── */}
      <div
        className="chat-panel-messages"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <div className="chat-panel-empty">
            <div className="chat-panel-empty-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <p>
              {hasUnresolved
                ? `Ask the board to resolve ${objections.length} unresolved objection${objections.length > 1 ? "s" : ""}, or ask why any decision was made.`
                : "Ask the board why any decision was made — board members respond in character from the debate."}
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`chat-bubble chat-bubble--${msg.role}`}
          >
            {/* Badge label */}
            <span className="chat-bubble-label">
              {/* Accent color dot for attributed persona messages */}
              {msg.role === "assistant" && msg.accentColor && (
                <span
                  className="chat-bubble-dot"
                  style={{ backgroundColor: msg.accentColor }}
                  aria-hidden="true"
                />
              )}
              {msg.role === "user" ? "You" : (msg.agentName ?? "Board")}
            </span>

            {/* Message bubble */}
            <div
              className="chat-bubble-content"
              style={{
                borderLeftColor:
                  msg.role === "assistant"
                    ? (msg.accentColor ?? "var(--col-cobalt)")
                    : undefined,
              }}
              aria-label={
                msg.role === "user"
                  ? "Your message"
                  : `${msg.agentName ?? "Board"} response`
              }
            >
              {msg.content || (msg.streaming ? (
                <span className="agent-typing-dots" aria-label="typing">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null)}
            </div>
          </div>
        ))}

        {error && (
          <p className="warroom-error" role="alert" style={{ margin: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>Error: {error}</span>
          </p>
        )}

        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* ── Input area ── */}
      <div className="chat-panel-input-area">
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
          className="chat-panel-textarea"
          aria-label="Chat message input"
        />
        <button
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || loading}
          className="chat-panel-send-btn"
          aria-label="Send message"
          aria-busy={loading}
        >
          {loading ? (
            <span className="agent-typing-dots" aria-label="sending" style={{ gap: "3px" }}>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </section>
  );
}
