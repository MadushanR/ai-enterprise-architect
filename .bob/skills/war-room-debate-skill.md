# War Room Debate Skill

## Purpose
Run the multi-agent architecture debate as a bounded, resumable LangGraph
state machine — never an open-ended chain that might not converge. The set
of agents is not hardcoded; it is loaded at runtime from `/personas/agents/`
by the persona loader, so the debate adapts to however many personas are
enabled without changing any graph code.

## When to use
Whenever a new architecture proposal enters the debate phase (Phase 2),
triggered after Phase 1 discovery produces a creative brief.

## Workflow
1. Call `loadPersonas()` (`lib/debate/load-personas.ts`) to get the active
   `PersonaConfig[]`, sorted by `turn_order`. This is the only place that
   touches the filesystem for persona data during a debate.
2. Build LangGraph nodes dynamically:
   - For each `role_type: debater` persona → `debaterNode(persona)` factory
     (`lib/debate/agents/debater.ts`)
   - For each `role_type: guardian` persona → `guardianNode(persona)` factory
     (`lib/debate/agents/guardian.ts`)
3. Initialize graph state: `{ proposal, round: 0, objections: [], resolved: false, transcript: [] }`
4. Round loop (max 3 rounds):
   - The first debater in turn order proposes/refines the design.
   - All remaining debaters run **concurrently** (`Promise.all`) — each
     responds with `OBJECTION: <reason>` or `NO OBJECTION`.
   - All guardians run **concurrently** after debaters complete — each
     evaluates against its `compliance_ref` BYOC mandate files.
   - If all active personas have no unresolved objections → exit loop.
   - Otherwise increment round, feed objections back to the first debater.
5. If round hits 3 without resolution → force synthesis anyway; flag all
   unresolved objections explicitly in the output (never drop them silently).
6. Synthesis step (single call to `ibm/granite-3-30b-instruct`, outside the
   loop): produce a canonical architecture description for diagram and deck.

## Guardrails
- Never call the synthesis model inside the round loop — synthesis once only.
- Max 6 active `role_type: debater` personas enforced by the loader.
  The graph does not need its own cap check.
- Stream each agent's completed turn to the frontend via SSE as soon as it
  finishes — don't hold turns until the full round completes.
- Log every round (agent id, round index, model used, objection status) to
  make the debate inspectable and debuggable, not just the final result.
- If a persona file has malformed frontmatter, the loader skips it with a
  warning. The debate proceeds with the remaining valid personas.