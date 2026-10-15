# Reel Discovery Improvement

**Date**: 2026-05-19
**Status**: Approved
**Scope**: `src/services/trending.ts`, `src/stages/stage1-discover.ts`, `src/types.ts`, `src/brands/ds.ts`, `src/brands/ns.ts`

---

## Goal

Replace the current Tavily-first discovery loop with a Google News RSS-first selection flow that consistently surfaces high-engagement stories — shock, surprise, fear, controversy. Reduce Tavily spend to near-zero on most runs.

---

## Section 1 — Signal Layer (`trending.ts`)

### GoogleNewsItem type

`fetchGoogleNews` returns structured items instead of plain headline strings:

```ts
export interface GoogleNewsItem {
  title: string;   // headline, trailing " - Source" stripped
  source: string;  // publisher e.g. "CNN", "thairath.co.th"
  pubDate: string; // ISO string
  link: string;    // Google News redirect URL
}
```

### Multi-geo support

`TrendingConfig.googleNewsGeo: string` becomes `googleNewsGeos: string[]`. Multiple geos are fetched in parallel and merged. Duplicates removed by normalized title (lowercase, strip punctuation).

### Remove Google Trends

`fetchGoogleTrends` is deleted. `TrendingConfig.googleTrendsGeo` field is removed. All callers updated.

### YouTube

Unchanged — still fetched and passed as secondary context in the selection prompt.

### TrendingSignals interface

```ts
// Before
googleTrends: string[];
googleNews: string[];

// After
// googleTrends removed
googleNews: GoogleNewsItem[];
```

---

## Section 2 — Stage 1 Selection Flow (`stage1-discover.ts`)

The agentic Tavily search loop is replaced with a 2-step non-agentic flow for **pure discovery runs**. Manual hint mode (`manualSourceHintText` present) keeps the existing agentic behavior unchanged.

### Step A — Gemini structured selection (no tools, no Tavily)

Single Gemini structured-output call. Input: numbered RSS pool (`title | source | pubDate`). Output schema:

```ts
{
  selectedIndex: number;
  headline: string;
  source: string;
  pillar: string;
  theme: string;
  selectionReason: string;
}
```

System prompt includes:
- Brand rules: geography, pillars, excluded topics, category bias (unchanged)
- Engagement criteria: *"Rank by shock value, surprise, fear, controversy, emotional impact. Hard news with a strong reaction angle beats dry factual reporting."*
- Secondary context: YouTube trending titles (if available)
- Dedup block: excluded topics list (same as current)

On dedup retry: remove matched items from the pool, re-call Step A with a warning. Up to `MAX_DEDUP_RETRIES` — no Tavily cost per retry.

### Step B — URL resolution

```
1. fetch(items[selectedIndex].link, { redirect: "follow", timeout: 5s })
2. If finalUrl host is not *.google.com → success, use finalUrl (free path)
3. Else → Tavily search: `"${headline}" ${source}`
         with includeDomains: brand.trustedSources
         take first result URL (fallback path)
```

### Verification

- Redirect path: if resolved domain is in `trustedSources` → `verified: true`, `verifiedBy: source`
- Tavily fallback path: first result is already from a trusted domain → `verified: true`
- Neither path produces a trusted URL → `verified: false` (non-fatal, logged)

---

## Section 3 — Config Changes

### `TrendingConfig` (types.ts)

```ts
// Remove
googleTrendsGeo?: string;
googleNewsGeo?: string;

// Add
googleNewsGeos?: string[];
```

### DS brand (`ds.ts`)

`trendingConfig` becomes:
```ts
trendingConfig: {
  googleNewsGeos: ["TH"],
  youtubeRegionCode: "TH",
  youtubeQuery: "ข่าวไทย",
}
```

Extended `trustedSources`:
```
thairath.co.th, dailynews.co.th, sanook.com, matichon.co.th,
khaosod.co.th, prachachat.net, bangkokpost.com, nationthailand.com,
bbc.com/thai, voicetv.co.th, thaipbs.or.th,
komchadluek.net, posttoday.com, mgronline.com, pptv36.com,
ch3plus.com, thansettakij.com, springnews.co.th, amarintv.com,
thestandard.co, workpointtoday.com, naewna.com, tnews.co.th,
hfocus.org, isranews.org, kapook.com, mthai.com, nbt.co.th
```

### NS brand (`ns.ts`)

`trendingConfig` becomes:
```ts
trendingConfig: {
  googleNewsGeos: ["US", "GB"],
  youtubeRegionCode: "GB",
  youtubeQuery: "europe news today",
}
```

Extended `trustedSources`:
```
reuters.com, bbc.com, apnews.com, theguardian.com,
dw.com, aljazeera.com, france24.com, euronews.com,
nytimes.com, washingtonpost.com, bloomberg.com, ft.com,
cnn.com, independent.co.uk, sky.com, politico.eu,
nbcnews.com, cbsnews.com, axios.com, time.com,
theatlantic.com, foreignpolicy.com, propublica.org, thetimes.co.uk
```

---

## What Gets Removed

| Item | Where |
|---|---|
| `fetchGoogleTrends` function | `trending.ts` |
| `googleTrendsGeo` field | `TrendingConfig` in `types.ts` |
| `formatTrendingForPrompt` function | `trending.ts` (replaced by inline formatting in stage1) |
| Agentic `search` tool + loop | `stage1-discover.ts` (discovery mode only) |
| `trendingBlock` Google Trends section | `stage1-discover.ts` prompt |

---

## Data Flow (Discovery Mode)

```
fetchTrendingSignals()
  ├── fetchGoogleNews(["TH"]) or fetchGoogleNews(["US","GB"])  ← primary pool
  └── fetchYouTube(...)                                         ← secondary hint

Stage1Discover.run()
  ├── [Step A] Gemini structured call
  │     input:  RSS pool + brand rules + engagement criteria
  │     output: { selectedIndex, headline, source, pillar, theme, selectionReason }
  │
  ├── [Step B] URL resolution
  │     try:  follow Google News redirect → real article URL
  │     else: Tavily search with headline + source (fallback only)
  │
  └── Build Story + set verified flag
```

---

## Expected Outcome

| Metric | Before | After |
|---|---|---|
| Tavily calls (discovery) | 1–2 per run | 0 (redirect succeeds) or 1 (fallback) |
| Story selection basis | Gemini-constructed queries | Top Google News headlines |
| Engagement focus | Category bias hint | Explicit shock/surprise/fear/controversy criteria |
| Signal sources | Google Trends + YouTube + Google News | Google News (primary) + YouTube (secondary) |
| Dedup retry cost | 1 full agentic call per retry | 1 Gemini structured call per retry (no Tavily) |

---

## Files Modified

| File | Change |
|---|---|
| `src/services/trending.ts` | `GoogleNewsItem` type, multi-geo fetch, remove Google Trends |
| `src/stages/stage1-discover.ts` | Replace agentic loop with 2-step flow for discovery mode |
| `src/types.ts` | Update `TrendingConfig`, `TrendingSignals` |
| `src/brands/ds.ts` | Update `trendingConfig`, extend `trustedSources` |
| `src/brands/ns.ts` | Update `trendingConfig`, extend `trustedSources` |

## Verification

- `npm run build` — must pass with no type errors
- Watch next reel run: `[stage1]` logs should show RSS pool size and selected headline
- Confirm `[stage1] redirect resolved` or `[stage1] tavily fallback` per run
- No `[trending] Google Trends` log lines
