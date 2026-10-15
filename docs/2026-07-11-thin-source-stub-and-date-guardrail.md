# Detect Thin/Stub Source Content and Stop Inventing Event Dates

## Problem

Reel `62579c4f` (NS, Almeria wildfire) stated "on July 10th, 2026" as the date people died on evacuation roads. A viewer flagged this as likely wrong — the fire and deaths appear to have started the night of July 9; July 10 is when the death toll was confirmed and articles were published.

Traced this end-to-end against the actual stored data for that reel:

1. Reuters' article was effectively paywalled — Tavily's extract came back as mostly page furniture: nav boilerplate ("Learn more about Refinitiv", "Browse World", "Browse Business"), a photo-gallery marker ("Item 1 of 6"), and one real sentence, followed by a photo caption: *"...wildfire approaches in the vicinity of Los Gallardos, in Almeria, Spain, **July 10, 2026**."*
2. This passed the only existing quality gate, `looksLikeScraperBlock()`, because it's 300+ characters and doesn't contain any paywall/block phrases — it just looks junky, not blocked.
3. Stage 0's classifier prompt asked Gemini for a "3-5 sentence summary" but Gemini just echoed the stub back near-verbatim (the stored `snippet` for this reel is literally the nav junk + photo caption, not a summary).
4. That stub — containing exactly one date, from a photo caption — went straight into Stage 2's script-writing prompt. Stage 2 has zero instructions about dates one way or another, so the model used the only date it had, verbatim: "July 10th, 2026."

Two independent gaps, both worth closing:

- **Gap A:** `looksLikeScraperBlock()` only catches "blocked," not "loaded fine but is mostly junk." Thin stubs like this sail through untouched.
- **Gap B:** Neither prompt (classifier or script-writer) ever tells the model that a date attached to a photo/byline isn't necessarily when the event happened. Nothing stops it from asserting a specific date on thin evidence.

Both `ns` and `ds` share this exact code path (`stage0-from-url.ts`, `reel-stage2-script.ts`) — this is not brand-specific.

## Fix 1 — detect thin/stub content, not just blocked content

Add `looksLikeThinStub(content: string): boolean` next to the existing `looksLikeScraperBlock()` in `src/stages/stage0-from-url.ts`. Flag content as a stub (not real article body) when **2 or more** of these signals are present:

- Photo-gallery markers: `/\[\d+\/\d+\]/` or `/item \d+ of \d+/i`
- 2+ markdown-style nav headers (`##`) anywhere in the content
- Screen-reader nav link boilerplate: `"opens new tab"` present
- A duplicated sentence of 40+ characters (gallery scrapes repeat the same photo caption verbatim; real prose doesn't repeat whole sentences)

(First attempt anchored the header check to line-start and required "opens new tab" twice — neither held up against the actual scraped content for this reel, which has no real newlines and only one nav-tab mention. Verified against the real junk snippet, a normal article, and a couple of near-miss cases — legit article with one photo caption, short repeated boilerplate phrase under 40 chars — before landing on the version above.)

In the Tavily branch of `classifyUrl()`, change the guard from:
```ts
if (tavilyContent && !looksLikeScraperBlock(tavilyContent)) {
```
to:
```ts
if (tavilyContent && !looksLikeScraperBlock(tavilyContent) && !looksLikeThinStub(tavilyContent)) {
```
When it trips, log it and fall through to the same Tier 2/Tier 3 fallback (Gemini direct URL read → search-fallback-by-slug) that already exists for blocked content. No new fallback path needed — reuse what's there.

## Fix 2 — stop treating any date in the source as "the" event date

Add the same style of guardrail already used for the honorary-titles rule in `reel-stage2-script.ts` (line 232), in two places:

**`src/stages/stage0-from-url.ts`**, in the classifier prompt template (used for both the article and YouTube paths):
> "IMPORTANT: Only state a specific date for when an event occurred if the source text explicitly narrates it as the event date. A date on a photo caption, byline, or dateline is NOT the event date. If timing is unclear, describe it in relative terms (e.g. 'overnight', 'earlier this week') instead of a specific date."

**`src/stages/reel-stage2-script.ts`**, in `buildSystemPrompt()`'s GENERAL RULES block, next to the existing titles rule:
> "CRITICAL: Do NOT state a specific calendar date (e.g. 'on July 10th') for when an event happened unless the source material explicitly narrates that as the event date. A date attached to a photo caption or byline is not necessarily the event date. If it's unclear or the story is still developing, use relative time framing ('overnight', 'this week', 'in the past 24 hours') instead of asserting a specific date."

## Files changed

- `src/stages/stage0-from-url.ts` — add `looksLikeThinStub()`, wire into the Tavily guard, add date-guardrail line to the classifier prompt
- `src/stages/reel-stage2-script.ts` — add date-guardrail line to `buildSystemPrompt()`

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Tavily returns junk stub (nav + photo caption) | Passes quality gate, poisons the script | Detected, falls back to Gemini direct read / search fallback |
| Source has no explicit event date, only a photo/byline date | Model states that date as fact | Model uses relative framing instead |
| Source explicitly narrates "the fire broke out Thursday" | Unchanged | Unchanged — explicit event date still used |
| Valid, full-prose Tavily extract | Unchanged | Unchanged |

## No schema changes, no new dependencies

Reuses the existing Tier 2/Tier 3 fallback chain already in `stage0-from-url.ts`. Both `ns` and `ds` get the fix automatically since the code path is shared.
