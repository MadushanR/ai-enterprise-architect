# Mermaid Live Diagram & Chaos Simulator Skill

## Purpose
Generate and progressively update Mermaid.js diagrams — both from the
War Room's synthesized architecture, and from the Chaos Simulator's
traffic-spike narrative.

## When to use
- After the War Room synthesis step, to render the initial architecture.
- After an audio-driven feedback update (Phase 4), to revise the diagram.
- During "Simulate Traffic Spike," to progressively recolor nodes.

## Workflow (initial diagram)
1. Prompt the model to output valid Mermaid flowchart/graph syntax
   describing the synthesized architecture — nodes for each component,
   edges for data flow.
2. Validate with mermaid.parse() before sending to the frontend.
   If parse fails, retry once with the error message fed back to the model.
3. Render.

## Workflow (chaos simulator)
1. Generate the narrative text describing the traffic spike unfolding,
   in stages (e.g. 4-6 beats: normal → strain → failure → failover → recovery).
2. For each stage, emit a Mermaid `classDef` diff assigning color classes
   to affected nodes (e.g. `classDef failing fill:#f77` / `classDef
   recovering fill:#7c7`), not a full diagram regeneration.
3. Stream each stage to the frontend with a short delay between them so
   the recoloring reads as a live event, not an instant jump.

## Guardrails
- Every Mermaid string must pass mermaid.parse() before rendering — a
  malformed diagram blank-screens the UI with no useful error.
- Keep classDef color assignments as diffs against the existing diagram,
  not full re-renders, so node positions don't jump around between stages.