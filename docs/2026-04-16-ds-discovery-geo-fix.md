# DS Discovery Geo-targeting Fix

**Date:** 2026-04-16
**Problem:** DS (ThaiDaily, Thai-language) discovery selects stories with no relevance to Thailand.

---

## Root Cause

DS lacks an explicit geo enforcement rule in the Gemini system prompt. NS has `"Strongly prefer European stories; only fall back to global if no strong European story exists"` hardcoded in `buildSystemPrompt()`. DS has no equivalent — only `"Avoid sensitive institutional political topics"`.

Three compounding issues:

1. **No explicit Thai geo rule** — `geographicFocus` is soft prose; it appears in the prompt but has no structural enforcement. NS gets the same field *plus* an additional hardcoded rule.
2. **Gemini defaults to English queries** — The only Thai-language search hint is inside the `forcePillar` block, which rarely fires. Without it, Gemini writes English queries → Tavily returns global English results.
3. **Reel category bias is geographically unconstrained** — human_interest bias ("Prefer stories centered on individuals…") can match any dramatic foreign story with no Thai connection.

**Example bad story:** "Sixteen injured after ex-student opens fire at high school in Turkey" — selected as DS human_interest reel via BBC English, zero Thailand relevance.

Both pipeline posts and reels share `stage1-discover.ts`, so one fix covers both.

---

## Fix

**File:** `src/stages/stage1-discover.ts`
**Location:** `buildSystemPrompt()` — the DS-specific block (currently line 142)

### Before
```ts
${!isCustomTheme && brand.id === "ds" ? "- Avoid sensitive institutional political topics" : ""}
```

### After
```ts
${!isCustomTheme && brand.id === "ds" ? `- Avoid sensitive institutional political topics
- Stories MUST be relevant to Thailand or Thai people. Accept: Thai domestic stories, events happening in Thailand, stories about Thai people or organisations, major global events with a clear direct Thai angle (Thai exports impacted, Thai tourists involved, Thai government response). Reject: purely foreign incidents with no Thai connection — a school shooting abroad, a European political crisis, a war in a country with no Thai involvement are NOT acceptable even if dramatic or emotional.
- Search in Thai first. Use Thai-language queries (e.g. ข่าวไทย, ข่าวด่วน, เหตุการณ์วันนี้, ประเทศไทย) to surface Thai-source stories before falling back to English queries.` : ""}
```

This mirrors exactly what NS gets at line 143 (`"Strongly prefer European stories…"`).

No other files need changes. `geographicFocus` in `src/brands/ds.ts` remains unchanged.

---

## Build & Deploy

```bash
npm run build
pm2 restart pipeline
```

## Verification

- Check `[stage1] search(...)` log lines — queries should now include Thai terms
- Next scheduled DS run should select a story from a Thai-source domain or a clearly Thailand-relevant story
- DS reel triggered via `!reel` should discover a story with a Thai headline/angle
