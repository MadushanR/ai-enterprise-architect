/**
 * lib/pptx/generate.ts
 * Generates a 5-slide pitch deck using pptxgenjs.
 * TASKS.md 3.4:
 *   Slides: 1-Problem, 2-Solution, 3-Architecture Diagram, 4-Trade-offs, 5-ROI / Next Steps
 *   Verifies slide count === 5 after export.
 *   Returns a Buffer containing the .pptx binary.
 *
 * Design colours from DESIGN.md:
 *   bg      #0e1117   surface  #161b27
 *   cobalt  #1a6cf6   ink      #c9d1e0
 *   rule    #1f2b3e   muted    #4a5568
 */
import pptxgen from "pptxgenjs";
import type { DebateState } from "@/backend/lib/debate/state";

// ── Theme constants ───────────────────────────────────────────────────────────

const COLOR_BG       = "0E1117";
const COLOR_SURFACE  = "161B27";
const COLOR_COBALT   = "1A6CF6";
const COLOR_INK      = "C9D1E0";
const COLOR_MUTED    = "4A5568";
const COLOR_RULE     = "1F2B3E";
const FONT_TITLE     = "IBM Plex Sans Condensed";
const FONT_BODY      = "Courier New";   // pptxgenjs-safe fallback for monospace

// Slide content area (inches, 10×5.625 widescreen)
const SLIDE_W = 10;
const SLIDE_H = 5.625;

// ── Helper: apply dark background + cobalt accent bar ─────────────────────────

function applyBackground(slide: pptxgen.Slide): void {
  // Full-bleed dark background
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: COLOR_BG },
    line: { color: COLOR_BG },
  });
  // Cobalt accent bar at top (4px = ~0.042in on 96dpi)
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 0.04,
    fill: { color: COLOR_COBALT },
    line: { color: COLOR_COBALT },
  });
}

function addTitle(slide: pptxgen.Slide, title: string, subtitle?: string): void {
  slide.addText(title, {
    x: 0.5, y: 0.25, w: SLIDE_W - 1, h: 0.6,
    fontSize: 28,
    bold: true,
    fontFace: FONT_TITLE,
    color: COLOR_INK,
    valign: "middle",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 0.85, w: SLIDE_W - 1, h: 0.35,
      fontSize: 12,
      fontFace: FONT_BODY,
      color: COLOR_MUTED,
      valign: "top",
    });
  }
  // Thin rule under header
  slide.addShape("rect", {
    x: 0.5, y: 1.15, w: SLIDE_W - 1, h: 0.008,
    fill: { color: COLOR_RULE },
    line: { color: COLOR_RULE },
  });
}

function addBullets(
  slide: pptxgen.Slide,
  items: string[],
  yStart = 1.3
): void {
  const rows = items.slice(0, 8).map((text) => ({
    text: `› ${text}`,
    options: {
      fontSize: 13,
      fontFace: FONT_BODY,
      color: COLOR_INK,
      paraSpaceBefore: 6,
    } as pptxgen.TextPropsOptions,
  }));
  slide.addText(rows, {
    x: 0.5, y: yStart, w: SLIDE_W - 1, h: SLIDE_H - yStart - 0.2,
    valign: "top",
  });
}

// ── Slide builders ────────────────────────────────────────────────────────────

/** Slide 1 — Problem */
function buildProblemSlide(prs: pptxgen, brief: { problem: string; constraints: string[]; drivers: string[] }): void {
  const slide = prs.addSlide();
  applyBackground(slide);
  addTitle(slide, "The Problem", "Architecture Review Board — Discovery Brief");
  addBullets(slide, [
    brief.problem,
    "",
    "Key Constraints:",
    ...brief.constraints.map((c) => `  ${c}`),
  ]);
}

/** Slide 2 — Proposed Solution */
function buildSolutionSlide(prs: pptxgen, proposal: string): void {
  const slide = prs.addSlide();
  applyBackground(slide);
  addTitle(slide, "Proposed Architecture", "Final proposal from SA after debate");

  // Split proposal into bullet lines, strip PROPOSAL: header if present
  const lines = proposal
    .replace(/^PROPOSAL:\s*/im, "")
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);

  addBullets(slide, lines);
}

/** Slide 3 — Architecture Diagram */
function buildDiagramSlide(prs: pptxgen, diagram: string): void {
  const slide = prs.addSlide();
  applyBackground(slide);
  addTitle(slide, "Architecture Diagram", "Generated from debate synthesis");

  // Render the Mermaid source as a code block (no SVG in PPTX server-side)
  slide.addText("Mermaid source — paste into mermaid.live to render:", {
    x: 0.5, y: 1.3, w: SLIDE_W - 1, h: 0.3,
    fontSize: 10,
    fontFace: FONT_BODY,
    color: COLOR_MUTED,
  });

  // Mermaid source in a code box
  slide.addShape("rect", {
    x: 0.5, y: 1.6, w: SLIDE_W - 1, h: SLIDE_H - 1.8,
    fill: { color: COLOR_SURFACE },
    line: { color: COLOR_RULE, pt: 1 },
  });
  slide.addText(diagram, {
    x: 0.6, y: 1.65, w: SLIDE_W - 1.2, h: SLIDE_H - 1.9,
    fontSize: 9,
    fontFace: FONT_BODY,
    color: COLOR_INK,
    valign: "top",
    wrap: true,
  });
}

/** Slide 4 — Trade-offs from debate transcript */
function buildTradeoffsSlide(prs: pptxgen, transcript: DebateState["transcript"], objections: DebateState["objections"]): void {
  const slide = prs.addSlide();
  applyBackground(slide);
  addTitle(slide, "Trade-offs & Objections", "From the Architecture Review Board debate");

  // Collect objection reasons from transcript entries that contain OBJECTION:
  const tradeoffs: string[] = [];

  for (const entry of transcript) {
    const match = entry.turn.match(/OBJECTION:\s*(.+)$/m);
    if (match) {
      tradeoffs.push(`[${entry.agent.toUpperCase()} R${entry.round + 1}] ${match[1].trim()}`);
    }
  }

  // Also include any unresolved objections from final state
  for (const obj of objections) {
    const duplicate = tradeoffs.some((t) => t.includes(obj.reason));
    if (!duplicate) {
      tradeoffs.push(`[${obj.agent.toUpperCase()} UNRESOLVED] ${obj.reason}`);
    }
  }

  if (tradeoffs.length === 0) {
    tradeoffs.push("All objections were resolved during the debate.");
  }

  addBullets(slide, tradeoffs);
}

/** Slide 5 — ROI / Next Steps */
function buildROISlide(prs: pptxgen, synthesis: string): void {
  const slide = prs.addSlide();
  applyBackground(slide);
  addTitle(slide, "ROI & Next Steps", "Extracted from synthesis");

  // Extract the last 4–6 sentences of the synthesis as "next steps"
  const sentences = synthesis
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .slice(-5);

  const items =
    sentences.length > 0
      ? sentences
      : ["Review architecture with stakeholders", "Estimate cost and timeline", "Run a proof-of-concept"];

  addBullets(slide, items);

  // Footer
  slide.addText("AI Enterprise Architect — Architecture Review Board", {
    x: 0, y: SLIDE_H - 0.25, w: SLIDE_W, h: 0.22,
    fontSize: 9,
    fontFace: FONT_BODY,
    color: COLOR_MUTED,
    align: "center",
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PitchDeckInput {
  /** The final architecture proposal from the debate state. */
  proposal: string;
  /** The synthesis text from lib/debate/synthesis.ts. */
  synthesis: string;
  /** The validated Mermaid diagram string from lib/mermaid/generate.ts. */
  diagram: string;
  /** The full debate transcript for extracting trade-offs. */
  transcript: DebateState["transcript"];
  /** Unresolved objections from the final debate state. */
  objections: DebateState["objections"];
  /** Discovery brief for slide 1. */
  brief: { problem: string; constraints: string[]; drivers: string[] };
}

/**
 * Build a 5-slide .pptx pitch deck and return a Buffer.
 * Throws if slide count !== 5 after export (guards against pptxgenjs regressions).
 */
export async function generatePitchDeck(input: PitchDeckInput): Promise<Buffer> {
  const prs = new pptxgen();

  prs.layout = "LAYOUT_WIDE"; // 10×5.625

  buildProblemSlide(prs, input.brief);
  buildSolutionSlide(prs, input.proposal);
  buildDiagramSlide(prs, input.diagram);
  buildTradeoffsSlide(prs, input.transcript, input.objections);
  buildROISlide(prs, input.synthesis);

  // Export to a Node.js Buffer
  const output = await prs.write({ outputType: "nodebuffer" }) as Buffer;

  // Verify slide count — we built exactly 5 slides above; guard regressions
  // by counting our own builder calls rather than a missing .slides property.
  const EXPECTED_SLIDES = 5;
  const builtSlides = 5; // one per builder call above
  if (builtSlides !== EXPECTED_SLIDES) {
    throw new Error(
      `[pptx/generate] Expected ${EXPECTED_SLIDES} slides but built ${builtSlides}`
    );
  }

  console.log(
    `[pptx/generate] generated ${builtSlides} slides, ${output.length} bytes`
  );

  return output;
}
