# Guard Against Recognizable Real-Person Likenesses in Generic Political Image Prompts

## Problem

In politics-category reels, AI-generated scene images sometimes depict a specific, recognizable real person — often an outdated one (e.g. a former minister or prime minister no longer in office) — even when the `imagePrompt` itself never names anyone.

Confirmed example: run `ea0e9945-433a-4fd5-aa81-6652f517a0d1` (TagesBrief, "Historische Trockenheit"), scene 3.

- **voiceover**: `"Bundesumweltminister Carsten Schneider nannte Wasser Mitte Juli unsere wertvollste Ressource..."` — names the real, current German federal environment minister.
- **imagePrompt**: `"German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style"` — no name at all, just a generic role description.

The name never made it from the voiceover into the imagePrompt. Given only the generic role description, the image-gen model (Gemini/Azure) rendered a specific, recognizable real politician anyway — not the person the story is actually about, and reportedly an outdated one. This is a property of the image model's training data (generic political-role prompts resolve to whichever face is most represented in training), not something the scriptwriting LLM's wording controls directly.

## Scope

- Applies to all three brands (`ds`, `ns`, `ts`) — `reel-stage4-images.ts` / `ReelStage4Images` is a single shared stage with no brand-specific branching, so the guard runs identically for every brand. Verified that `imagePrompt` text is always written in English regardless of the brand's target language (checked live `ds` (Thai), `ns`, `ts` rows in `data/pipeline.db`), so the English role-keyword regex needs no per-language variants.
- Applies to AI-generated images only (`imageGen.generate()` calls in `reel-stage4-images.ts`). Stock-photo search (Unsplash via `stockService.tryStockImage`) is out of scope, on the assumption that Unsplash is general-purpose creative-stock photography, not a photojournalism/wire archive — it's very unlikely to return a correctly-attributed editorial photo of a specific politician for a generic query. This is a stated assumption, not empirically spot-checked against live Unsplash results; flag if that verification is wanted before shipping.
- Triggers only on **generic** political/government-role language with **no name attached**. If the `imagePrompt` already names a specific real person, it is left untouched — the model is trusted to attempt that person's likeness, and accuracy for named individuals is explicitly out of scope for this fix.
- Does not modify the stored `scene.imagePrompt` (as persisted in `ReelScript` / `data/pipeline.db`) — only the string actually sent to the image-gen API is changed, so review tooling and regeneration still see the original prompt.
- Does not add a rule to the scriptwriting system prompt (`buildSystemPrompt()` in `reel-stage2-script.ts`). This is a deterministic code-level guardrail, not an LLM-instruction fix.

## Design

### New helper: `guardAgainstRealPersonLikeness(prompt: string): string`

Location: `src/stages/reel-stage4-images.ts`, alongside the existing `REBUILD_VARIATIONS` constant.

**Step 1 — role-keyword detection**

A case-insensitive, word-boundary regex matching political/government role language.
Plural forms are matched too (`s?` before the closing boundary) for the simple
pluralizable single-word alternatives and the last word of "prime minister" /
"party leader", so e.g. "German politicians" is still guarded — the bare `\b`
boundary alone never matches before a trailing "s". `mp` / `member of parliament`
are left singular-only (plural is ambiguous/rare enough to skip), and "head of
state" is left singular-only too (its plural, "heads of state", is irregular —
the "s" isn't on the last word):

```
politicians?|presidents?|prime ministers?|premiers?|chancellors?|ministers?|
secretary of state|senators?|governors?|mayors?|\bmp\b|member of parliament|
parliamentarians?|cabinet|head of state|party leaders?|diplomats?|ambassadors?|
officials?
```

**Step 2 — name-like sequence detection**

Scan for sequences of 2+ consecutive capitalized word tokens (`/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g`). For each match, split into words and check against a stopword set. If **every** word in a matched sequence is in this stopword set, it's just a title/place/institution phrase, not a name. If **any** matched sequence has at least one word outside the set, a real name is considered present. The stopword set covers two categories:

- **Titles/nationalities**: `Prime`, `Minister`, `President`, `Chancellor`, `Secretary`, `State`, `Senator`, `Governor`, `Mayor`, `Premier`, `Cabinet`, `Parliament`, `Congress`, `House`, `Representatives`, `Foreign`, `Interior`, `Defense`, `Finance`, `Justice`, `The`, `Of`, plus common nationality adjectives like `German`, `Thai`, `American`, `British`, `French`.
- **Places/institutions** (added after review — see below): `White`, `Street`, `Downing`, `Palace`, `Capitol`, `Hill`, `Commission`, `Reichstag`, `Bundestag`, `Kremlin`, `Building`, `Square`, `Avenue`, `Hall`.

  (`Elysée` was originally in this set but is unreachable dead code: `CAPITALIZED_SEQUENCE_RE` is ASCII-only (`[A-Z][a-zA-Z]+`), so a token containing "é" can never be produced by that regex in the first place. It was removed in final review. "Elysée Palace" is still guarded correctly today — via the "no 2-word capitalized sequence matched" fallback path, not via this stopword — same outcome, different mechanism.)

  **This places/institutions list is a denylist of specific known phrases, not a general fix.** It only helps when the exact phrase (or its constituent words) is in the set above. It does **not** close the general false-negative class of "any capitalized place/institution name reads as a real name" — real prompts like `"in front of the Brandenburg Gate"`, `"in Red Square, Moscow"`, or `"at Government House, Bangkok"` still slip through today (verified in final review): none of `Brandenburg`, `Gate`, `Red`, `Moscow`, `Government`, `Bangkok` are in `TITLE_STOPWORDS`, so each of those sequences is treated as a real name and the guard incorrectly leaves the prompt unguarded. Closing the general class is out of scope here — see the follow-up note near Non-goals below.

  Separately, and for a different reason: **non-ASCII names are also over-anonymized today.** Because `CAPITALIZED_SEQUENCE_RE` is ASCII-only, a name like `"Jürgen Müller"` never matches the sequence regex at all, so `hasRealNameSequence()` returns `false` even though a real name is present — the guard fires and anonymizes it. This is the same accepted safe-direction trade-off as the documented bare-surname limitation below (over-anonymizing a real name is safe; rendering a specific wrong face is not), just via a different mechanism (encoding, not word count).

**Known limitation (accepted, not fixed):** the 2+-word minimum means a bare single-word surname (e.g. `"German chancellor Merkel speaking at a podium"` — `Merkel` alone, no first name) is *not* detected as a real name, so the guard will anonymize it even though a specific real person is actually named. Loosening the check to count single capitalized words as names was considered and rejected: single capitalized words are extremely common for things that are *not* people (city names, building names, brand names), so that change would reopen the White House-style false negative that the places/institutions stopwords above specifically cover — e.g. `"German politician giving a speech in Berlin"` would wrongly be treated as "already named" via `Berlin`. (As noted above, this places/institutions coverage is only a fixed denylist, not a general fix, so plenty of other place names already trigger this same false-negative today regardless.) The bare-surname case is accepted as a known trade-off: the failure direction is safe (over-anonymizes a real name into a generic face) rather than unsafe (renders a specific wrong face), which is the trade-off this whole feature exists to bias toward.

**Step 3 — decision**

- Role keyword found **and** no name-like sequence found → append the anonymization clause (Step 4).
- Otherwise → return the prompt unchanged.

**Step 4 — anonymization clause**

```
" Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead."
```

### Call sites

In `ReelStage4Images.run()`, both places that call `imageGen.generate()`:

1. Main generation path (~line 104): guard the prompt before calling `imageGen.generate(prompt, ...)`. The stock-photo lookup (~line 95) continues to use the original, unguarded `prompt`.
2. Safety-retry fallback (~line 111-113): **corrected in final review.** The original implementation built `safePrompt` by running the banned-word-stripping regex over `genPrompt` (the already-guarded text). When the guard had fired, that strips the word "person" out of `ANONYMIZATION_CLAUSE` itself, producing mangled text (a double space, a dropped word). The fix strips banned words from the original, unguarded `prompt` instead, then re-appends `ANONYMIZATION_CLAUSE` afterward — but only if the guard actually fired for this scene (tracked via a `guardFired = genPrompt !== prompt` check) — so a non-political prompt's safe-retry text isn't given the clause it never had.

Concretely, the stock-image lookup keeps using the original `prompt` unchanged, and a second variable holds the guarded text used only for AI generation:

```ts
let prompt = scene.imagePrompt;
if (shuffledVariations) { /* existing rebuild-variation logic, unchanged */ }

// stock lookup uses `prompt` (unguarded) — unchanged
const stockResult = ctx.useStockImages !== false
  ? await stockService.tryStockImage(prompt, "portrait")
  : null;

if (stockResult) {
  // unchanged
} else {
  const genPrompt = guardAgainstRealPersonLikeness(prompt);
  try {
    const genResult = await imageGen.generate(genPrompt, { aspectRatio: "9:16" });
    ...
  } catch (err) {
    ...
    // Strip from the original `prompt`, not `genPrompt` — stripping "person" out of
    // ANONYMIZATION_CLAUSE itself would mangle it. Re-append the clause afterward,
    // only if the guard fired.
    const strippedPrompt = prompt.replace(/\b(child|kid|boy|girl|man|woman|person|people|minor|\d+-year-old)\b/gi, "").trim();
    const guardFired = genPrompt !== prompt;
    const safePrompt = `Cinematic news photo, no people visible: ${strippedPrompt}${guardFired ? ANONYMIZATION_CLAUSE : ""}. Dramatic lighting, photorealistic.`;
    ...
  }
}
```

## Testing

Add unit tests (new file `tests/reel-stage4-images-guard.test.ts` or alongside existing `tests/post-stage3-image-gen.test.ts` conventions) covering `guardAgainstRealPersonLikeness` directly:

1. **Confirmed regression case**: the scene-3 imagePrompt from `ea0e9945-433a-4fd5-aa81-6652f517a0d1` → clause appended.
2. **Named-person prompt left alone**: e.g. `"Carsten Schneider speaking at a podium press conference..."` → unchanged (name-like sequence found, "Carsten Schneider" not in stopword set).
3. **Title-only phrase still triggers**: e.g. `"The Prime Minister addressing parliament..."` → clause appended ("Prime Minister" both words are stopwords, no real name present).
4. **No role keyword, no person**: e.g. `"Wide dry sandbars emerging from the Rhine river near Duisburg..."` (scene 1 of the same run) → unchanged, no role keyword present.
5. **Nationality adjective doesn't count as a name**: e.g. `"German politician at a podium..."` (the actual scene-3 prompt) → clause appended, confirming `German` alone doesn't satisfy the name-like check.
6. **Place/institution isn't mistaken for a name** (added after review): e.g. `"German politician speaking outside the White House..."` → clause appended, confirming `White House` doesn't satisfy the name-like check now that place/institution words are in the stopword set.
7. **Accepted limitation — bare single-word surname** (added after review): e.g. `"German chancellor Merkel speaking at a podium..."` → clause appended (current/accepted behavior — a single capitalized word never counts as a name-like sequence, so this real name is over-anonymized; see "Known limitation" above). Test documents the accepted behavior, not a bug to fix.
8. **Plural role word triggers** (added in final review): e.g. `"German politicians arguing in a parliamentary chamber..."` → clause appended, confirming the `s?` addition to `POLITICAL_ROLE_RE` catches plural role nouns that the original word-boundary-only regex missed.

## Files changed

- `src/stages/reel-stage4-images.ts` — add `guardAgainstRealPersonLikeness()` helper, apply it to the generation-path prompt before both `imageGen.generate()` call sites.
- New test file covering the helper directly.

## Non-goals

- No fix to `reel-stage2-script.ts` / `buildSystemPrompt()`.
- No attempt to verify or correct the accuracy of a depicted real person when a name is present in the prompt.
- No change to stock-image search behavior.
- No detection of bare single-word surnames as real names (accepted limitation, see "Known limitation" above).
- Scoped to political/government roles only. The same underlying failure mode (a generic professional-role prompt resolving to whichever face is most represented in the image model's training data) plausibly applies to other role categories too — e.g. "CEO of a major tech company," "famous athlete." Out of scope here; flagged as likely future work if similar reports surface for non-political roles.

## Follow-up / future work (flagged in final review, not done here)

The current name-detection approach (`hasRealNameSequence()`) is fundamentally a "not a known stopword" check — it treats the *absence* of negative evidence (a stopword match) as *proof* a real name is present. This is why it's an open-ended, inherently incomplete denylist against proper nouns (see the place/institution note in Step 2 above): any capitalized phrase not already in `TITLE_STOPWORDS` reads as a name, whether or not it actually is one.

A more robust redesign would instead look for **positive** evidence of a real name — e.g. requiring a capitalized name-like sequence to appear directly adjacent to a role keyword (as in `"Minister Carsten Schneider"`), rather than anywhere in the prompt regardless of proximity to a role word. This would likely reduce both false negatives (untagged place names slipping through) and false positives (unrelated capitalized phrases elsewhere in the prompt being treated as a name). This is flagged as follow-up work — not implemented as part of this fix.
