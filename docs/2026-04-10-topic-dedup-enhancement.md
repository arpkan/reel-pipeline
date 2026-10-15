# Topic Dedup Enhancement

**Date**: 2026-04-10
**Status**: Planned
**Scope**: `src/stages/stage1-discover.ts` (shared by normal posts + reels)

## Problem

Both the reel pipeline and normal post pipeline repeatedly select the same topics (gold prices, oil prices, government policy). Root causes:

1. **Normal post pipeline has zero dedup** — no check against recent posts or reels
2. **Reel pipeline dedup is prompt-only** — relies on Gemini following instructions, no programmatic enforcement
3. **Lookback too narrow** — only 10 recent reel headlines checked (<2 days at 6 reels/day)
4. **No cross-pipeline awareness** — reels don't know what posts covered, posts don't know what reels covered
5. **Headline matching is too literal** — "ราคาทองวันนี้ 9 เม.ย." vs "ราคาทองวันนี้ 10 เม.ย." treated as different stories

## Solution

Shared programmatic topic filter with retry loop. Character trigram similarity (works for Thai without word segmentation) with hard block on duplicates.

## Files to Modify

| File | Change |
|---|---|
| `src/stages/stage1-discover.ts` | Add trigram filter + retry loop + improve prompt wording |
| `src/db/queries.ts` | Add `getRecentPostHeadlines()`, increase `getRecentReelHeadlines` default |
| `src/pipeline/reel-runner.ts` | Increase lookback 10 → 30, merge post + reel headlines |
| `src/pipeline/runner.ts` | Add post + reel headline lookback, merge into context |
| `src/types.ts` | Rename `reelRecentTopics` → `excludedTopics` |

## Implementation Details

### Change 1: Trigram similarity utility

Add `trigramSimilarity(a, b)` helper in `stage1-discover.ts`:

- Normalize: lowercase, strip whitespace and digits (so dates don't create false uniqueness)
- Extract character trigrams from normalized string
- Score: `intersection / min(|a|, |b|)` — uses min so short headlines aren't penalized
- Threshold: **0.45** for "too similar" — named constant `SIMILARITY_THRESHOLD` at file top

```
Example:
"ราคาทองวันนี้ 9 เม.ย. 69 ประกาศ ราคาทองคำวันนี้ ร่วงลงแรง"
vs
"ราคาทองวันนี้ 10 เม.ย. 69 ปรับขึ้น 550 บาท ทองรูปพรรณอยู่ที่ 73,250 บาท"
→ similarity ~60-70% → REJECTED

"กบน. ลดราคาน้ำมันรับสงกรานต์"
vs
"กบน.เคาะลดดีเซล 2.14 บาททุกปั๊ม"
→ similarity ~50% → REJECTED

"หมอวรงค์ แฉดีเซลล่องหน 700 ล้านลิตร"
vs
"จับหนุ่มวัย 20 พร้อมไอซ์เกือบครึ่งตัน"
→ similarity ~5% → OK
```

### Change 2: New DB query — `getRecentPostHeadlines(brand, limit)`

In `src/db/queries.ts`:

- Query `runs` table where `brand = brandId`, ordered by `created_at DESC`, limit 20
- Extract `stories` JSON → parse → extract `headline` from each story
- Return flat array of headline strings
- Increase `getRecentReelHeadlines` default from 5 → 30

### Change 3: Merge headlines from both pipelines

Each runner gathers headlines from both sources before calling stage1:

- `reel-runner.ts`: Call `getRecentReelHeadlines(brandId, 30)` + `getRecentPostHeadlines(brandId, 20)`, merge, pass to context
- `runner.ts`: Same — call both queries, merge, pass to context
- Rename `reelRecentTopics` → `excludedTopics` in `RunContext` (since it's no longer reel-only)

Stage1 receives a merged array of up to ~50 headlines covering 3-5 days.

### Change 4: Post-submission topic filter with retry

In `stage1-discover.ts`, wrap the `services.gemini.agentic()` call in a retry loop:

```
MAX_DEDUP_RETRIES = 2
SIMILARITY_THRESHOLD = 0.45

for attempt 0..MAX_DEDUP_RETRIES:
  result = agentic(systemPrompt + duplicateWarning, userMessage, ...)

  duplicates = submitted stories where any excludedTopic
               has trigramSimilarity > SIMILARITY_THRESHOLD

  if no duplicates → break (success)

  if attempt < MAX_DEDUP_RETRIES:
    duplicateWarning = "REJECTED: already covered — [matched headlines]. Pick different stories."
    console.log duplicate detected, retrying
  else:
    throw Error("submitted stories too similar to recent coverage")
```

Key behaviors:
- On retry, the full agentic call re-runs (Gemini does new searches with the duplicate warning in prompt)
- After 2 retries exhausted → **hard block** — pipeline fails rather than publish duplicate
- Duplicate warnings include the matched recent headline so Gemini knows exactly what to avoid

### Change 5: Improve prompt wording

Replace current `RECENTLY COVERED REEL TOPICS` section with stronger language:

```
DO NOT COVER these topics or anything closely related —
even if the date, numbers, or specific details differ:
1. "ราคาทองวันนี้ 10 เม.ย. 69 ปรับขึ้น 550 บาท..."
2. "กบน. ลดราคาน้ำมันรับสงกรานต์..."
... (up to 50 headlines from reels + posts)
```

### Change 6: Increase lookback in runners

- `reel-runner.ts:351`: `getRecentReelHeadlines(brandId, 10)` → `30`
- `runner.ts`: Add `getRecentPostHeadlines(brandId, 20)` + `getRecentReelHeadlines(brandId, 30)`, merge, pass to context

## Data Flow

```
runner.ts / reel-runner.ts
  │ calls getRecentReelHeadlines(brand, 30)    → 30 reel headlines
  │ calls getRecentPostHeadlines(brand, 20)    → 20 post headlines
  │ merges into excludedTopics (up to 50)
  │ passes to RunContext
  ▼
stage1-discover.ts
  │ includes all 50 in prompt (stronger wording)
  │ Gemini searches and submits stories
  │ trigramSimilarity check against all 50
  │ if duplicate → retry (up to 2x) with warning
  │ if still duplicate → hard block (throw)
  ▼
stories returned (deduplicated)
```

## Concerns

| Concern | Mitigation |
|---|---|
| Threshold tuning | Named constant `SIMILARITY_THRESHOLD`, easy to adjust |
| API cost of retries | Worst case 3 agentic calls. Acceptable vs duplicate content |
| Thai trigram limitations | "ราคาทอง" vs "ทองราคา" may match, but both are gold-topic — acceptable |
| Field rename scope | `reelRecentTopics` → `excludedTopics` touches types.ts + 2 runners + stage1 + html-builder |

## Changelog

- 2026-04-10: Initial plan
