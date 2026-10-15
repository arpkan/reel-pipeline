# Fix Script-Stage JSON Parse Failures From Unescaped Quotes

## Problem

User ran `!reel https://www.dailynews.co.th/news/6021314/` (ds brand). Unlike the two bugs fixed in `2026-07-12-source-extract-integrity-check.md`, Stage 0 worked correctly this time — it classified the real story (a Thai heroin-smuggling case) and the run got all the way to Stage 2 (script writing) before failing:

```
[ReelRunner] failed: Error: Failed to parse script JSON:
```json
{
  "category": "breaking",
  "title": "แอร์หิ้วเฮโรอีน: เบื้องหลังขบวนการข้ามชาติ",
  ...
  "scenes": [
    {
      "sceneNumber": 1,
      "voiceover": "รู้ไหมว่าคดีแอร์โฮสเตส "มีนา" ที่ถูกจับในออสเตรเลียลึกกว่าที่คิด ป.ป.ส.ยืนยันแล้วว่า "เดียร์" ...
```

The model quoted two nicknames (`"มีนา"`, `"เดียร์"`) using literal straight double-quotes *inside* a JSON string value, without escaping them as `\"`. That's invalid JSON — `JSON.parse` throws, `reel-stage2-script.ts:344` catches it and rethrows as a hard failure, and the whole run dies with nothing produced. This is a single-shot call with no retry (`src/stages/reel-stage2-script.ts:339-347`) — one malformed response and the run is dead, even though the story itself was valid and this is a wording quirk, not a real error.

This is a plausible recurring pattern, not a one-off: Thai (and English) crime/news reporting frequently quotes nicknames or short phrases ("เดียร์", "the so-called X"), which is exactly the shape that trips up naive JSON generation.

## Fix 1 — prompt guardrail against unescaped quotes (prevent it)

Add a rule to `buildSystemPrompt()`'s GENERAL RULES block in `src/stages/reel-stage2-script.ts` (next to the existing titles/dates guardrails, ~line 233):

```
- CRITICAL: You are writing values inside a JSON string. If a voiceover or caption needs to quote a nickname, alias, or short phrase (e.g. a nickname like เดียร์), use curly quotes "..." — never a straight double-quote ("...") — since a straight quote inside a JSON string breaks the JSON. Do not use the " character anywhere inside a voiceover, caption, or title value.
```

## Fix 2 — retry once on parse failure (defense in depth)

Right now a single bad response kills the run outright. `src/stages/story-stage1-direction.ts:91-124` already establishes the pattern for this exact situation elsewhere in the codebase — wrap the model call in a 2-attempt loop, only throwing after the second failure:

```ts
const maxAttempts = 2;
let script: ReelScript | undefined;

for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const { text: raw, source } = await bedrock.converse(systemPrompt, userMessage);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    script = JSON.parse(jsonMatch?.[0] ?? raw);
    lastSource = source;
    break;
  } catch {
    if (attempt === maxAttempts - 1) {
      throw new Error(`Failed to parse script JSON after ${maxAttempts} attempts:\n${raw.slice(0, 500)}`);
    }
    console.log(`  [reel-stage2-script] JSON parse failed on attempt ${attempt + 1} — retrying`);
  }
}
```

No repair/sanitization heuristic on the malformed text itself — the previous fix's principle (fail loudly rather than silently patch bad data) applies here too: a regex-based "fix the stray quote" repair could easily mangle legitimate Thai text at word boundaries with no clear delimiter. A clean re-roll of the same prompt is what the codebase already does elsewhere for this exact class of problem, and it sidesteps that risk entirely — LLM output for the same prompt is a fresh sample, not a deterministic repeat of the same malformed quote placement.

## Files changed

- `src/stages/reel-stage2-script.ts` — add JSON-quote-escaping rule to `buildSystemPrompt()`, wrap the model call + parse in a 2-attempt retry loop matching `story-stage1-direction.ts`'s existing pattern

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Model quotes a nickname with a straight `"` inside a JSON string value | Run fails immediately, nothing produced | Prompt guardrail should mostly prevent this; if it still happens, one retry gives a fresh sample before failing |
| Model still fails to produce valid JSON after 2 attempts | Run fails | Run still fails — this is the correct outcome, same as today, just with one extra chance first |
| Valid JSON on first attempt | Unchanged | Unchanged (no extra latency — retry loop only engages on failure) |

## No schema changes, no new dependencies

Reuses the exact retry pattern already established in `story-stage1-direction.ts`. Applies to both `ns` and `ds` since they share `reel-stage2-script.ts`.
