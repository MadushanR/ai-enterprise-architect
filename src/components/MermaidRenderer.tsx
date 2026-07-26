"use client";

/**
 * components/MermaidRenderer.tsx
 * TASKS.md 3.2 (updated for 4.4 + live chaos animations): Client-side Mermaid diagram renderer.
 *
 * Phase 4 addition: exposes an imperative handle via forwardRef/useImperativeHandle:
 *   - applyClassDefs(nodeStyles)  — recolour SVG nodes without re-rendering
 *   - animateNodes(nodeIds, state) — trigger per-state CSS animation on affected nodes
 *   - getSvgContainer()            — return the underlying div so callers can measure node positions
 *   - isRendered()                 — true once SVG has been injected
 */

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { NodeStyle } from "@/backend/lib/chaos/classDef";
import type { ChaosState } from "@/backend/lib/chaos/narrative";

// ── Public handle type ────────────────────────────────────────────────────────

export interface MermaidRendererHandle {
  /** Apply per-node style overrides directly to the rendered SVG. */
  applyClassDefs(nodeStyles: NodeStyle[]): void;
  /**
   * Trigger a per-state CSS animation on the given node groups.
   * Classes are auto-removed after the animation completes.
   */
  animateNodes(nodeIds: string[], state: ChaosState): void;
  /** Return the container div holding the SVG (for position measurement). */
  getSvgContainer(): HTMLDivElement | null;
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
  /** Called once after the SVG has been successfully injected into the DOM. */
  onRendered?: () => void;
}

// ── Animation class map ───────────────────────────────────────────────────────

const STATE_ANIM_CLASS: Record<ChaosState, string> = {
  normal:   "chaos-node-normal",
  strain:   "chaos-node-strain",
  failure:  "chaos-node-failure",
  failover: "chaos-node-failover",
  recovery: "chaos-node-recovery",
};

// Duration (ms) that the animation class stays on the element before removal.
// Must be >= the CSS animation duration for each state.
const STATE_ANIM_DURATION: Record<ChaosState, number> = {
  normal:   450,
  strain:   2300,
  failure:  600,
  failover: 600,
  recovery: 750,
};

// ── Component ─────────────────────────────────────────────────────────────────

const MermaidRenderer = forwardRef<MermaidRendererHandle, MermaidRendererProps>(
  function MermaidRenderer({ diagram, valid = true, parseError, onRendered }, ref) {
    const id = useId().replace(/:/g, "m");       // mermaid ids must not contain ":"
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [rendered, setRendered] = useState(false);

    // ── Helper: collect all SVG group elements for a given nodeId ──────────
    function getNodeGroups(svg: HTMLDivElement, nodeId: string): SVGElement[] {
      const byDataAttr = Array.from(svg.querySelectorAll<SVGElement>(
        `[data-node-id="${nodeId}"], [data-id="${nodeId}"]`
      ));
      const byIdPrefix = Array.from(svg.querySelectorAll<SVGElement>(
        `[id^="flowchart-${nodeId}-"]`
      ));

      const targets: SVGElement[] = [...byDataAttr, ...byIdPrefix];

      if (targets.length === 0) {
        svg.querySelectorAll<SVGElement>("g.node").forEach((g) => {
          if (g.querySelector(".label")?.textContent?.includes(nodeId)) {
            targets.push(g);
          }
        });
      }
      return targets;
    }

    // ── Imperative handle ───────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      isRendered: () => rendered,

      getSvgContainer: () => containerRef.current,

      applyClassDefs(nodeStyles: NodeStyle[]) {
        const svg = containerRef.current;
        if (!svg) return;

        for (const { nodeId, fill, stroke, color } of nodeStyles) {
          const targets = getNodeGroups(svg, nodeId);

          for (const group of targets) {
            group.querySelectorAll<SVGElement>("rect, circle, polygon, ellipse").forEach((shape) => {
              shape.style.fill = fill;
              shape.style.stroke = stroke;
            });
            group.querySelectorAll<SVGElement>("text, .label").forEach((t) => {
              (t as SVGElement).style.fill = color;
            });
          }
        }
      },

      animateNodes(nodeIds: string[], state: ChaosState) {
        const svg = containerRef.current;
        if (!svg) return;

        const animClass = STATE_ANIM_CLASS[state];
        const duration  = STATE_ANIM_DURATION[state];

        for (const nodeId of nodeIds) {
          const targets = getNodeGroups(svg, nodeId);
          for (const group of targets) {
            // Remove any previous animation class first to allow re-triggering
            group.classList.remove(...Object.values(STATE_ANIM_CLASS));
            // Force reflow so the browser re-triggers the animation
            void (group as unknown as HTMLElement).offsetWidth;
            group.classList.add(animClass);
            setTimeout(() => group.classList.remove(animClass), duration + 50);
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
            onRendered?.();
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
