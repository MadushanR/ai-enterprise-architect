# AI Enterprise Architect — Task Breakdown

> **Read this file first, every session.** See [Session Protocol](#session-protocol) below.

---

## Task Table

| # | Task | Phase | Depends On | Status |
|---|------|-------|------------|--------|
| 0.1 | Verify watsonx health endpoint returns `ok: true` against us-south; document result in `AGENTS.md` | Phase 0 | — | Done |
| 0.2 | Confirm `.env.local` has `WATSONX_AI_REGION=us-south` and all three required models appear in `availableChatModels` | Phase 0 | 0.1 | Done |
| 0.3 | Initialise `simple-git` on the repo root and verify `git log` works via a one-off script (`scripts/verify-git.ts`) | Phase 0 | — | Done |
| 0.4 | Add `NEXT_PUBLIC_APP_NAME` to `.env.example` and rename `app/layout.tsx` title/description away from the Next.js boilerplate | Phase 0 | — | Done |
| 0.5 | Design system pass: define a compact token system (4-6 named
colors including explicit "normal / strain / failure / recovery" states
for chaos coloring, 2 typefaces, spacing scale) and a layout concept for
the full app — not just the discovery screen — accounting for: discovery
input, debate feed, diagram pane, deck download, chaos trigger, audio
upload. Document as DESIGN.md. Take one deliberate visual risk that fits
an "architecture review board" concept rather than a generic AI-dashboard
look. | Phase 0 | 0.4 | Done |
| 1.1 | Define the persona frontmatter schema (see AGENTS.md §Persona schema), then create four starter persona files: `sa.md`, `sre.md`, `finops.md`, `security.md` — sa/sre/finops as `role_type: debater`, security as `role_type: guardian` with `compliance_ref: "personas/compliance/*.md"`. Files must include all required frontmatter fields. | Phase 1 | 0.3 | Done |
| 1.2 | Create `/personas/compliance/` directory with at least two BYOC mandate files (`iam.md`, `data-residency.md`) using the mandate template from `gitops-persona-skill.md` | Phase 1 | 1.1 | Done |
| 1.3 | Wire `simple-git` helper (`lib/git-commit.ts`) that reads a file, writes it, and commits with a caller-supplied message — used by every future persona edit | Phase 1 | 0.3 | Done |
| 1.4 | Build the Discovery API route (`app/api/discovery/route.ts`): POST receives a business idea string, calls `ibm/granite-4-h-small` once, returns a structured creative brief (problem, constraints, drivers) | Phase 1 | 0.2, 1.3 | Done |
| 1.5 | Build the Discovery UI: replace `app/page.tsx` boilerplate with a split-screen shell — left pane is the text-input discovery form, right pane is a placeholder for the War Room feed | Phase 1 | 1.4, 0.5 | Done |
| 1.6 | Verify end-to-end: submit a test idea, confirm creative brief returns correctly and `git log` shows no spurious commits | Phase 1 | 1.4, 1.5 | Done |
| 2.1 | Build LangGraph state type (`lib/debate/state.ts`): `{ proposal, round, objections, resolved, transcript }` — typed, no implementation yet | Phase 2 | 1.4 | Done |
| 2.2 | ~~Implement SA agent node (`lib/debate/agents/sa.ts`)~~ — one-off file per agent; **superseded by 2.2r**. Kept as `Done` because the code ships and passes tests. | Phase 2 | 2.1 | Done |
| 2.3 | ~~Implement SRE agent node (`lib/debate/agents/sre.ts`)~~ — **superseded by 2.2r**. | Phase 2 | 2.1 | Done |
| 2.4 | ~~Implement FinOps agent node (`lib/debate/agents/finops.ts`)~~ — **superseded by 2.2r**. | Phase 2 | 2.1 | Done |
| 2.5 | ~~Implement Security agent node (`lib/debate/agents/security.ts`)~~ — **superseded by 2.3r**. | Phase 2 | 2.1, 1.2 | Done |
| 2.2r | Build generic debater node factory (`lib/debate/agents/debater.ts`): accepts a parsed `PersonaConfig` (from the loader), returns a LangGraph-compatible async node function; calls `persona.model` via watsonx-ai-provider with streaming; enforces `OBJECTION:`/`NO OBJECTION` terminal format for non-SA turns; replaces `sa.ts`, `sre.ts`, `finops.ts` | Phase 2 | 2.4r | Done |
| 2.3r | Build generic guardian node factory (`lib/debate/agents/guardian.ts`): accepts a `PersonaConfig` with `role_type: guardian`, resolves `compliance_ref` glob at runtime, concatenates mandate files as BYOC context, calls `persona.model` with `reasoningEffort: high`; replaces `security.ts` | Phase 2 | 2.4r | Done |
| 2.4r | Build persona loader (`lib/debate/load-personas.ts`): reads all `*.md` files in `/personas/agents/`, parses YAML frontmatter, validates required fields, filters `enabled: true`, sorts by `turn_order`, enforces max-6-debater cap (warns and truncates, does not throw), returns `PersonaConfig[]` typed array | Phase 2 | 1.1 | Done |
| 2.5r | Expose loaded personas as API endpoint (`app/api/personas/route.ts`): GET returns the array from the persona loader (id, name, role_type, model, turn_order, accent_color, enabled) — no secrets, no system prompt body. Used by the UI to build agent badges dynamically instead of hardcoding four labels. | Phase 2 | 2.4r | Done |
| 2.6 | Wire the LangGraph graph (`lib/debate/graph.ts`) — refactored: iterates over `loadPersonas()` output, builds a single `round` node via `debaterNode`/`guardianNode` factories, runs reviewers + guardians concurrently via `Promise.all`, preserves max-3-round cap. | Phase 2 | 2.2, 2.3, 2.4, 2.5 | Done |
| 2.7 | Implement synthesis step (`lib/debate/synthesis.ts`): single call to `ibm/granite-3-30b-instruct` outside the loop, converts final state to canonical architecture description; flag unresolved objections in output | Phase 2 | 2.6 | Done |
| 2.8 | Expose the debate engine as a streaming API route (`app/api/debate/route.ts`): POST triggers the graph, streams each agent turn as a Server-Sent Event; returns synthesis on completion | Phase 2 | 2.7 | Done |
| 2.9 | Add War Room feed to the center pane of the UI: connects to the SSE stream, renders each agent turn in a labelled card as tokens arrive; agent badge labels and accent colors read from `/api/personas` at mount time rather than hardcoded — falls back to `agent` field from SSE event if the endpoint is unavailable | Phase 2 | 2.8, 1.5, 0.5 | Done |
| 2.10 | Verify end-to-end: run a full debate from test input, confirm max-3-rounds cap fires, synthesis produces output, all agent turns appear in the UI feed | Phase 2 | 2.9 | Done |
| 3.1 | Build Mermaid generation helper (`lib/mermaid/generate.ts`): prompts `ibm/granite-4-h-small` to emit a valid `graph TD` block, validates with `mermaid.parse()`, retries once on failure | Phase 3 | 2.7 | Done |
| 3.2 | Build `MermaidRenderer` React component (`components/MermaidRenderer.tsx`): accepts a Mermaid string prop, renders client-side only, shows parse-error state rather than blank-screening | Phase 3 | 3.1 | Done |
| 3.3 | Expose Mermaid generation as an API route (`app/api/diagram/route.ts`): POST synthesis description → returns validated Mermaid string | Phase 3 | 3.1 | Done |
| 3.4 | Build PPTX generation helper (`lib/pptx/generate.ts`): uses `pptxgenjs` to build the 5-slide deck (problem, solution, diagram image, tradeoffs from transcript, ROI), verifies slide count after export | Phase 3 | 2.7, 3.1 | Done |
| 3.5 | Expose PPTX download as an API route (`app/api/pitch-deck/route.ts`): POST synthesis + diagram → streams back the `.pptx` binary | Phase 3 | 3.4 | Done |
| 3.6 | Add diagram pane and "Download Deck" button to the UI; wire to `app/api/diagram` and `app/api/pitch-deck` respectively | Phase 3 | 3.2, 3.3, 3.5, 2.9, 0.5 | Done |
| 3.7 | Verify end-to-end: after a full debate the diagram renders without blank-screen, download produces a valid 5-slide `.pptx` with tradeoffs from the actual debate transcript | Phase 3 | 3.6 | Done |
| 4.1 | ⭐ HIGH PRIORITY — Build Chaos Simulator narrative generator (`lib/chaos/narrative.ts`): given the architecture description, emits a 4–6-beat stress narrative (normal → strain → failure → failover → recovery) | Phase 4 | 2.7 | Done |
| 4.2 | ⭐ HIGH PRIORITY — Build `classDef` diff emitter (`lib/chaos/classDef.ts`): for each narrative beat, outputs only the `classDef` and `class` assignments for affected nodes — never a full re-render | Phase 4 | 4.1, 3.1 | Done |
| 4.3 | ⭐ HIGH PRIORITY — Expose chaos simulator as a streaming API route (`app/api/chaos/route.ts`): POST architecture description → streams beats as SSEs with short inter-beat delay | Phase 4 | 4.2 | Done |
| 4.4 | ⭐ HIGH PRIORITY — Add "Simulate Traffic Spike" button and live diagram recoloring to the UI; beats apply `classDef` diffs without re-mounting the diagram component | Phase 4 | 4.3, 3.6, 0.5 | Done |
| 4.5 | ⭐ HIGH PRIORITY — Verify chaos simulator end-to-end: diagram recolors through all beats, node positions do not jump, final state is visually distinct from initial | Phase 4 | 4.4 | Done |
| 4.6 | Build Watson STT audio upload route (`app/api/audio/route.ts`): accepts `.mp3` multipart upload, calls `granite-speech-4.1-2b` (fallback: watson-stt per `STT_PROVIDER` env), returns transcript text | Phase 4 | 0.2 | Done |
| 4.7 | Build diagram update helper (`lib/mermaid/update.ts`): given a transcript string, extracts architectural critiques and produces a delta Mermaid patch; validates result with `mermaid.parse()` | Phase 4 | 3.1, 4.6 | Done |
| 4.8 | Add audio upload widget and "Update Diagram" button to the UI; wire to `app/api/audio` → `lib/mermaid/update` → `MermaidRenderer` | Phase 4 | 4.7, 3.6, 0.5 | Done |
| 4.9 | Verify audio pipeline end-to-end: upload a test `.mp3`, confirm transcript appears, diagram updates with valid Mermaid, no blank-screen on parse edge cases | Phase 4 | 4.8 | Done |
| 5.1 | Add fallback to every watsonx call: if the primary model is unavailable, retry with the AGENTS.md-documented fallback model and log which model was actually used | Phase 5 | 2.10, 3.7 | Done |
| 5.2 | Add a cached-response fallback for the synthesis step: if `ibm/granite-3-30b-instruct` returns an error, use the last round's SA proposal as the synthesis output rather than failing silently | Phase 5 | 5.1 | Done |
| 5.3 | Add a rule-based fallback for Watson STT / Granite Speech: if `STT_PROVIDER` call fails, return a stub transcript with a clear `"transcription_unavailable"` flag the UI can display gracefully | Phase 5 | 4.9 | Done |
| 5.4 | Extend `/api/health/watsonx` response to include STT provider status and `simple-git` status so the pre-demo checklist is a single endpoint call | Phase 5 | 5.3 | Done |
| 5.5 | Demo rehearsal: run the full flow end-to-end (discovery → debate → diagram → pptx → chaos → audio) once with real watsonx credentials and record any runtime errors | Phase 5 | 5.4, 4.5, 4.9 | Done |
| 5.6 | Fix any issues surfaced by the demo rehearsal and update `AGENTS.md` with any newly discovered failure modes | Phase 5 | 5.5 | Done |
| 5.7 | **STRETCH** — Persona admin UI: a `/settings/personas` screen that lists personas from `/api/personas`, lets a user toggle `enabled` on any persona and add a new persona via a form (all fields from the AGENTS.md persona schema), writes through `lib/git-commit.ts` so new/edited personas are versioned identically to manually-edited files; new personas appear in the next debate without a redeploy | Phase 5 | 2.5r, 5.6 | Done |

---

## Session Protocol

**Every session — including after a context reset — must follow these rules:**

1. **Read `TASKS.md` first.** Do not write a single line of implementation code before reading this file in full.

2. **Pick the next task** whose `Depends On` column contains only tasks marked `Done`. If multiple tasks qualify, pick the lowest-numbered one unless a higher-priority task is explicitly marked ⭐ HIGH PRIORITY and its dependencies are also `Done`.

3. **Mark it `In Progress` before starting.** Edit the Status cell in this table to `In Progress` and save the file. This prevents two sessions from accidentally working on the same task after a reset.

4. **Work on exactly one task at a time.** Do not start a second task until the current one is verified and marked `Done`.

5. **Mark it `Done` only after verifying** — not after just writing code. Verification means the feature works as described (test call succeeds, UI renders correctly, etc.). A task is not `Done` if it compiles but has not been exercised.

6. **Update `TASKS.md` immediately** after marking a task `Done` — do not batch multiple status updates.

7. **If a task is blocked** (a dependency turns out to be broken or missing), mark it `Blocked`, note the blocker inline in this file, and work on a different unblocked task rather than pushing through with assumptions.

---

## Priority Note — Phase 4

Within Phase 4, the **Chaos Simulator tasks (4.1 – 4.5) are high priority** and must be implemented before the Audio Pipeline tasks (4.6 – 4.9). If a session runs short on time or tokens, the Audio Pipeline is the first thing to descope — the Chaos Simulator is a core demo feature and must not be deferred.
