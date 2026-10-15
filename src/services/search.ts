export interface SearchResult {
  url: string;
  title: string;
  content: string;        // snippet/summary
  score: number;          // Tavily relevance score
  publishedDate?: string; // ISO date string if available e.g. "2026-03-22T08:00:00Z"
}

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  topic?: "general" | "news";
  days?: number;           // only applies when topic = "news"
  includeDomains?: string[]; // restrict results to these domains
}

export interface ExtractResult {
  url: string;
  title?: string;
  content: string;    // cleaned article / video description + transcript
  isYouTube: boolean;
}

export class SearchService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { maxResults = 10, searchDepth = "basic", topic, days, includeDomains } = options;

    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
    };
    if (topic) body.topic = topic;
    if (topic === "news" && days) body.days = days;
    if (includeDomains?.length) body.include_domains = includeDomains;

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = "";
      try { detail = JSON.stringify(await response.json()); } catch { /* ignore */ }
      const msg = `Tavily search failed: ${response.status} ${detail || response.statusText}`;
      if (response.status === 432 || response.status === 433 || detail.includes("usage limit") || detail.includes("upgrade your plan") || detail.includes("pay-as-you-go")) {
        throw new Error(`Tavily quota exhausted — top up at https://app.tavily.com`);
      }
      throw new Error(msg);
    }

    const data = await response.json() as {
      results: Array<{ url: string; title: string; content: string; score: number; published_date?: string }>;
      usage?: { credits: number };
    };
    if (data.usage) {
      console.log(`  [tavily] credits used: ${data.usage.credits}`);
    }
    return (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      content: r.content,
      score: r.score,
      publishedDate: r.published_date,
    }));
  }

  async extract(urls: string[]): Promise<ExtractResult[]> {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        urls,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily extract failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{ url: string; raw_content: string }>;
      failed_results?: Array<{ url: string; error: string }>;
    };

    return (data.results ?? []).map((r) => ({
      url: r.url,
      content: r.raw_content ?? "",
      isYouTube: r.url.includes("youtube.com") || r.url.includes("youtu.be"),
    }));
  }
}

export function createSearchService(): SearchService {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  return new SearchService(apiKey);
}
