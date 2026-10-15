# URL Slug Search Fallback in stage0-from-url

## Problem

Some sites (e.g. The Telegraph) block both Tavily extract and Gemini direct URL reads. When both fail, the pipeline silently classifies the error/blocked page and produces a reel with a junk headline like "Access Issue Help".

## Fix

Add a third fallback tier between the Gemini URL read and failure: extract keywords from the URL slug, run a Tavily news search, pick the best result from a different domain, and classify using that content instead.

### Fallback chain (articles only)

1. **Tavily extract** — fast, full content. Skip if blocked/error page detected.
2. **Tavily news search** _(new)_ — extract slug keywords from the URL path, search `topic: "news"` with `days: 3`, exclude the original domain, take the first result with content. Log the alternative source URL used.
3. **Gemini direct URL read** — last resort; works for some sites Tavily can't reach.

### Slug keyword extraction

Strip the URL path of date segments and stop words, then use the hyphen-separated slug words as the search query.

Example:
- URL: `https://www.telegraph.co.uk/us/news/2026/05/18/trump-bomb-iran-truth-social/`
- Slug: `trump-bomb-iran-truth-social`
- Query: `trump bomb iran truth social`
- Search: `topic: "news"`, `days: 3`, exclude `telegraph.co.uk`

### File changed

`src/stages/stage0-from-url.ts`

- Add helper `extractSlugQuery(url: string): string` — extracts the last meaningful path segment, strips hyphens, removes pure-numeric segments (dates)
- In the else branch (after Tavily block detection), try Tavily news search before falling back to Gemini
- If a search result is found, use its `content` (snippet) + `title` as the article text and set `sourceReadMode = "tavily_extract"` with `sourceExtractText` set to the search snippet
- Log: `[stage0-from-url] found story via search on <domain> — using as source`

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Site blocks Tavily + Gemini | Junk "Access Issue Help" reel | Finds same story on Reuters/AP/BBC/etc and scripts correctly |
| Site blocks Tavily only | Falls back to Gemini | Unchanged (Gemini still tier 3) |
| Valid Tavily extract | Unchanged | Unchanged |

## No schema changes, no new dependencies
