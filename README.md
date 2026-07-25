# 🏗️ The AI Enterprise Architect

> **Built for the IBM AI Builders Challenge**  
> Transforming enterprise IT architecture from a manual bottleneck into an AI-augmented creative process.

The AI Enterprise Architect is a multimodal AI creative partner that bridges the gap between business imagination and technical execution. Instead of acting as a simple code generator, this platform simulates a real-world Architecture Review Board. It orchestrates a debate among specialized AI personas to design, stress-test, and document enterprise-grade infrastructure.

## ✨ Core Features

* **GitOps for AI (PromptOps):** AI guardrails, agent personas (SA, SRE, FinOps, Security), and compliance mandates are stored as version-controlled Markdown files under `backend/personas/`. Enterprise teams govern AI behavior via standard Pull Requests — edits take effect on the next request without a redeploy.
* **The Multi-Agent War Room:** Powered by IBM Granite models via watsonx, specialized AI agents debate architectural trade-offs (speed vs. cost vs. reliability) in a bounded 3-round LangGraph loop. Per-round agent calls run concurrently; adding a persona does not increase wall-clock latency.
* **Technical Storytelling:** The platform automatically translates the agreed-upon architecture into two deliverables:
  * A dynamically rendered **Mermaid.js** visual diagram (validated with `mermaid.parse()` before rendering).
  * A downloadable **Executive Pitch Deck** (`.pptx`) generated with `pptxgenjs`, tailored for the C-Suite.
* **Audio Feedback Loop (The Review Board):** Upload a meeting recording (`.mp3`). A Scrum Master agent extracts architectural critiques and autonomously patches the Mermaid diagram to reflect human feedback. Uses `granite-speech-4.1-2b` as primary STT, Watson Speech-to-Text as fallback (controlled by `STT_PROVIDER` env var).
* **Chaos Engineering Storyteller:** Simulate stress tests (e.g., "Black Friday Traffic"). The AI generates a multi-beat narrative (normal → strain → failure → failover → recovery) while updating Mermaid `classDef` diffs in real-time to recolor nodes — never a full re-render.

## 🤖 Agent Personas

Four specialized debater personas and one guardian persona, each defined as a Markdown file under `backend/personas/agents/`:

| Agent | Role | Model |
|-------|------|-------|
| **Solutions Architect (SA)** | Proposes and iteratively refines the architecture | `ibm/granite-4-h-small` |
| **SRE** | Critiques for reliability, latency, and SLO risk | `ibm/granite-4-h-small` |
| **FinOps** | Critiques for cost efficiency and TCO | `ibm/granite-4-h-small` |
| **Security** | Evaluates against BYOC compliance mandates (IAM, data residency) | `ibm/granite-guardian-3-8b` |

Synthesis is performed exactly once per session by `ibm/granite-3-30b-instruct` — never in the debate loop.

> **Region note:** `ibm/granite-4-h-small` is verified in **us-south**. The fallback model for `ca-tor` is `meta-llama/llama-3-3-70b-instruct`. Set `WATSONX_AI_REGION=us-south` in your `.env.local` for full Granite support.

## 🛠️ Tech Stack

* **LLM Engine:** IBM Granite (`granite-4-h-small`, `granite-guardian-3-8b`, `granite-3-30b-instruct`) via `watsonx-ai-provider`
* **AI SDK:** Vercel AI SDK (`ai` package) — `generateText` / `streamText`
* **Orchestration:** LangGraph (`@langchain/langgraph`) — bounded 3-round `StateGraph` built dynamically from persona files
* **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4
* **State Management:** Zustand
* **Visuals & Deliverables:** Mermaid.js v11 (validated SVGs), `pptxgenjs` v4 (PowerPoint generation)
* **GitOps:** `simple-git` — every persona edit is a real git commit, never a silent overwrite
* **Markdown Parsing:** `gray-matter` (persona frontmatter), custom frontmatter loader

## 📂 Project Structure

```text
/ai-enterprise-architect
├── backend/
│   ├── personas/
│   │   ├── agents/              # GitOps agent persona files (Markdown + YAML frontmatter)
│   │   │   ├── sa.md            # Solutions Architect — proposes the initial design
│   │   │   ├── sre.md           # Site Reliability Engineer — reliability / SLO critiques
│   │   │   ├── finops.md        # FinOps — cost efficiency and TCO critiques
│   │   │   └── security.md      # Security guardian — BYOC compliance evaluation
│   │   └── compliance/          # Compliance mandate files loaded by the Security agent
│   │       ├── iam.md           # IAM rules (least-privilege, MFA, session expiry)
│   │       └── data-residency.md # Data residency rules (PII region, cross-border logging)
│   ├── lib/
│   │   ├── debate/              # LangGraph debate engine
│   │   │   ├── state.ts         # DebateState type
│   │   │   ├── graph.ts         # StateGraph — dynamic node wiring from persona loader
│   │   │   ├── load-personas.ts # Runtime persona loader (max 6 debaters, turn_order sort)
│   │   │   ├── synthesis.ts     # One-shot synthesis via granite-3-30b-instruct
│   │   │   └── agents/          # Individual agent node implementations
│   │   ├── mermaid/
│   │   │   ├── generate.ts      # Mermaid generation with mermaid.parse() validation + retry
│   │   │   └── update.ts        # Diagram patch from audio transcript
│   │   ├── pptx/
│   │   │   └── generate.ts      # 5-slide pitch deck via pptxgenjs
│   │   ├── chaos/
│   │   │   ├── narrative.ts     # ChaosBeat narrative generator (4–6 beats)
│   │   │   └── classDef.ts      # Mermaid classDef diff emitter (no full re-render)
│   │   └── git-commit.ts        # commitFile() — simple-git GitOps helper
│   └── scripts/
│       └── verify-git.ts        # Sanity-checks simple-git against the repo
├── src/
│   ├── app/
│   │   ├── api/                 # Next.js App Router API routes
│   │   │   ├── debate/          # POST → SSE debate stream
│   │   │   ├── diagram/         # POST → validated Mermaid JSON; /update for audio patches
│   │   │   ├── pitch-deck/      # POST → .pptx binary download
│   │   │   ├── chaos/           # POST → SSE chaos beat stream (1400ms inter-beat delay)
│   │   │   ├── audio/           # POST multipart → transcript (Granite Speech / Watson STT)
│   │   │   ├── discovery/       # POST → structured creative brief JSON
│   │   │   ├── personas/        # CRUD for persona files (GitOps-backed)
│   │   │   └── health/watsonx/  # Health check endpoint
│   │   ├── settings/personas/   # Persona management UI page
│   │   └── page.tsx             # Three-column war-room dashboard
│   └── components/
│       ├── MermaidRenderer.tsx  # Client component — renders diagram, exposes patchClassDefs()
│       ├── WarRoomFeed.tsx       # SSE consumer — renders live agent turn cards
│       ├── AgentTurnCard.tsx     # Individual agent turn (streaming pulse, objection badge)
│       ├── RoundCounter.tsx      # Circuit-strip round progress indicator
│       ├── ChaosBeatIndicator.tsx# Beat progress row with chaos state colors
│       └── AudioPanel.tsx       # Audio upload, transcript preview, diagram update trigger
├── AGENTS.md                    # Model routing, persona schema, debate loop rules
├── DESIGN.md                    # Design system — color tokens, typography, layout wireframe
├── .env.example                 # Required environment variable reference
└── next.config.ts
```

## ⚙️ Setup

1. **Clone** the repo and run `npm install`.
2. **Copy** `.env.example` to `.env.local` and fill in your watsonx credentials:
   ```
   WATSONX_AI_APIKEY=<your key>
   WATSONX_AI_PROJECT_ID=<your project id>
   WATSONX_AI_REGION=us-south
   ```
3. **Run** `npm run dev` and open [http://localhost:3000](http://localhost:3000).
4. **Verify** the watsonx connection at `/api/health/watsonx` before running a full debate.

Optional: set `STT_PROVIDER=watson` and provide `WATSON_STT_APIKEY` / `WATSON_STT_URL` to enable real audio transcription. Without these, the audio panel returns a graceful `transcription_unavailable` notice.
