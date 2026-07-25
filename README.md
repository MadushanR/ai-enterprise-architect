# 🏗️ The AI Enterprise Architect

> **Built for the IBM AI Builders Challenge** 
> Transforming enterprise IT architecture from a manual bottleneck into an AI-augmented creative process.

The AI Enterprise Architect is a multimodal AI creative partner that bridges the gap between business imagination and technical execution. Instead of acting as a simple code generator, this platform simulates a real-world Architecture Review Board. It orchestrates a debate among specialized AI personas to design, stress-test, and document enterprise-grade infrastructure.

## ✨ Core Features

* **GitOps for AI (PromptOps):** AI guardrails, agent personas (SRE, FinOps, Security), and compliance mandates are stored as version-controlled Markdown files, allowing enterprise teams to govern AI behavior via standard Pull Requests.
* **The Multi-Agent War Room:** Powered by IBM Granite, specialized AI agents interrogate user requirements and debate architectural trade-offs (e.g., speed vs. cost vs. reliability) until a consensus is reached.
* **Technical Storytelling:** The platform automatically translates the agreed-upon architecture into two deliverables:
  * A dynamically rendered **Mermaid.js** visual diagram.
  * A downloadable **Executive Pitch Deck** (.pptx) tailored for the C-Suite, focusing on ROI and business value.
* **Audio Feedback Loop (The Review Board):** Upload a meeting recording (`.mp3`). Using IBM Watson Speech-to-Text, a "Scrum Master" agent extracts architectural critiques and autonomously updates the Mermaid diagram to reflect human feedback.
* **Chaos Engineering Storyteller:** Simulate stress tests (e.g., "Black Friday Traffic"). The AI generates a narrative of system performance while dynamically updating the diagram's CSS to visualize bottlenecks and failovers in real-time.

## 🛠️ Tech Stack

* **LLM Engine:** IBM Granite (via watsonx)
* **Audio Processing:** IBM Watson Speech-to-Text (with diarization)
* **Orchestration:** LangChain (Node.js)
* **Frontend:** Next.js (App Router), React, Tailwind CSS
* **Visuals & Deliverables:** Mermaid.js (SVGs), `pptxgenjs` (PowerPoint generation), `gray-matter` (Markdown parsing)

## 📂 Project Structure

```text
/ai-enterprise-architect
├── /agents                  # GitOps Agent Personas (Markdown)
│   ├── 01_architect.md      # Proposes the initial design
│   ├── 02_sre.md            # Critiques for reliability/toil
│   └── 03_finops.md         # Critiques for cost efficiency
├── /skills                  # Enterprise Knowledge Base (Markdown)
│   └── aws-cost-matrix.md   # Domain knowledge injected into agents
├── /app
│   ├── /api                 # LangChain routing, Watson STT, PPTX generators
│   └── page.tsx             # Main Split-Screen Dashboard UI
├── /components              # React components (MermaidRenderer, ChatFeed)
└── /lib                     # Utilities (Agent parser, Watsonx wrappers)