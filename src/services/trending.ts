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
