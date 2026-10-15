# Detect Garbled/Mismatched Source Content and Stop Rendering Failure Messages as Stories

## Problem

User ran `!reel https://bbc.com/news/articles/cy8w67l642no` (a BBC article about Welsh wildfires) twice within the same session. Both attempts produced wrong output, via two distinct bugs in `src/stages/stage0-from-url.ts`.

### Bug A — garbled/mismatched Tavily extract passes both quality gates

Reel `9aeddfc7` (NS): Tavily's `/extract` for this URL returned 784 chars of content that is **not from bbc.com at all** — it's ROT13-style obfuscated text mixed with paywall-modal boilerplate from an unrelated, paywalled St. Louis sports article ("You are the owner of this article... Out of gifts for the month... 2=[ yy (6E96C9@=E..."). Re-running the same Tavily call minutes later returns the correct wildfire article cleanly, so this was a transient bad scrape on Tavily's side — not reproducible on demand, and not something we control.

What we do control: this garbled content sailed straight through both existing quality gates, verified by running them directly against the captured content:

- `looksLikeScraperBlock()` → `false` (784 chars > 300 char minimum; none of the listed paywall phrases match this site's specific wording)
- `looksLikeThinStub()` → `false` (no photo-gallery markers, no `##` headers, no "opens new tab", no duplicate 40+ char sentence — that check was built last night, see `2026-07-11-thin-source-stub-and-date-guardrail.md`, for a *different* junk shape: nav boilerplate, not paywall-cipher text)

With no gate catching it, the garbled content — which still contained a few legible fragments ("Cardinals," "$132.5 million," "Wetherholt") — went straight to the classifier LLM, which confidently produced a complete, wrong, unrelated headline and snippet. The reel was fully scripted (`current_stage` reached cancellation before render in this case, but nothing in the code would have stopped it from rendering).

### Bug B — "all fallback tiers exhausted" path renders the failure message as the story

Reel `7a3d37fb` (NS, same URL, attempted 1 hour earlier with `www.` prefix): Tavily failed for this URL variant, so the code fell to Tier 2 (Gemini direct URL read). Gemini responded honestly:

> "I can't access external webpages from the URL alone in this environment, so I'm unable to read the BBC article and extract an accurate summary. Please provide the article text..."

The code's `geminiBlocked` check is supposed to catch exactly this and route to Tier 3 (search fallback):

```ts
const geminiBlocked = geminiResult.text.toLowerCase().includes("inaccessible") ||
  geminiResult.text.toLowerCase().includes("access error") ||
  geminiResult.text.toLowerCase().includes("cannot access") ||
  geminiResult.text.toLowerCase().includes("unable to access") ||
  geminiResult.text.toLowerCase().includes("not a news article");
```

Gemini's actual wording — **"can't access"** (contraction) and **"unable to read"** — matches none of these five phrases. `geminiBlocked` evaluated `false`, so the apology text was treated as a valid classification and used verbatim as the story. The pipeline then ran end-to-end on it: scripted 4 scenes literally narrating "No article was actually provided for this story... we refused to invent facts," generated 4 AI images, voiced it, and rendered a full video (`video_gcs_url` present) that sat in `awaiting_approval` for the user to review as if it were a real pending post.

Even with broader phrase matching, this class of bug will recur — the design itself is wrong. When Tier 3 (search fallback) also finds nothing (`searchFallbackUsed = false`), the current code deliberately falls back to "use Gemini's best-effort response anyway" (`stage0-from-url.ts:263-269`) and proceeds as if that response were valid story content. There is no point in the pipeline where "all three tiers failed to get real content" results in an actual error — it always produces *something* that looks like a story.

## Fix 1 — extend paywall/junk-content phrase list (Bug A)

Add the specific boilerplate phrases observed in the captured content to `looksLikeScraperBlock()` in `src/stages/stage0-from-url.ts`:

```ts
lower.includes("out of gifts for the month") ||
lower.includes("you are the owner of this article") ||
lower.includes("your counter will reset") ||
```

This is the same phrase-list-extension pattern used for the existing gate — low risk, no new logic, immediately closes the exact case observed. It won't catch every future paywall wording variant (that's a known limitation of phrase matching, same as the existing gate), but it directly fixes the reproduced case and costs nothing to maintain.

Explicitly **not** adding a general "gibberish density" / word-shape heuristic: the `ds` brand's source articles and output are Thai-language, and any Latin-alphabet-shaped heuristic would false-positive on every legitimate Thai extract. A language-safe version of that check is possible but is a separate, higher-risk piece of work — out of scope here.

## Fix 2 — fail loudly when all extraction tiers are exhausted (Bug B)

Two changes to `src/stages/stage0-from-url.ts`, in the Tier 2/3 fallback block (~line 210–271):

**2a. Broaden `geminiBlocked` phrase detection** — add the missing contraction/phrasing variants so Tier 3 actually triggers when it should:

```ts
const geminiBlocked = geminiResult.text.toLowerCase().includes("inaccessible") ||
  geminiResult.text.toLowerCase().includes("access error") ||
  geminiResult.text.toLowerCase().includes("cannot access") ||
  geminiResult.text.toLowerCase().includes("can't access") ||
  geminiResult.text.toLowerCase().includes("unable to access") ||
  geminiResult.text.toLowerCase().includes("unable to read") ||
  geminiResult.text.toLowerCase().includes("not a news article");
```

**2b. Root fix — remove the "use best-effort anyway" fallback.** When `geminiBlocked` is true and the Tier 3 search fallback also fails to find a usable hit (`!searchFallbackUsed`), throw instead of proceeding:

```ts
if (!searchFallbackUsed) {
  throw new Error(
    `Stage0FromUrl: could not extract article content for ${url} — Tavily failed, Gemini direct read was blocked, and no search fallback match was found. Provide the article text manually.`
  );
}
```

This is the change that actually prevents the bug class, independent of how complete the phrase list is: no matter *why* Gemini's response looks like a refusal, if it's flagged as blocked and there's no fallback content, the stage fails the run instead of producing a fake story to review. The `!reel` command will show the user an error instead of a several-minutes-later "your video is ready to review" that's actually the pipeline narrating its own confusion.

## Files changed

- `src/stages/stage0-from-url.ts` — extend `looksLikeScraperBlock()` phrase list (Fix 1), broaden `geminiBlocked` detection and replace the silent best-effort fallback with a thrown error (Fix 2)

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Tavily returns garbled/paywalled content with known boilerplate phrases | Passes both gates, poisons the story | Caught by extended `looksLikeScraperBlock()`, falls to Tier 2/3 |
| Tavily returns garbled content with *unrecognized* boilerplate phrasing | Passes both gates, poisons the story | **Still not caught** — known limitation of phrase matching, same as today |
| Gemini says "can't access" / "unable to read" (contraction/phrasing not in old list) | Not detected as blocked, apology text used as story, full video rendered | Detected as blocked, routes to Tier 3 |
| All three tiers genuinely produce no usable content | Silently renders a video where the reel narrates the failure | Stage throws, run fails with a clear error, no fake reel reaches approval |
| Valid extraction at any tier | Unchanged | Unchanged |

## No schema changes, no new dependencies

Same file as yesterday's fix, same pattern (phrase-list extension + fallback-chain behavior change). Both `ns` and `ds` share this code path; Fix 1 and 2a are language-agnostic phrase additions, Fix 2b is control-flow only.
