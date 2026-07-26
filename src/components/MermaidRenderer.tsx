"use client";

/**
 * components/MermaidRenderer.tsx
 * TASKS.md 3.2 (updated for 4.4): Client-side Mermaid diagram renderer.
 *
 * Phase 3: renders a diagram string via mermaid.render(), shows parse-error
 * state gracefully (never blank-screens).
 *
 * Phase 4 addition: exposes an imperative `applyClassDefs(nodeStyles)` handle
 * via forwardRef/useImperativeHandle. The chaos simulator uses this to recolor
 * individual SVG nodes by mutating inline styles directly — bypassing
 * mermaid.render() entirely so node positions never jump.
 *
 * The SVG node-ID-to-element mapping relies on the ids Mermaid assigns:
 *   - flowchart nodes: the SVG <g> element's data-id attribute or the id
 *     attribute of the child <rect>/<circle>. Mermaid uses the pattern
 *     `flowchart-<nodeId>-<n>` on the wrapping <g> and sets data-node-id.
 *     We search by `data-node-id` first, then fall back to a text-content scan.
 */

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { NodeStyle } from "@/backend/lib/chaos/classDef";

// ── Public handle type ────────────────────────────────────────────────────────

export interface MermaidRendererHandle {
  /**
   * Apply per-node style overrides directly to the rendered SVG.
   * Called by the chaos panel on each beat — never re-renders the diagram.
   */
  applyClassDefs(nodeStyles: NodeStyle[]): void;
  /** True once the SVG has been successfully rendered. */
  isRendered(): boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MermaidRendererProps {
  /** Mermaid diagram string (e.g. starting with "graph TD"). */
  diagram: string;
  /** Optional: pass false when upstream validation already failed. */
  valid?: boolean;
  /** Optional: upstream parse error message to display in error state. */
  parseError?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

const MermaidRenderer = forwardRef<MermaidRendererHandle, MermaidRendererProps>(
  function MermaidRenderer({ diagram, valid = true, parseError }, ref) {
    const id = useId().replace(/:/g, "m");       // mermaid ids must not contain ":"
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [rendered, setRendered] = useState(false);

    // ── Imperative handle ───────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      isRendered: () => rendered,

      applyClassDefs(nodeStyles: NodeStyle[]) {
        const svg = containerRef.current;
        if (!svg) return;

        for (const { nodeId, fill, stroke, color } of nodeStyles) {
          // Mermaid flowchart: wrapping <g> elements carry data-node-id or
          // an id of the form "flowchart-<nodeId>-<n>". Try both selectors.
          const byDataAttr = svg.querySelectorAll<SVGElement>(
            `[data-node-id="${nodeId}"], [data-id="${nodeId}"]`
          );
          // Fallback: id-prefix match (Mermaid appends a counter)
          const byIdPrefix = svg.querySelectorAll<SVGElement>(
            `[id^="flowchart-${nodeId}-"]`
          );

          const targets: SVGElement[] = [
            ...Array.from(byDataAttr),
            ...Array.from(byIdPrefix),
          ];

          if (targets.length === 0) {
            // Last resort: find the <g> whose text content matches the nodeId
            svg.querySelectorAll<SVGElement>("g.node").forEach((g) => {
              if (g.querySelector(".label")?.textContent?.includes(nodeId)) {
                targets.push(g);
              }
            });
          }

          for (const group of targets) {
            // Apply to any <rect>, <circle>, <polygon> inside the group
            group.querySelectorAll<SVGElement>("rect, circle, polygon, ellipse").forEach((shape) => {
              shape.style.fill = fill;
              shape.style.stroke = stroke;
            });
            // Apply text color
            group.querySelectorAll<SVGElement>("text, .label").forEach((t) => {
              (t as SVGElement).style.fill = color;
            });
          }
        }
      },
    }), [rendered]);

    // ── Render effect ───────────────────────────────────────────────────────
    useEffect(() => {
      setRenderError(null);
      setRendered(false);

      if (!diagram) return;
      if (!valid) {
        setRenderError(parseError ?? "Invalid diagram syntax");
        return;
      }

      let cancelled = false;

      async function render() {
        try {
          const { default: mermaid } = await import("mermaid");

          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            themeVariables: {
              background: "#0e1117",
              mainBkg: "#161b27",
              nodeBorder: "#1f2b3e",
              lineColor: "#4a5568",
              primaryTextColor: "#c9d1e0",
              edgeLabelBackground: "#161b27",
            },
          });

          const { svg } = await mermaid.render(`diagram-${id}`, diagram);
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            setRendered(true);
          }
        } catch (err) {
          if (!cancelled) {
            setRenderError(err instanceof Error ? err.message : String(err));
          }
        }
      }

      void render();
      return () => { cancelled = true; };
    }, [diagram, id, valid, parseError]);

    // ── Error state ──────────────────────────────────────────────────────────
    if (renderError) {
      return (
        <div
          role="alert"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.75rem",
            backgroundColor: "rgba(192, 57, 43, 0.08)",
            border: "1px solid var(--col-chaos-failure)",
            borderRadius: "4px",
            padding: "12px",
            color: "var(--col-chaos-failure)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-plex-condensed)",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "8px",
            }}
          >
            Diagram parse error
          </div>
          <p style={{ marginBottom: "8px", color: "var(--col-muted)" }}>{renderError}</p>
          <details>
            <summary style={{ cursor: "pointer", color: "var(--col-muted)", marginBottom: "4px" }}>
              Raw Mermaid source
            </summary>
            <pre
              style={{
                marginTop: "6px",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                color: "var(--col-ink)",
                fontSize: "0.6875rem",
              }}
            >
              {diagram}
            </pre>
          </details>
        </div>
      );
    }

    // ── Container is always mounted so containerRef is available to the render
    // effect. The skeleton overlay is shown until the SVG has been injected.
    return (
      <>
        {!rendered && (
          <div
            aria-busy="true"
            aria-label="Rendering diagram…"
            style={{
              height: "200px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--col-base)",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
              color: "var(--col-muted)",
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.75rem",
            }}
          >
            <span className="animate-pulse">Rendering diagram…</span>
          </div>
        )}
        <div
          ref={containerRef}
          aria-label="Architecture diagram"
          style={{
            width: "100%",
            overflowX: "auto",
            backgroundColor: "var(--col-base)",
            borderRadius: "4px",
            display: rendered ? "block" : "none",
          }}
        />
      </>
    );
  }
);

MermaidRenderer.displayName = "MermaidRenderer";
export default MermaidRenderer;
