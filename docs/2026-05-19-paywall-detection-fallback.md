# Scraper-Block Detection Fallback in stage0-from-url

## Problem

Some news sites (e.g. The Telegraph) block Tavily's scraper while remaining fully readable in a browser. When this happens, Tavily returns an access-error/blocked page instead of the article content. The current code treats any non-empty Tavily response as valid content and passes it to classification, which then produces a "story" about the error page. When `reel-stage2-script` gets this, Bedrock refuses to write a script and returns a plain-text refusal instead of JSON, causing the pipeline to crash with `⚠️ Failed to parse script JSON`.

## Fix

Add a `looksLikePaywallOrError(content)` guard in `stage0-from-url.ts`. If Tavily content triggers the guard, skip it and fall through to the existing Gemini fallback path.

### Detection heuristics (any one match = skip Tavily content)

- Content length < 300 characters (a bare redirect/block page)
- Contains any of: `"subscribe to read"`, `"subscription required"`, `"access denied"`, `"sign in to read"`, `"you've reached your limit"`, `"website access error"`, `"403 forbidden"`, `"blocked by"`, `"to continue reading"`, `"register to read"`, `"paywall"`

All comparisons are case-insensitive.

## File changed

`src/stages/stage0-from-url.ts`

- Add helper function `looksLikePaywallOrError(content: string): boolean` before `classifyUrl`
- In the Tavily content branch (around line 119), add the guard: `if (tavilyContent && !looksLikePaywallOrError(tavilyContent))` — otherwise log a warning and fall through to Gemini

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Scraper-blocked URL (e.g. Telegraph) | Classifies the error page, script stage crashes | Detects blocked response, falls back to Gemini URL read |
| Valid Tavily content | Unchanged | Unchanged |
| Tavily returns nothing | Unchanged (falls back to Gemini) | Unchanged |

## No schema changes, no new dependencies
