# Enrich Discovery-Sourced Reels With a Full Article Extract, Not Just a Search Snippet

## Problem

User compared two `ts` reels built from the same source article (`bild.de` — Nord-Stream diver arrest):

| | `860d0769` | `8aff3f4c` |
|---|---|---|
| How it started | Discovery (`!reel`, no URL) → paused → `!reel confirm` | `!reel <url>` (explicit URL) |
| `context.inputMode` | `discovery` | `url` |
| `snippet` length | **134 chars** | **1,294 chars** |
| `script` length | 7,870 chars | 10,361 chars |

The `!reel confirm` run reads noticeably thinner than the `!reel <url>` run even though both point at the exact same article.

## Root cause

`src/stages/reel-stage2-script.ts:248` writes the script from `story.snippet.slice(0, 4000)` — the script quality is bounded by how much real article material is in `story.snippet` at that point. The two entry points populate `snippet` completely differently:

- **`!reel <url>`** → `Stage0FromUrl` (`src/stages/stage0-from-url.ts`) calls Tavily's dedicated `/extract` endpoint on the article page, then runs the full extracted text through a Gemini classification prompt that produces a **3-5 sentence summary + 5-8 bullet key-facts list**, merged into one rich snippet. This is real article content, curated by an LLM that read the whole page.

- **Discovery mode** (`src/stages/stage1-discover.ts`, reached via bare `!reel` → `!reel confirm`) never does either of those things. Both of its internal paths just keep whatever `content` field a Tavily **search** call returned for that URL:
  - RSS-pool path: `resolveArticleUrl()` → `fetchSnippet()` → one Tavily `search()` result's `.content` (`stage1-discover.ts:90/107`)
  - Agentic path: `contentByUrl.get(sourceUrl)` from the search results used to pick the story (`stage1-discover.ts:577/587`)

  Tavily's *search* content field is a short relevance excerpt, not the article body — hence 134 chars in this example. Neither discovery path ever calls `/extract` or runs the classification step, so `!reel confirm` reels are structurally worse-sourced than `!reel <url>` reels, independent of which specific URL is involved.

**Secondary compounding bug:** `src/pipeline/reel-runner.ts:767` truncates the snippet to `.slice(0, 2000)` when persisting a new reel record. `stage2`'s prompt reads up to 4000 chars (`reel-stage2-script.ts:248`). So even a long snippet gets cut in half specifically on the discovery→confirm path, since `ReelRunner.confirm()` → `rerescript()` reconstructs `ctx.story.snippet` from the persisted (already-truncated) DB value (`reel-runner.ts:988`), whereas `!reel <url>` runs straight through in-memory and never round-trips through that 2000-char cap before scripting.

Both discovery paths (RSS pool and agentic) are shared code — not brand-specific — so this affects `ds`, `ns`, and `ts` identically whenever a reel is discovery-sourced.

## Fix 1 — give discovery-sourced stories the same full-extract enrichment as URL-sourced ones

Factor the "extract full page → classify into rich summary + key facts" logic already in `stage0-from-url.ts` into a reusable exported function, and call it once, right before `Stage1Discover.run()` returns, regardless of which internal path (RSS pool / agentic / manual hint) produced the story.

**`src/stages/stage0-from-url.ts`** — extract a new exported function so both stages share one implementation instead of duplicating the richSnippet-merge logic:

```ts
export interface UrlContentEnrichment {
  headline: string;
  snippet: string;
  selectionReason: string;
  sourceReadMode?: "tavily_extract" | "url_model_read";
  sourceExtractText?: string;
  sourceExtractAvailable?: boolean;
  sourceExtractChars?: number;
  discoverySource?: import("../types.js").ApiProvider;
}

export async function enrichUrlContent(
  url: string,
  ctx: RunContext,
  services: Services,
): Promise<UrlContentEnrichment> {
  const { story: classified, discoverySource } = await classifyUrl(url, ctx, services);
  const richSnippet = classified.keyFacts
    ? `${classified.snippet}\n\nKey facts:\n${classified.keyFacts}`
    : classified.snippet;
  return {
    headline: classified.headline,
    snippet: richSnippet,
    selectionReason: classified.selectionReason,
    sourceReadMode: classified.sourceReadMode,
    sourceExtractText: classified.sourceExtractText,
    sourceExtractAvailable: classified.sourceExtractAvailable,
    sourceExtractChars: classified.sourceExtractChars,
    discoverySource,
  };
}
```

`Stage0FromUrl.run()`'s loop body is simplified to call `enrichUrlContent()` instead of duplicating the richSnippet merge — behaviour unchanged (same Gemini calls, same throw-on-failure semantics), just de-duplicated.

**`src/stages/stage1-discover.ts`** — wrap the existing `run()` logic (currently one big method with three return points: RSS path, and two returns inside `runAgentic`) so every path funnels through a single enrichment step before returning to the caller:

```ts
async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
  const result = await this.selectStory(ctx, services); // existing method body, renamed
  const story = result.stories?.[0];
  if (story) {
    const originalLen = story.snippet.length;
    try {
      const { enrichUrlContent } = await import("./stage0-from-url.js");
      const enrichment = await enrichUrlContent(story.sourceUrl, ctx, services);
      story.snippet = enrichment.snippet;
      story.sourceReadMode = enrichment.sourceReadMode;
      story.sourceExtractText = enrichment.sourceExtractText;
      story.sourceExtractAvailable = enrichment.sourceExtractAvailable;
      story.sourceExtractChars = enrichment.sourceExtractChars;
      console.log(`  [stage1] enriched snippet via full-page extract: ${originalLen} → ${enrichment.snippet.length} chars`);
    } catch (err) {
      console.warn(`  [stage1] full-page enrichment failed, keeping search snippet (${originalLen} chars): ${err instanceof Error ? err.message : err}`);
    }
  }
  return result;
}
```

`story.headline` and `story.selectionReason` are deliberately **not** overwritten from the enrichment — Stage1's own editorial pick (validated against the RSS pool / dedup rules) stays authoritative; only the snippet and extract metadata come from the enrichment call.

Enrichment failure (paywall, extract/classify error) falls back to the existing short search snippet and logs a warning rather than failing the run — unlike `Stage0FromUrl`, where enrichment is the only source of content, here it's a quality upgrade on top of an already-validated story, so it must not turn a working discovery run into a failure.

**Cost:** one extra Tavily `/extract` call + one extra Gemini classification call per discovery-based reel (i.e. once per `!reel confirm`, not per search result).

## Fix 2 — stop double-truncating the snippet on the confirm/rerescript path

**`src/pipeline/reel-runner.ts:767`** — raise the persisted-snippet cap to match what `reel-stage2-script.ts:248` actually reads:

```ts
snippet: fetchResult.story.snippet.slice(0, 4000),
```

This is a one-line change, no schema impact — it just stops silently discarding the second half of the snippet on every reel record, which otherwise partially undoes Fix 1's benefit specifically for reels that pause for confirmation.

## Files changed

- `src/stages/stage0-from-url.ts` — extract `enrichUrlContent()` as an exported, reusable function; `Stage0FromUrl.run()` calls it instead of duplicating logic
- `src/stages/stage1-discover.ts` — rename current `run()` body to private `selectStory()`, add a thin `run()` wrapper that enriches the selected story's snippet before returning
- `src/pipeline/reel-runner.ts` — raise persisted snippet truncation from 2000 to 4000 chars (line 767)

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| `!reel <url>` | Full extract + classified rich snippet | Unchanged |
| `!reel` → `!reel confirm` (discovery) | Raw Tavily search excerpt only (~100-500 chars typical) | Full extract + classified rich snippet, same quality as URL path |
| Discovery enrichment fails (paywall/blocked) | N/A (never attempted) | Falls back to existing short search snippet, run still succeeds |
| Any reel's persisted snippet vs script's read window | Silently truncated at 2000 vs 4000 read | Persisted at full 4000, matches script read window |

Applies identically to `ds`, `ns`, and `ts` — `stage1-discover.ts` is shared code with no brand-specific branching around this logic.
