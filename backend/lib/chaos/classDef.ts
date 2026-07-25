/**
 * lib/chaos/classDef.ts
 * TASKS.md 4.2 — Mermaid classDef diff emitter.
 *
 * For each chaos beat, builds the minimal Mermaid snippet that recolors
 * affected nodes using classDef + class directives.
 *
 * The patch is appended to the live SVG via DOM manipulation — it is never
 * passed back through mermaid.render() (which would re-mount and jump positions).
 *
 * Colors from DESIGN.md §2 / globals.css:
 *   normal   #2d7a6e  stroke #1a4d44
 *   strain   #c98a1a  stroke #8a5d10
 *   failure  #c0392b  stroke #7a1f15
 *   failover #7c5cd8  stroke #4e38a3  (improvised — no DESIGN.md token, using cobalt variant)
 *   recovery #3b7a57  stroke #1f4d33
 */
import type { ChaosBeat, ChaosState } from "@/backend/lib/chaos/narrative";

// ── Color map ─────────────────────────────────────────────────────────────────

interface StateStyle {
  fill: string;
  stroke: string;
  color: string; // text color
}

const STATE_STYLES: Record<ChaosState, StateStyle> = {
  normal:   { fill: "#2d7a6e", stroke: "#1a4d44", color: "#c9d1e0" },
  strain:   { fill: "#c98a1a", stroke: "#8a5d10", color: "#0e1117" },
  failure:  { fill: "#c0392b", stroke: "#7a1f15", color: "#c9d1e0" },
  failover: { fill: "#7c5cd8", stroke: "#4e38a3", color: "#c9d1e0" },
  recovery: { fill: "#3b7a57", stroke: "#1f4d33", color: "#c9d1e0" },
};

// ── Mermaid patch builder ─────────────────────────────────────────────────────

/**
 * Build a Mermaid classDef patch for the given beat.
 * Returns a multi-line string like:
 *
 *   classDef failure fill:#c0392b,stroke:#7a1f15,color:#c9d1e0
 *   class APIGateway failure
 *   class LoadBalancer failure
 *
 * This string is intended to be passed to the MermaidRenderer's `applyClassDefs`
 * imperative method, which applies the style changes directly to the rendered SVG
 * without remounting the component.
 */
export function buildClassDefPatch(beat: ChaosBeat): string {
  const style = STATE_STYLES[beat.state];

  const classDefLine = `classDef ${beat.state} fill:${style.fill},stroke:${style.stroke},color:${style.color}`;
  const classLines = beat.affectedNodes
    .filter((n) => n !== "unknown")
    .map((nodeId) => `class ${nodeId} ${beat.state}`);

  return [classDefLine, ...classLines].join("\n");
}

// ── Style extractor (used by MermaidRenderer to parse and apply patches) ──────

export interface NodeStyle {
  nodeId: string;
  fill: string;
  stroke: string;
  color: string;
}

/**
 * Parse a classDef patch string into a flat list of (nodeId → style) mappings.
 * The MermaidRenderer uses this to apply inline CSS to SVG elements directly.
 */
export function parseClassDefPatch(patch: string): NodeStyle[] {
  const styles: Record<string, StateStyle> = {};

  for (const line of patch.split("\n")) {
    const defMatch = line.match(/^classDef\s+(\S+)\s+fill:([^,]+),stroke:([^,]+),color:(.+)$/);
    if (defMatch) {
      const [, name, fill, stroke, color] = defMatch;
      styles[name] = { fill: fill.trim(), stroke: stroke.trim(), color: color.trim() };
      continue;
    }

    const classMatch = line.match(/^class\s+(\S+)\s+(\S+)$/);
    if (classMatch) {
      const [, nodeId, styleName] = classMatch;
      const s = styles[styleName];
      if (s) {
        // yield later — collected below
        void { nodeId, styleName, s };
      }
    }
  }

  // Two-pass: collect all class assignments after we know all classDefs
  const result: NodeStyle[] = [];
  const lines = patch.split("\n");

  for (const line of lines) {
    const classMatch = line.match(/^class\s+(\S+)\s+(\S+)$/);
    if (classMatch) {
      const [, nodeId, styleName] = classMatch;
      const s = styles[styleName];
      if (s) result.push({ nodeId, fill: s.fill, stroke: s.stroke, color: s.color });
    }
  }

  return result;
}
