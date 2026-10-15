# Fix: Political-Figure Image Guard Misses Generic Person Descriptions

## Problem

The guard added in [`2026-08-03-political-figure-image-anonymization-design.md`](./2026-08-03-political-figure-image-anonymization-design.md) only appends the anonymization clause when `imagePrompt` contains an explicit political/government role noun (`POLITICAL_ROLE_RE`: `politician`, `senator`, `minister`, etc.). It does not fire when the same real person is described generically ("a woman", "two people") — and the scriptwriting stage frequently does exactly that.

**Confirmed regression**, both `ns` brand, "trending" category, same underlying story (Trump rally for SC Senate candidate Darline Graham):

- run `45b741e4-48d2-429d-9330-7bce7c8ddd32` (2026-08-22)
- run `d531b39f-befc-4bdd-bac2-fa084f704af3` (2026-08-23)

| Run | Scene | imagePrompt (excerpt) | `POLITICAL_ROLE_RE` match | Result |
|---|---|---|---|---|
| 45b741e4 | 3 | "**Female politician** on a brightly lit campaign stage..." | ✅ | guard fired → generic invented face |
| 45b741e4 | 4 | "**Two politicians** sharing a handshake..." | ✅ | guard fired → generic invented faces |
| d531b39f | 3 | "**a woman** at a campaign rally stage podium... **a male figure** beside her" | ❌ | guard did NOT fire |
| d531b39f | 4 | "**two people** standing together on a brightly lit rally stage..." | ❌ | guard did NOT fire → rendered image shows a woman with a strong, recognizable Hillary Clinton likeness — a real, prominent, but *wrong* person for a scene about Darline Graham |

Verified by running the actual `POLITICAL_ROLE_RE` against the four stored prompts (matches exactly the table above) and by visually inspecting the rendered PNGs in `work/reels/<id>/scene{3,4}.png` for both runs — the two guarded scenes show clearly generic/invented faces, the two unguarded scenes do not, and scene 4 of `d531b39f` is the smoking gun.

**Root cause:** `guardAgainstRealPersonLikeness()` (`src/stages/reel-stage4-images.ts:107`) Step 1 gates entirely on `POLITICAL_ROLE_RE.test(prompt)`. When the scriptwriting LLM phrases a scene about a real politician without a role noun — "a woman", "two people", "a male figure" — the gate returns `false` immediately and the prompt goes to `imageGen.generate()` unmodified, leaving the model free to resolve the generic description to whichever real face is most represented in its training data.

## Fix (per your review answers)

Two parts:

**A. Broaden the Step 1 trigger** to also fire on generic person-reference words, not just role nouns (your answer: "2", the broadest option).

**B. Before falling back to anonymization, try to resolve the real name** from the scene's voiceover and inject it into the prompt instead, so the model attempts the *correct* likeness rather than either the wrong one (today) or a generic invented one (naive fix). Falls back to anonymization when resolution isn't confident (your answer: "Yes, auto-extract from voiceover").

### Part A — broaden the trigger (narrowed to political/campaign scenes)

```ts
const GENERIC_PERSON_RE = /\b(wom[ae]n|men|man|person|people|figures?|individuals?|candidates?)\b/i;

const POLITICAL_SCENE_RE =
  /\b(rally|rallies|campaign|election|elections|primary|primaries|runoff|caucus|debate\s+stage|podium|polling|senate|congress|parliament|government|governor's\s+race|convention\s+center)\b/i;
```

Step 1 becomes:

```ts
const hasRoleKeyword = POLITICAL_ROLE_RE.test(prompt);
const hasGenericPersonInPoliticalScene = GENERIC_PERSON_RE.test(prompt) && POLITICAL_SCENE_RE.test(prompt);
if (!hasRoleKeyword && !hasGenericPersonInPoliticalScene) return prompt;
```

Decided against the broad "any person mention" version: it would tax image quality on every human-depicting prompt pipeline-wide (all brands/categories share this stage) to guard against a failure mode — an overrepresented real face for a generic role prompt — that's specific to public figures in political/campaign scenes, not generic people. Gating `GENERIC_PERSON_RE` on co-occurrence with `POLITICAL_SCENE_RE` targets exactly the failure pattern seen in both regression runs ("a woman at a campaign rally stage podium...", "two people standing together on a brightly lit rally stage...") without touching human_interest/business/lifestyle prompts that happen to say "a woman" or "people" with no political context. It also keeps Part B's LLM resolution calls (below) rare, matching how often the underlying bug actually occurs, instead of firing on every human_interest/business scene too.

Re-checked against the regression prompts: `d531b39f` scene 3 ("...campaign rally stage podium...South Carolina setting...") and scene 4 ("...rally stage...convention center...") both match `POLITICAL_SCENE_RE`, so both are now caught.

### Part B — name resolution from voiceover

New helper in `src/stages/reel-stage4-images.ts`:

```ts
async function resolveNamedPersonFromVoiceover(
  voiceover: string,
  genericPrompt: string,
): Promise<string | null>
```

- Uses `createBedrockService()` (already used for text generation in `reel-stage2-script.ts`) via `bedrock.converse(systemPrompt, userMessage)`.
- System prompt: given the scene's voiceover and its generic image description, identify whether the image description refers to **one** specific, real, named person mentioned in the voiceover. Respond with just that person's full name, or the literal string `NONE` if no real name is mentioned, multiple people are plausible referents, or the description refers to an unnamed bystander/crowd.
- Only called when Part A's trigger fires **and** `hasRealNameSequence(prompt)` is `false` — i.e. exactly the scenes that would otherwise fall through to anonymization today.
- Name returned → inject into the prompt sent to `imageGen.generate()` (e.g. prepend `"${name}, "`), and do **not** append `ANONYMIZATION_CLAUSE` — matches the original doc's existing policy that named-person prompts are left for the model to attempt.
- `NONE` / call throws / times out → fall back to today's anonymization clause. Same safe-direction default already established.
- Does not touch the stored `scene.imagePrompt` — only the string sent to `imageGen.generate()`, same non-goal as the original doc.

**Known limitation, accepted:** voiceovers often name multiple real people in one scene (e.g. `d531b39f` scene 4's voiceover mentions both "Darline Graham" and "Trump"). The resolver is instructed to return `NONE` in genuinely ambiguous cases, so many scenes will still fall back to anonymization rather than get a correctly injected name. That's intentional, not a bug — same "when unsure, over-anonymize" principle as the rest of this guard.

### Call site changes (`ReelStage4Images.run()`)

```ts
const genPrompt = guardAgainstRealPersonLikeness(prompt);
let finalPrompt = genPrompt;
if (genPrompt !== prompt) {
  // guard fired — try to resolve + inject the real name before anonymizing
  const resolvedName = await resolveNamedPersonFromVoiceover(scene.voiceover, prompt);
  if (resolvedName) {
    finalPrompt = `${resolvedName}, ${prompt}`;
  }
}
const genResult = await imageGen.generate(finalPrompt, { aspectRatio: "9:16" });
```

Safety-retry fallback path (existing, ~line 165–167) is **unchanged**: still strips banned words from the original `prompt` and re-appends `ANONYMIZATION_CLAUSE` only if the original guard fired. Name-injection is not attempted on the safety-retry path — if the model already safety-blocked once, defaulting to anonymized-generic is the safer of the two options.

## Deferred: manual force-name parameter

You mentioned possibly wanting a manual override to force a specific real name for a scene (e.g. reviewer spots a wrong-face render and wants a deterministic redo). Today's rebuild path (`ReelRunner.rebuildPart(reelId, brand, "images", ...)` → `ctx.isImageRebuild = true`) regenerates **all** scenes' images at once with random style variations — there's no per-scene targeting today. Adding a per-scene `forcePersonName` override is a bigger change (new CLI/API parameter, per-scene rebuild plumbing) than the auto-resolution fix above.

**Recommend deferring this to a separate follow-up doc** once we see how often Part B's auto-resolution needs manual correction in practice. Flag if you'd rather bundle it into this same change.

## Testing

Extend the guard's existing test file with:

1. Regression: `45b741e4` scene 4 prompt ("Two politicians...") — still guarded via unchanged Part A path.
2. New: `d531b39f` scene 4 prompt ("two people standing together...") — previously unguarded, now triggers Part A.
3. Name resolution mocked, single real name in voiceover → name injected, no anonymization clause.
4. Name resolution mocked, 2+ real names in voiceover (ambiguous) → falls back to anonymization clause.
5. Name resolution mocked, LLM call throws → falls back to anonymization clause, no crash.
6. Non-political generic-person prompt (e.g. human_interest "a woman cooking in her kitchen") → **unchanged**, guard does not fire — confirms `POLITICAL_SCENE_RE` correctly excludes it, per the narrowed scope decision above.
7. Generic person + political scene, no role noun (e.g. "a man at a campaign rally podium") → guard fires via the new combined condition.

## Files changed

- `src/stages/reel-stage4-images.ts` — add `GENERIC_PERSON_RE`, broaden `guardAgainstRealPersonLikeness()` Step 1, add `resolveNamedPersonFromVoiceover()`, wire into `ReelStage4Images.run()`.
- Test file additions per above.

## Non-goals (carried over / additional)

- No per-scene manual force-name parameter (deferred, see above).
- No change to the stock-photo path (`stockService.tryStockImage`) — still uses the original, unguarded `prompt`, same as the original doc.
- No change to `reel-stage2-script.ts` — still a deterministic stage4 fix, not an LLM-instruction fix to the scriptwriter.
