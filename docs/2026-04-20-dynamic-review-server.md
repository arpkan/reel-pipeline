# Dynamic Review HTML Server

## Context

Review HTML is currently generated at pipeline time, uploaded to GCS, and the GCS URL is stored in the DB. The `/review/:brand/:runId` route just 302-redirects to that GCS URL.

**Problems this solves:**
- Template changes (e.g. adding image prompts) require re-running `bin/regen-review.ts` for every past run — with dynamic rendering every page is always current automatically
- Dependency on GCS for serving simple HTML text
- Extra GCS API call and upload per run

**Approach:** Remove HTML generation from the pipeline entirely. The review route reconstructs RunContext/ReelContext from the DB on each request and calls `buildReviewHtml()` / `buildReelReviewHtml()` live. The stored `reviewUrl` becomes a server URL (`https://pipeline.example.com/review/...`) instead of a GCS URL.

Additionally, persist `trendingSignals`, `themeSource`, and `pillarBalance` in a new `context` JSON column on the `runs` table (matching what reels already do), so the Trending Signals and Theme/Pillar panels render correctly on all future runs.

---

## Approach

### What changes
| Area | Before | After |
|------|--------|-------|
| HTML generation | At pipeline time, uploaded to GCS | On each HTTP request, built from DB |
| `reviewUrl` stored | `https://storage.googleapis.com/...` | `https://pipeline.example.com/review/...` |
| Template update | Requires `regen-review.ts` re-run | Instant — just restart server |
| Trending signals | Lost after run completes | Persisted in `runs.context` JSON |

### What does NOT change
- Images and videos stay on GCS (Meta publish API needs public URLs)
- The URL format `/review/:brand/:runId` stays the same
- All Telegram/LINE notifications work identically

---

## Files to Modify

### 1. `src/db/schema.ts`
Add `context` column to the `runs` table:
```ts
context: text("context"),  // JSON: { trendingSignals, themeSource, pillarBalance }
```

Run migration once:
```sql
ALTER TABLE runs ADD COLUMN context TEXT;
```

### 2. `src/db/queries.ts`
Add new function:
```ts
export function saveRunContext(runId: string, context: object): void {
  db.update(runs).set({ context: JSON.stringify(context), updatedAt: now() })
    .where(eq(runs.id, runId)).run();
}
```

### 3. `src/pipeline/runner.ts`
After `stage1-discover` and `stage0-from-url` complete, save:
```ts
queries.saveRunContext(runId, {
  trendingSignals: ctx.trendingSignals,
  themeSource: ctx.themeSource,
  pillarBalance: ctx.pillarBalance,
});
```

### 4. `src/stages/stage4a-review.ts`
Replace HTML generation + GCS upload with URL computation:
```ts
const reviewUrl = `${process.env.PIPELINE_BASE_URL}/review/${ctx.brand.id}/${ctx.runId}`;
updateRunReviewUrl(ctx.runId, reviewUrl);
return { reviewUrl };
```

### 5. `src/pipeline/reel-runner.ts` (4 places)
Each `buildReelReviewHtml(ctx)` + `gcs.uploadHtml()` block becomes:
```ts
const reviewUrl = `${process.env.PIPELINE_BASE_URL}/review/reel/${reelId}`;
queries.updateReel(reelId, { reviewUrl });
ctx = { ...ctx, reviewUrl };
```

### 6. `api/routes/review.ts` — core change
**GET `/review/:brand/:runId`** — reconstruct RunContext and render:
- `getRunById` + `getPostsByRun` + `getStageLogsForRun`
- Parse `run.context` JSON → restore `trendingSignals`, `themeSource`, `pillarBalance`
- `buildReviewHtml(ctx, brand)` → `c.html(html)` with `X-Robots-Tag: noindex`

**GET `/review/reel/:reelId`** — reconstruct ReelContext and render:
- `getReelById` → parse `script` + `context` JSON
- `buildReelReviewHtml(ctx)` → `c.html(html)` with `X-Robots-Tag: noindex`

### 7. `src/review/html-builder.ts` + `src/review/reel-html-builder.ts`
Add to `<head>` in both templates:
```html
<meta name="robots" content="noindex, nofollow">
```

### 8. `src/services/gcs.ts`
Remove `uploadHtml()` method (no longer used).

### 9. `.env` + `src/config.ts`
Add `PIPELINE_BASE_URL=https://pipeline.example.com` to `.env`.
Add to `ALWAYS_REQUIRED` in `config.ts`.

### 10. Delete `bin/regen-review.ts`
No longer needed.

---

## Verification

1. Run migration: `sqlite3 data/pipeline.db "ALTER TABLE runs ADD COLUMN context TEXT;"`

2. Visit existing run:
   - `https://pipeline.example.com/review/ds/752b1937-c4f0-4053-84ae-862c51253767`
   - Should render review HTML directly (not redirect to GCS)
   - Check: response header `X-Robots-Tag: noindex` present
   - Check: `<meta name="robots" content="noindex, nofollow">` in source

3. Visit existing reel:
   - `https://pipeline.example.com/review/reel/57942424-c92a-496e-a45f-14f8fa0aef9a`
   - Should render reel review with per-scene image prompts

4. Edit any label in `html-builder.ts`, reload — change is instant, no regen step.

5. Trigger a new run → Telegram notification link is `pipeline.example.com/review/...`; review page shows Trending Signals panel.
