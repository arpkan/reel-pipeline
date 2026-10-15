# Tavily Search Optimization + Reel Topic Deduplication

**Date**: 2026-04-13
**Status**: Planned
**Scope**: `src/stages/stage1-discover.ts`, `src/services/search.ts`, `src/types.ts`, `src/pipeline/reel-runner.ts`, `src/db/queries.ts`

---

## Background

Two separate problems addressed together since they share the same file (`stage1-discover.ts`):

1. **Tavily over-spending**: Each run uses 6–10 API calls costing ~$24–43/month. Multiple structural inefficiencies identified.
2. **Reel topic duplication**: Same news story appears across consecutive reel runs because dedup only checks 10 headlines as a soft Gemini hint — no server-side enforcement, no URL-level matching.

---

## Part A: Tavily Search Optimization

### Pricing reference
- Basic search: **1 credit = $0.008/call**
- Advanced search: **2 credits = $0.016/call**
- Max results per call: **20** (no extra cost for more results)

### Change A1 — `src/stages/stage1-discover.ts` line 180: Increase `maxResults` 5 → 20

Tavily charges per API call, **not per result**. Quadrupling results per call gives Gemini far more candidates at zero extra cost. Expected: discovery drops from 4–8 searches to 1–2.

```typescript
// Before
maxResults: 5,
// After
maxResults: 20,
```

### Change A2 — Unify stage1-discover to always find 1 story

`stage1-discover` hardcodes 2 stories everywhere (lines 63, 69, 158, 241, 267). Reel only uses `stories[0]` — story[1] and its verification search are wasted every run. Since reel is the primary pipeline and post is secondary, both are unified to 1 story per run. Post pipeline schedules 1 post per run using `postTimes[0]`.

Change all hardcoded `2` → `1` in `src/stages/stage1-discover.ts`:
- Tool description: `"Submit your final selected story. Call this once you have found and verified 1 strong candidate."`
- Tool parameter description: `"Exactly 1 story"`
- User message: `"Find 1 news story for ${brand.name} today…"`
- Validation: `submitted.length < 1`
- Slice: `submitted.slice(0, 1)`

Search budget tightened:
```
// Before
SEARCH BUDGET: Maximum 8 searches total. Be efficient.

// After
SEARCH BUDGET: Maximum 2 searches total. Each search returns up to 20 results — 1 broad search is usually enough to find 1 strong story.
```

PROCESS instruction updated:
```
// Before
1. Search for news candidates (2–4 searches with search_depth: 'advanced')
2. For each story you want to select, verify with a targeted search
3. Call submit_stories with your final 2 selections

// After
1. Search for news candidates (1 broad search with search_depth: 'advanced')
2. If needed, verify with 1 targeted search for the chosen story
3. Call submit_stories with your final selection
```

### Change A3 — `src/stages/stage1-discover.ts` lines 285–304: Skip verification for trusted-source stories

If Gemini found the story from a trusted source URL, it is already verified — no search needed. Only run verification for stories from unknown sources.

```typescript
const alreadyTrusted = brand.trustedSources.some(
  (ts) => story.source === ts || story.source.endsWith(`.${ts}`)
);
if (alreadyTrusted) {
  story.verified = true;
  story.verifiedBy = story.source;
  console.log(`  [stage1] auto-verified (trusted source): "${story.headline.slice(0, 40)}…"`);
  return;
}
// ... existing verification search logic for non-trusted sources ...
```

### Change A4 — `src/stages/stage1-discover.ts` line 289: Use `include_domains` for verification searches

For non-trusted-source stories, pass `includeDomains: brand.trustedSources` to Tavily. Tavily filters server-side so every result is already from a trusted source — no post-search filtering needed in code.

```typescript
// Before
const results = await services.search.search(query, { maxResults: 3, searchDepth: "basic" });
const hit = results.find((r) => {
  const hostname = new URL(r.url).hostname.replace("www.", "");
  return brand.trustedSources.some((ts) => hostname === ts || hostname.endsWith(`.${ts}`));
});

// After
const results = await services.search.search(query, {
  maxResults: 3,
  searchDepth: "basic",
  includeDomains: brand.trustedSources,
});
const hit = results[0]; // every result is already from a trusted source
```

Requires adding `includeDomains?: string[]` to `SearchOptions` in `src/services/search.ts` and passing it in the Tavily request body as `include_domains`.

### Change A5 — `src/services/search.ts`: Add `include_usage` to log credit consumption

Add `include_usage: true` to all Tavily requests and log the returned credit count. Zero cost, gives visibility into actual spend per call.

```typescript
// In fetch body:
include_usage: true,

// After response parsing:
if (data.usage) {
  console.log(`  [tavily] credits used: ${data.usage.credits}`);
}
```

### Change A6 — `src/stages/stage1-discover.ts` line 183: Reduce `days: 7` → `days: 3`

A 7-day window lets stale articles pollute results and forces extra searches. 3 days keeps results fresh while still covering stories that broke yesterday.

```typescript
// Before
days: 7,
// After
days: 3,
```

### Estimated savings

**Per run (unified to 1 story):**

| Metric | Before | After |
|---|---|---|
| Discovery (advanced) | 4–8 calls × 2 cr = **8–16 cr** | 1–2 calls × 2 cr = **2–4 cr** |
| Verification (basic) | 2 calls × 1 cr = **2 cr** | 0–1 calls × 1 cr = **0–1 cr** |
| Total per run | **10–18 cr ($0.08–$0.14)** | **2–5 cr ($0.02–$0.04)** |

**Daily (~10 runs across DS + NS):**

| | Before | After |
|---|---|---|
| Total/day | 100–180 cr ($0.80–$1.44) | 20–50 cr ($0.16–$0.40) |
| Per month | **~$24–$43** | **~$5–$12** |
| Reduction | — | **~70–80%** |

---

## Part B: Strengthen Reel Topic Deduplication

### Context

Current dedup checks last 10 reel headlines as a soft Gemini prompt hint. Problems:
- 10 headlines = ~1.5 days of coverage for DS (6 reels/day)
- Same article with different headline wording bypasses the check
- Gemini can ignore the instruction if it deems a story important enough

### Change B1 — `src/db/queries.ts`: Add `getRecentReelInfo()`

Extend `getRecentReelHeadlines` to also return `sourceUrl`, increase limit to 20:

```typescript
export function getRecentReelInfo(brand: BrandId, limit = 20): { headline: string; sourceUrl: string }[] {
  return db.select({ headline: reels.headline, sourceUrl: reels.source_url }).from(reels)
    .where(eq(reels.brand, brand))
    .orderBy(desc(reels.createdAt))
    .limit(limit)
    .all();
}
```

Keep old `getRecentReelHeadlines` as a thin wrapper or update the single caller in reel-runner.ts directly.

### Change B2 — `src/types.ts`: Add `reelRecentUrls` to RunContext

```typescript
reelRecentUrls?: string[];
```

### Change B3 — `src/pipeline/reel-runner.ts`: Hard server-side URL check

- Increase lookback from 10 → 20
- After `fetchStory`, reject if `sourceUrl` matches any recent reel — no Gemini involvement, hard stop

```typescript
// Replace:
const recentTopics = queries.getRecentReelHeadlines(brandId, 10);
// With:
const recentInfo = queries.getRecentReelInfo(brandId, 20);
const recentTopics = recentInfo.map((r) => r.headline);
const recentUrls   = new Set(recentInfo.map((r) => r.sourceUrl));

// After fetchStory:
if (recentUrls.has(fetchResult.story.sourceUrl)) {
  throw new Error(`Reel story already covered recently: ${fetchResult.story.sourceUrl}`);
}
```

Also pass `reelRecentUrls: Array.from(recentUrls)` into RunContext.

### Change B4 — `src/stages/stage1-discover.ts`: Enrich dedup prompt with source domains

```typescript
// Before:
${ctx.reelRecentTopics?.length
  ? `RECENTLY COVERED REEL TOPICS (avoid repeating):\n${ctx.reelRecentTopics.map((h, i) => `  ${i+1}. ${h}`).join("\n")}\n`
  : ""}

// After:
${ctx.reelRecentTopics?.length
  ? `RECENTLY COVERED REEL TOPICS (avoid same stories or closely related angles — do NOT reuse any of these source URLs):\n${ctx.reelRecentTopics.map((h, i) => `  ${i+1}. ${h}${ctx.reelRecentUrls?.[i] ? ` (${new URL(ctx.reelRecentUrls[i]).hostname.replace("www.", "")})` : ""}`).join("\n")}\n`
  : ""}
```

---

## Files Modified

| File | Changes |
|---|---|
| `src/stages/stage1-discover.ts` | 1 story, maxResults 5→20, budget 8→2, days 7→3, skip trusted-source verification, include_domains on verification, enrich dedup prompt |
| `src/services/search.ts` | Add `includeDomains?: string[]` to SearchOptions, add include_usage logging |
| `src/types.ts` | Add `reelRecentUrls?: string[]` to RunContext |
| `src/pipeline/reel-runner.ts` | Lookback 10→20, hard URL check post-fetch, pass reelRecentUrls |
| `src/db/queries.ts` | Add `getRecentReelInfo()` |

## Verification

- `npm run build` — must pass with no type errors
- Watch next reel run logs: discovery should use 1–2 searches; credit usage logged per call
- Look for `[stage1] auto-verified (trusted source)` confirming skip logic fires
- Look for `Reel story already covered recently` if a URL duplicate slips through dedup
