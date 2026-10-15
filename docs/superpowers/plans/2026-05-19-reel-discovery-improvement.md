# Reel Discovery Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini-driven Tavily search discovery with a Google News RSS pool selection flow that consistently surfaces high-engagement stories, reducing Tavily calls from 2–4 to 1 per run.

**Architecture:** `fetchTrendingSignals` returns structured `GoogleNewsItem[]` from multiple geo-targeted RSS feeds. `Stage1Discover.run()` branches: RSS selection path (pure discovery) uses a single `gemini.generate()` JSON call to pick from the pool, then resolves the URL via redirect-follow with Tavily-search fallback; manual hint path keeps the existing agentic loop unchanged.

**Tech Stack:** TypeScript, Vitest, nock (HTTP mocking), `@google/genai`, Tavily API

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Remove `googleTrendsGeo` from `TrendingConfig`; rename `googleNewsGeo` → `googleNewsGeos: string[]` |
| `src/services/trending.ts` | Add `GoogleNewsItem` type; update `fetchGoogleNews` to return structured items; add multi-geo support; remove `fetchGoogleTrends`; remove `formatTrendingForPrompt` |
| `src/brands/ds.ts` | Update `trendingConfig`; extend `trustedSources` |
| `src/brands/ns.ts` | Update `trendingConfig`; extend `trustedSources` |
| `src/stages/stage1-discover.ts` | Add `resolveArticleUrl()`; add `selectStoryFromPool()`; branch `run()` on `manualSourceHintText` |
| `tests/stage1-discover.test.ts` | Add tests for `resolveArticleUrl` and `selectStoryFromPool` |
| `tests/testing-runner-stage1-agentic-mock.test.ts` | Update mock helper for new Gemini JSON response format |
| `test/runner.ts` | Update `createStage1GeminiMockReply` and `setupStage1Nock` for new flow |

---

## Task 1: Update `TrendingConfig` and `TrendingSignals` types

**Files:**
- Modify: `src/types.ts:46-52`
- Modify: `src/services/trending.ts:1-9`

- [ ] **Step 1: Write the failing build test**

Run: `npm run build`
Expected: PASS (baseline — confirm build is green before touching anything)

- [ ] **Step 2: Update `TrendingConfig` in `src/types.ts`**

Replace lines 46–52:
```ts
export interface TrendingConfig {
  googleNewsGeos?: string[];       // e.g. ["TH"] or ["US", "GB"]
  googleNewsLang?: string;         // e.g. "en", "th" — used in RSS URL hl= param
  youtubeRegionCode?: string;      // e.g. "TH", "DE"
  youtubeQuery?: string;           // e.g. "ข่าวไทย", "news europe"
}
```

- [ ] **Step 3: Add `GoogleNewsItem` and update `TrendingSignals` in `src/services/trending.ts`**

Replace lines 1–8:
```ts
import type { TrendingConfig } from "../types.js";
import type { SearchService } from "./search.js";

export interface GoogleNewsItem {
  title: string;    // headline, trailing " - Source" stripped
  source: string;   // publisher name e.g. "CNN", "thairath.co.th"
  pubDate: string;  // as-returned from RSS e.g. "Tue, 19 May 2026 10:31:00 GMT"
  link: string;     // Google News redirect URL
}

export interface TrendingSignals {
  youtube: string[];
  googleNews: GoogleNewsItem[];
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: type errors on callers of `googleNewsGeo` and `googleTrendsGeo` — that's expected; we'll fix them in later tasks. If there are unexpected errors, fix them now.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/services/trending.ts
git commit -m "refactor: update TrendingConfig and TrendingSignals for RSS-first discovery"
```

---

## Task 2: Refactor `trending.ts`

**Files:**
- Modify: `src/services/trending.ts`

- [ ] **Step 1: Write the failing test**

In `tests/stage1-discover.test.ts`, add at the top of the file (below existing imports):
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatExcludedTopicsBlock } from "../src/stages/stage1-discover.js";

describe("fetchGoogleNews (unit)", () => {
  it("parses title, source, pubDate, and link from RSS XML", async () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Thai floods hit 3 provinces - Bangkok Post</title>
        <link>https://news.google.com/rss/articles/ABC123?oc=5</link>
        <pubDate>Tue, 19 May 2026 08:00:00 GMT</pubDate>
        <source url="https://bangkokpost.com">Bangkok Post</source>
      </item>
    </channel></rss>`;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    }));

    const { fetchGoogleNews } = await import("../src/services/trending.js");
    const items = await fetchGoogleNews("th", "TH");

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Thai floods hit 3 provinces");
    expect(items[0].source).toBe("Bangkok Post");
    expect(items[0].pubDate).toBe("Tue, 19 May 2026 08:00:00 GMT");
    expect(items[0].link).toBe("https://news.google.com/rss/articles/ABC123?oc=5");

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: FAIL — `fetchGoogleNews` is not exported

- [ ] **Step 3: Rewrite `trending.ts`**

Replace the full file content of `src/services/trending.ts`:

```ts
import type { TrendingConfig } from "../types.js";
import type { SearchService } from "./search.js";

export interface GoogleNewsItem {
  title: string;
  source: string;
  pubDate: string;
  link: string;
}

export interface TrendingSignals {
  youtube: string[];
  googleNews: GoogleNewsItem[];
}

// ─── Google News RSS ──────────────────────────────────────────────────────────

export async function fetchGoogleNews(lang: string, geo: string): Promise<GoogleNewsItem[]> {
  const url = `https://news.google.com/rss?hl=${lang}&gl=${geo}&ceid=${geo}:${lang}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsPipeline/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Google News RSS returned ${res.status} for ${geo}`);
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return items.map((m) => {
    const body = m[1];
    const titleRaw = body.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ?? "";
    const source = body.match(/<source[^>]*>([^<]+)<\/source>/)?.[1]?.trim() ?? "";
    const title = source
      ? titleRaw.replace(new RegExp(`\\s*-\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "").trim()
      : titleRaw;
    const link = body.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? "";
    const pubDate = body.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() ?? "";
    return { title, source, pubDate, link };
  }).filter((item) => item.title && item.link).slice(0, 20);
}

// ─── YouTube Data API v3 ──────────────────────────────────────────────────────

const REGION_TO_LANG: Record<string, string> = {
  TH: "th", DE: "de", GB: "en", US: "en", FR: "fr", JP: "ja", KR: "ko",
};

async function fetchYouTube(regionCode: string, query: string, apiKey: string): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    order: "viewCount",
    publishedAfter: since,
    regionCode,
    relevanceLanguage: REGION_TO_LANG[regionCode] ?? "en",
    maxResults: "10",
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
  const data = await res.json() as { items?: { snippet: { title: string } }[] };
  return (data.items ?? [])
    .map((item) => item.snippet.title.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'"))
    .filter(Boolean);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function fetchTrendingSignals(
  config: TrendingConfig,
  _search: SearchService,
): Promise<TrendingSignals> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const lang = config.googleNewsLang ?? "en";

  const [youtube, googleNewsArrays] = await Promise.all([
    config.youtubeRegionCode && config.youtubeQuery
      ? fetchYouTube(config.youtubeRegionCode, config.youtubeQuery, apiKey).catch((e) => {
          console.warn(`[trending] YouTube failed (non-fatal): ${e instanceof Error ? e.message : e}`);
          return [] as string[];
        })
      : Promise.resolve([] as string[]),

    config.googleNewsGeos?.length
      ? Promise.all(
          config.googleNewsGeos.map((geo) =>
            fetchGoogleNews(lang, geo).catch((e) => {
              console.warn(`[trending] Google News (${geo}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
              return [] as GoogleNewsItem[];
            })
          )
        )
      : Promise.resolve([] as GoogleNewsItem[][]),
  ]);

  // Merge multi-geo results, deduplicate by normalized title
  const seen = new Set<string>();
  const googleNews: GoogleNewsItem[] = [];
  for (const batch of googleNewsArrays) {
    for (const item of batch) {
      const key = item.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (!seen.has(key)) {
        seen.add(key);
        googleNews.push(item);
      }
    }
  }

  return { youtube, googleNews };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: PASS for the new fetchGoogleNews test

- [ ] **Step 5: Run full test suite to check for breakage**

Run: `npm run test`
Expected: any failures are in tests that reference `googleTrendsGeo`, `googleNewsGeo`, or `formatTrendingForPrompt` — those will be fixed in later tasks. No unexpected failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/trending.ts tests/stage1-discover.test.ts
git commit -m "feat: refactor trending.ts — structured GoogleNewsItem, multi-geo RSS, remove Google Trends"
```

---

## Task 3: Update brand configs

**Files:**
- Modify: `src/brands/ds.ts`
- Modify: `src/brands/ns.ts`

- [ ] **Step 1: Update DS `trendingConfig`**

In `src/brands/ds.ts`, replace the `trendingConfig` block:
```ts
trendingConfig: {
  googleNewsGeos: ["TH"],
  googleNewsLang: "th",
  youtubeRegionCode: "TH",
  youtubeQuery: "ข่าวไทย",
},
```

- [ ] **Step 2: Extend DS `trustedSources`**

In `src/brands/ds.ts`, replace the `trustedSources` array:
```ts
trustedSources: [
  "thairath.co.th",
  "dailynews.co.th",
  "sanook.com",
  "matichon.co.th",
  "khaosod.co.th",
  "prachachat.net",
  "bangkokpost.com",
  "nationthailand.com",
  "bbc.com/thai",
  "voicetv.co.th",
  "thaipbs.or.th",
  "komchadluek.net",
  "posttoday.com",
  "mgronline.com",
  "pptv36.com",
  "ch3plus.com",
  "thansettakij.com",
  "springnews.co.th",
  "amarintv.com",
  "thestandard.co",
  "workpointtoday.com",
  "naewna.com",
  "tnews.co.th",
  "hfocus.org",
  "isranews.org",
  "kapook.com",
  "mthai.com",
  "nbt.co.th",
],
```

- [ ] **Step 3: Update NS `trendingConfig`**

In `src/brands/ns.ts`, replace the `trendingConfig` block:
```ts
trendingConfig: {
  googleNewsGeos: ["US", "GB"],
  googleNewsLang: "en",
  youtubeRegionCode: "GB",
  youtubeQuery: "europe news today",
},
```

- [ ] **Step 4: Extend NS `trustedSources`**

In `src/brands/ns.ts`, replace the `trustedSources` array:
```ts
trustedSources: [
  "reuters.com",
  "bbc.com",
  "apnews.com",
  "theguardian.com",
  "dw.com",
  "aljazeera.com",
  "france24.com",
  "euronews.com",
  "nytimes.com",
  "washingtonpost.com",
  "bloomberg.com",
  "ft.com",
  "cnn.com",
  "independent.co.uk",
  "sky.com",
  "politico.eu",
  "nbcnews.com",
  "cbsnews.com",
  "axios.com",
  "time.com",
  "theatlantic.com",
  "foreignpolicy.com",
  "propublica.org",
  "thetimes.co.uk",
],
```

- [ ] **Step 5: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS (brand config type errors from `googleTrendsGeo`/`googleNewsGeo` are now gone)

- [ ] **Step 6: Run brands test**

Run: `npx vitest run tests/brands.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/brands/ds.ts src/brands/ns.ts
git commit -m "feat: update DS/NS trendingConfig and extend trustedSources for RSS-first discovery"
```

---

## Task 4: Add `resolveArticleUrl` to `stage1-discover.ts`

**Files:**
- Modify: `src/stages/stage1-discover.ts`
- Modify: `tests/stage1-discover.test.ts`

- [ ] **Step 1: Write failing tests for `resolveArticleUrl`**

Add to `tests/stage1-discover.test.ts`:
```ts
import { vi } from "vitest";
import type { SearchService } from "../src/services/search.js";
import { resolveArticleUrl } from "../src/stages/stage1-discover.js";

const mockBrand = {
  trustedSources: ["reuters.com", "bbc.com"],
} as any;

describe("resolveArticleUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns redirect URL when Google redirect resolves off google.com", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      url: "https://reuters.com/world/test-article",
    }));
    const mockSearch = { search: vi.fn() } as unknown as SearchService;

    const result = await resolveArticleUrl(
      "https://news.google.com/rss/articles/ABC123",
      "Test headline",
      "Reuters",
      mockBrand,
      mockSearch,
    );

    expect(result.url).toBe("https://reuters.com/world/test-article");
    expect(result.verified).toBe(true);
    expect(result.verifiedBy).toBe("reuters.com");
    expect(mockSearch.search).not.toHaveBeenCalled();
  });

  it("falls back to Tavily when redirect stays on google.com", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      url: "https://news.google.com/articles/ABC123",
    }));
    const mockSearch = {
      search: vi.fn().mockResolvedValue([
        { url: "https://bbc.com/news/test-story", content: "article snippet", score: 0.9 },
      ]),
    } as unknown as SearchService;

    const result = await resolveArticleUrl(
      "https://news.google.com/rss/articles/ABC123",
      "Test headline",
      "BBC",
      mockBrand,
      mockSearch,
    );

    expect(result.url).toBe("https://bbc.com/news/test-story");
    expect(result.verified).toBe(true);
    expect(result.snippet).toBe("article snippet");
    expect(mockSearch.search).toHaveBeenCalledOnce();
  });

  it("falls back to Tavily when redirect fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network timeout")));
    const mockSearch = {
      search: vi.fn().mockResolvedValue([
        { url: "https://reuters.com/world/story", content: "news content", score: 0.8 },
      ]),
    } as unknown as SearchService;

    const result = await resolveArticleUrl(
      "https://news.google.com/rss/articles/ABC123",
      "Test headline",
      "Reuters",
      mockBrand,
      mockSearch,
    );

    expect(result.url).toBe("https://reuters.com/world/story");
    expect(result.verified).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: FAIL — `resolveArticleUrl` is not exported

- [ ] **Step 3: Add `resolveArticleUrl` to `src/stages/stage1-discover.ts`**

Add these imports at the top of `stage1-discover.ts` (after existing imports):
```ts
import type { BrandConfig } from "../types.js";
import type { SearchService } from "../services/search.js";
```

Add this exported function before the `Stage1Discover` class:
```ts
export interface ResolvedUrl {
  url: string;
  verified: boolean;
  verifiedBy?: string;
  snippet: string;
}

export async function resolveArticleUrl(
  googleLink: string,
  headline: string,
  source: string,
  brand: Pick<BrandConfig, "trustedSources">,
  searchService: SearchService,
): Promise<ResolvedUrl> {
  const isTrusted = (hostname: string) =>
    brand.trustedSources.some((ts) => hostname === ts || hostname.endsWith(`.${ts}`));

  // Step 1: follow Google News redirect
  try {
    const res = await fetch(googleLink, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsPipeline/1.0)" },
    });
    const finalUrl = res.url;
    if (finalUrl) {
      const host = new URL(finalUrl).hostname.replace("www.", "");
      if (!host.includes("google.com")) {
        console.log(`  [stage1] redirect resolved: ${finalUrl}`);
        // Fetch snippet via Tavily
        const snippet = await fetchSnippet(headline, source, brand.trustedSources, searchService);
        return { url: finalUrl, verified: isTrusted(host), verifiedBy: isTrusted(host) ? host : undefined, snippet };
      }
    }
  } catch (err) {
    console.warn(`  [stage1] redirect follow failed: ${err instanceof Error ? err.message : err}`);
  }

  // Step 2: Tavily fallback
  console.log(`  [stage1] tavily fallback for URL: "${headline.slice(0, 50)}"`);
  const results = await searchService.search(`"${headline}" ${source}`, {
    maxResults: 3,
    searchDepth: "basic",
    topic: "news",
    days: 3,
    includeDomains: brand.trustedSources,
  });
  const hit = results[0];
  if (!hit) throw new Error(`Stage 1: could not resolve URL for "${headline.slice(0, 60)}"`);
  const host = new URL(hit.url).hostname.replace("www.", "");
  console.log(`  [stage1] tavily resolved: ${hit.url}`);
  return { url: hit.url, verified: true, verifiedBy: host, snippet: hit.content };
}

async function fetchSnippet(
  headline: string,
  source: string,
  trustedSources: string[],
  searchService: SearchService,
): Promise<string> {
  try {
    const results = await searchService.search(`"${headline}" ${source}`, {
      maxResults: 1,
      searchDepth: "basic",
      topic: "news",
      days: 3,
      includeDomains: trustedSources,
    });
    return results[0]?.content ?? "";
  } catch (err) {
    console.warn(`  [stage1] snippet fetch failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    return "";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: all `resolveArticleUrl` tests PASS; existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stages/stage1-discover.ts tests/stage1-discover.test.ts
git commit -m "feat: add resolveArticleUrl — redirect-follow with Tavily fallback"
```

---

## Task 5: Add `selectStoryFromPool` and wire `Stage1Discover.run()`

**Files:**
- Modify: `src/stages/stage1-discover.ts`
- Modify: `tests/stage1-discover.test.ts`

- [ ] **Step 1: Write failing tests for `selectStoryFromPool`**

Add to `tests/stage1-discover.test.ts`:
```ts
import type { RunContext, Services } from "../src/types.js";
import type { GoogleNewsItem } from "../src/services/trending.js";
import { selectStoryFromPool } from "../src/stages/stage1-discover.js";

const mockCtx = {
  brand: {
    name: "WorldBrief",
    language: "en",
    pillars: ["Breaking", "Controversy"],
    trustedSources: ["reuters.com"],
    geographicFocus: "Europe",
  },
  runDate: "2026-05-19",
  pillarBalance: { deprioritise: [], prioritise: [], forcePillar: undefined },
  excludedTopics: [],
  reelRecentUrls: [],
  trendingSignals: { youtube: [], googleNews: [] },
} as unknown as RunContext;

const mockPool: GoogleNewsItem[] = [
  { title: "Explosion at parliament building", source: "BBC", pubDate: "Tue, 19 May 2026 08:00:00 GMT", link: "https://news.google.com/rss/articles/A" },
  { title: "Local charity raises funds", source: "Reuters", pubDate: "Tue, 19 May 2026 07:00:00 GMT", link: "https://news.google.com/rss/articles/B" },
];

describe("selectStoryFromPool", () => {
  it("returns parsed selection from gemini.generate response", async () => {
    const mockServices = {
      gemini: {
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            selectedIndex: 0,
            headline: "Explosion at parliament building",
            source: "BBC",
            pillar: "Breaking",
            theme: "Politics",
            selectionReason: "High shock value and immediate public concern.",
          }),
          source: "native",
        }),
      },
    } as unknown as Services;

    const result = await selectStoryFromPool(mockPool, mockCtx, mockServices, new Set(), "");

    expect(result.selectedIndex).toBe(0);
    expect(result.headline).toBe("Explosion at parliament building");
    expect(result.pillar).toBe("Breaking");
    expect(mockServices.gemini.generate).toHaveBeenCalledOnce();
  });

  it("skips excluded indices and remaps selectedIndex correctly", async () => {
    const mockServices = {
      gemini: {
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            selectedIndex: 0,  // index 0 of the filtered list = index 1 of original pool
            headline: "Local charity raises funds",
            source: "Reuters",
            pillar: "Controversy",
            theme: "Lifestyle",
            selectionReason: "Unexpected feel-good angle.",
          }),
          source: "native",
        }),
      },
    } as unknown as Services;

    // Exclude index 0 (the explosion story)
    const result = await selectStoryFromPool(mockPool, mockCtx, mockServices, new Set([0]), "");

    expect(result.selectedIndex).toBe(1);  // remapped to original pool index
    expect(result.headline).toBe("Local charity raises funds");
  });

  it("throws when all pool items are excluded", async () => {
    const mockServices = { gemini: { generate: vi.fn() } } as unknown as Services;
    await expect(
      selectStoryFromPool(mockPool, mockCtx, mockServices, new Set([0, 1]), "")
    ).rejects.toThrow("RSS pool exhausted");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: FAIL — `selectStoryFromPool` is not exported

- [ ] **Step 3: Add `SelectionResult` type and `selectStoryFromPool` to `stage1-discover.ts`**

Add after the `resolveArticleUrl` / `fetchSnippet` functions:

```ts
export interface SelectionResult {
  selectedIndex: number;
  headline: string;
  source: string;
  pillar: string;
  theme?: string;
  selectionReason: string;
}

export async function selectStoryFromPool(
  pool: import("../services/trending.js").GoogleNewsItem[],
  ctx: RunContext,
  services: Services,
  excludedIndices: Set<number>,
  duplicateWarning: string,
): Promise<SelectionResult> {
  const { brand, theme } = ctx;
  const isCustomTheme = theme && !brand.pillars.includes(theme);

  const originalIndices = pool.map((_, i) => i).filter((i) => !excludedIndices.has(i));
  const available = originalIndices.map((i) => pool[i]);
  if (available.length === 0) throw new Error("Stage 1: RSS pool exhausted after dedup retries");

  const candidates = available
    .map((item, i) => `${i}. "${item.title}" — ${item.source} (${item.pubDate})`)
    .join("\n");

  const youtubeBlock = ctx.trendingSignals?.youtube?.length
    ? `\nTRENDING ON YOUTUBE (secondary context — spot viral angles):\n${ctx.trendingSignals.youtube.map((t) => `- ${t}`).join("\n")}`
    : "";

  const pillarBlock = ctx.pillarBalance?.forcePillar
    ? `Pillar focus: ${ctx.pillarBalance.forcePillar} — story must use this pillar`
    : `Pillar balance — deprioritise: ${ctx.pillarBalance.deprioritise.join(", ") || "none"}
Pillar balance — prioritise: ${ctx.pillarBalance.prioritise.join(", ") || "none"}`;

  const systemPrompt = `You are a news editor for ${brand.name}, a ${brand.language === "th" ? "Thai" : "English"} Facebook page.

Geographic focus: ${isCustomTheme ? "Global — no regional restriction, find the best stories worldwide for this theme" : brand.geographicFocus}
Available pillars: ${brand.pillars.join(", ")}
Today's date: ${ctx.runDate}
${isCustomTheme ? `Theme focus: ${theme} — story must relate to this theme` : ""}
${pillarBlock}
${ctx.reelCategoryBias ? `CATEGORY BIAS: ${ctx.reelCategoryBias}` : ""}
${youtubeBlock}

SELECTION CRITERIA — rank stories by:
1. Shock value, surprise, fear, controversy, emotional impact
2. Hard news with a strong reaction angle beats dry factual reporting
3. Recency — prefer stories published today or yesterday
4. Geographic relevance — ${isCustomTheme ? "global" : brand.geographicFocus}
${brand.id === "ds" ? "- Stories MUST be relevant to Thailand or Thai people" : ""}
${brand.id === "ns" ? "- Strongly prefer European stories; only fall back to global if no strong European story exists" : ""}

${formatExcludedTopicsBlock(ctx.excludedTopics ?? [], ctx.reelRecentUrls)}
${duplicateWarning}
Respond with a single JSON object only — no markdown fences, no extra text:
{
  "selectedIndex": <number — index from the CANDIDATES list>,
  "headline": "<exact title from the candidate>",
  "source": "<source from the candidate>",
  "pillar": "<must exactly match one of: ${brand.pillars.join(", ")}>",
  "theme": "<one of: Tech, Health, Economy, Politics, Entertainment, Environment, Science, Sports, Lifestyle>",
  "selectionReason": "<1-2 sentences: why this is the most attention-grabbing story today>"
}`;

  const userMessage = `Select the single most attention-grabbing story for ${brand.name} today (${ctx.runDate}).

CANDIDATES:
${candidates}`;

  const { text } = await services.gemini.generate(systemPrompt, userMessage);
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const raw = JSON.parse(cleaned) as {
    selectedIndex: number;
    headline: string;
    source: string;
    pillar: string;
    theme?: string;
    selectionReason: string;
  };

  const originalIndex = originalIndices[raw.selectedIndex] ?? raw.selectedIndex;
  return { ...raw, selectedIndex: originalIndex };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stage1-discover.test.ts`
Expected: all `selectStoryFromPool` tests PASS

- [ ] **Step 5: Wire `Stage1Discover.run()` to use the new flow**

In `src/stages/stage1-discover.ts`, replace the `run()` method body. The method should:

1. Keep the existing `trendingSignals` / `trendingBlock` fetch at the top (for YouTube signals)
2. Add a branch: if `ctx.manualSourceHintText` is set → run the existing agentic loop (no change)
3. Otherwise → run the new RSS selection flow

Replace the `run()` method:

```ts
async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
  const { brand, theme, pillarBalance } = ctx;
  const isCustomTheme = theme && !brand.pillars.includes(theme);

  // Fetch trending signals (YouTube for secondary context; Google News as candidate pool)
  // fetchTrendingSignals is the static import at the top of the file
  let trendingSignals: import("../types.js").RunContext["trendingSignals"];
  if (brand.trendingConfig) {
    try {
      console.log(`  [stage1] fetching trending signals...`);
      const signals = await fetchTrendingSignals(brand.trendingConfig, services.search);
      trendingSignals = signals;
      const counts = [
        signals.youtube.length && `youtube:${signals.youtube.length}`,
        signals.googleNews.length && `news:${signals.googleNews.length}`,
      ].filter(Boolean).join(" ");
      console.log(`  [stage1] trending signals: ${counts || "none"}`);
    } catch (err) {
      console.warn(`  [stage1] trending signals fetch failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    }
  }

  const excludedTopics = ctx.excludedTopics ?? [];

  // ── Manual hint path (keeps existing agentic loop) ────────────────────────
  if (ctx.manualSourceHintText) {
    return this.runAgentic(ctx, services, trendingSignals, excludedTopics, isCustomTheme);
  }

  // ── RSS selection path ────────────────────────────────────────────────────
  const pool = trendingSignals?.googleNews ?? [];
  if (pool.length === 0) {
    console.warn("  [stage1] RSS pool empty — falling back to agentic discovery");
    return this.runAgentic(ctx, services, trendingSignals, excludedTopics, isCustomTheme);
  }

  console.log(`  [stage1] RSS pool: ${pool.length} candidates`);

  const excludedIndices = new Set<number>();
  let duplicateWarning = "";
  let selected: SelectionResult | undefined;

  for (let attempt = 0; attempt <= MAX_DEDUP_RETRIES; attempt++) {
    selected = await selectStoryFromPool(pool, { ...ctx, trendingSignals }, services, excludedIndices, duplicateWarning);

    if (excludedTopics.length === 0) break;

    const dups = findDuplicates([{ headline: selected.headline } as SubmittedStory], excludedTopics);
    if (dups.size === 0) {
      console.log(`  [stage1] dedup: ok (attempt ${attempt})`);
      break;
    }

    const matched = dups.get(0)!;
    console.warn(`  [stage1] dedup: duplicate on attempt ${attempt}: "${selected.headline.slice(0, 50)}" ≈ "${matched.slice(0, 50)}"`);

    if (attempt < MAX_DEDUP_RETRIES) {
      excludedIndices.add(selected.selectedIndex);
      duplicateWarning = `⚠️ YOUR PREVIOUS SELECTION WAS REJECTED — too similar to recently covered topic:\n  "${selected.headline}" ≈ "${matched}"\nCandidate ${selected.selectedIndex} is excluded. Pick a different story.\n`;
    } else {
      throw new Error(`Stage 1: story too similar to recent coverage after ${MAX_DEDUP_RETRIES + 1} attempts`);
    }
  }

  const selectedItem = pool[selected!.selectedIndex];
  const resolved = await resolveArticleUrl(
    selectedItem.link,
    selected!.headline,
    selected!.source,
    brand,
    services.search,
  );

  const story: Story = {
    index: 0,
    headline: selected!.headline,
    source: selected!.source,
    sourceUrl: resolved.url,
    snippet: resolved.snippet,
    pillar: selected!.pillar,
    theme: selected!.theme as Theme | undefined,
    selectionReason: selected!.selectionReason,
    compositeScore: 0,
    verified: resolved.verified,
    verifiedBy: resolved.verifiedBy,
  };

  return {
    stories: [story],
    trendingSignals,
    apiSourceMap: { ...ctx.apiSourceMap, discovery: "native" },
  };
}
```

- [ ] **Step 6: Extract the existing agentic logic into `runAgentic()`**

Add a private method `runAgentic()` that contains the existing agentic loop from the old `run()` method body (lines 99–332 of the original file). This method signature:

```ts
private async runAgentic(
  ctx: RunContext,
  services: Services,
  trendingSignals: import("../types.js").RunContext["trendingSignals"] | undefined,
  excludedTopics: string[],
  isCustomTheme: boolean,
): Promise<Partial<RunContext>>
```

Move all the code from the original `run()` method (the `buildSystemPrompt`, `userMessage`, `contentByUrl`, `availableUrls`, `runAgentic` closure, dedup loop, story building, and verification) into this new private method. Update it to accept `trendingSignals` as a parameter instead of fetching it again (since it was already fetched above).

In the body, replace the `trendingBlock` line:
```ts
// Before
trendingBlock = formatTrendingForPrompt(signals, isCustomTheme ? theme : undefined);
// After (YouTube-only block since Google Trends is removed)
if (trendingSignals?.youtube?.length) {
  trendingBlock = `\nTRENDING ON YOUTUBE:\n${trendingSignals.youtube.map((t) => `- ${t}`).join("\n")}`;
}
```

And remove the `fetchTrendingSignals` call inside `runAgentic` (it now receives `trendingSignals` as a parameter).

- [ ] **Step 7: Remove unused import**

Remove `formatTrendingForPrompt` from the import at line 3:
```ts
import { fetchTrendingSignals } from "../services/trending.js";
```

- [ ] **Step 8: Run build**

Run: `npm run build`
Expected: PASS with no type errors

- [ ] **Step 9: Run tests**

Run: `npm run test`
Expected: all existing tests pass; new tests pass

- [ ] **Step 10: Commit**

```bash
git add src/stages/stage1-discover.ts
git commit -m "feat: RSS-first story selection in Stage1Discover — selectStoryFromPool + URL resolution"
```

---

## Task 6: Update test fixtures and mocks

**Files:**
- Modify: `test/runner.ts`
- Modify: `tests/testing-runner-stage1-agentic-mock.test.ts`

- [ ] **Step 1: Update `createStage1GeminiMockReply` in `test/runner.ts`**

The function now returns a Gemini `generate()` response (plain text JSON) instead of an agentic function-call response. Replace lines 41–100:

```ts
export function createStage1GeminiMockReply(): () => Record<string, unknown> {
  return () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                selectedIndex: 0,
                headline: "Test Story Title",
                source: "reuters.com",
                pillar: "Breaking",
                theme: "Politics",
                selectionReason: "Important and timely event for readers.",
              }),
            },
          ],
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
  });
}
```

- [ ] **Step 2: Update `setupStage1Nock` in `test/runner.ts`**

Replace lines 198–216:

```ts
async function setupStage1Nock(): Promise<void> {
  const nock = (await import("nock")).default;
  const tavilyFixture = JSON.parse(
    fs.readFileSync(resolveFixturePath("tavily-search.json"), "utf8")
  );
  const nextGeminiReply = createStage1GeminiMockReply();

  // Mock Google News RSS (multi-geo)
  nock("https://news.google.com")
    .get(/\/rss.*/)
    .reply(
      200,
      `<?xml version="1.0"?><rss><channel>
        <item>
          <title>Test Story Title - Reuters</title>
          <link>https://news.google.com/rss/articles/TEST123?oc=5</link>
          <pubDate>Tue, 19 May 2026 08:00:00 GMT</pubDate>
          <source url="https://reuters.com">Reuters</source>
        </item>
      </channel></rss>`,
      { "Content-Type": "application/rss+xml" }
    )
    .persist();

  // Mock Google News redirect → real article URL
  nock("https://news.google.com")
    .get(/\/rss\/articles\/.*/)
    .reply(302, "", { Location: "https://example.com/test-story" });

  nock("https://example.com")
    .get("/test-story")
    .reply(200, "<html><body>Article content</body></html>");

  // Mock Tavily (snippet fetch + any fallback calls)
  nock("https://api.tavily.com")
    .post("/search")
    .reply(200, tavilyFixture)
    .persist();

  // Mock Gemini generate endpoint (non-agentic JSON response)
  nock("https://generativelanguage.googleapis.com")
    .post(/.*/)
    .reply(() => [200, nextGeminiReply()])
    .persist();
}
```

- [ ] **Step 3: Update `testing-runner-stage1-agentic-mock.test.ts`**

Replace the entire file content:
```ts
import { describe, it, expect } from "vitest";
import { createStage1GeminiMockReply } from "../test/runner.js";

describe("createStage1GeminiMockReply", () => {
  it("returns a Gemini generate-style JSON text response", () => {
    const reply = createStage1GeminiMockReply();
    const response = reply();

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text as string;
    expect(text).toBeTruthy();

    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("selectedIndex");
    expect(parsed).toHaveProperty("headline");
    expect(parsed).toHaveProperty("pillar");
    expect(parsed).toHaveProperty("selectionReason");
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add test/runner.ts tests/testing-runner-stage1-agentic-mock.test.ts
git commit -m "test: update stage1 mocks for RSS-first discovery flow"
```

---

## Task 7: Final build and verification

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: PASS with zero type errors

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: PASS — all tests green

- [ ] **Step 3: Verify no references to removed symbols**

Run:
```bash
grep -rn "googleTrendsGeo\|formatTrendingForPrompt\|fetchGoogleTrends" src/ tests/ test/
```
Expected: zero results

- [ ] **Step 4: Confirm log output shape (smoke test)**

In a local test run or manual run, look for these log lines:
```
[stage1] trending signals: youtube:N news:N
[stage1] RSS pool: N candidates
[stage1] redirect resolved: https://...  (or: [stage1] tavily fallback for URL)
```
And confirm absence of:
```
[trending] Google Trends
```

- [ ] **Step 5: Final commit**

```bash
git add -p  # review any remaining unstaged changes
git commit -m "chore: final cleanup — verify RSS-first discovery complete"
```
