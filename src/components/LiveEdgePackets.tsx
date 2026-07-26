"use client";

/**
 * components/LiveEdgePackets.tsx
 *
 * Renders an SVG overlay exactly over the Mermaid diagram SVG.
 * Discovers every edge <path> in the Mermaid SVG, then runs a
 * requestAnimationFrame loop that moves colored circle "packets"
 * along each path — simulating live data flowing through the system.
 *
 * Coordinate strategy
 * ────────────────────
 * The Mermaid SVG has its own transform hierarchy. We map path points to
 * screen coordinates using path.getCTM() + createSVGPoint().matrixTransform(),
 * then subtract the overlay's bounding rect to get overlay-local coords.
 * This handles any viewBox / scaling Mermaid applies.
 *
 * Behavior per chaos state
 * ─────────────────────────
 * normal   — slow steady teal packets on every edge
 * strain   — faster amber packets, density ×1.5
 * failure  — affected edges: red frozen/strobing packets
 *            unaffected edges: dim gray, slowed
 * failover — purple burst on unaffected edges (rerouting), affected frozen
 * recovery — green sweep across all edges, faster then normalises
 *
 * reducedMotion: component renders nothing and the RAF loop never starts.
 */

import { useEffect, useRef, useCallback } from "react";
import type { ChaosState } from "@/backend/lib/chaos/narrative";

// ── Selectors for Mermaid edge paths ─────────────────────────────────────────
const EDGE_PATH_SELECTORS = [
  ".edgePaths path",
  ".edgePath path",
  "g.edges path",
  "path.edge-thickness-normal",
  "path.edge-thickness-thick",
].join(", ");

// ── Per-state config ──────────────────────────────────────────────────────────
interface StateConfig {
  color:        string;   // default packet color
  speed:        number;   // path-fraction per frame (≈ 60 fps baseline)
  radius:       number;   // dot radius px
  opacity:      number;   // dot opacity for unaffected edges
  packetCount:  number;   // packets per edge
}

const STATE_CONFIG: Record<ChaosState, StateConfig> = {
  normal:   { color: "#14b8a6", speed: 0.0018, radius: 3,   opacity: 0.65, packetCount: 2 },
  strain:   { color: "#e8a735", speed: 0.0030, radius: 3.5, opacity: 0.80, packetCount: 3 },
  failure:  { color: "#4a5568", speed: 0.0008, radius: 2.5, opacity: 0.28, packetCount: 1 },
  failover: { color: "#7c5cd8", speed: 0.0042, radius: 4,   opacity: 0.90, packetCount: 4 },
  recovery: { color: "#22c55e", speed: 0.0035, radius: 3.5, opacity: 0.85, packetCount: 3 },
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface Packet {
  pathIndex: number;
  t:         number;   // 0–1 progress along path
}

interface Props {
  /** The div that wraps the Mermaid SVG (chaos-live-diagram > MermaidRenderer) */
  svgContainer:    HTMLDivElement | null;
  currentState:    ChaosState | null;
  affectedNodes:   string[];
  reducedMotion:   boolean;
  diagramRendered: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function LiveEdgePackets({
  svgContainer,
  currentState,
  affectedNodes,
  reducedMotion,
  diagramRendered,
}: Props) {
  const overlayRef  = useRef<SVGSVGElement>(null);
  const rafRef      = useRef<number>(0);
  const packetsRef  = useRef<Packet[]>([]);
  const pathsRef    = useRef<SVGPathElement[]>([]);

  // Keep latest reactive values accessible in RAF without causing loop restarts
  const stateRef    = useRef(currentState);
  const affectedRef = useRef(affectedNodes);
  useEffect(() => { stateRef.current    = currentState;  }, [currentState]);
  useEffect(() => { affectedRef.current = affectedNodes; }, [affectedNodes]);

  // ── Size overlay to match Mermaid SVG ──────────────────────────────────────
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !svgContainer || !diagramRendered) return;

    function syncSize() {
      const mermaidSvg = svgContainer!.querySelector<SVGSVGElement>("svg");
      if (!mermaidSvg || !overlay) return;
      const { width, height } = mermaidSvg.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      overlay.style.width  = `${width}px`;
      overlay.style.height = `${height}px`;
    }

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(svgContainer);
    return () => ro.disconnect();
  }, [svgContainer, diagramRendered]);

  // ── Discover edge paths + initialise packet pool ──────────────────────────
  const initPackets = useCallback(() => {
    if (!svgContainer) { pathsRef.current = []; packetsRef.current = []; return; }

    const found = Array.from(
      svgContainer.querySelectorAll<SVGPathElement>(EDGE_PATH_SELECTORS)
    ).filter((p) => {
      try { return p.getTotalLength() > 20; } catch { return false; }
    });

    pathsRef.current = found;

    const state = stateRef.current ?? "normal";
    const count = STATE_CONFIG[state].packetCount;
    const pkts: Packet[] = [];
    for (let pi = 0; pi < found.length; pi++) {
      for (let k = 0; k < count; k++) {
        pkts.push({ pathIndex: pi, t: k / count });
      }
    }
    packetsRef.current = pkts;
  }, [svgContainer]);

  useEffect(() => {
    if (!diagramRendered) return;
    const t = setTimeout(initPackets, 150);
    return () => clearTimeout(t);
  }, [diagramRendered, initPackets]);

  // Re-init packet density whenever state changes (different packetCount)
  useEffect(() => {
    if (!diagramRendered || pathsRef.current.length === 0) return;
    const state = currentState ?? "normal";
    const count = STATE_CONFIG[state].packetCount;
    const pkts: Packet[] = [];
    for (let pi = 0; pi < pathsRef.current.length; pi++) {
      for (let k = 0; k < count; k++) {
        pkts.push({ pathIndex: pi, t: k / count });
      }
    }
    packetsRef.current = pkts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentState]);

  // ── RAF loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion || !diagramRendered) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    let running = true;

    function frame() {
      if (!running) return;

      const paths    = pathsRef.current;
      const packets  = packetsRef.current;
      const state    = stateRef.current ?? "normal";
      const affected = affectedRef.current;
      const cfg      = STATE_CONFIG[state];
      const now      = Date.now();

      // Ensure circle pool size matches packet count
      while (overlay!.childElementCount < packets.length) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("pointer-events", "none");
        overlay!.appendChild(c);
      }
      while (overlay!.childElementCount > packets.length) {
        overlay!.removeChild(overlay!.lastChild!);
      }

      // Build set of affected path indices for failure/failover states
      let affectedPaths: Set<number> | null = null;
      if ((state === "failure" || state === "failover") && affected.length > 0) {
        affectedPaths = new Set<number>();
        for (let pi = 0; pi < paths.length; pi++) {
          const el  = paths[pi];
          const gid = (
            el.getAttribute("id") ??
            el.parentElement?.getAttribute("id") ??
            el.closest("g")?.getAttribute("id") ??
            ""
          ).toLowerCase();
          for (const nid of affected) {
            if (nid !== "unknown" && gid.includes(nid.toLowerCase())) {
              affectedPaths.add(pi);
              break;
            }
          }
        }
      }

      const overlayRect = overlay!.getBoundingClientRect();
      const circles = overlay!.children;

      for (let i = 0; i < packets.length; i++) {
        const pkt    = packets[i];
        const path   = paths[pkt.pathIndex];
        const circle = circles[i] as SVGCircleElement | undefined;
        if (!path || !circle) continue;

        const isAffected = affectedPaths?.has(pkt.pathIndex) ?? false;

        // ── Determine per-packet visual + motion ──
        let color:   string;
        let opacity: number;
        let radius:  number;
        let speed:   number;

        if (state === "failure") {
          if (isAffected) {
            // Red strobing frozen dot on the failing edge
            color   = "#ef4444";
            opacity = 0.45 + 0.45 * Math.sin(now / 140 + i * 1.3);
            radius  = 4.5;
            speed   = 0;
          } else {
            // Dim slow dots on healthy edges
            color   = "#4a5568";
            opacity = 0.25;
            radius  = 2.5;
            speed   = 0.0008;
          }
        } else if (state === "failover") {
          if (isAffected) {
            // Still frozen (failed edge, purple waiting)
            color   = "#ef4444";
            opacity = 0.30;
            radius  = 3;
            speed   = 0;
          } else {
            // Purple rerouting burst on healthy edges
            color   = cfg.color;
            opacity = cfg.opacity;
            radius  = cfg.radius;
            speed   = cfg.speed;
          }
        } else {
          color   = cfg.color;
          opacity = cfg.opacity;
          radius  = cfg.radius;
          speed   = cfg.speed;
        }

        // ── Advance position ──
        if (speed > 0) {
          pkt.t = (pkt.t + speed) % 1;
        }

        // ── Get screen position via CTM ──
        let sx = 0, sy = 0, valid = false;
        try {
          const len = path.getTotalLength();
          if (len > 0) {
            const localPt = path.getPointAtLength(pkt.t * len);
            const svgPt   = path.ownerSVGElement?.createSVGPoint();
            const ctm     = path.getCTM();
            if (svgPt && ctm) {
              svgPt.x = localPt.x;
              svgPt.y = localPt.y;
              const screen = svgPt.matrixTransform(ctm);
              sx = screen.x - overlayRect.left;
              sy = screen.y - overlayRect.top;
              valid = true;
            }
          }
        } catch {
          // detached or zero-length path — skip
        }

        if (!valid) {
          circle.setAttribute("r", "0");
          continue;
        }

        circle.setAttribute("cx",      String(sx.toFixed(2)));
        circle.setAttribute("cy",      String(sy.toFixed(2)));
        circle.setAttribute("r",       String(radius));
        circle.setAttribute("fill",    color);
        circle.setAttribute("opacity", String(Math.max(0, Math.min(1, opacity)).toFixed(3)));
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      const ov = overlayRef.current;
      if (ov) while (ov.firstChild) ov.removeChild(ov.firstChild);
    };
  }, [reducedMotion, diagramRendered]);

  if (reducedMotion) return null;

  return (
    <svg
      ref={overlayRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 4,
        overflow: "visible",
      }}
    />
  );
}
