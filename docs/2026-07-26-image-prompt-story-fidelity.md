# Make AI Image Prompts Depict the Actual Story Subject + More Visible AI Disclosure

## Problem

User received this comment on a TS (TagesBrief) reel, run `6e1d737e-3773-4558-b39d-beffcf062435` ("Kleinflugzeug stürzt in Wohnhaus – zwei Tote", sourced from stern.de):

> Traurig. Warum muss solch ein Bullshit gepostet werden? Weder haben die Bilder noch die dazu eingeblendeten Aussagen einen Bezug zu dem Unfallereignis in Ganderkesee.
> ("Sad. Why does this bullshit have to be posted? Neither the images nor the captions shown have any connection to the accident in Ganderkesee.")

Checked the run in `data/pipeline.db` (`reels` table) and rendered frames from `work/reels/6e1d737e-.../reel.mp4`:

- **Script vs. source: aligned.** The voiceover/captions accurately reflect the stern.de article — Ganderkesee, Landkreis Oldenburg, 2 dead, fire after impact, cause under investigation. No factual drift.
- **Images: not aligned with the story.** All 4 scenes are AI-generated (`gpt-image-2` via Azure). None of the 4 `imagePrompt`s in the stored script mention an aircraft at all:
  - Scene 1: *"...small residential house...dramatic crash damage on the roof, smoke rising...emergency vehicles..."*
  - Scene 2: *"...firefighters...battling flames engulfing a damaged residential building..."*
  - Scene 3: *"...police officers...securing a crash site perimeter...damaged house..."*
  - Scene 4: *"...street cordoned off with police tape...damaged house..."*

  The rendered images show a photorealistic burning house with fire trucks and police — no wreckage, wing, fuselage, or any visual evidence of a plane. It reads as a generic house-fire photo, not a plane-crash photo. The commenter is right: the imagery has no actual connection to the reported event.

- **AI disclosure is present but easy to miss.** `enhanced-default.ts` already renders a "✨ AI" badge (top-left, 36px, 65% opacity) on any scene where `imageSourceMap[scene].type === "ai"`. It's small and generic, unlikely to register on a fast-scrolling feed, especially for a hyper-realistic image like this one.

**Root cause:** `buildSystemPrompt()` in `src/stages/reel-stage2-script.ts` tells the scriptwriting LLM that image prompts should be "vivid, photorealistic" but never requires the prompt to depict the concrete, story-specific subject (here, the aircraft). The model defaults to generic disaster-scene imagery (damage/smoke/emergency vehicles), which is generic enough to fit almost any incident and specific to none.

## Fix 1 — prompt guardrail requiring the actual subject to appear (prevent it)

Add a rule to the GENERAL RULES block in `buildSystemPrompt()` (`src/stages/reel-stage2-script.ts`, next to the existing titles/dates/quote-escaping guardrails, ~line 177):

```
- CRITICAL: If the story centers on a specific vehicle, object, animal, or unusual element (e.g. a plane, train, car, boat, animal), the image prompts for the scenes depicting that event MUST visually include it — don't default to generic aftermath shots (damaged buildings, generic emergency vehicles, police tape) that could belong to any story. A reader should be able to tell what happened from the image alone.
```

This is a global system prompt shared by `ds`/`ns`/`ts`, so the fix applies to all three brands, all languages.

## Fix 2 — make the AI badge unmissable and localized (reduce harm even when imagery drifts)

In `src/stages/reel-stage5-templates/enhanced-default.ts`:

- Replace the generic `✨ AI` text with a localized, explicit label per `ctx.brand.language`, matching the German press convention audiences already recognize for illustrative (non-authentic) imagery:
  - `de`: `KI-generiertes Symbolbild`
  - `en`: `AI-generated image`
  - `th`: `ภาพสร้างโดย AI`
- Increase opacity (0.65 → ~0.9) and add a subtle background pill/scrim behind the text so it holds up against bright frames — currently it's plain text with only a drop shadow, which washes out against a light image like the one in this run.

## Files changed

- `src/stages/reel-stage2-script.ts` — add subject-fidelity rule to `buildSystemPrompt()`'s GENERAL RULES block
- `src/stages/reel-stage5-templates/enhanced-default.ts` — localize + strengthen the `.ai-badge-layer` label and styling

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Story centers on a specific vehicle/object/animal (plane crash, car pileup, escaped zoo animal, etc.) | Image prompts often generic ("damage", "emergency vehicles") with no depiction of the actual subject | Image prompts required to visually include the subject when the story centers on it |
| Story has no single visual "subject" (e.g. policy announcement, economic data) | Unchanged | Unchanged — rule only applies when the story has one |
| AI-generated scene is shown to a viewer | Small "✨ AI" badge, 65% opacity, easy to miss | Larger, higher-contrast, localized disclosure label |

## No schema changes, no new dependencies

Both changes are prompt/template edits only — no changes to `ReelScript` shape, `imageSourceMap`, or the stage pipeline itself.
