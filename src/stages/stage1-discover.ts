import type { Stage, RunContext, Services, Story, Theme } from "../types.js";
import type { BrandConfig } from "../types.js";
import type { SearchService } from "../services/search.js";
import { Type, type FunctionDeclaration } from "@google/genai";
import { fetchTrendingSignals } from "../services/trending.js";
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";

interface SubmittedStory {
  headline: string;
  sourceUrl: string;
  source: string;
  snippet: string;
  theme?: string;
  selectionReason: string;
  verified: boolean;
  verifiedBy?: string;
}

export interface ResolvedUrl {
  url: string;
  verified: boolean;
  verifiedBy?: string;
  snippet: string;
}

function findMatchingSearchResult(
  results: Awaited<ReturnType<SearchService["search"]>>,
  headline: string,
): Awaited<ReturnType<SearchService["search"]>>[number] | undefined {
  const titledResults = results.filter((r) => r.title?.trim());
  if (titledResults.length === 0) return undefined;
  return titledResults.find((r) => trigramSimilarity(r.title, headline) >= SIMILARITY_THRESHOLD);
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
  let hit = findMatchingSearchResult(results, headline);

  if (!hit) {
    console.log(`  [stage1] tavily no results with trusted domains — retrying without domain filter`);
    const unfiltered = await searchService.search(`"${headline}" ${source}`, {
      maxResults: 5,
      searchDepth: "basic",
      topic: "news",
      days: 3,
    });
    hit = findMatchingSearchResult(unfiltered, headline);
  }

  if (!hit) throw new Error(`Stage 1: could not resolve URL for "${headline.slice(0, 60)}"`);
  const host = new URL(hit.url).hostname.replace("www.", "");
  console.log(`  [stage1] tavily resolved: ${hit.url}`);
  return { url: hit.url, verified: isTrusted(host), verifiedBy: isTrusted(host) ? host : undefined, snippet: hit.content };
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

const SIMILARITY_THRESHOLD = 0.35;
const MAX_DEDUP_RETRIES = 2;

function trigramSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\d]+/g, "");
  const trigrams = (s: string) => {
    const n = normalize(s);
    const set = new Set<string>();
    for (let i = 0; i <= n.length - 3; i++) set.add(n.slice(i, i + 3));
    return set;
  };
  const ta = trigrams(a), tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

function findDuplicates(
  submitted: SubmittedStory[],
  recentHeadlines: string[],
): Map<number, string> {
  const duplicates = new Map<number, string>();
  for (let i = 0; i < submitted.length; i++) {
    for (const recent of recentHeadlines) {
      if (trigramSimilarity(submitted[i].headline, recent) > SIMILARITY_THRESHOLD) {
        if (!duplicates.has(i)) duplicates.set(i, recent);
      }
    }
  }
  return duplicates;
}

const tools: FunctionDeclaration[] = [
  {
    name: "search",
    description: "Search for news articles using Tavily. Use search_depth 'advanced' for discovery, 'basic' for verification.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query:        { type: Type.STRING, description: "Search query string — include the current date for freshness" },
        search_depth: { type: Type.STRING, description: "advanced for discovery, basic for verification" },
      },
      required: ["query"],
    },
  },
  {
    name: "submit_stories",
    description: "Submit your final selected story. Call this once you have found and verified 1 strong candidate.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        stories: {
          type: Type.ARRAY,
          description: "Exactly 1 story",
          items: {
            type: Type.OBJECT,
            properties: {
              headline:        { type: Type.STRING, description: "Exact headline from the article" },
              sourceUrl:       { type: Type.STRING, description: "Full URL of the article — must be a specific article, not a homepage" },
              source:          { type: Type.STRING, description: "Domain name e.g. thairath.co.th" },
              snippet:         { type: Type.STRING, description: "Brief content summary from the article (2-3 sentences)" },
              theme:           { type: Type.STRING, description: "Topic classification — must match one of: Tech, Health, Economy, Politics, Entertainment, Environment, Science, Sports, Lifestyle" },
              selectionReason: { type: Type.STRING, description: "1-2 sentences explaining why this story was chosen" },
              verified:        { type: Type.BOOLEAN, description: "True if a verification search confirmed this story from a credible outlet" },
              verifiedBy:      { type: Type.STRING, description: "Domain that confirmed the story e.g. reuters.com" },
            },
            required: ["headline", "sourceUrl", "source", "snippet", "theme", "selectionReason", "verified"],
          },
        },
      },
      required: ["stories"],
    },
  },
];

export interface SelectionResult {
  selectedIndex: number;
  headline: string;
  source: string;
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
  const isCustomTheme = !!theme;

  const originalIndices = pool.map((_, i) => i).filter((i) => !excludedIndices.has(i));
  const available = originalIndices.map((i) => pool[i]);
  if (available.length === 0) throw new Error("Stage 1: RSS pool exhausted after dedup retries");

  const candidates = available
    .map((item, i) => `${i}. "${item.title}" — ${item.source} (${item.pubDate})`)
    .join("\n");

  const youtubeBlock = ctx.trendingSignals?.youtube?.length
    ? `\nTRENDING ON YOUTUBE (secondary context — spot viral angles):\n${ctx.trendingSignals.youtube.map((t) => `- ${t}`).join("\n")}`
    : "";

  const systemPrompt = `You are a news editor for ${brand.name}, a ${REEL_STRINGS[brand.language as ReelLang]?.langLabel ?? "English"} Facebook page.

Geographic focus: ${isCustomTheme ? "Global — no regional restriction, find the best stories worldwide for this theme" : brand.geographicFocus}
Today's date: ${ctx.runDate}
${isCustomTheme ? `Theme focus: ${theme} — story must relate to this theme` : ""}
${ctx.reelCategoryBias ? `CATEGORY BIAS: ${ctx.reelCategoryBias}` : ""}
${youtubeBlock}

SELECTION CRITERIA — rank stories by:
1. Shock value, surprise, fear, controversy, emotional impact
2. Hard news with a strong reaction angle beats dry factual reporting
3. Recency — prefer stories published today or yesterday
4. Geographic relevance — ${isCustomTheme ? "global" : brand.geographicFocus}
${brand.id === "ds" ? "- Stories MUST be relevant to Thailand or Thai people" : ""}
${brand.id === "ns" ? "- Strongly prefer European stories; only fall back to global if no strong European story exists" : ""}
${(brand.id as string) === "ts" ? "- Prioritize German-language stories with direct relevance to DACH (Germany, Austria, Switzerland); fall back to broader European stories only if no strong DACH story exists" : ""}

${formatExcludedTopicsBlock(ctx.excludedTopics ?? [], ctx.reelRecentUrls)}
${duplicateWarning}
Respond with a single JSON object only — no markdown fences, no extra text:
{
  "selectedIndex": <number — index from the CANDIDATES list>,
  "headline": "<exact title from the candidate>",
  "source": "<source from the candidate>",
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
    theme?: string;
    selectionReason: string;
  };

  const originalIndex = originalIndices[raw.selectedIndex] ?? raw.selectedIndex;
  return { ...raw, selectedIndex: originalIndex };
}

export class Stage1Discover implements Stage {
  name = "stage1-discover";

  async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
    const result = await this.selectStory(ctx, services);
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

  private async selectStory(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
    const { brand, theme } = ctx;
    const isCustomTheme = !!theme;

    // Fetch trending signals (YouTube for secondary context; Google News as candidate pool)
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

    const RSS_MAX_RETRIES = 4;
    const excludedIndices = new Set<number>();
    let duplicateWarning = "";
    let selected: SelectionResult | undefined;
    let resolved: ResolvedUrl | undefined;
    let urlResolveFailures = 0;

    for (let attempt = 0; attempt <= RSS_MAX_RETRIES; attempt++) {
      try {
        selected = await selectStoryFromPool(pool, { ...ctx, trendingSignals }, services, excludedIndices, duplicateWarning);

        const selectedItem = pool[selected.selectedIndex];
        if (!selectedItem) {
          throw new Error(`Stage 1: Gemini returned out-of-bounds selectedIndex ${selected.selectedIndex} (pool size: ${pool.length})`);
        }

        if (trigramSimilarity(selected.headline, selectedItem.title) < SIMILARITY_THRESHOLD) {
          console.warn(`  [stage1] headline mismatch on attempt ${attempt}: Gemini returned "${selected.headline.slice(0, 50)}…" but pool item is "${selectedItem.title.slice(0, 50)}…" — overriding with pool title`);
          selected = { ...selected, headline: selectedItem.title };
        }

        resolved = await resolveArticleUrl(
          selectedItem.link,
          selected.headline,
          selected.source,
          brand,
          services.search,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [stage1] selection/resolution failed on attempt ${attempt}: ${msg}`);
        urlResolveFailures++;
        if (selected) excludedIndices.add(selected.selectedIndex);
        if (attempt < RSS_MAX_RETRIES) continue;
      }

      if (!resolved) {
        if (urlResolveFailures > RSS_MAX_RETRIES) break;
        continue;
      }

      if (excludedTopics.length > 0) {
        const dups = findDuplicates([{ headline: selected!.headline } as SubmittedStory], excludedTopics);
        if (dups.size > 0) {
          const matched = dups.get(0)!;
          console.warn(`  [stage1] dedup: headline duplicate on attempt ${attempt}: "${selected!.headline.slice(0, 50)}" ≈ "${matched.slice(0, 50)}"`);
          if (attempt < RSS_MAX_RETRIES) {
            excludedIndices.add(selected!.selectedIndex);
            duplicateWarning = `⚠️ YOUR PREVIOUS SELECTION WAS REJECTED — too similar to recently covered topic:\n  "${selected!.headline}" ≈ "${matched}"\nDo not select this story again.\n`;
            continue;
          }
          throw new Error(`Stage 1: story too similar to recent coverage after ${RSS_MAX_RETRIES + 1} attempts`);
        }
      }

      if (ctx.reelRecentUrls?.length && ctx.reelRecentUrls.includes(resolved.url)) {
        console.warn(`  [stage1] dedup: URL already covered on attempt ${attempt}: ${resolved.url}`);
        if (attempt < RSS_MAX_RETRIES) {
          excludedIndices.add(selected!.selectedIndex);
          duplicateWarning = `⚠️ YOUR PREVIOUS SELECTION WAS REJECTED — the article URL (${resolved.url}) was already used in a recent reel. Pick a completely different story.\n`;
          continue;
        }
        throw new Error(`Stage 1: resolved URL already covered recently after ${RSS_MAX_RETRIES + 1} attempts: ${resolved.url}`);
      }

      console.log(`  [stage1] dedup: ok (attempt ${attempt})`);
      break;
    }

    if (!resolved || !selected) {
      console.warn(`  [stage1] RSS path exhausted (${urlResolveFailures} URL resolution failures) — falling back to agentic discovery`);
      return this.runAgentic(ctx, services, trendingSignals, excludedTopics, isCustomTheme);
    }

    const story: Story = {
      index: 0,
      headline: selected!.headline,
      source: selected!.source,
      sourceUrl: resolved!.url,
      snippet: resolved!.snippet,
      theme: selected!.theme as Theme | undefined,
      selectionReason: selected!.selectionReason,
      compositeScore: 0,
      verified: resolved!.verified,
      verifiedBy: resolved!.verifiedBy,
    };

    return {
      stories: [story],
      trendingSignals,
      apiSourceMap: { ...ctx.apiSourceMap, discovery: "native" },
    };
  }

  private async runAgentic(
    ctx: RunContext,
    services: Services,
    trendingSignals: import("../types.js").RunContext["trendingSignals"] | undefined,
    excludedTopics: string[],
    isCustomTheme: boolean,
  ): Promise<Partial<RunContext>> {
    const { brand, theme } = ctx;

    let trendingBlock = "";
    if (trendingSignals?.youtube?.length) {
      trendingBlock = `\nTRENDING ON YOUTUBE:\n${trendingSignals.youtube.map((t) => `- ${t}`).join("\n")}`;
    }

    const excludedBlock = formatExcludedTopicsBlock(excludedTopics, ctx.reelRecentUrls);

    const manualHintBlock = ctx.manualSourceHintText
      ? `OPERATOR HINT (guidance only; do not treat as source-of-record URL):\n${ctx.manualSourceHintText.slice(0, 4000)}\n\n`
      : "";

    const buildSystemPrompt = (extraWarning: string) => `You are a news editor for ${brand.name}, a ${REEL_STRINGS[brand.language as ReelLang]?.langLabel ?? "English"} Facebook page.

Geographic focus: ${isCustomTheme ? "Global — no regional restriction, find the best stories worldwide for this theme" : brand.geographicFocus}
Trusted sources: ${brand.trustedSources.join(", ")}
Today's date: ${ctx.runDate}
${isCustomTheme ? `Theme focus: ${theme} — both stories must relate to this theme` : ""}

${ctx.reelCategoryBias ? `REEL CATEGORY BIAS: ${ctx.reelCategoryBias}\n` : ""}${manualHintBlock}${excludedBlock}${extraWarning}YOUR GOAL: Find exactly 2 strong, distinct news stories for today's Facebook posts.

SELECTION RULES:
- Prefer stories from the trusted sources list
- One story should be hard news (breaking/politics/economy); one should be a different angle (uplifting/opinion/stats/social trend)
- Stories must be about specific events — not homepage aggregators
- Source must be identifiable — no anonymous or single-source rumour stories
${!isCustomTheme && brand.id === "ds" ? `- Avoid sensitive institutional political topics
- Stories MUST be relevant to Thailand or Thai people. Accept: Thai domestic stories, events happening in Thailand, stories about Thai people or organisations, major global events with a clear direct Thai angle (Thai exports impacted, Thai tourists involved, Thai government response). Reject: purely foreign incidents with no Thai connection — a school shooting abroad, a European political crisis, a war in a country with no Thai involvement are NOT acceptable even if dramatic or emotional.
- Search in Thai first. Use Thai-language queries (e.g. ข่าวไทย, ข่าวด่วน, เหตุการณ์วันนี้, ประเทศไทย) to surface Thai-source stories before falling back to English queries.` : ""}
${!isCustomTheme && brand.id === "ns" ? "- Strongly prefer European stories; only fall back to global if no strong European story exists" : ""}
${!isCustomTheme && (brand.id as string) === "ts" ? "- Prioritize German-language stories with direct relevance to DACH (Germany, Austria, Switzerland); fall back to broader European stories only if no strong DACH story exists" : ""}

PROCESS:
1. Search for news candidates (1 broad search with search_depth: 'advanced')
2. If needed, verify with 1 targeted search for the chosen story: search for the headline + source domain with search_depth: 'basic'
3. Call submit_stories with your final selection

CRITICAL URL RULE: Each search response includes an "__url_whitelist" array at the end. You may ONLY submit URLs from this whitelist. Never construct, guess, or modify a URL. The whitelist accumulates URLs from all your searches. If you cannot find a suitable URL in the whitelist, search again with a different query.
SEARCH BUDGET: Maximum 2 searches total. Each search returns up to 20 results — 1 broad search is usually enough to find 1 strong story.${trendingBlock}`;

    const userMessage = `Find 1 news story for ${brand.name} today (${ctx.runDate}).${theme ? ` Theme: ${theme}.` : ""} Search, verify, then submit your selection.`;

    const contentByUrl = new Map<string, string>();
    const availableUrls = new Set<string>();

    const executeAgenticCall = async (duplicateWarning: string): Promise<{ stories: SubmittedStory[]; discoverySource: import("../types.js").ApiProvider }> => {
      const systemPrompt = buildSystemPrompt(duplicateWarning);
      contentByUrl.clear();
      availableUrls.clear();

      const agenticResult = await services.gemini.agentic(
        systemPrompt,
        userMessage,
        tools,
        async (name, args) => {
          if (name === "search") {
            const query = args.query as string;
            const depth = (args.search_depth as "basic" | "advanced") ?? "advanced";
            console.log(`  [stage1] search(${depth}): ${query}`);
            let results;
            try {
              results = await services.search.search(query, {
                maxResults: 20,
                searchDepth: depth,
                topic: "news",
                days: 3,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`  [stage1] search failed: ${msg}`);
              if (msg.includes("quota exhausted")) throw err;
              return [{ notice: "Search API error. Please try a different query." }];
            }
            if (!results || results.length === 0) {
              console.log(`  [stage1] no results returned for query`);
              return [{ notice: "No results found. Please try a different query." }];
            }
            const NON_ARTICLE = /\/(tags?|categories?|category|author|authors|search|page|topic|topics)(\/|$)/i;
            const articleResults = results.filter((r) => {
              try {
                const u = new URL(r.url);
                if (u.pathname === "/" || u.pathname === "") return false;
                if (NON_ARTICLE.test(u.pathname)) return false;
                return true;
              } catch { return false; }
            });
            const filtered = results.length - articleResults.length;
            if (filtered > 0) {
              console.log(`  [stage1] filtered ${filtered} non-article URL(s) from results`);
            }
            if (articleResults.length === 0 && results.length > 0) {
              return [{ notice: "All results were tag/category pages. Please search again with a more specific headline-focused query, e.g. include article title or key names." }];
            }
            for (const r of articleResults) {
              if (!contentByUrl.has(r.url)) contentByUrl.set(r.url, r.content);
              availableUrls.add(r.url);
            }
            const resultsWithWhitelist = articleResults.map((r) => ({
              title: r.title,
              url: r.url,
              content: r.content,
              score: r.score,
              source: new URL(r.url).hostname.replace("www.", ""),
            }));
            resultsWithWhitelist.push({
              __url_whitelist: Array.from(availableUrls),
              __notice: "IMPORTANT: You may ONLY submit URLs from the __url_whitelist array above. Never construct or guess a URL."
            } as any);
            return resultsWithWhitelist;
          }
          throw new Error(`Unknown tool: ${name}`);
        },
        "submit_stories",
      );
      return { stories: (agenticResult.result as { stories: SubmittedStory[] }).stories, discoverySource: agenticResult.source };
    };

    let duplicateWarning = "";
    let submitted: SubmittedStory[] = [];
    let lastDiscoverySource: import("../types.js").ApiProvider | undefined;

    const AGENTIC_MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= AGENTIC_MAX_RETRIES; attempt++) {
      const result = await executeAgenticCall(duplicateWarning);

      submitted = result.stories as SubmittedStory[];
      lastDiscoverySource = result.discoverySource;
      if (!Array.isArray(submitted) || submitted.length < 1) {
        throw new Error(`Stage 1: Gemini submitted ${submitted?.length ?? 0} stories — expected 1`);
      }

      if (excludedTopics.length > 0) {
        const duplicates = findDuplicates(submitted, excludedTopics);
        if (duplicates.size > 0) {
          const dupLines = Array.from(duplicates.entries()).map(
            ([i, matched]) => `"${submitted[i].headline.slice(0, 60)}…" ≈ "${matched.slice(0, 60)}…"`
          );
          console.warn(`  [stage1] topic dedup: ${duplicates.size} duplicate(s) on attempt ${attempt}: ${dupLines.join(" | ")}`);

          if (attempt < AGENTIC_MAX_RETRIES) {
            duplicateWarning = `\n⚠️ YOUR PREVIOUS SELECTION WAS REJECTED — these topics were already covered recently:\n${dupLines.map((d) => `  - ${d}`).join("\n")}\nYou MUST pick completely different stories about different subjects. Do NOT pick stories about the same topic with slightly different details.\n`;
            continue;
          }
          throw new Error(
            `Stage 1: submitted stories are too similar to recent coverage after ${AGENTIC_MAX_RETRIES + 1} attempts:\n${dupLines.join("\n")}`
          );
        }
      }

      if (ctx.reelRecentUrls?.length) {
        const urlDups = submitted.filter((s) => ctx.reelRecentUrls!.includes(s.sourceUrl));
        if (urlDups.length > 0) {
          console.warn(`  [stage1] URL dedup: ${urlDups.length} submitted URL(s) already covered on attempt ${attempt}: ${urlDups.map((s) => s.sourceUrl).join(", ")}`);
          if (attempt < AGENTIC_MAX_RETRIES) {
            duplicateWarning = `\n⚠️ YOUR PREVIOUS SELECTION WAS REJECTED — these article URLs were already used in recent reels:\n${urlDups.map((s) => `  - ${s.sourceUrl}`).join("\n")}\nYou MUST pick stories with completely different source URLs.\n`;
            continue;
          }
          throw new Error(
            `Stage 1: submitted URLs already covered recently after ${AGENTIC_MAX_RETRIES + 1} attempts: ${urlDups.map((s) => s.sourceUrl).join(", ")}`
          );
        }
      }

      console.log(`  [stage1] topic dedup: no duplicates (attempt ${attempt})`);
      break;
    }

    const stories: Story[] = submitted.slice(0, 1).map((s, i) => {
      const tavilyContent = contentByUrl.get(s.sourceUrl);
      if (!tavilyContent) {
        console.error(`  [stage1] URL not in whitelist (${availableUrls.size} URLs available): ${s.sourceUrl}`);
        throw new Error(`Stage 1: submitted URL was not found in search results (whitelist check failed): ${s.sourceUrl}`);
      }
      return {
        index: i,
        headline: s.headline,
        source: s.source,
        sourceUrl: s.sourceUrl,
        snippet: tavilyContent,
        theme: s.theme as Theme | undefined,
        selectionReason: s.selectionReason,
        compositeScore: 0,
        verified: false,
        verifiedBy: undefined,
      };
    });

    await Promise.all(stories.map(async (story) => {
      try {
        // If the story already came from a trusted source, no verification search needed
        const alreadyTrusted = brand.trustedSources.some(
          (ts) => story.source === ts || story.source.endsWith(`.${ts}`)
        );
        if (alreadyTrusted) {
          story.verified = true;
          story.verifiedBy = story.source;
          console.log(`  [stage1] auto-verified (trusted source): "${story.headline.slice(0, 40)}…"`);
          return;
        }

        const query = `"${story.headline}" ${story.source}`;
        console.log(`  [stage1] verify: ${query}`);
        const results = await services.search.search(query, {
          maxResults: 3,
          searchDepth: "basic",
          includeDomains: brand.trustedSources,
        });
        const hit = results[0];
        if (hit) {
          story.verified = true;
          story.verifiedBy = new URL(hit.url).hostname.replace("www.", "");
          console.log(`  [stage1] verified: "${story.headline.slice(0, 40)}…" → ${story.verifiedBy}`);
        } else {
          console.warn(`  [stage1] NOT verified by trusted source: "${story.headline.slice(0, 40)}…"`);
        }
      } catch (err) {
        console.warn(`  [stage1] verification search failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      }
    }));

    return { stories, trendingSignals, apiSourceMap: { ...ctx.apiSourceMap, discovery: lastDiscoverySource } };
  }
}

export function formatExcludedTopicsBlock(
  excludedTopics: string[],
  reelRecentUrls?: string[],
): string {
  if (excludedTopics.length === 0) return "";

  const lines = excludedTopics.map((headline, i) => {
    const recentUrl = reelRecentUrls?.[i];
    if (!recentUrl) return `  ${i + 1}. ${headline}`;
    try {
      const host = new URL(recentUrl).hostname.replace("www.", "");
      return `  ${i + 1}. ${headline} (${host})`;
    } catch {
      return `  ${i + 1}. ${headline} (invalid recent URL: ${recentUrl})`;
    }
  });

  return `DO NOT COVER these topics or anything closely related — even if the date, numbers, or specific details differ. Do NOT reuse any of these source URLs:\n${lines.join("\n")}\n`;
}
