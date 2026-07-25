# Executive Pitch Deck Skill

## Purpose
Turn the War Room's synthesized architecture into a pptxgenjs deck a
non-technical executive would actually read — business value and ROI
framing, not a technical spec dump.

## When to use
After the War Room synthesis step completes, in parallel with diagram
generation.

## Workflow
1. Generate deck content via the model in a fixed structure:
   - Slide 1: Problem statement (the original business idea, reframed
     as a cost/risk the org faces today)
   - Slide 2: Proposed solution (plain-language summary, no jargon)
   - Slide 3: Architecture diagram (embed the Mermaid output, rendered
     as an image)
   - Slide 4: Tradeoffs considered (a short table — what the War Room
     debated and why the final call was made; this is what makes the
     deck feel like it came from a real review, not a template)
   - Slide 5: ROI / business impact framing (cost, time saved, risk
     reduced — whatever the discovery interview surfaced as the driver)
2. Build the deck with pptxgenjs using this house style: one idea per
   slide, minimal text, no walls of bullet points.
3. Verify file integrity after export (open the .pptx, confirm slide
   count matches expected) before presenting it as done.

## Guardrails
- Never let a slide exceed ~40 words of body text — this is a pitch,
  not documentation.
- The tradeoffs slide must reflect the ACTUAL debate transcript, not a
  generic "pros and cons" — pull real objections/resolutions from the
  War Room state.