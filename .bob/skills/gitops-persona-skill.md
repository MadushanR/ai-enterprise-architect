# GitOps Persona & Compliance Skill

## Purpose
Manage agent persona definitions and compliance mandates as version-controlled
markdown files, so every change to "how an agent thinks" is a real, auditable
git commit — not a silent overwrite. Personas are discovered and loaded at
runtime by `lib/debate/load-personas.ts`; adding, editing, or disabling a
persona file takes effect on the next request without a redeploy.

## When to use
Any time a persona file in `/personas/agents/*.md` or a compliance mandate
in `/personas/compliance/*.md` is created or edited.

## Persona file structure
Every `/personas/agents/*.md` file must begin with a YAML frontmatter block
(see AGENTS.md §Persona schema for the full field reference), followed by the
persona's system prompt as the markdown body:

```markdown
---
id: my-agent
name: My Agent
role_type: debater        # or: guardian
model: ibm/granite-4-h-small
enabled: true
turn_order: 3
accent_color: "#6ab04c"   # optional
# compliance_ref: "personas/compliance/*.md"  # guardian only
---

You are a ... (system prompt begins here)
```

## Workflow
1. Read the existing file (if it exists) before editing — never blind-overwrite.
2. Make the edit in memory, keeping frontmatter valid YAML.
3. Write the file via `lib/git-commit.ts` (`commitFile`) so the write and
   commit are atomic from the caller's perspective.
4. Commit message must describe WHAT changed and WHY
   (e.g. "persona(sre): tighten P99 latency objection threshold to 200ms").
5. Never batch unrelated persona edits into one commit — one concern per commit.
6. To retire a persona, set `enabled: false` and commit — never delete the file.

## Guardrails
- The frontmatter block must be valid YAML. A parse error causes the loader
  to skip the file entirely and log a warning; it does not crash the debate.
- Compliance mandate files must stay in a format Granite Guardian's
  Bring-Your-Own-Criteria can parse (see mandate template below).
- Persona system prompts should stay under ~40 lines. If a persona needs more
  nuance, split it into a base persona + a scenario-specific addendum rather
  than one sprawling file.
- `role_type: debater` files must NOT contain a `compliance_ref` field.
- `role_type: guardian` files MUST contain a `compliance_ref` glob that
  resolves to at least one existing file.

## Mandate template
```
## Rule: <short name>
Enforced by: <agent id>
Statement: <one sentence, testable>
Example violation: <one concrete example>
```