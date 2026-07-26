# Chaos Simulator — Live Interactive Page Plan

## Overview

Add a dedicated `/chaos` page that users land on when they click "▶ Simulate Traffic Spike"
from the main war-room dashboard. The page starts the SSE simulation automatically, shows a
**split layout**: a large animated Mermaid diagram on the left with node pulse/glow on each beat,
and a live scrolling beat timeline log on the right, with a progress bar across the top.

**Data flow:** Synthesis text + diagram source are written to a Zustand store before navigation.
The chaos page reads from the store and auto-starts the SSE stream on mount.

**Scope:** 4 sub-tasks — store, chaos page, node pulse animation, wire-up on main page.

---

## Sub-Task 1 — Zustand Chaos Store

**Status:** [x] done

### Intent
Create a shared Zustand store that holds the two inputs the chaos page needs: the LLM synthesis
description and the validated Mermaid diagram source. The main page writes to it before
navigating; the chaos page reads from it on mount. This avoids URL length limits and keeps
the data strongly typed.

### Expected Outcomes
- A new file `src/store/chaosStore.ts` exports a `useChaosStore` hook with:
  - `synthesis: string | null`
  - `diagramSource: string | null`
  - `setSynthesis(s: string): void`
  - `setDiagramSource(d: string): void`
  - `setInputs(synthesis: string, diagramSource: string): void` — convenience setter
- The store is a standard Zustand `create()` store, no persist middleware needed.
- No other files are changed in this sub-task.

### Todo List
1. Install `zustand` if not already in `package.json` (check first).
2. Create `src/store/chaosStore.ts` with the interface and store above.

### Relevant Context
- Zustand is already listed in the AGENTS.md as "optional Zustand" for state management —
  check `package.json` before adding it as a dependency.
- Follow the existing import alias pattern: `@/src/store/chaosStore`.

---

## Sub-Task 2 — Chaos Simulation Page `/chaos`

**Status:** [x] done

### Intent
Create `src/app/chaos/page.tsx` — a full Next.js App Router client page. On mount it reads
from the Zustand store, auto-starts the `/api/chaos` SSE stream, and renders the split
layout: progress bar top, large diagram left, beat log right, back+re-run buttons top-left.

### Expected Outcomes
- Route `/chaos` renders the new page without errors.
- On mount, if `synthesis` and `diagramSource` are in the store, the SSE stream starts automatically.
- If the store is empty (user navigated directly), a "no simulation data" empty state is shown
  with a "← Back to War Room" link.
- **Layout (full viewport height, dark theme using existing CSS tokens):**
  - Top bar: "← Back" button (left), page title "Chaos Simulator", re-run button (right)
  - Progress bar below top bar: fills left-to-right as beats arrive (beat index / total)
  - Main area split: ~60% left for diagram, ~40% right for beat log
- **Left panel:** `MermaidRenderer` renders the diagram; beat colors applied imperatively
  via `diagramRef.current.applyClassDefs()` (same pattern as `page.tsx`)
- **Right panel:** scrolling list of beat cards, appended live as each SSE beat arrives.
  Each card shows:
  - State badge (colored pill using `STATE_COLOR` map from `ChaosBeatIndicator`)
  - Beat label text
  - Affected node IDs as small monospace tags
  - Timestamp (time since simulation started, e.g. "t+2.8s")
- **Bottom of right panel:** overall status line ("Beat 3 / 6 · failure") or "Complete ✓"
- Page uses existing design tokens: `--col-base`, `--col-surface`, `--col-rule`,
  `--col-ink`, `--col-muted`, `var(--font-geist-mono)` etc.
- SSE reader uses the same labeled `outer:` while-loop pattern from `page.tsx` (lines 444–492).
- `reducedMotion` detected with `window.matchMedia("(prefers-reduced-motion: reduce)")` on mount.
- State variables mirror the existing chaos state shape:
  `chaosBeats`, `chaosCurrent`, `chaosLabel`, `chaosRunning`, `chaosTotal`.

### Todo List
1. Create `src/app/chaos/page.tsx` as a `"use client"` component.
2. Import `useChaosStore`, `MermaidRenderer`, `MermaidRendererHandle`,
   `parseClassDefPatch`, `NodeStyle` (reuse all existing exports — no new logic).
3. Add mount effect: read store → start SSE stream via `handleSimulate()`.
4. Implement the SSE reader (copy labeled `outer:` loop from `page.tsx`; apply `applyClassDefs` on each beat).
5. Build the top bar with back link (`router.push('/')`) and re-run button.
6. Build the progress bar (CSS width `${(chaosCurrent+1)/chaosTotal*100}%`).
7. Build the left panel with `MermaidRenderer ref={diagramRef}`.
8. Build the right panel with a beat log — each beat appended as a styled card.
9. Build the empty state (no store data).
10. Ensure all DESIGN.md tokens are used; no new colors introduced except the existing
    `STATE_COLOR` map values already in `ChaosBeatIndicator`.

### Relevant Context
- `src/app/settings/personas/page.tsx` — reference for sub-page structure (client component pattern).
- `src/components/ChaosBeatIndicator.tsx` — `STATE_COLOR` map and `ChaosState` type to reuse.
- `src/components/MermaidRenderer.tsx` — `MermaidRendererHandle`, `applyClassDefs` imperative handle.
- `backend/lib/chaos/classDef.ts` — `parseClassDefPatch` function.
- `src/app/page.tsx` lines 420–498 — SSE reader pattern to replicate.
- `src/app/api/chaos/route.ts` — SSE event shape: `{ beat, total, state, label, affectedNodes, patch }`.
- `src/app/globals.css` — all CSS token names.

---

## Sub-Task 3 — Node Pulse/Glow Animation

**Status:** [x] done

### Intent
When `applyClassDefs` patches an SVG node's inline style, briefly add a CSS keyframe
"pulse-glow" animation to the affected nodes so the user sees which nodes just changed.
This must be skipped entirely when `prefers-reduced-motion: reduce` is active.

### Expected Outcomes
- A `@keyframes chaos-pulse` is added to `src/app/globals.css`:
  - Animates `filter: brightness()` from 1× → 2× → 1× over ~600 ms.
  - No transforms, no opacity changes (keeps layout stable).
- After `applyClassDefs` fires on the chaos page, a small helper adds the CSS class
  `chaos-pulse-active` to each affected SVG node, then removes it after 600 ms.
- The helper checks `reducedMotionRef.current` — if true, it skips adding the class.
- `MermaidRenderer.tsx` is **not** modified — the pulse is applied in the chaos page's
  own beat-processing code, after calling `applyClassDefs`.
- The main `page.tsx` is **not** modified — no pulse on the inline experience.

### Todo List
1. Add `@keyframes chaos-pulse` to `src/app/globals.css`.
2. Add `.chaos-pulse-active` CSS rule that applies the animation.
3. In `src/app/chaos/page.tsx`, after each `applyClassDefs` call, select the affected
   SVG nodes by the same selectors used in `MermaidRenderer` (`data-node-id`, `data-id`,
   `id^="flowchart-{nodeId}"`) and add/remove the class with a 600 ms `setTimeout`.
4. Gate the class addition behind `!reducedMotionRef.current`.

### Relevant Context
- `src/components/MermaidRenderer.tsx` lines 50–103 — node selector logic to replicate
  for finding the right SVG elements to pulse.
- `src/app/globals.css` — where to add the keyframes.
- DESIGN.md §8: "No transition animations when prefers-reduced-motion: reduce is active."

---

## Sub-Task 4 — Wire Up Main Page Button

**Status:** [x] done

### Intent
Change the "▶ Simulate Traffic Spike" button on `page.tsx` so it writes to the Zustand store
then navigates to `/chaos`, instead of running the simulation inline. The inline chaos state
variables and `handleSimulateChaos` function can be removed from `page.tsx` to clean up the
now-unused code.

### Expected Outcomes
- Clicking "▶ Simulate Traffic Spike" on the main page:
  1. Calls `chaosStore.setInputs(synthesis!, diagram!.diagram)`
  2. Calls `router.push("/chaos")`
- The button is disabled when `!diagram?.valid` (same guard as today).
- `handleSimulateChaos`, `chaosBeats`, `chaosCurrent`, `chaosLabel`, `chaosRunning`,
  `chaosTotal` state are all removed from `page.tsx`.
- `ChaosBeatIndicator` import is removed from `page.tsx` (no longer used there).
- The chaos section in the sidebar keeps its heading and button, just loses the inline
  beat indicator block.

### Todo List
1. Import `useChaosStore` and `useRouter` in `page.tsx`.
2. Remove chaos state variables (`chaosBeats`, `chaosCurrent`, `chaosLabel`,
   `chaosRunning`, `chaosTotal`) and `handleSimulateChaos` function.
3. Replace the button `onClick` with a two-liner: set store inputs, push route.
4. Remove the inline `<ChaosBeatIndicator>` block from the chaos section JSX.
5. Remove the `ChaosBeatIndicator` import if it is no longer used elsewhere.
6. Remove the `parseClassDefPatch` import from `page.tsx` if no longer used.

### Relevant Context
- `src/app/page.tsx` lines 96–101 (state to remove), lines 420–498 (handler to remove),
  lines 1308–1365 (chaos JSX section to simplify).
- `useChaosStore` — written in Sub-Task 1.
