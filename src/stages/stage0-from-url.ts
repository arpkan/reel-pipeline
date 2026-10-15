import type { Stage, RunContext, Services, Story } from "../types.js";
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";

function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/** Normalise a YouTube URL to https://www.youtube.com/watch?v=VIDEO_ID
 *  Gemini rejects URLs with extra query params like &t=1s */
function normaliseYouTubeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Shorts: /shorts/<id>
    const shortsMatch = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
    if (shortsMatch) return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    // youtu.be/<id>
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return `https://www.youtube.com/watch?v=${id}`;
    }
    // Regular watch URL — keep only the v= param
    const videoId = u.searchParams.get("v");
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  } catch { /* fall through */ }
  return url;
}

function extractSlugQuery(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    // Take the last segment that isn't a pure date (all digits or short date parts)
    const slug = [...segments].reverse().find((s) => !/^\d{4}$/.test(s) && !/^\d{2}$/.test(s)) ?? segments[segments.length - 1] ?? "";
    return slug.replace(/-/g, " ").trim();
  } catch {
    return "";
  }
}

function looksLikeScraperBlock(content: string): boolean {
  if (content.length < 300) return true;
  const lower = content.toLowerCase();
  return (
    lower.includes("website access error") ||
    lower.includes("access denied") ||
    lower.includes("403 forbidden") ||
    lower.includes("blocked by") ||
    lower.includes("subscribe to read") ||
    lower.includes("subscription required") ||
    lower.includes("sign in to read") ||
    lower.includes("register to read") ||
    lower.includes("to continue reading") ||
    lower.includes("you've reached your limit") ||
    lower.includes("paywall") ||
    lower.includes("out of gifts for the month") ||
    lower.includes("you are the owner of this article") ||
    lower.includes("your counter will reset")
  );
}

/** Length of content remaining after stripping markdown header lines —
 *  used to tell "a couple of nav headers on an otherwise-empty page" apart
 *  from "a full article followed by a long related-links block." */
function nonHeaderContentLength(content: string): number {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n").length;
}

/** Detects content that loaded successfully but is mostly page furniture
 *  (nav, photo-gallery markers, boilerplate, duplicated photo captions)
 *  rather than article prose — e.g. a paywalled Reuters page that returns
 *  nav links + one repeated photo caption instead of the article body. */
function looksLikeThinStub(content: string): boolean {
  let signals = 0;
  if (/\[\d+\/\d+\]/.test(content) || /item \d+ of \d+/i.test(content)) signals++;
  if ((content.match(/##\s/g) ?? []).length >= 2 && nonHeaderContentLength(content) < 1500) signals++;
  if (/opens new tab/i.test(content)) signals++;
  const sentences = (content.match(/[^.!?]{40,}[.!?]/g) ?? [])
    .filter((s) => /\s/.test(s.trim()) && !s.includes("\n"));
  const seen = new Set<string>();
  const hasDuplicateSentence = sentences.some((s) => {
    const key = s.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (hasDuplicateSentence) signals++;
  return signals >= 2;
}

interface ClassifiedStory {
  headline: string;
  snippet: string;
  selectionReason: string;
  keyFacts?: string; // bullet-point details used to enrich the caption
  sourceReadMode?: "tavily_extract" | "url_model_read";
  sourceExtractText?: string;
  sourceExtractAvailable?: boolean;
  sourceExtractChars?: number;
}

async function classifyUrl(
  url: string,
  ctx: RunContext,
  services: Services,
): Promise<{ story: ClassifiedStory; discoverySource: import("../types.js").ApiProvider | undefined }> {
  const contentType = isYouTubeUrl(url) ? "YouTube video" : "article";
  const langNote = REEL_STRINGS[ctx.brand.language as ReelLang]?.langLabel ?? "English";

  const prompt = `You are classifying a ${contentType} for the ${ctx.brand.name} Facebook page.

Language: ${ctx.brand.language}

IMPORTANT: Only state a specific date for when an event occurred if the source text explicitly narrates it as the event date. A date on a photo caption, byline, or dateline is NOT the event date. If timing is unclear, describe it in relative terms (e.g. "overnight", "earlier this week") instead of a specific date.

Extract the following and respond in JSON only, no markdown:
{
  "headline": "the main headline or title (in ${langNote})",
  "snippet": "3-5 sentence summary covering the main story and its significance (in ${langNote})",
  "keyFacts": "5-8 bullet points of specific facts, stats, quotes, or details from the content that a copywriter can use to write a rich Facebook caption (in ${langNote})",
  "selectionReason": "why this is good content for a Facebook post"
}`;

  let raw = "";
  let discoverySource: import("../types.js").ApiProvider | undefined;
  let sourceReadMode: "tavily_extract" | "url_model_read" = "url_model_read";
  let sourceExtractText = "";

  if (isYouTubeUrl(url)) {
    const videoUrl = normaliseYouTubeUrl(url);
    console.log(`  [stage0-from-url] normalised YouTube URL: ${videoUrl}`);
    const { GoogleGenAI, ThinkingLevel } = await import("@google/genai");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    const client = new GoogleGenAI({ apiKey });

    const response = await client.models.generateContent({
      model: "gemini-3.6-flash",
      config: {
        systemInstruction: "You are a content classifier. Respond in JSON only.",
        maxOutputTokens: 2048,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false },
      },
      contents: {
        role: "user",
        parts: [
          { fileData: { fileUri: videoUrl } },
          { text: prompt },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    raw = parts.map((p: { text?: string }) => p.text ?? "").join("");
    discoverySource = "native";
    if (!raw) {
      const reason = response.candidates?.[0]?.finishReason;
      throw new Error(`Gemini returned empty response for YouTube URL ${url} (finishReason=${reason})`);
    }
  } else {
    // Article — use Tavily extract first, fall back to Gemini direct URL access
    const results = await services.search.extract([url]);
    const normalise = (value: string): string => {
      try {
        const u = new URL(value);
        u.hash = "";
        if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
          u.port = "";
        }
        u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
        return `${u.hostname}${u.pathname}${u.search}`;
      } catch {
        return value.trim().toLowerCase();
      }
    };

    const wanted = normalise(url);
    const matched = results.find((r) => normalise(r.url) === wanted);
    const tavilyContent = matched?.content ?? results[0]?.content;

    console.log(`  [stage0-from-url] Tavily extract: ${tavilyContent ? `${tavilyContent.length} chars` : "no content"}`);

    if (tavilyContent && looksLikeThinStub(tavilyContent)) {
      console.log(`  [stage0-from-url] Tavily content looks like a thin stub (nav/caption junk, not article prose) — treating as blocked`);
    }

    if (tavilyContent && !looksLikeScraperBlock(tavilyContent) && !looksLikeThinStub(tavilyContent)) {
      let enrichedContent = tavilyContent;

      // If extract is thin, supplement with search results from other sites
      const THIN_EXTRACT_THRESHOLD = 3000;
      if (tavilyContent.length < THIN_EXTRACT_THRESHOLD) {
        const sourceDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
        const searchQuery = tavilyContent.slice(0, 120).trim();
        try {
          const supplementResults = await services.search.search(searchQuery, { topic: "news", days: 3, maxResults: 5 });
          const supplements = supplementResults
            .filter((r) => {
              const domain = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
              return domain !== sourceDomain && r.content.length > 200;
            })
            .slice(0, 3);
          if (supplements.length > 0) {
            const supplementText = supplements.map((r) => r.content).join("\n\n---\n\n");
            console.log(`  [stage0-from-url] thin extract — supplemented with ${supplements.length} search result(s) (${supplementText.length} chars)`);
            enrichedContent = `${tavilyContent}\n\n--- SUPPLEMENTARY SOURCES ---\n\n${supplementText}`;
          } else {
            console.log(`  [stage0-from-url] thin extract — no supplementary results found`);
          }
        } catch (err) {
          console.log(`  [stage0-from-url] supplement search failed: ${err}`);
        }
      }

      const articlePrompt = `URL: ${url}\n\nARTICLE CONTENT:\n${enrichedContent}\n\n${prompt}`;
      const genResult = await services.gemini.generate("You are a content classifier. Respond in JSON only.", articlePrompt);
      raw = genResult.text;
      discoverySource = genResult.source;
      sourceReadMode = "tavily_extract";
      sourceExtractText = enrichedContent;
    } else {
      if (tavilyContent) {
        console.log(`  [stage0-from-url] Tavily returned a blocked/error page for ${url} — trying Gemini direct read`);
      } else {
        console.log(`  [stage0-from-url] Tavily extraction failed for ${url} — trying Gemini direct read`);
      }

      // Tier 2: Gemini direct URL read
      const geminiResult = await services.gemini.generate(
        "You are a content classifier. Respond in JSON only.",
        `Please read this article and respond with the requested JSON.\n\nURL: ${url}\n\n${prompt}`,
      );

      // Check if Gemini could actually read the article (not just describe an access error)
      const geminiBlocked = geminiResult.text.toLowerCase().includes("inaccessible") ||
        geminiResult.text.toLowerCase().includes("access error") ||
        geminiResult.text.toLowerCase().includes("cannot access") ||
        geminiResult.text.toLowerCase().includes("can't access") ||
        geminiResult.text.toLowerCase().includes("unable to access") ||
        geminiResult.text.toLowerCase().includes("unable to read") ||
        geminiResult.text.toLowerCase().includes("not a news article");

      if (!geminiBlocked) {
        raw = geminiResult.text;
        discoverySource = geminiResult.source;
        sourceReadMode = "url_model_read";
      } else {
        // Tier 3: search for the same story on another site via slug keywords
        console.log(`  [stage0-from-url] Gemini could not read ${url} — trying search fallback`);
        const slugQuery = extractSlugQuery(url);
        const blockedDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
        let searchFallbackUsed = false;

        if (slugQuery) {
          try {
            const searchResults = await services.search.search(slugQuery, { topic: "news", days: 3, maxResults: 5 });
            const hit = searchResults.find((r) => {
              const domain = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
              return domain !== blockedDomain && r.content.length > 200;
            });
            if (hit) {
              const hitDomain = (() => { try { return new URL(hit.url).hostname.replace(/^www\./, ""); } catch { return hit.url; } })();
              console.log(`  [stage0-from-url] found story via search on ${hitDomain} — using as source`);
              const articlePrompt = `URL: ${hit.url}\n\nARTICLE CONTENT:\n${hit.content}\n\n${prompt}`;
              const genResult = await services.gemini.generate("You are a content classifier. Respond in JSON only.", articlePrompt);
              raw = genResult.text;
              discoverySource = genResult.source;
              sourceReadMode = "tavily_extract";
              sourceExtractText = hit.content;
              searchFallbackUsed = true;
            }
          } catch (err) {
            console.log(`  [stage0-from-url] search fallback failed: ${err}`);
          }
        }

        if (!searchFallbackUsed) {
          throw new Error(
            `Stage0FromUrl: could not extract article content for ${url} — Tavily failed, Gemini direct read was blocked, and no search fallback match was found. Provide the article text manually.`,
          );
        }
      }
    }
  }

  let parsed: ClassifiedStory;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    throw new Error(`Stage0FromUrl: failed to parse Gemini classification for ${url}: ${raw}`);
  }

  return {
    story: {
      ...parsed,
      sourceReadMode,
      sourceExtractText,
      sourceExtractAvailable: sourceReadMode === "tavily_extract" && sourceExtractText.length > 0,
      sourceExtractChars: sourceExtractText.length,
    },
    discoverySource,
  };
}

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

export class Stage0FromUrl implements Stage {
  name = "stage0-from-url";

  constructor(private readonly sourceUrls: string[]) {}

  async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
    const urls = this.sourceUrls.slice(0, 2);
    console.log(`  [stage0-from-url] classifying ${urls.length} URL(s)`);

    const stories: Story[] = [];
    let lastDiscoverySource: import("../types.js").ApiProvider | undefined;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const contentType = isYouTubeUrl(url) ? "YouTube video" : "article";
      console.log(`  [stage0-from-url] classifying ${contentType}: ${url}`);

      const enrichment = await enrichUrlContent(url, ctx, services);
      lastDiscoverySource = enrichment.discoverySource;
      console.log(`  [stage0-from-url] classified: "${enrichment.headline}"`);

      const hostname = (() => {
        try { return new URL(url).hostname.replace("www.", ""); }
        catch { return url; }
      })();

      stories.push({
        index: i,
        headline: enrichment.headline,
        source: hostname,
        sourceUrl: url,
        snippet: enrichment.snippet,
        selectionReason: enrichment.selectionReason,
        compositeScore: 0,
        verified: true,
        verifiedBy: hostname,
        sourceReadMode: enrichment.sourceReadMode,
        sourceExtractText: enrichment.sourceExtractText,
        sourceExtractAvailable: enrichment.sourceExtractAvailable,
        sourceExtractChars: enrichment.sourceExtractChars,
      });
    }

    return { stories, apiSourceMap: { ...ctx.apiSourceMap, discovery: lastDiscoverySource } };
  }
}
