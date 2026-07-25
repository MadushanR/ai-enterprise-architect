# AI Enterprise Architect — Design System

> **Source of truth for all UI work.**  
> Every task that touches a component, page, or style must reference this file.  
> No later task may invent its own colors, typefaces, or spacing independently.

---

## 1. Visual World

This is not a dashboard. It is a **war room**.

The reference world is the intersection of three physical spaces:

1. **Architecture review room** — whiteboard topology diagrams, sticky-note objection clusters, projected network schematics, a table of engineers arguing over a single decision. Dense, contested, consequential.
2. **Incident command center** — PagerDuty / Grafana aesthetic. Dark base, monospace protagonist, RAG status indicators that feel like instrument-panel readings, not decorative tags. Time-stamped machine output that nobody wastes vertical space on.
3. **Engineering blueprint** — fine structural grid lines, callout-style labels, systematic annotation rather than decorative illustration. Blue-on-dark rather than blue-on-white.

The UI must feel like it was built *inside* the first room and *outputs* the second. Generic SaaS dashboard vernacular (rounded card shadows, gradients, hero illustrations, celebration animations) is explicitly excluded.

---

## 2. Color Token System

Six named values. Every color used anywhere in the app must map to one of these tokens.

| Token | Hex | Role |
|-------|-----|------|
| `--col-base` | `#0e1117` | Page background — near-black with a cool blue undertone, not pure black |
| `--col-surface` | `#161b27` | Panel and card backgrounds — one step lighter than base |
| `--col-rule` | `#1f2b3e` | Structural grid lines, panel borders, dividers |
| `--col-cobalt` | `#1a6cf6` | Primary accent — IBM-adjacent cobalt; interactive elements, active indicators, selection states |
| `--col-ink` | `#c9d1e0` | Primary text — cool off-white, not pure white |
| `--col-muted` | `#4a5568` | Secondary text, timestamps, placeholders |

### Chaos Simulator State Colors

These are **part of the main palette**, not separate. They map to instrument-panel status readings.

| State | Token | Hex | Rationale |
|-------|-------|-----|-----------|
| Normal | `--col-chaos-normal` | `#2d7a6e` | Desaturated teal — "all systems nominal," reads as calm instrument green |
| Strain | `--col-chaos-strain` | `#c98a1a` | Amber — amber-alert register, not yellow (too cheerful) |
| Failure | `--col-chaos-failure` | `#c0392b` | Crimson — serious, not fluorescent red; incident-severity register |
| Recovery | `--col-chaos-recovery` | `#3b7a57` | Muted forest green — distinct from normal teal, conveys repair-in-progress |

> **Rule:** The chaos state colors must only appear on Mermaid node fills via `classDef` patches. They must not bleed into any other UI surface.

---

## 3. Typography

Three faces, each with a distinct job. No other typefaces may be introduced.

| Role | Face | Source | Usage |
|------|------|---------|-------|
| Display | **IBM Plex Sans Condensed** | Google Fonts (free) | Section headers, agent name labels, phase titles, the round counter. Loaded at weights 400 and 600 only. Feels like engineering stencil lettering without being a novelty font — on-brand with the IBM Granite context. |
| Body | **Geist Sans** | Already in `app/layout.tsx` | Discovery form, narrative prose, slide content previews, button labels. No new import needed. |
| Data / Transcript | **Geist Mono** | Already in `app/layout.tsx` | Debate transcript cards, Mermaid source view, API response snippets, timestamps, all diagram labels. No new import needed. |

### Type Scale (rem, relative to 16px base)

| Label | Size | Weight | Face | Use |
|-------|------|--------|------|-----|
| `display-lg` | 1.75rem | 600 | IBM Plex Sans Condensed | Phase section titles |
| `display-sm` | 1.1rem | 600 | IBM Plex Sans Condensed | Agent name badges |
| `body-lg` | 1rem | 400 | Geist Sans | Primary prose |
| `body-sm` | 0.875rem | 400 | Geist Sans | Secondary prose, button labels |
| `mono-md` | 0.8125rem | 400 | Geist Mono | Transcript lines, timestamps |
| `mono-sm` | 0.6875rem | 400 | Geist Mono | Diagram node labels |

---

## 4. Layout

### One-sentence description
A **fixed three-column shell** where the left column collapses to a drawer on mobile — discovery input is pinned top-left, the debate feed scrolls in the center, and the diagram/output pane anchors right; the chaos simulator sits immediately below the diagram (always visible without scrolling) because it is the highest-priority demo feature, with the deck download and audio widget below it.

### Full-state ASCII Wireframe

The wireframe represents the **busiest state**: mid-debate, diagram visible, chaos simulator running. All six functional areas are present.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HEADER: "Architecture Review Board"  [●●○] round 2 of 3   [health: ✓]         │
├──────────────┬──────────────────────────────┬──────────────────────────────────┤
│  LEFT PANE   │  CENTER PANE                 │  RIGHT PANE                      │
│  (280px)     │  (flex-grow)                 │  (360px)                         │
│              │                              │                                  │
│ ┌──────────┐ │ ┌──────────────────────────┐ │ ┌──────────────────────────────┐ │
│ │DISCOVERY │ │ │ WAR ROOM FEED            │ │ │ LIVE DIAGRAM                 │ │
│ │FORM      │ │ │                          │ │ │                              │ │
│ │          │ │ │ [SA]  token stream…      │ │ │  [mermaid graph TD]          │ │
│ │textarea  │ │ │ ──────────────────────── │ │ │  nodes recoloring via        │ │
│ │          │ │ │ [SRE] OBJECTION: latency │ │ │  classDef diffs              │ │
│ │[Analyse] │ │ │ ──────────────────────── │ │ │                              │ │
│ └──────────┘ │ │ [FINOPS] NO OBJECTION    │ │ │                              │ │
│              │ │ ──────────────────────── │ │ │                              │ │
│ ┌──────────┐ │ │ [SEC] evaluating…        │ │ └──────────────────────────────┘ │
│ │BRIEF     │ │ │                          │ │                                  │
│ │preview   │ │ │                          │ │ ┌──────────────────────────────┐ │
│ │(compact) │ │ │                          │ │ │ CHAOS SIMULATOR  ⭐           │ │
│ │          │ │ │                          │ │ │ [▶ Simulate Traffic Spike]   │ │
│ └──────────┘ │ └──────────────────────────┘ │ │ beat: ●●○○○○  strain         │ │
│              │                              │ └──────────────────────────────┘ │
│              │ ┌──────────────────────────┐ │                                  │
│              │ │ SYNTHESIS (when done)    │ │ ┌──────────────────────────────┐ │
│              │ │ collapsible summary card │ │ │ DECK EXPORT                  │ │
│              │ └──────────────────────────┘ │ │ [↓ Download .pptx]           │ │
│              │                              │ └──────────────────────────────┘ │
│              │                              │                                  │
│              │                              │ ┌──────────────────────────────┐ │
│              │                              │ │ AUDIO UPLOAD                 │ │
│              │                              │ │ [📎 Upload .mp3]             │ │
│              │                              │ │ transcript preview (mono)    │ │
│              │                              │ └──────────────────────────────┘ │
├──────────────┴──────────────────────────────┴──────────────────────────────────┤
│  STATUS BAR (mono-sm):  region: us-south  │  model: granite-4-h-small  │  …   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Column Behaviour

| Breakpoint | Left pane | Center pane | Right pane |
|-----------|-----------|-------------|------------|
| ≥ 1280px (`xl`) | 280px fixed | flex-grow | 360px fixed |
| 768–1279px (`md`) | collapsible drawer (closed by default, toggle in header) | full width | slides in from right as sheet overlay |
| < 768px (`sm`) | full-screen step 1 → discovery; full-screen step 2 → debate; full-screen step 3 → diagram. Tabs in the header switch between panes. |

> **Mobile note:** On mobile the app becomes a **stepper**, not a simultaneous multi-pane view. Each phase occupies the full viewport. The round counter in the header is always visible regardless of active step.

### Spacing Primitives

Based on a 4px base unit. Only multiples of 4 may be used for padding/margin/gap.

| Token | Value | Common use |
|-------|-------|------------|
| `space-1` | 4px | Icon padding, tight label gaps |
| `space-2` | 8px | Within-component internal gaps |
| `space-3` | 12px | Component-to-component within a section |
| `space-4` | 16px | Section padding, card internal padding |
| `space-6` | 24px | Between major sections |
| `space-8` | 32px | Panel-level vertical rhythm |

---

## 5. Structural Grid Lines

Every panel is separated by **1px rules using `--col-rule`**, not drop shadows or elevation. This is the blueprint convention: structure is shown through explicit lines, not implied depth. No `box-shadow`, no `border-radius > 4px` on structural containers (cards within panels may use up to 4px radius).

---

## 6. Signature Element — The Round Counter

The single most memorable element in the app: a **segmented circuit strip in the header** showing debate progress.

```
  [●  ●  ○]   round 2 of 3
```

- Three segments, each a rectangle (not a circle or pill — rectangles read as circuit pads).
- Filled segments use `--col-cobalt`. Empty segments use `--col-rule`.
- When synthesis fires (round completes or max reached), all three fill briefly then transition to a single solid bar at full width — like a circuit closing.
- This element is visible at all breakpoints, including mobile. It is the one piece of non-utilitarian chrome in the entire UI.
- **`prefers-reduced-motion`:** the closing animation is suppressed; segments snap directly to filled state.

---

## 7. Interactive States

All interactive elements must have **explicit, visible focus rings** — not just the browser default. Use:
```css
outline: 2px solid var(--col-cobalt);
outline-offset: 3px;
```
No `outline: none` anywhere in the codebase without an explicit replacement focus indicator in the same rule.

| State | Treatment |
|-------|-----------|
| Hover | `--col-surface` → 8% lighter (use `color-mix` or a static computed value) |
| Focus | Cobalt outline, 2px, offset 3px |
| Active/pressed | Cobalt background, ink text |
| Disabled | `--col-muted` text, no hover effect, `cursor: not-allowed` |
| Loading/streaming | Subtle left-border pulse on the active agent card (cobalt, opacity 0.4 → 1 → 0.4). Reduced-motion: static border, no pulse. |

---

## 8. Chaos Simulator Visual Rules

- Diagram node state changes happen via `classDef` diffs only — never a full Mermaid re-render.
- The beat progress indicator (the `●●○○○○` row in the chaos panel) uses the same four chaos state colors as the node fills — the indicator at beat N shows the color of that beat's state.
- Inter-beat delay: 1400ms default. Reduced-motion: 0ms delay, no crossfade.
- The chaos panel heading changes text at each beat to reflect the current state label (e.g., "STRAIN — CDN edge saturated").

---

## 9. Self-Critique Record

*The following defaults were considered and rejected:*

| Default | Why it was tempting | Why it was rejected for this subject |
|---------|--------------------|------------------------------------|
| Near-black + acid green | Strong contrast, "hacker" legibility | Reads as a code editor or CTF tool, not a serious architecture review instrument |
| Warm cream + high-contrast serif + terracotta | Editorial warmth, typographic sophistication | Wrong emotional register — architecture reviews are clinical and contested, not editorial |
| Broadsheet hairline-rule layout | Structural, serious, European design tradition | Too static — the layout needs to handle live streaming state and instrument-panel status, which the broadsheet grid doesn't accommodate well |

*What changed as a result:* The base was pulled cooler (blue undertone in `--col-base`) specifically to avoid drifting into warm-grey dashboard territory. IBM Plex Sans Condensed was chosen over a serif display face because the subject (IBM Granite, architecture schematics) justifies it by specific context, not by default.

---

## 10. Accessibility Floor (Non-Negotiable)

- **Responsive:** functional at 320px minimum viewport width via the stepper pattern described in §4.
- **Focus states:** all interactive elements must use the cobalt outline described in §7. No exceptions.
- **`prefers-reduced-motion`:** all animations (round counter fill, chaos beat transitions, streaming pulse) must be wrapped in a `@media (prefers-reduced-motion: reduce)` guard that either removes the animation or replaces it with an instant state change. This is required, not optional, for the chaos simulator.
- **Color contrast:** `--col-ink` on `--col-surface` achieves ≥ 7:1 (AAA). `--col-cobalt` on `--col-base` achieves ≥ 4.5:1 (AA). Chaos state colors on `--col-surface` must be tested against `mono-sm` label text before use — they are only used as fills on Mermaid nodes (dark fill with `--col-ink` label text), not as standalone text colors.
- **Semantic HTML:** debate feed items use `<article>` with `aria-label="[Agent name] turn"`. The round counter has `role="status"` and `aria-live="polite"`. The chaos beat indicator has `aria-label="Chaos simulation: [current state]"`.
