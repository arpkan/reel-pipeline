# Performance Dashboard & Feedback Loop — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-26-performance-dashboard-feedback-loop-design.md`
**Phase:** 1 (Data Foundation + Dashboard)
**Date:** 2026-04-26

---

## Step 1: Add theme field to Story type and discover output

Make Gemini classify every story with a theme during discover.

### 1a. Add `theme` to Story interface

**File:** `src/types.ts`

Add `theme?: Theme` to the `Story` interface (around line 80). The field is optional because existing stories won't have it.

### 1b. Extend Gemini structured output schema

**File:** `src/stages/stage1-discover.ts`

Add `theme` property to the `submit_stories` function's `items.properties` (around line 78, after `pillar`):

```typescript
theme: { type: Type.STRING, description: "Topic classification — must match one of the brand's theme categories exactly" },
```

Add `"theme"` to the `required` array on line 83.

### 1c. Map theme into Story objects

**File:** `src/stages/stage1-discover.ts`

In the story mapping (lines 278-289), add `theme: s.theme` to the returned object:

```typescript
return {
  index: i,
  headline: s.headline,
  source: s.source,
  sourceUrl: s.sourceUrl,
  snippet: tavilyContent,
  pillar: s.pillar,
  theme: s.theme,        // <-- add this
  selectionReason: s.selectionReason,
  compositeScore: 0,
  verified: false,
  verifiedBy: undefined,
};
```

### 1d. Persist theme from discover into runs table

**File:** `src/pipeline/reel-runner.ts`

After discover completes, the theme should already be stored on the run (the `runs.theme` column). Verify that the reel runner sets `theme` from the story returned by discover. The discover stage already sets `theme` on the run context when a custom theme is provided — now it should also set it from the Gemini-classified theme for every run.

**File:** `src/pipeline/reel-runner.ts` — in `buildPersistedReelContext`, ensure `theme` from the discover story is included in the context JSON if not already present.

---

## Step 2: Add database tables

Three new tables for metrics storage.

### 2a. Define Drizzle schema tables

**File:** `src/db/schema.ts`

Add at the end of the file:

```typescript
export const reelMetrics = sqliteTable("reel_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reelId: text("reel_id").notNull().references(() => reels.id),
  fetchedAt: text("fetched_at").notNull(),
  platform: text("platform").notNull().default("facebook"),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  reach: integer("reach"),
  watchTimeSec: real("watch_time_sec"),
  totalWatchTimeSec: real("total_watch_time_sec"),
});

export const performanceBenchmarks = sqliteTable("performance_benchmarks", {
  brandId: text("brand_id").notNull(),
  dimension: text("dimension").notNull(),       // "pillar", "theme", "voice", "music", "category"
  dimensionValue: text("dimension_value").notNull(),
  period: text("period").notNull(),             // "7d", "30d"
  avgViews: real("avg_views"),
  avgEngagementRate: real("avg_engagement_rate"),
  avgWatchTime: real("avg_watch_time"),
  sampleCount: integer("sample_count").notNull().default(0),
  computedAt: text("computed_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.brandId, t.dimension, t.dimensionValue, t.period] }),
}));

export const performanceScores = sqliteTable("performance_scores", {
  reelId: text("reel_id").primaryKey().references(() => reels.id),
  viewsRatio: real("views_ratio"),
  engagementRatio: real("engagement_ratio"),
  overallScore: real("overall_score"),
  computedAt: text("computed_at").notNull(),
});
```

### 2b. Add inline migrations

**File:** `src/db/client.ts`

After the existing `batch_run_reels` migration block (around line 150), add:

```typescript
// Performance metrics tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reel_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id TEXT NOT NULL REFERENCES reels(id),
    fetched_at TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'facebook',
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    saves INTEGER,
    reach INTEGER,
    watch_time_sec REAL,
    total_watch_time_sec REAL
  );

  CREATE TABLE IF NOT EXISTS performance_benchmarks (
    brand_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    dimension_value TEXT NOT NULL,
    period TEXT NOT NULL,
    avg_views REAL,
    avg_engagement_rate REAL,
    avg_watch_time REAL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (brand_id, dimension, dimension_value, period)
  );

  CREATE TABLE IF NOT EXISTS performance_scores (
    reel_id TEXT PRIMARY KEY REFERENCES reels(id),
    views_ratio REAL,
    engagement_ratio REAL,
    overall_score REAL,
    computed_at TEXT NOT NULL
  );
`);
```

---

## Step 3: Add database queries

CRUD operations for metrics, benchmarks, and scores.

**File:** `src/db/queries.ts`

Add imports for the new tables:

```typescript
import { runs, posts, stageLogs, lineEvents, themeWeights, reels, reelSchedule, batchRuns, batchRunReels, reelMetrics, performanceBenchmarks, performanceScores } from "./schema.js";
```

Add these query functions:

### Reel Metrics

```typescript
export function insertReelMetrics(params: {
  reelId: string;
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  watchTimeSec: number | null;
  totalWatchTimeSec: number | null;
}): void {
  db.insert(reelMetrics).values({
    reelId: params.reelId,
    fetchedAt: now(),
    platform: params.platform,
    views: params.views,
    likes: params.likes,
    comments: params.comments,
    shares: params.shares,
    saves: params.saves,
    reach: params.reach,
    watchTimeSec: params.watchTimeSec,
    totalWatchTimeSec: params.totalWatchTimeSec,
  }).run();
}

/** Get reels eligible for metrics fetch: published, with FB post ID, 12h-14d old */
export function getMetricsCandidates(brand: string, since: string, until: string): Array<{
  id: string;
  facebookPostId: string | null;
  headline: string;
}> {
  return db.select({
    id: reels.id,
    facebookPostId: reels.facebookPostId,
    headline: reels.headline,
  })
    .from(reels)
    .where(and(
      eq(reels.brand, brand),
      isNotNull(reels.facebookPostId),
      gte(reels.updatedAt, since),
      lte(reels.updatedAt, until),
    ))
    .all();
}

/** Get the most recent metrics snapshot for a reel */
export function getLatestMetrics(reelId: string) {
  return db.select()
    .from(reelMetrics)
    .where(eq(reelMetrics.reelId, reelId))
    .orderBy(desc(reelMetrics.fetchedAt))
    .limit(1)
    .get();
}

/** Get all metrics snapshots for a set of reels, within a date range */
export function getMetricsForPeriod(reelIds: string[], since: string) {
  if (reelIds.length === 0) return [];
  return db.select()
    .from(reelMetrics)
    .where(and(
      inArray(reelMetrics.reelId, reelIds),
      gte(reelMetrics.fetchedAt, since),
    ))
    .all();
}
```

### Performance Benchmarks

```typescript
export function upsertBenchmark(params: {
  brandId: string;
  dimension: string;
  dimensionValue: string;
  period: string;
  avgViews: number | null;
  avgEngagementRate: number | null;
  avgWatchTime: number | null;
  sampleCount: number;
}): void {
  db.insert(performanceBenchmarks)
    .values({
      brandId: params.brandId,
      dimension: params.dimension,
      dimensionValue: params.dimensionValue,
      period: params.period,
      avgViews: params.avgViews,
      avgEngagementRate: params.avgEngagementRate,
      avgWatchTime: params.avgWatchTime,
      sampleCount: params.sampleCount,
      computedAt: now(),
    })
    .onConflictDoUpdate({
      target: [performanceBenchmarks.brandId, performanceBenchmarks.dimension, performanceBenchmarks.dimensionValue, performanceBenchmarks.period],
      set: {
        avgViews: params.avgViews,
        avgEngagementRate: params.avgEngagementRate,
        avgWatchTime: params.avgWatchTime,
        sampleCount: params.sampleCount,
        computedAt: now(),
      },
    })
    .run();
}

export function getBenchmarks(brandId: string, period?: string) {
  const conditions = [eq(performanceBenchmarks.brandId, brandId)];
  if (period) conditions.push(eq(performanceBenchmarks.period, period));
  return db.select().from(performanceBenchmarks)
    .where(and(...conditions))
    .all();
}
```

### Performance Scores

```typescript
export function upsertPerformanceScore(params: {
  reelId: string;
  viewsRatio: number | null;
  engagementRatio: number | null;
  overallScore: number | null;
}): void {
  db.insert(performanceScores)
    .values({
      reelId: params.reelId,
      viewsRatio: params.viewsRatio,
      engagementRatio: params.engagementRatio,
      overallScore: params.overallScore,
      computedAt: now(),
    })
    .onConflictDoUpdate({
      target: performanceScores.reelId,
      set: {
        viewsRatio: params.viewsRatio,
        engagementRatio: params.engagementRatio,
        overallScore: params.overallScore,
        computedAt: now(),
      },
    })
    .run();
}
```

### Dashboard data queries

```typescript
/** Get all reels with their latest metrics for the dashboard table */
export function getReelsWithMetrics(brand: string, since: string): Array<{
  reel: typeof reels.$inferSelect;
  latestMetrics: typeof reelMetrics.$inferSelect | null;
  score: typeof performanceScores.$inferSelect | null;
  runTheme: string | null;
}> {
  // Get reels for the period
  const brandReels = db.select()
    .from(reels)
    .where(and(
      eq(reels.brand, brand),
      gte(reels.createdAt, since),
    ))
    .all();

  return brandReels.map(reel => {
    const latest = db.select()
      .from(reelMetrics)
      .where(eq(reelMetrics.reelId, reel.id))
      .orderBy(desc(reelMetrics.fetchedAt))
      .limit(1)
      .get();

    const score = db.select()
      .from(performanceScores)
      .where(eq(performanceScores.reelId, reel.id))
      .get();

    // Get theme from runs table (reel id = run id)
    const run = db.select({ theme: runs.theme })
      .from(runs)
      .where(eq(runs.id, reel.id))
      .get();

    return { reel, latestMetrics: latest ?? null, score: score ?? null, runTheme: run?.theme ?? null };
  });
}
```

---

## Step 4: Add fetchReelInsights to MetaService

**File:** `src/services/meta.ts`

Add a new method to `MetaService` that fetches Page Post Insights for a video post:

```typescript
interface ReelInsights {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  watchTimeSec: number | null;
  totalWatchTimeSec: number | null;
}

async fetchReelInsights(postId: string, token: string): Promise<ReelInsights> {
  // Fetch video_view count from the post insights endpoint
  const insightsRes = await fetch(
    `${BASE_URL}/${postId}/insights?metric=video_views,video_view_time,video_avg_time_watched&access_token=${token}`
  );

  const result: ReelInsights = {
    views: null, likes: null, comments: null, shares: null,
    saves: null, reach: null, watchTimeSec: null, totalWatchTimeSec: null,
  };

  if (insightsRes.ok) {
    const data = await insightsRes.json() as { data: Array<{ name: string; values: Array<{ value: number }> }> };
    for (const metric of data.data) {
      const val = metric.values?.[0]?.value ?? null;
      if (metric.name === "video_views") result.views = val;
      if (metric.name === "video_view_time") result.totalWatchTimeSec = val;
      if (metric.name === "video_avg_time_watched") result.watchTimeSec = val;
    }
  }

  // Fetch reactions, comments, shares, reach from the post object
  const postRes = await fetch(
    `${BASE_URL}/${postId}?fields=reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count),shares,insights.metric(post_impressions)&access_token=${token}`
  );

  if (postRes.ok) {
    const post = await postRes.json() as {
      reactions?: { summary: { total_count: number } };
      comments?: { summary: { total_count: number } };
      shares?: { count: number };
    };
    result.likes = post.reactions?.summary?.total_count ?? null;
    result.comments = post.comments?.summary?.total_count ?? null;
    result.shares = post.shares?.count ?? null;
  }

  // Fetch reach separately (post_impressions insight)
  const reachRes = await fetch(
    `${BASE_URL}/${postId}/insights?metric=post_impressions&access_token=${token}`
  );
  if (reachRes.ok) {
    const reachData = await reachRes.json() as { data: Array<{ name: string; values: Array<{ value: number }> }> };
    for (const metric of reachData.data) {
      if (metric.name === "post_impressions") result.reach = metric.values?.[0]?.value ?? null;
    }
  }

  return result;
}
```

---

## Step 5: Build metrics collector service

**File:** `src/services/metrics-collector.ts` (NEW)

This is the scheduled job that fetches FB insights and computes benchmarks.

```typescript
import { MetaService, createMetaService } from "./meta.js";
import { getBrand } from "../brands/index.js";
import {
  getMetricsCandidates,
  getLatestMetrics,
  insertReelMetrics,
  upsertBenchmark,
  upsertPerformanceScore,
} from "../db/queries.js";
import type { BrandId } from "../types.js";

const FETCH_WINDOW_HOURS = 12;    // minimum age before first fetch
const FETCH_WINDOW_MAX_DAYS = 14;  // max age — stop fetching after 14 days
const REFETCH_INTERVAL_HOURS = 6;  // don't re-fetch within this window

export async function collectMetrics(brandId: BrandId): Promise<void> {
  const brand = getBrand(brandId);
  const meta = createMetaService();

  const now = new Date();
  const since = new Date(now.getTime() - FETCH_WINDOW_MAX_DAYS * 86400000).toISOString();
  const until = new Date(now.getTime() - FETCH_WINDOW_HOURS * 3600000).toISOString();

  const candidates = getMetricsCandidates(brandId, since, until);
  console.log(`[metrics] ${brandId}: ${candidates.length} candidates`);

  let fetched = 0;
  for (const reel of candidates) {
    if (!reel.facebookPostId) continue;

    // Check if we already fetched recently
    const latest = getLatestMetrics(reel.id);
    if (latest) {
      const hoursSinceFetch = (now.getTime() - new Date(latest.fetchedAt).getTime()) / 3600000;
      if (hoursSinceFetch < REFETCH_INTERVAL_HOURS) continue;
    }

    try {
      const insights = await meta.fetchReelInsights(reel.facebookPostId, brand.metaPageToken);
      insertReelMetrics({
        reelId: reel.id,
        platform: "facebook",
        views: insights.views,
        likes: insights.likes,
        comments: insights.comments,
        shares: insights.shares,
        saves: insights.saves,
        reach: insights.reach,
        watchTimeSec: insights.watchTimeSec,
        totalWatchTimeSec: insights.totalWatchTimeSec,
      });
      fetched++;
    } catch (err) {
      console.warn(`[metrics] failed for reel ${reel.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[metrics] ${brandId}: fetched ${fetched} reels`);

  // Recompute benchmarks and scores after fetching
  await recomputeBenchmarks(brandId);
  await recomputeScores(brandId);
}
```

The `recomputeBenchmarks` and `recomputeScores` functions will:

1. **recomputeBenchmarks** — For each dimension (pillar, theme, voice, music, category), get all published reels in 7d and 30d windows, parse their context JSON for voice/music, get their latest metrics snapshot, compute averages, and upsert into `performance_benchmarks`.

2. **recomputeScores** — For each reel published > 48h ago, load its latest metrics and its pillar's benchmark, compute `views_ratio = reel.views / pillar.avgViews` and `engagement_ratio = reel.engRate / pillar.avgEngRate`, then `overall_score = 0.5 * views_ratio + 0.5 * engagement_ratio`.

---

## Step 6: Build dashboard HTML builder

**File:** `src/review/dashboard-html-builder.ts` (NEW)

Server-rendered HTML page following the existing review page patterns (dark theme `#0f1117`, inline CSS, no framework).

The builder function takes dashboard data and returns a complete HTML string:

```
buildDashboardPage(data: DashboardData) => string
```

### Dashboard sections

1. **Scorecard row** — 4 cards: total reels, total views, avg engagement rate, top dimension. Cards use the existing pill-badge style.

2. **Trend chart** — CSS bar chart (no external lib). 30 daily bars showing view totals. Each bar is a `<div>` with `height: X%` and a date label.

3. **Per-reel table** — All reels from last 14 days with columns: title, brand, pillar, theme, category, voice, views, likes, shares, engagement rate, overall score (color-coded). Each row links to `/review/:brand/:reelId`.

4. **Breakdown panels (2x2 grid)** — Pillar, Theme, Voice, Music. Each panel shows dimension values with avg views, avg engagement rate, sample count, trend vs previous period.

5. **Discover score correlation** — Compare top-quartile vs bottom-quartile composite scores against engagement rates.

### Data shape

```typescript
interface DashboardData {
  brandId: BrandId;
  scorecard: {
    totalReels7d: number;
    totalReels30d: number;
    totalViews7d: number;
    totalViews30d: number;
    avgEngRate7d: number;
    avgEngRate30d: number;
    topDimension: { dimension: string; value: string; avgEngRate: number };
  };
  dailyViews: Array<{ date: string; views: number }>;
  reels: Array<ReelRow>;
  breakdowns: {
    pillar: BreakdownRow[];
    theme: BreakdownRow[];
    voice: BreakdownRow[];
    music: BreakdownRow[];
  };
}

interface ReelRow {
  id: string;
  headline: string;
  brand: string;
  pillar: string;
  theme: string | null;
  category: string | null;
  voiceId: string | null;
  views: number | null;
  likes: number | null;
  shares: number | null;
  engRate: number | null;
  overallScore: number | null;
}

interface BreakdownRow {
  value: string;
  avgViews: number | null;
  avgEngRate: number | null;
  sampleCount: number;
  trend: "up" | "down" | "flat" | "new";
}
```

---

## Step 7: Build dashboard route

**File:** `api/routes/dashboard.ts` (NEW)

```typescript
import { Hono } from "hono";
import { buildDashboardPage } from "../../src/review/dashboard-html-builder.js";
import { getReelsWithMetrics, getBenchmarks } from "../../src/db/queries.js";

export const dashboardRouter = new Hono();

dashboardRouter.get("/dashboard", (c) => {
  const brand = c.req.query("brand") ?? "ds";
  // ... collect data, build HTML
  c.header("Cache-Control", "no-store");
  return c.html(buildDashboardPage(data));
});
```

**File:** `bin/server.ts`

Add import and register route:

```typescript
import { dashboardRouter } from "../api/routes/dashboard.js";
app.route("/", dashboardRouter);
```

---

## Step 8: Schedule metrics collector

**File:** `bin/server.ts`

Add a cron job that runs every 6 hours:

```typescript
import { collectMetrics } from "../src/services/metrics-collector.js";

// Metrics collection — every 6 hours at minute 7
cron.schedule("7 */6 * * *", async () => {
  for (const brandId of ["ds", "ns"] as BrandId[]) {
    try {
      await collectMetrics(brandId);
    } catch (err) {
      console.error(`[metrics-cron] failed for ${brandId}:`, err instanceof Error ? err.message : err);
    }
  }
});
```

---

## Step 9: Tests

**File:** `src/services/__tests__/metrics-collector.test.ts` (NEW)

- Test `collectMetrics` with mocked MetaService and DB queries
- Verify metrics are inserted for eligible reels
- Verify benchmarks are computed correctly
- Verify scores are computed against pillar averages

**File:** `src/services/__tests__/meta-insights.test.ts` (NEW)

- Test `fetchReelInsights` with mocked fetch responses
- Verify correct parsing of FB API responses

---

## Build sequence

Execute in this order:

1. **Step 1** — Theme in discover (types + Gemini schema + mapping) — independent, no DB changes
2. **Step 2** — DB schema + migrations — new tables only, no breaking changes
3. **Step 3** — DB queries — depends on step 2 tables
4. **Step 4** — MetaService insights method — independent of steps 2-3
5. **Step 5** — Metrics collector — depends on steps 3 + 4
6. **Step 6** — Dashboard HTML builder — depends on step 3 (query shapes)
7. **Step 7** — Dashboard route — depends on step 6
8. **Step 8** — Schedule collector — depends on step 5
9. **Step 9** — Tests — can be written alongside steps 4-5

Steps 1 and 4 can run in parallel. Steps 6 and 8 can run in parallel.

---

## Files summary

| File | Action | Step |
|------|--------|------|
| `src/types.ts` | Modify — add `theme` to `Story` | 1 |
| `src/stages/stage1-discover.ts` | Modify — Gemini schema + mapping | 1 |
| `src/pipeline/reel-runner.ts` | Modify — persist theme in context | 1 |
| `src/db/schema.ts` | Modify — add 3 tables | 2 |
| `src/db/client.ts` | Modify — add inline migrations | 2 |
| `src/db/queries.ts` | Modify — add metric queries | 3 |
| `src/services/meta.ts` | Modify — add `fetchReelInsights` | 4 |
| `src/services/metrics-collector.ts` | **Create** | 5 |
| `src/review/dashboard-html-builder.ts` | **Create** | 6 |
| `api/routes/dashboard.ts` | **Create** | 7 |
| `bin/server.ts` | Modify — register route + cron | 7, 8 |
| `src/services/__tests__/metrics-collector.test.ts` | **Create** | 9 |
| `src/services/__tests__/meta-insights.test.ts` | **Create** | 9 |
