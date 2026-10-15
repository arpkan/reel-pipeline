import { describe, expect, it, afterEach } from "vitest";
import { vi } from "vitest";
import { formatExcludedTopicsBlock } from "../src/stages/stage1-discover.js";
import type { SearchService } from "../src/services/search.js";
import { resolveArticleUrl } from "../src/stages/stage1-discover.js";
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
    const mockSearch = {
      search: vi.fn().mockResolvedValue([]), // returns empty for snippet fetch
    } as unknown as SearchService;

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
    // search called once for snippet (not for URL resolution)
    expect(mockSearch.search).toHaveBeenCalledOnce();
  });

  it("falls back to Tavily when redirect stays on google.com", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      url: "https://news.google.com/articles/ABC123",
    }));
    const mockSearch = {
      search: vi.fn().mockResolvedValue([
        { url: "https://bbc.com/news/test-story", title: "Test headline", content: "article snippet", score: 0.9 },
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

  it("does not accept unrelated Tavily results for a selected Google News headline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      url: "https://news.google.com/articles/ABC123",
    }));
    const mockSearch = {
      search: vi.fn().mockResolvedValue([
        {
          url: "https://bbc.com/news/wrong-story",
          title: "Three Canadian off-duty officers arrested in Spain over serious allegations",
          content: "Three Canadian off-duty police officers have been arrested in Barcelona.",
          score: 0.9,
        },
        {
          url: "https://bbc.com/news/right-story",
          title: "Toilets and changing rooms must be used on basis of biological sex, guidance confirms",
          content: "Toilets and changing rooms must be used on the basis of biological sex.",
          score: 0.7,
        },
      ]),
    } as unknown as SearchService;

    const result = await resolveArticleUrl(
      "https://news.google.com/rss/articles/ABC123",
      "Toilets and changing rooms must be used on basis of biological sex, guidance confirms",
      "BBC",
      mockBrand,
      mockSearch,
    );

    expect(result.url).toBe("https://bbc.com/news/right-story");
    expect(result.snippet).toBe("Toilets and changing rooms must be used on the basis of biological sex.");
  });

  it("falls back to Tavily when redirect fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network timeout")));
    const mockSearch = {
      search: vi.fn().mockResolvedValue([
        { url: "https://reuters.com/world/story", title: "Test headline", content: "news content", score: 0.8 },
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

describe("formatExcludedTopicsBlock", () => {
  it("renders excluded topics with source hostnames", () => {
    const out = formatExcludedTopicsBlock(
      ["topic A", "topic B"],
      ["https://www.reuters.com/world/story", "https://bbc.com/news/xyz"],
    );

    expect(out).toContain("topic A (reuters.com)");
    expect(out).toContain("topic B (bbc.com)");
  });

  it("includes invalid recent URL inline instead of throwing", () => {
    const out = formatExcludedTopicsBlock(["topic A"], ["-"]);
    expect(out).toContain("topic A (invalid recent URL: -)");
  });
});

describe("fetchGoogleNews (unit)", () => {
  afterEach(() => vi.unstubAllGlobals());

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
  });
});
