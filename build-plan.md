# AI Enterprise Architect — Build Plan

## Top-Level Overview

Build the AI Enterprise Architect application from its current boilerplate state through all five phases as described in `TASKS.md`. The app is a Next.js 16 / React 19 / TypeScript project using IBM watsonx Granite models, LangGraph for the debate state machine, Mermaid for live diagrams, pptxgenjs for deck export, and simple-git for GitOps persona management.

The project already has:
- Next.js scaffold with Geist fonts, Tailwind v4, TypeScript strict mode
- `watsonx-ai-provider`, `@langchain/langgraph`, `ai` (Vercel AI SDK), `mermaid`, `pptxgenjs`, `simple-git`, `zustand` installed
- `/app/api/health/watsonx/route.ts` — health check endpoint (working)
- `.env.local` with us-south credentials
- `DESIGN.md` — complete design token system and layout wireframe
- `.bob/skills/` — four skill templates to reference

The plan follows TASKS.md session protocol exactly: one task at a time, mark In Progress → verify → mark Done.

---

## Sub-Tasks

### Sub-Task 0.3 — Initialize simple-git and verify git log
- **Status:** `[ ] pending`
- **Intent:** Confirm `simple-git` works against the repo root so later GitOps persona commits can rely on it with confidence.
- **Expected Outcomes:** A script `scripts/verify-git.ts` runs without error and prints recent commit hash(es) to stdout.
- **Todo List:**
  1. Create `scripts/verify-git.ts` — import `simple-git`, point it at `process.cwd()`, call `.log({ maxCount: 5 })`, print the result, exit 0.
  2. Add a `"verify-git": "npx ts-node --project tsconfig.json scripts/verify-git.ts"` script to `package.json` (or use `tsx` since it is already resolvable via ts-node/Next toolchain).
  3. Run the script and confirm it prints log entries without throwing.
  4. Update `TASKS.md` 0.3 → Done.
- **Relevant Context:**
  - `simple-git` v3.36.0 is already installed.
  - `tsconfig.json` has `"paths": { "@/*": ["./*"] }` — use relative imports in the script to avoid alias issues.
  - Use `tsx` (available as `npx tsx`) rather than `ts-node` since the project uses Next.js bundler resolution.

---

### Sub-Task 0.4 — Rename layout metadata + add NEXT_PUBLIC_APP_NAME
- **Status:** `[ ] pending`
- **Intent:** Remove the "Create Next App" boilerplate title/description from `app/layout.tsx` and establish the app name token via `.env.example`.
- **Expected Outcomes:**
  - `.env.example` contains `NEXT_PUBLIC_APP_NAME=AI Enterprise Architect`.
  - `app/layout.tsx` `metadata.title` = `"Architecture Review Board"` and `metadata.description` = `"AI-powered multi-agent enterprise architecture debate and diagramming tool"`.
  - IBM Plex Sans Condensed is loaded from Google Fonts (weights 400, 600) and its CSS variable is set on `<html>`.
- **Todo List:**
  1. Add `NEXT_PUBLIC_APP_NAME=AI Enterprise Architect` to `.env.example`.
  2. In `app/layout.tsx`, import `IBM_Plex_Sans_Condensed` from `next/font/google` (subsets: `["latin"]`, weights: `["400","600"]`, variable: `--font-plex-condensed`).
  3. Update `metadata.title` and `metadata.description` as above.
  4. Add `${plexCondensed.variable}` to the `<html>` className.
  5. Update `TASKS.md` 0.4 → Done.
- **Relevant Context:**
  - `app/layout.tsx` currently imports `Geist` and `Geist_Mono` — keep those, only add Plex Condensed.
  - DESIGN.md §3: IBM Plex Sans Condensed is the display face, weights 400 and 600 only.

---

### Sub-Task 0.5 — Verify DESIGN.md is the active design system (already complete)
- **Status:** `[x] done`
- **Intent:** DESIGN.md is already written and complete with color tokens, typography, spacing, layout wireframe, chaos state colors, and self-critique. No further work needed.
- **Relevant Context:** `DESIGN.md` — already committed. All subsequent UI tasks must reference it.

---

### Sub-Task 1.1 — Create persona files for all four agents
- **Status:** `[ ] pending`
- **Intent:** Give each debate agent (SA, SRE, FinOps, Security) a structured persona file under `backend/personas/agents/` that the debate engine loads at runtime.
- **Expected Outcomes:**
  - Four files exist: `personas/agents/sa.md`, `sre.md`, `finops.md`, `security.md`.
  - Each is ≤ 40 lines, follows the gitops-persona-skill template from `.bob/skills/gitops-persona-skill.md`.
  - Each file is committed to git via a simple-git commit.
- **Todo List:**
  1. Create `personas/agents/sa.md` — Solutions Architect persona (role, expertise, debate style, model: `ibm/granite-4-h-small`).
  2. Create `personas/agents/sre.md` — Site Reliability Engineer persona (reliability, latency, SLO focus; must include objection format).
  3. Create `personas/agents/finops.md` — FinOps persona (cost optimization, unit economics, TCO; must include objection format).
  4. Create `backend/personas/agents/security.md` — Security persona (BYOC criteria loader, thinking mode, references `backend/personas/compliance/*.md`; model: `ibm/granite-guardian-3-8b`).
  5. Commit each file individually via simple-git (one concern per commit per gitops-persona-skill guardrail).
  6. Update `TASKS.md` 1.1 → Done.
- **Relevant Context:**
  - `.bob/skills/gitops-persona-skill.md` — template and guardrails.
  - AGENTS.md: debate agents use `ibm/granite-4-h-small`; security uses `ibm/granite-guardian-3-8b`.
  - Each agent turn must end with `OBJECTION: <reason>` or `NO OBJECTION`.

---

### Sub-Task 1.2 — Create compliance mandate files
- **Status:** `[ ] pending`
- **Intent:** Provide BYOC (Bring-Your-Own-Criteria) mandate files the Security agent uses at runtime to evaluate proposals against real compliance rules.
- **Expected Outcomes:**
  - Two files exist: `personas/compliance/iam.md` and `personas/compliance/data-residency.md`.
  - Both use the mandate template format from `gitops-persona-skill.md` (Rule / Enforced by / Statement / Example violation).
  - Each committed individually.
- **Todo List:**
  1. Create `personas/compliance/iam.md` — at least 2 IAM rules (e.g., least-privilege, MFA enforcement, session expiry).
  2. Create `personas/compliance/data-residency.md` — at least 2 data residency rules (e.g., PII must stay in declared region, cross-border transfer must be logged).
  3. Commit each file via simple-git.
  4. Update `TASKS.md` 1.2 → Done.
- **Relevant Context:**
  - `.bob/skills/gitops-persona-skill.md` — mandate template.
  - Security agent (task 2.5) will load `personas/compliance/*.md` at runtime using `fs.readdir` + `fs.readFile`.

---

### Sub-Task 1.3 — Wire simple-git helper lib/git-commit.ts
- **Status:** `[ ] pending`
- **Intent:** Centralize the git commit logic so every future persona edit goes through one typed function rather than duplicating `simple-git` boilerplate.
- **Expected Outcomes:**
  - `lib/git-commit.ts` exports a single async `commitFile(filePath: string, content: string, message: string): Promise<void>` function.
  - It writes the file, stages it, and commits with the supplied message.
  - TypeScript strict — no `any`.
- **Todo List:**
  1. Create `lib/git-commit.ts` using `simple-git` pointed at `process.cwd()`.
  2. Function signature: `commitFile(filePath, content, message)` — writes content to disk, `git.add(filePath)`, `git.commit(message)`.
  3. Export type for the function.
  4. Update `TASKS.md` 1.3 → Done.
- **Relevant Context:**
  - `simple-git` v3.36.0 is in `node_modules`.
  - `tsconfig.json` path alias `@/*` → use `@/lib/git-commit` in callers.

---

### Sub-Task 1.4 — Build the Discovery API route
- **Status:** `[ ] pending`
- **Intent:** Accept a raw business idea string, call Granite once, and return a structured creative brief (problem, constraints, drivers) as JSON.
- **Expected Outcomes:**
  - `app/api/discovery/route.ts` — POST handler that accepts `{ idea: string }`.
  - Returns `{ problem: string, constraints: string[], drivers: string[] }`.
  - Calls `ibm/granite-4-h-small` via `watsonx-ai-provider`.
  - No streaming (single call, JSON response).
- **Todo List:**
  1. Create `app/api/discovery/route.ts` as a Next.js App Router POST handler.
  2. Parse the request body for `{ idea }`, validate it is a non-empty string.
  3. Build a system + user prompt that asks Granite to return a JSON creative brief.
  4. Call `ibm/granite-4-h-small` via `watsonx-ai-provider` using `generateText` from the Vercel AI SDK.
  5. Parse the JSON response and return it as `NextResponse.json(...)`.
  6. Update `TASKS.md` 1.4 → Done.
- **Relevant Context:**
  - AGENTS.md: `ibm/granite-4-h-small` for discovery.
  - `watsonx-ai-provider` v2 is installed — check its API for model instantiation pattern.
  - `ai` (Vercel AI SDK) `generateText` is the correct tool (not streaming here).

---

### Sub-Task 1.5 — Build the Discovery UI
- **Status:** `[ ] pending`
- **Intent:** Replace the Next.js boilerplate home page with the three-column war-room shell defined in DESIGN.md, including a working discovery form on the left pane.
- **Expected Outcomes:**
  - `app/page.tsx` renders the three-column layout (left 280px, center flex-grow, right 360px).
  - Left pane: textarea + "Analyse" button + brief preview area.
  - Center pane: placeholder War Room feed (empty state).
  - Right pane: placeholder for diagram, chaos panel, deck export, audio upload (all showing placeholder/empty state).
  - Header: "Architecture Review Board" title, round counter (inactive state `○○○`), health indicator.
  - Status bar at bottom.
  - All colors, fonts, spacing strictly from DESIGN.md tokens (CSS custom properties in `app/globals.css`).
  - The discovery form calls `POST /api/discovery` and renders the returned brief in the left pane.
- **Todo List:**
  1. Add design token CSS custom properties to `app/globals.css` (all tokens from DESIGN.md §2, §3 type scale vars, §4 spacing vars).
  2. Build `components/RoundCounter.tsx` — three rectangle segments, cobalt fill for active rounds, `role="status"`, `aria-live="polite"`, reduced-motion safe.
  3. Build `app/page.tsx` as a `"use client"` component with the full three-column layout using Tailwind utility classes mapped to the CSS token variables.
  4. Wire the discovery form: `useState` for idea text + brief result, `fetch("/api/discovery")` on submit, display brief in left pane.
  5. Add the status bar (region, model name) using `process.env.NEXT_PUBLIC_APP_NAME`.
  6. Verify the page renders at 1280px+ and at 768px (drawer collapse behavior).
  7. Update `TASKS.md` 1.5 → Done.
- **Relevant Context:**
  - DESIGN.md §2 (color tokens), §3 (typography + scale), §4 (layout wireframe + column behavior + spacing), §5 (structural grid lines), §6 (round counter), §7 (interactive states), §10 (accessibility floor).
  - `app/layout.tsx` already loads Geist Sans, Geist Mono, and (after 0.4) IBM Plex Sans Condensed.
  - Tailwind v4 is installed — use `@theme` or `@layer base` for CSS variable mapping.

---

### Sub-Task 1.6 — Verify Phase 1 end-to-end
- **Status:** `[ ] pending`
- **Intent:** Confirm the discovery flow works with real watsonx credentials and no spurious git commits.
- **Expected Outcomes:** Submit a test business idea in the browser, receive a structured creative brief, verify `git log` shows only intentional persona commits.
- **Todo List:**
  1. Start `npm run dev`, open the app in a browser.
  2. Submit a test idea (e.g., "Build a real-time fraud detection system for a regional bank").
  3. Confirm the brief JSON renders in the left pane.
  4. Run `git log --oneline -10` and confirm no unexpected commits were created.
  5. Update `TASKS.md` 1.6 → Done.

---

### Sub-Task 2.1 — LangGraph state type
- **Status:** `[ ] pending`
- **Intent:** Define the typed state contract for the debate graph so all agent nodes share a common interface.
- **Expected Outcomes:** `lib/debate/state.ts` exports `DebateState` interface with `{ proposal, round, objections, resolved, transcript }` — typed, no `any`, no runtime code.
- **Todo List:**
  1. Create `lib/debate/state.ts` with the `DebateState` type/interface.
  2. `proposal: string` — current architecture proposal text.
  3. `round: number` — current round index (0-based, max 2 for 3 rounds).
  4. `objections: Array<{ agent: string; reason: string }>` — outstanding objections.
  5. `resolved: boolean` — true if all agents returned NO OBJECTION.
  6. `transcript: Array<{ agent: string; turn: string; round: number }>` — full debate history.
  7. Update `TASKS.md` 2.1 → Done.
- **Relevant Context:** AGENTS.md debate loop rules. LangGraph `@langchain/langgraph` v1.4.8 installed.

---

### Sub-Task 2.2 — SA agent node
- **Status:** `[ ] pending`
- **Intent:** Implement the Solutions Architect agent that refines the proposal each round, streaming tokens via Vercel AI SDK.
- **Expected Outcomes:** `lib/debate/agents/sa.ts` exports an async node function compatible with LangGraph that takes `DebateState`, calls `ibm/granite-4-h-small`, streams tokens, returns updated state.
- **Todo List:**
  1. Create `lib/debate/agents/sa.ts`.
  2. Load persona from `personas/agents/sa.md` at node entry using `fs.readFile`.
  3. Build a prompt incorporating the persona, current proposal, and any objections from the previous round.
  4. Call `ibm/granite-4-h-small` via `streamText` from Vercel AI SDK.
  5. Append the completed turn to `transcript`, update `proposal` in state.
  6. Return the updated `DebateState`.
  7. Update `TASKS.md` 2.2 → Done.
- **Relevant Context:** `lib/debate/state.ts`, `personas/agents/sa.md`, AGENTS.md model IDs.

---

### Sub-Task 2.3 — SRE agent node
- **Status:** `[ ] pending`
- **Intent:** Implement the SRE agent that evaluates reliability/latency concerns and responds with either `OBJECTION: <reason>` or `NO OBJECTION`.
- **Expected Outcomes:** `lib/debate/agents/sre.ts` — same structure as SA, but its turn always ends with the standardized objection/no-objection suffix.
- **Todo List:**
  1. Create `lib/debate/agents/sre.ts`.
  2. Load `personas/agents/sre.md` at node entry.
  3. Prompt instructs the model to end its response with exactly `OBJECTION: <reason>` or `NO OBJECTION`.
  4. Parse the model output to extract objection status; push to `state.objections` if present, remove previous SRE objection if resolved.
  5. Append to `transcript`, return updated state.
  6. Update `TASKS.md` 2.3 → Done.

---

### Sub-Task 2.4 — FinOps agent node
- **Status:** `[ ] pending`
- **Intent:** Implement the FinOps agent — same pattern as SRE with cost/TCO focus.
- **Expected Outcomes:** `lib/debate/agents/finops.ts` — identical structure to SRE node but loads `personas/agents/finops.md`.
- **Todo List:**
  1. Create `lib/debate/agents/finops.ts` following the SRE pattern.
  2. Load `personas/agents/finops.md` at entry.
  3. Same objection format enforcement.
  4. Update `TASKS.md` 2.4 → Done.

---

### Sub-Task 2.5 — Security agent node
- **Status:** `[ ] pending`
- **Intent:** Implement the Security agent using `ibm/granite-guardian-3-8b` in thinking mode, evaluating proposals against the BYOC compliance mandates loaded at runtime.
- **Expected Outcomes:** `lib/debate/agents/security.ts` — loads all `personas/compliance/*.md` files, calls guardian model, appends objections if mandates are violated.
- **Todo List:**
  1. Create `lib/debate/agents/security.ts`.
  2. At node entry, `fs.readdir("personas/compliance")` and read all `.md` files into a single compliance context string.
  3. Load `personas/agents/security.md` for behavioral persona.
  4. Call `ibm/granite-guardian-3-8b` (thinking mode — check watsonx-ai-provider docs for `thinking` parameter).
  5. Parse output for objections, update state.
  6. Update `TASKS.md` 2.5 → Done.
- **Relevant Context:** AGENTS.md security agent rules. `personas/compliance/iam.md`, `personas/compliance/data-residency.md`.

---

### Sub-Task 2.6 — Wire the LangGraph debate graph
- **Status:** `[ ] pending`
- **Intent:** Connect the four agent nodes into a bounded loop (max 3 rounds) with a conditional exit on resolution.
- **Expected Outcomes:** `lib/debate/graph.ts` — exports a compiled LangGraph `StateGraph` that runs SA → SRE → FinOps → Security per round, loops back to SA if objections remain (max 3 rounds), then exits.
- **Todo List:**
  1. Create `lib/debate/graph.ts`.
  2. Define `StateGraph<DebateState>` with nodes: `sa`, `sre`, `finops`, `security`, `end`.
  3. Edges: `sa → sre → finops → security → [conditional]`.
  4. Conditional: if `state.resolved || state.round >= 3` → `end`, else increment `state.round`, → `sa`.
  5. Compile the graph with `graph.compile()`.
  6. Every round result is logged (console or passed to stream).
  7. Update `TASKS.md` 2.6 → Done.
- **Relevant Context:** `@langchain/langgraph` v1.4.8 — use `StateGraph`, `Annotation`, conditional edges pattern. AGENTS.md: max 3 rounds, loop must be resumable and inspectable.

---

### Sub-Task 2.7 — Synthesis step
- **Status:** `[ ] pending`
- **Intent:** After the debate concludes, produce a single canonical architecture description suitable for diagram + pitch-deck generation.
- **Expected Outcomes:** `lib/debate/synthesis.ts` — exports `synthesize(state: DebateState): Promise<string>`, calls `meta-llama/llama-3-3-70b-instruct` exactly once, flags unresolved objections in output.
- **Todo List:**
  1. Create `lib/debate/synthesis.ts`.
  2. Build a prompt that includes the final `proposal`, full `transcript`, and any `objections` that were never resolved.
  3. Call `meta-llama/llama-3-3-70b-instruct` via `generateText`.
  4. If objections remain unresolved, append a `"UNRESOLVED OBJECTIONS: ..."` section.
  5. Return the synthesis string.
  6. Update `TASKS.md` 2.7 → Done.
- **Relevant Context:** AGENTS.md: "call ONCE per session, never in the debate loop". `meta-llama/llama-3-3-70b-instruct`.

---

### Sub-Task 2.8 — Debate API route (SSE streaming)
- **Status:** `[ ] pending`
- **Intent:** Expose the debate graph as a Server-Sent Events stream so the UI receives agent turns token-by-token.
- **Expected Outcomes:** `app/api/debate/route.ts` — POST triggers the graph, emits SSE events per agent turn, closes with synthesis text on completion.
- **Todo List:**
  1. Create `app/api/debate/route.ts`.
  2. Accept `{ proposal: string }` POST body.
  3. Use `TransformStream` + `ReadableStream` to emit SSE.
  4. Each agent turn emits `data: { agent, token }` events.
  5. On graph completion, emit `data: { type: "synthesis", text }` then close the stream.
  6. Update `TASKS.md` 2.8 → Done.

---

### Sub-Task 2.9 — War Room feed UI
- **Status:** `[ ] pending`
- **Intent:** Connect the center pane to the SSE debate stream, rendering each agent turn as a labelled card as tokens arrive.
- **Expected Outcomes:** Center pane shows live-updating agent turn cards (with agent badge, streaming text, objection/no-objection state). Each card is `<article aria-label="[agent] turn">`.
- **Todo List:**
  1. Create `components/AgentTurnCard.tsx` — accepts `{ agent, text, status: "streaming"|"objection"|"no-objection" }`, renders per DESIGN.md (streaming pulse border, agent badge in display-sm, transcript text in mono-md).
  2. Create `components/WarRoomFeed.tsx` — manages SSE connection, parses events, renders `AgentTurnCard` list.
  3. Wire into `app/page.tsx` center pane, replacing the placeholder.
  4. Update round counter in header as rounds progress.
  5. Update `TASKS.md` 2.9 → Done.
- **Relevant Context:** DESIGN.md §7 (loading/streaming pulse state). Accessibility: `<article aria-label>`, round counter `role="status" aria-live="polite"`.

---

### Sub-Task 2.10 — Verify Phase 2 end-to-end
- **Status:** `[ ] pending`
- **Intent:** Confirm the full debate works with real watsonx credentials, round cap fires correctly, synthesis produces output.
- **Expected Outcomes:** Full debate runs in browser from a test input, max 3 rounds, synthesis text appears, all agent turns visible in the feed.
- **Todo List:**
  1. Submit the same test idea from 1.6 to trigger the debate.
  2. Observe round counter advancing.
  3. Confirm the graph terminates at or before round 3.
  4. Confirm synthesis text appears.
  5. Update `TASKS.md` 2.10 → Done.

---

### Sub-Task 3.1 — Mermaid generation helper
- **Status:** `[ ] pending`
- **Intent:** Given a synthesis description, generate a validated Mermaid `graph TD` string with one retry on parse failure.
- **Expected Outcomes:** `lib/mermaid/generate.ts` exports `generateMermaid(description: string): Promise<string>` — calls Granite, validates with `mermaid.parse()`, retries once.
- **Todo List:**
  1. Create `lib/mermaid/generate.ts`.
  2. Prompt `ibm/granite-4-h-small` to emit a Mermaid `graph TD` block.
  3. Extract the `graph TD` block from the response (strip markdown fences).
  4. Call `mermaid.parse(diagram)` — if it throws, retry once with a corrective prompt.
  5. Return the validated string or throw with a descriptive error after one retry.
  6. Update `TASKS.md` 3.1 → Done.
- **Relevant Context:** AGENTS.md: "Mermaid output must be validated before rendering, or the UI blank-screens." `mermaid` v11 installed.

---

### Sub-Task 3.2 — MermaidRenderer component
- **Status:** `[ ] pending`
- **Intent:** Client-side React component that renders a Mermaid diagram string safely, showing an explicit error state instead of blank-screening.
- **Expected Outcomes:** `components/MermaidRenderer.tsx` — `"use client"`, accepts `{ diagram: string }`, renders the diagram via `mermaid.render()`, shows parse error message on failure.
- **Todo List:**
  1. Create `components/MermaidRenderer.tsx` as a client component.
  2. Use `useEffect` to call `mermaid.render()` after mount, inserting SVG into a container `<div>`.
  3. Wrap `mermaid.render()` in a try/catch — on error, render `<p className="error">Invalid diagram: {err.message}</p>`.
  4. Apply chaos `classDef` diffs without re-mounting (expose a `patchClassDefs(diffs: string)` function via `useImperativeHandle` or a Zustand slice).
  5. Update `TASKS.md` 3.2 → Done.
- **Relevant Context:** DESIGN.md §8: node state changes via `classDef` diffs only.

---

### Sub-Task 3.3 — Diagram API route
- **Status:** `[ ] pending`
- **Intent:** Expose diagram generation as an API endpoint.
- **Expected Outcomes:** `app/api/diagram/route.ts` — POST `{ description: string }` → returns `{ diagram: string }` (validated Mermaid).
- **Todo List:**
  1. Create `app/api/diagram/route.ts`.
  2. Call `generateMermaid(description)` from `lib/mermaid/generate.ts`.
  3. Return the result as JSON.
  4. Update `TASKS.md` 3.3 → Done.

---

### Sub-Task 3.4 — PPTX generation helper
- **Status:** `[ ] pending`
- **Intent:** Build a 5-slide pitch deck from the synthesis description, diagram, and debate transcript.
- **Expected Outcomes:** `lib/pptx/generate.ts` exports `generateDeck({ synthesis, diagram, transcript }): Promise<Buffer>` — 5 slides (problem, solution, diagram image, tradeoffs, ROI), verified slide count.
- **Todo List:**
  1. Create `lib/pptx/generate.ts` using `pptxgenjs`.
  2. Slide 1: Problem statement (from synthesis).
  3. Slide 2: Proposed solution (from synthesis).
  4. Slide 3: Architecture diagram (render Mermaid to SVG, embed as image).
  5. Slide 4: Tradeoffs (from transcript objections).
  6. Slide 5: ROI / next steps (from synthesis).
  7. Assert `pres.sections.length === 5` before returning.
  8. Return `Buffer` from `pres.write({ outputType: "nodebuffer" })`.
  9. Update `TASKS.md` 3.4 → Done.
- **Relevant Context:** `pptxgenjs` v4 installed. DESIGN.md colors may be used for slide theme.

---

### Sub-Task 3.5 — PPTX download API route
- **Status:** `[ ] pending`
- **Intent:** Expose deck generation as a binary download endpoint.
- **Expected Outcomes:** `app/api/pitch-deck/route.ts` — POST `{ synthesis, diagram, transcript }` → returns `.pptx` binary with correct content-type header.
- **Todo List:**
  1. Create `app/api/pitch-deck/route.ts`.
  2. Call `generateDeck(...)` from `lib/pptx/generate.ts`.
  3. Return `new Response(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": 'attachment; filename="architecture.pptx"' } })`.
  4. Update `TASKS.md` 3.5 → Done.

---

### Sub-Task 3.6 — Diagram pane and deck download UI
- **Status:** `[ ] pending`
- **Intent:** Wire the right pane with live diagram and deck download button.
- **Expected Outcomes:** Right pane shows `MermaidRenderer` with the generated diagram after debate completes; "Download Deck" button triggers download.
- **Todo List:**
  1. After synthesis is received in the UI, call `POST /api/diagram` and set diagram state.
  2. Render `<MermaidRenderer diagram={diagram} />` in the right pane.
  3. Wire "Download Deck" button to fetch `POST /api/pitch-deck` and trigger browser download.
  4. Update `TASKS.md` 3.6 → Done.

---

### Sub-Task 3.7 — Verify Phase 3 end-to-end
- **Status:** `[ ] pending`
- **Intent:** Confirm diagram renders without blank-screen and downloaded `.pptx` has exactly 5 slides.
- **Todo List:**
  1. Run full flow: discovery → debate → diagram renders.
  2. Download `.pptx`, open in PowerPoint/LibreOffice, verify 5 slides with actual debate content.
  3. Update `TASKS.md` 3.7 → Done.

---

### Sub-Task 4.1 — ⭐ Chaos narrative generator
- **Status:** `[ ] pending`
- **Intent:** Given the architecture description, produce a 4–6-beat stress narrative (normal → strain → failure → failover → recovery).
- **Expected Outcomes:** `lib/chaos/narrative.ts` exports `generateNarrative(description: string): Promise<ChaosBeat[]>` where `ChaosBeat = { state: "normal"|"strain"|"failure"|"failover"|"recovery", label: string, affectedNodes: string[] }`.
- **Todo List:**
  1. Create `lib/chaos/narrative.ts` with `ChaosBeat` type and `generateNarrative`.
  2. Prompt `ibm/granite-4-h-small` to produce 4–6 beats as structured JSON.
  3. Parse and validate the beats array.
  4. Return typed array.
  5. Update `TASKS.md` 4.1 → Done.
- **Relevant Context:** DESIGN.md §2 chaos state colors: normal=`#2d7a6e`, strain=`#c98a1a`, failure=`#c0392b`, recovery=`#3b7a57`. DESIGN.md §8: beat timing 1400ms.

---

### Sub-Task 4.2 — ⭐ classDef diff emitter
- **Status:** `[ ] pending`
- **Intent:** For each chaos beat, emit only the Mermaid `classDef` and `class` assignment strings for affected nodes — never re-render the full diagram.
- **Expected Outcomes:** `lib/chaos/classDef.ts` exports `buildClassDefPatch(beat: ChaosBeat): string` — returns a Mermaid snippet like `classDef strain fill:#c98a1a...` + `class nodeA strain`.
- **Todo List:**
  1. Create `lib/chaos/classDef.ts`.
  2. Map `ChaosBeat.state` to the DESIGN.md §2 hex values.
  3. Build the `classDef` string with fill, stroke, and color.
  4. Build `class <node> <state>` assignments for each affected node.
  5. Return combined patch string.
  6. Update `TASKS.md` 4.2 → Done.

---

### Sub-Task 4.3 — ⭐ Chaos simulator API route (SSE)
- **Status:** `[ ] pending`
- **Intent:** Stream chaos beats as SSEs with inter-beat delay so the UI receives them progressively.
- **Expected Outcomes:** `app/api/chaos/route.ts` — POST `{ description: string }` → streams `ChaosBeat` + `classDef` patch per beat with 1400ms inter-beat delay.
- **Todo List:**
  1. Create `app/api/chaos/route.ts`.
  2. Generate full narrative with `generateNarrative`.
  3. Build a `ReadableStream` that emits each beat, calls `buildClassDefPatch`, waits 1400ms between beats.
  4. Stream SSE format: `data: { beat, state, label, patch }\n\n`.
  5. Update `TASKS.md` 4.3 → Done.
- **Relevant Context:** DESIGN.md §8: `prefers-reduced-motion` → 0ms delay. The API should respect a `reducedMotion` flag in the request body.

---

### Sub-Task 4.4 — ⭐ Chaos Simulator UI panel
- **Status:** `[ ] pending`
- **Intent:** Add "Simulate Traffic Spike" button and live diagram recoloring; beats apply `classDef` diffs without re-mounting the diagram.
- **Expected Outcomes:** Chaos panel in right pane: button triggers SSE stream from `/api/chaos`, beat progress indicator updates, diagram nodes recolor per beat without positional jump.
- **Todo List:**
  1. Create `components/ChaosBeatIndicator.tsx` — `●●○○○○` row using chaos state colors per DESIGN.md §8 (reduced-motion safe, `aria-label`).
  2. Add chaos panel to `app/page.tsx` right pane below the diagram.
  3. Wire "Simulate Traffic Spike" button to `EventSource` connected to `POST /api/chaos`.
  4. On each beat event, call `MermaidRenderer`'s `patchClassDefs` method to apply the diff without re-mounting.
  5. Update chaos panel heading with current state label.
  6. Update `TASKS.md` 4.4 → Done.
- **Relevant Context:** DESIGN.md §8 and §10 (reduced-motion required). AGENTS.md chaos coloring rule.

---

### Sub-Task 4.5 — ⭐ Verify Chaos Simulator end-to-end
- **Status:** `[ ] pending`
- **Intent:** Confirm diagram recolors through all beats, nodes don't jump, final state is visually distinct.
- **Todo List:**
  1. Run a full flow to get the diagram visible.
  2. Click "Simulate Traffic Spike", observe all beats cycle through.
  3. Confirm node positions do not change during recoloring.
  4. Confirm final state (failure/recovery) is visually distinct from initial (normal).
  5. Update `TASKS.md` 4.5 → Done.

---

### Sub-Task 4.6 — Audio upload route (Watson STT / Granite Speech)
- **Status:** `[ ] pending`
- **Intent:** Accept `.mp3` multipart upload, transcribe via `granite-speech-4.1-2b` (or watson-stt fallback), return transcript text.
- **Expected Outcomes:** `app/api/audio/route.ts` — POST multipart `file` field → returns `{ transcript: string }`.
- **Todo List:**
  1. Create `app/api/audio/route.ts`.
  2. Parse multipart form data using `request.formData()`.
  3. Check `STT_PROVIDER` env: if `"watson"`, call Watson STT API; otherwise call `granite-speech-4.1-2b` via watsonx.
  4. Return `{ transcript: string }`.
  5. Update `TASKS.md` 4.6 → Done.
- **Relevant Context:** AGENTS.md: `granite-speech-4.1-2b` primary, watson-stt fallback. `STT_PROVIDER` env.

---

### Sub-Task 4.7 — Diagram update helper from transcript
- **Status:** `[ ] pending`
- **Intent:** Given a voice transcript string, extract architectural critiques and produce a valid Mermaid patch.
- **Expected Outcomes:** `lib/mermaid/update.ts` exports `updateDiagramFromTranscript(transcript: string, currentDiagram: string): Promise<string>` — returns a delta patch (not a full re-render) validated with `mermaid.parse()`.
- **Todo List:**
  1. Create `lib/mermaid/update.ts`.
  2. Prompt Granite to identify mentioned nodes/edges from the transcript and suggest additions/modifications.
  3. Produce a minimal Mermaid patch (new node or edge lines only).
  4. Validate the full updated diagram with `mermaid.parse()`.
  5. Update `TASKS.md` 4.7 → Done.

---

### Sub-Task 4.8 — Audio upload widget UI
- **Status:** `[ ] pending`
- **Intent:** Add audio file upload, transcript display, and diagram update trigger to the right pane.
- **Expected Outcomes:** Audio panel in right pane: file input for `.mp3`, transcript preview in mono-md, "Update Diagram" button.
- **Todo List:**
  1. Create `components/AudioPanel.tsx` — file input, transcript state, "Update Diagram" button.
  2. On file select, POST to `/api/audio`, display returned transcript.
  3. On "Update Diagram" click, call `lib/mermaid/update.ts` (via a new `/api/diagram/update` route) and patch `MermaidRenderer`.
  4. Wire into right pane of `app/page.tsx`.
  5. Update `TASKS.md` 4.8 → Done.

---

### Sub-Task 4.9 — Verify audio pipeline end-to-end
- **Status:** `[ ] pending`
- **Intent:** Confirm transcript appears and diagram updates without blank-screen on parse edge cases.
- **Todo List:**
  1. Upload a test `.mp3`, confirm transcript appears.
  2. Click "Update Diagram", confirm diagram updates with valid Mermaid.
  3. Test with a degenerate case (very short audio) and confirm no blank-screen.
  4. Update `TASKS.md` 4.9 → Done.

---

### Sub-Task 5.1–5.6 — Resilience, fallbacks, and demo rehearsal
- **Status:** `[ ] pending`
- **Intent:** Add model fallbacks, cached-response fallbacks, STT fallback, extend health endpoint, and run end-to-end demo rehearsal.
- **Todo List:**
  1. 5.1: Wrap every `watsonx-ai-provider` call with a try/catch that retries with the fallback model from AGENTS.md and logs which model was used.
  2. 5.2: Cache last SA proposal in synthesis step; use as fallback if meta-llama/llama-3-3-70b-instruct fails.
  3. 5.3: Return `{ transcript: "", transcription_unavailable: true }` if STT call fails.
  4. 5.4: Extend `/api/health/watsonx` to also check STT provider status and `git log` health.
  5. 5.5: Full demo rehearsal (discovery → debate → diagram → pptx → chaos → audio), record errors.
  6. 5.6: Fix errors, update AGENTS.md with new failure modes.
  - Update each task in `TASKS.md` as completed.

---

## Implementation Order

```
0.3 → 0.4 (can run in parallel)
         ↓
        1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
                                          ↓
                    2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9 → 2.10
                                                                                 ↓
                                          3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7
                                                                                 ↓
                               4.1 → 4.2 → 4.3 → 4.4 → 4.5 (chaos, HIGH PRIORITY)
                               4.6 → 4.7 → 4.8 → 4.9 (audio, can defer)
                                                                                 ↓
                                                              5.1 → 5.2 → ... → 5.6
```
