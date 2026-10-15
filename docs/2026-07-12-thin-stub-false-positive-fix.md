# Fix False-Positive Thin-Stub Detection Rejecting Real Articles

## Problem

`!reel https://www.dailynews.co.th/news/6021314/` failed repeatedly. Traced end-to-end:

```
[stage0-from-url] Tavily extract: 13462 chars
[stage0-from-url] Tavily content looks like a thin stub (nav/caption junk, not article prose) — treating as blocked
```

I called Tavily's `/extract` directly for this exact URL and got back 12,147 characters of legitimate, well-formed Thai article prose — a real, complete article about a subway tunnel water leak, matching the page's own `og:title` exactly. This is not junk. But `looksLikeThinStub()` (added in `2026-07-11-thin-source-stub-and-date-guardrail.md`, to catch a genuinely thin Reuters nav-junk stub) flagged it anyway. Running the real content through that function directly shows why:

```json
{
  "hashHeaderCount": 112,
  "hasDuplicateSentence": true,
  "dupSentence": "th/wp-content/uploads/2025/06/logo-dn-pink-04."
}
```

Two false positives, both from signals that were tuned against a single short, genuinely-junk example and don't generalize:

1. **Header count.** dailynews.co.th appends a long "related articles" list after the real article body, each entry formatted as a markdown `## headline`. The existing check flags **any** page with 2+ `##` headers, anywhere, regardless of how much real content surrounds them. That held for the original short Reuters stub (nav + one sentence + a caption) but breaks on any ordinary news page with a substantial related-links section — which is normal, not a sign of thin content.

2. **False duplicate-sentence match.** The sentence-splitting regex (`[^.!?]{40,}[.!?]`) doesn't distinguish prose from URLs — periods inside a file path (`.../logo-dn-pink-04.webp`) get matched as "sentence" boundaries, and since the site's logo URL appears twice on the page (header + elsewhere), it registered as a "duplicated sentence." Not real content duplication.

With 2 of 4 signals required to trip the stub check, these two false positives together crossed the `signals >= 2` threshold, and 12KB of legitimate article content was discarded as "thin junk," falling through to Gemini's weaker direct-URL-read tier — which is what produced downstream garbage in later stages.

## Fix — tighten both signals so they require actual thinness, not just presence

**`src/stages/stage0-from-url.ts`**, in `looksLikeThinStub()`:

**1. Header signal — require the page to actually be dominated by headers, not just contain 2+ of them.** Instead of counting raw header occurrences, measure how much *non-header* content remains after stripping header lines. Only flag if that remainder is itself thin:

```ts
function nonHeaderContentLength(content: string): number {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n").length;
}
```

```ts
const headerCount = (content.match(/##\s/g) ?? []).length;
if (headerCount >= 2 && nonHeaderContentLength(content) < 1500) signals++;
```

Verified: the real dailynews article has 112 headers but 2,968 characters of non-header content — well clear of the 1,500 threshold, so it no longer trips. A reconstruction of the original short Reuters-style stub (nav boilerplate + one sentence + a caption, a few hundred characters total) still trips it, since stripping its 2 headers leaves next to nothing.

**2. Duplicate-sentence signal — exclude URL-shaped matches and multi-line matches.** A real sentence has spaces in it and doesn't span a newline; a URL fragment caught by the greedy regex has neither:

```ts
const sentences = (content.match(/[^.!?]{40,}[.!?]/g) ?? [])
  .filter((s) => /\s/.test(s.trim()) && !s.includes("\n"));
```

The `!s.includes("\n")` guard is a secondary fix found while testing: without it, the regex can also swallow an entire nav/header block into one "sentence" (since `[^.!?]` matches newlines too), which is a separate latent bug in the same matcher — same fix, same line, no separate deploy needed for it.

## Files changed

- `src/stages/stage0-from-url.ts` — `looksLikeThinStub()`: header signal now ratio-based (non-header content length) instead of raw count; duplicate-sentence signal excludes URL-shaped and multi-line false matches

## Behaviour after fix

| Scenario | Before | After |
|---|---|---|
| Real article with a large "related articles" header list appended (dailynews.co.th and similar sites) | Falsely flagged as thin stub, discarded | Passes — real content still recognized by its substantial non-header body |
| Original short Reuters-style stub (nav + one sentence + duplicated caption, no real body) | Correctly flagged | Still correctly flagged |
| Duplicate URL fragment (e.g. repeated logo image path) | Falsely counted as a duplicated sentence | No longer matched — requires whitespace, single line |
| Genuine duplicated prose sentence (e.g. repeated photo caption, the original bug this signal was built for) | Correctly flagged | Still correctly flagged — real sentences have spaces and don't span newlines |

## No schema changes, no new dependencies

Same file, same function, signal-tuning only. Applies to both `ns` and `ds` since the code path is shared.
