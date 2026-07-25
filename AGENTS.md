# AGENTS.md

## Model routing — do not change without updating this file

> **Region note:** model availability is region-scoped. IDs below are verified
> against the **us-south** catalog. The project in `.env.local` is currently in
> **ca-tor**, which only has llama/mistral models — switch the project to
> us-south before running the debate engine, or accept the fallback behaviour.

- Debater personas (`role_type: debater`): `ibm/granite-4-h-small`
  — verified present in us-south; absent in ca-tor (fallback: `meta-llama/llama-3-3-70b-instruct`)
- Guardian personas (`role_type: guardian`): `ibm/granite-guardian-3-8b` (us-south catalog ID)
  — thinking mode (`reasoningEffort: high`), BYOC criteria loaded from `compliance_ref` field at runtime
- Synthesis step: `ibm/granite-3-30b-instruct` — call ONCE per session, never in the debate loop
- Audio: granite-speech-4.1-2b primary, watson-stt fallback (env: STT_PROVIDER)

## Persona schema

Every file in `/personas/agents/*.md` must begin with a YAML frontmatter block.
The markdown body below the frontmatter is the persona's verbatim system prompt.

```yaml
---
id: <slug>            # unique, lowercase, no spaces (e.g. "sre", "finops", "my-custom-agent")
name: <display name>  # shown in the UI agent badge
role_type: debater | guardian
model: <watsonx model ID>           # overrides the AGENTS.md default for this persona
enabled: true | false               # false = skipped by the loader, still in git history
turn_order: <integer>               # ascending; lower = earlier in each round
accent_color: "<hex>"               # optional; if omitted the UI uses a default palette cycle
compliance_ref: "<glob>"            # guardian only — path glob relative to repo root
                                    # e.g. "personas/compliance/*.md"
---
```

**Field rules:**
- `id` must be unique across all files in `/personas/agents/`. The loader rejects duplicates.
- `role_type: debater` personas must NOT have a `compliance_ref` field.
- `role_type: guardian` personas MUST have a `compliance_ref` field pointing to at least one existing file.
- `model` is required; it may repeat the AGENTS.md default or override it per-persona.
- `enabled: false` is the correct way to retire a persona — never delete the file (git history is the audit trail).

## Persona loader caps

- **Max 6 active `role_type: debater` personas per session**, enforced by `lib/debate/load-personas.ts`.
  If more than 6 are enabled, the loader takes the first 6 by `turn_order` and logs a warning.
- The 3-round debate cap applies regardless of how many personas are active.
- Per-round agent calls run **concurrently** (`Promise.all`) so that adding personas does not
  linearly increase round wall-clock latency. Each agent call must be independently awaitable.

## Debate loop
- Fixed at 3 rounds max, then forced synthesis. Never let the graph run unbounded.
- Each agent turn must end with either an objection + reason, or an explicit "no objection".
- LangGraph state, not raw LangChain chains — the loop must be resumable and inspectable.
- The graph is built dynamically from the persona loader's output — it does not hardcode
  node names. Adding or removing a persona file changes the graph without touching graph.ts.

## GitOps for AI
- Persona and compliance mandate files live in /personas/**.md and are Bob Skills (.bob/skills/).
- Every edit to a persona/mandate file must be a real git commit via simple-git, never a silent overwrite.
- The persona loader reads frontmatter at runtime; editing a persona file and committing it
  takes effect on the next request without a redeploy.

## Known failure modes
- watsonx auth fails silently if Project ID is wrong for the region — check /api/health/watsonx before demoing.
- Mermaid output from the LLM must be validated (mermaid.parse) before rendering, or the UI blank-screens.
- A persona file with malformed frontmatter will cause the loader to skip that file and log a warning;
  the debate continues with the remaining valid personas. This is by design — never hard-crash on one bad file.
- `commitFile` in `lib/git-commit.ts` calls `git.status()` before committing; if the persona file content
  is identical to what was already on disk, it skips the commit silently (no empty-commit error).
- The chaos SSE handler uses a labeled `outer:` while loop — `break outer` on `done`/`error` events
  exits the reader immediately. A plain `break` in the inner `for` loop would only exit the `for`.
- Watson STT is only enabled when `STT_PROVIDER=watson` AND both `WATSON_STT_APIKEY` and `WATSON_STT_URL`
  are set. Without these, `/api/audio` returns `{ transcription_unavailable: true }` with HTTP 200.
  The UI displays an amber notice rather than an error. Granite Speech (`granite-speech-4.1-2b`) is not
  yet available via the standard `ml/v1` REST API for multipart audio.