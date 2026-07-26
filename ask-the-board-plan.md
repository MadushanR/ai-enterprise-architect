# Ask the Board — Follow-up Feature Plan

## Overview

After the debate resolves and synthesis is shown, the user can ask follow-up questions like
"why didn't we use Kafka?" and get attributed answers — each answer coming from the specific
persona(s) who actually reasoned about that topic during the debate. The persona responds in
character using its own system prompt and its own transcript entries as grounding.

**Approach:** Two-step routing per follow-up message.
1. A **routing step** calls the synthesis model to identify which persona ID(s) from the
   transcript are most relevant to the question.
2. A **response step** calls each matched persona's own model, injecting their own system
   prompt and their specific transcript entries, producing an in-character attributed answer.

Responses stream back as attributed messages (persona badge visible) rather than a generic
"Board" reply.

---

## Sub-Tasks

---

### Sub-Task 1 — New `/api/ask-board` endpoint

**Status:** [x] done

**Intent:**
Create a new POST endpoint that accepts a follow-up question plus the full debate context,
performs a two-step routing + response call, and streams back one or more attributed persona
responses as SSE events.

**Expected Outcomes:**
- `POST /api/ask-board` accepts `{ message, synthesis, transcript, objections, history }`.
- Step 1: calls `meta-llama/llama-3-3-70b-instruct` (synthesis model, once) with the full transcript
  and question to produce a JSON array of the 1–3 most relevant persona IDs.
- Step 2: for each matched persona, loads that persona's config (system prompt + model) via
  `loadPersonas()`, then streams a response using the persona's own model and its own
  transcript entries as context.
- Streams SSE events in this shape:
  - `{ type: "persona-start", agent: "sre", name: "Site Reliability Engineer", accentColor: "#e8a735" }` — before each persona response begins
  - `{ type: "chunk", agent: "sre", text: "…" }` — each streamed text chunk (includes `agent` field)
  - `{ type: "persona-done", agent: "sre" }` — when that persona finishes
  - `{ type: "done" }` — after all personas have responded
  - `{ type: "error", message: "…" }` — on failure
- If the routing step returns no matching personas (or fails), falls back to a single response
  from the synthesis model under the agent ID `"board"`.

**Todo List:**
1. Create `src/app/api/ask-board/route.ts`.
2. Define `AskBoardRequestBody` interface (same fields as `/api/chat` body).
3. Implement the routing step: build a prompt that shows the transcript (agent + round + first
   200 chars of turn) and asks the model to return a JSON array of the 1–3 most relevant persona
   IDs. Parse the response robustly (trim, JSON.parse, validate all IDs exist in transcript).
4. Implement `callPersona(persona, question, theirTranscriptEntries, synthesis)` — builds a
   system prompt from `persona.systemPrompt` + a "You are being asked a follow-up" header,
   injects the persona's own transcript turns as grounding, calls `streamText` with the
   persona's model (with fallback), and yields chunks.
5. Stream each persona's response wrapped in `persona-start` / `chunk` / `persona-done` events.
6. On routing failure or empty result, emit a single fallback `persona-start` with
   `agent: "board"` and call the synthesis model.
7. Set `export const maxDuration = 120`.

**Relevant Context:**
- Persona loading: [`loadPersonas()`](backend/lib/debate/load-personas.ts) — call once per
  request; returns `PersonaConfig[]` with `id`, `name`, `model`, `systemPrompt`, `accentColor`.
- `streamText` + `createWatsonx()` pattern: copy from
  [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts).
- `TranscriptEntry` type: `{ agent: string; turn: string; round: number }` from
  [`backend/lib/debate/state.ts`](backend/lib/debate/state.ts).
- Routing model: `meta-llama/llama-3-3-70b-instruct` (synthesis tier per AGENTS.md — used once per
  request, not in the response loop).
- Persona models: use the `persona.model` field; fallback to
  `meta-llama/llama-3-3-70b-instruct`.

---

### Sub-Task 2 — Update `ChatPanel` to use `/api/ask-board` and render attributed responses

**Status:** [x] done

**Intent:**
Replace the existing single-model `/api/chat` call in `ChatPanel` with a call to
`/api/ask-board`, and render each attributed persona response as a distinct message bubble
with the persona's name badge and accent color — matching the visual style used in
`AgentTurnCard`.

**Expected Outcomes:**
- `ChatPanel` sends messages to `/api/ask-board` instead of `/api/chat`.
- `ChatMessage` type gains optional `agent`, `agentName`, and `accentColor` fields.
- On `persona-start`, a new streaming assistant message is pushed for that persona.
- On `chunk` events, chunks accumulate into the correct persona's message (matched by `agent`).
- On `persona-done`, that message's `streaming` flag is cleared.
- Each assistant message bubble shows a persona badge (name + accent color dot) instead of the
  generic "Board" label. The badge matches the accent color from the event.
- The `personas` prop (type `PersonaSummary[]`) is added to `ChatPanelProps` so accent colors
  can be pre-loaded client-side for the fallback "board" case (shown as a neutral badge).
- Existing error handling and keyboard shortcuts remain unchanged.

**Todo List:**
1. Add `agent?: string; agentName?: string; accentColor?: string` to `ChatMessage` interface.
2. Add `personas: PersonaSummary[]` to `ChatPanelProps`.
3. Change the fetch URL from `/api/chat` to `/api/ask-board`.
4. Update SSE parsing: handle `persona-start`, `chunk` (with `agent` field), `persona-done`,
   `done`, `error` event types.
   - `persona-start`: push a new `{ role: "assistant", content: "", streaming: true, agent,
     agentName, accentColor }` message.
   - `chunk`: find the last message where `agent === event.agent && streaming === true`,
     append text.
   - `persona-done`: clear `streaming` flag on the message with matching `agent`.
   - `done`: set `loading = false` (no message change needed).
5. Update the assistant message label from hardcoded `"Board"` to `msg.agentName ?? "Board"`.
6. Update the accent color dot: render a small colored circle before the name label when
   `msg.accentColor` is present.
7. Update the empty-state placeholder text to mention "board members" responding in turn.

**Relevant Context:**
- Current `ChatPanel`: [`src/components/ChatPanel.tsx`](src/components/ChatPanel.tsx)
- `PersonaSummary` type: imported from `src/app/api/personas/route.ts` (or defined in
  `load-personas.ts`). Has fields: `id`, `name`, `role_type`, `model`, `enabled`,
  `turn_order`, `accent_color`.
- `AgentTurnCard` badge style for reference:
  [`src/components/AgentTurnCard.tsx`](src/components/AgentTurnCard.tsx)
- `personas` state already exists in `page.tsx` — just needs to be passed as a prop.

---

### Sub-Task 3 — Pass `personas` prop to `ChatPanel` in `page.tsx`

**Status:** [x] done

**Intent:**
Wire the already-loaded `personas` state from `page.tsx` into `ChatPanel` so accent colors
and names are available for attributed message rendering.

**Expected Outcomes:**
- `<ChatPanel>` in `page.tsx` receives `personas={personas}`.
- No other changes to `page.tsx`.

**Todo List:**
1. In `page.tsx`, add `personas={personas}` to the `<ChatPanel ...>` JSX element at line ~1232.

**Relevant Context:**
- `personas` is `useState<PersonaSummary[]>` already in scope at that call site.
- `ChatPanel` usage: [`src/app/page.tsx:1232`](src/app/page.tsx:1232).

---

## Data Flow Diagram (described)

```
User types question in ChatPanel
        │
        ▼
POST /api/ask-board
  { message, synthesis, transcript, objections, history }
        │
        ▼
Step 1 — ROUTING (granite-3-30b, once)
  Prompt: "Given this transcript, which 1-3 persona IDs best answer: <question>?"
  Output: ["sre", "finops"]  (JSON array, validated against known IDs)
        │
        ▼
Step 2 — PERSONA RESPONSES (concurrent or sequential)
  For each matched persona:
    SSE → persona-start { agent, name, accentColor }
    stream persona.model(persona.systemPrompt + their transcript + question)
    SSE → chunk { agent, text } × N
    SSE → persona-done { agent }
        │
        ▼
SSE → done
        │
        ▼
ChatPanel renders each persona as a separate attributed message bubble
  [SRE badge ●] "Because Kafka introduces operational overhead…"
  [FINOPS badge ●] "We costed managed Kafka at $X/month vs…"
```

---

## Notes

- The existing `/api/chat` endpoint is left untouched — it remains available for any other
  consumers.
- `loadPersonas()` is synchronous-enough to call per-request on the server; it reads files
  from disk at `backend/personas/agents/*.md`. No caching is needed for this feature.
- If the routing step returns a persona ID not present in the transcript, that persona is
  silently skipped (no crash, no fallback needed for that specific ID).
- History continuity: `history` is still sent but used only in the routing prompt for context,
  not re-injected into each persona call (keeps persona responses focused on their own
  reasoning, not the whole chat history).
- The `personas` prop on `ChatPanel` is typed as `PersonaSummary[]` (not full `PersonaConfig`)
  since accent colors are all that's needed client-side; the server loads full configs.
