# Performance Dashboard & Feedback Loop — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Scope:** Facebook-first engagement analytics, theme tagging, and discovery feedback loop

## Problem

The pipeline publishes reels to Facebook but never collects engagement data back. There is no visibility into which pillars, themes, voices, or music tracks perform well. The discover stage uses static weights with no learning from actual performance.

## Goals

1. Collect Facebook Page Post Insights for every published reel
2. Build a web dashboard that merges engagement data with pipeline run metadata
3. Tag every reel with a theme (Tech, Economy, etc.) for granular analysis
4. After sufficient data, feed performance back into discover to improve story selection

## API Availability

- **Facebook Page Post Insights**: `GET /{page-post-id}/insights` — generic video metrics. **Caution:** returns both `period=lifetime` and `period=day` entries for the same metric name; must filter to `period=lifetime` only or values get overwritten with yesterday's incremental count.
- **Facebook Video Insights** (preferred for Reels): `GET /{video-id}/video_insights` — Reels-specific endpoint. Returns `blue_reels_play_count` (actual Reels plays, more accurate than `post_video_views`), `post_video_avg_time_watched` (ms, direct — no manual division needed), `post_video_view_time` (total ms), `post_impressions_unique` (reach), and **`post_video_followers`** (exact per-reel follower attribution). This is the **implemented** endpoint.
- **Engagement** (likes/comments/shares): `GET /{pageId}_{videoId}?fields=reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count),shares` — still needed as a separate call since `video_insights` doesn't return reaction breakdown.
- **Instagram Reels Insights**: Available (`GET /{ig-media-id}/insights`) but deferred to phase 2. WorldBrief has Instagram enabled.
- **TikTok**: No analytics API found at the Content Posting API tier. Both brands have `tikTokEnabled: false` anyway.

Facebook-first, expand to Instagram later.

---

## 1. Data Model

### `reel_metrics` table

One row per fetch snapshot per reel. Tracks metric growth over time.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| reel_id | TEXT FK→reels | |
| fetched_at | DATETIME | when we pulled from FB |
| platform | TEXT | "facebook" (extensible) |
| views | INTEGER | |
| likes | INTEGER | |
| comments | INTEGER | |
| shares | INTEGER | |
| saves | INTEGER | |
| reach | INTEGER | |
| watch_time_sec | REAL | avg watch time per viewer (from `post_video_avg_time_watched` ms ÷ 1000) |
| total_watch_time_sec | REAL | cumulative watch time (from `post_video_view_time` ms ÷ 1000) |
| followers_gained | INTEGER | per-reel followers from `post_video_followers` |

Each fetch creates a new row. This enables growth curves (views at 24h vs 48h vs 72h).

### `performance_benchmarks` table

Pre-computed rolling averages across all dimensions. Updated by the metrics collector after each batch.

| Column | Type | Notes |
|--------|------|-------|
| brand_id | TEXT | "ds" or "ns" |
| dimension | TEXT | "pillar", "theme", "voice", "music", "category" |
| dimension_value | TEXT | e.g. "Breaking", "Tech", "JBFqn...", "breaking-1.mp3" |
| period | TEXT | "7d", "30d" |
| avg_views | REAL | |
| avg_engagement_rate | REAL | (likes+comments+shares) / views |
| avg_watch_time | REAL | |
| sample_count | INTEGER | reels in the window |
| computed_at | DATETIME | |

Single table covers all dashboard breakdown panels.

### `performance_scores` table

Normalized per-reel scores vs its pillar average.

| Column | Type | Notes |
|--------|------|-------|
| reel_id | TEXT FK→reels | |
| views_ratio | REAL | reel views / pillar avg views |
| engagement_ratio | REAL | reel eng rate / pillar avg eng rate |
| overall_score | REAL | `0.5 * views_ratio + 0.5 * engagement_ratio` |
| computed_at | DATETIME | |

Primary key: `reel_id` (one score per reel, updated on each computation).

---

## 2. Theme Tagging

**Current state:** Theme is only set when a run is manually started with a theme override. Most runs have no theme.

**Change:** Extend the discover stage's Gemini structured output to return `theme` alongside `pillar` for every story. Gemini classifies the story into one of the brand's `themeWeights` keys (Tech, Economy, Politics, Science, Health, Environment, Entertainment, Sports, Lifestyle, plus pillar-name themes like Breaking, Uplifting).

The theme is stored in the `runs.theme` column (already exists in schema). No schema change needed.

This gives every reel both a pillar and a theme, enabling the "By Theme" dashboard panel to have full coverage from day one.

---

## 3. Metrics Collection

### Scheduled job: `src/services/metrics-collector.ts`

Runs every 6 hours, triggered by the existing pipeline scheduler.

**Flow:**

1. **Find candidates** — Query published reels where `publishedAt` is between 12 hours and **30 days** ago (window extended from 14d to match the benchmark period). Filter by `reels.publishedAt` (not `reels.updatedAt` — reels that haven't been modified recently but are still within the 30d window would otherwise be missed). Skip reels with a `reel_metrics` row fetched in the last 6 hours.

2. **Fetch from Facebook** — For each reel, call `GET /{videoId}/video_insights` (Reels-specific endpoint — see API Availability above). Also fetch the post object (`GET /{pageId}_{videoId}?fields=reactions,...`) for reactions/comments/shares counts.

3. **Store snapshots** — Insert into `reel_metrics`. Run metadata (theme, category) comes from the `runs` table. Voice and music come from the reel's stored metadata/context JSON in the `reels` table.

4. **Recompute benchmarks** — For every dimension (pillar, theme, voice, music, category) across 7d and 30d windows, calculate averages and upsert into `performance_benchmarks`.

5. **Update performance scores** — For each reel published > 48h ago, compute `views_ratio` and `engagement_ratio` against its pillar benchmark, store in `performance_scores`.

### Error handling

- FB API errors are logged but don't block other reels in the batch
- Rate limiting: respect FB API limits, add backoff if needed
- Missing post IDs: skip reels without `facebookPostId`

---

## 4. Dashboard

### Route: `GET /dashboard` on existing Express server

Server-rendered HTML page, same auth as the review endpoint. No client-side JS framework — pure HTML/CSS with inline styles matching the existing review page aesthetic.

### Layout (top to bottom)

**1. Scorecard row**

Four cards in a row:
- Total reels published (7d / 30d)
- Total FB views (7d / 30d, with delta vs previous period)
- Avg engagement rate (7d / 30d, with delta)
- Top-performing dimension (which pillar/theme has highest engagement)

**2. Trend chart**

Daily view totals over 30 days. CSS-rendered bar chart (no external chart library). Each bar = sum of latest-snapshot views for reels published that day. Labeled with dates.

**3. Per-reel table**

All reels from last 14 days. Columns:
- Title
- Brand
- Pillar
- Theme
- Category
- Voice (truncated ID)
- Views, Likes, Shares
- Engagement rate
- Overall score (color-coded: green > 1.2x, yellow 0.8-1.2x, red < 0.8x)

Sortable by any column. Each row links to the existing `/review` page for that reel.

**4. Breakdown panels (2x2 grid)**

Each panel shows: dimension value, avg views, avg engagement rate, sample count, trend arrow (vs previous period).

- **By Pillar** — Breaking, Trending, Human Interest, Business
- **By Theme** — Tech, Economy, Politics, Science, etc.
- **By Voice** — each voice ID with provider
- **By Music** — each music track filename

**5. Discover score correlation**

Shows whether the pipeline's existing `compositeScore` from discover predicts engagement:
- High-scorers (top quartile) avg engagement rate
- Low-scorers (bottom quartile) avg engagement rate
- Verdict: "Score predicts engagement" or "Weak correlation — discover scoring needs tuning"

---

## 5. Feedback Loop (Phase 2)

Activated after 30+ days of performance data. Not built in the initial implementation.

### How it works

1. **Compute dimension boosts** — From `performance_benchmarks`, calculate how each dimension outperforms or underperforms the overall average. If "Breaking" pillar averages 1.4x overall → positive boost. If "Tech" theme averages 0.8x → negative signal.

2. **Inject into discover** — The discover stage (stage 1) considers three signals:
   - Static `themeWeights` from brand config (baseline)
   - `performanceBoost` from benchmarks (learned adjustment)
   - Combined: `themeWeight * (1 + performanceBoost)`

3. **Guardrails:**
   - Only applies after 30 days of data (configurable threshold)
   - Performance boost capped at ±50% of original weight (prevents total suppression or domination)
   - Minimum 5 samples per dimension before influencing weights
   - Boost values logged in run's `context` JSON for transparency

4. **Dashboard visibility** — A section showing which weights are boosted vs suppressed, with original vs effective values.

---

## 6. Implementation Phases

### Phase 1: Data foundation + dashboard
- Add `reel_metrics`, `performance_benchmarks`, `performance_scores` tables to schema
- Extend discover prompt to return `theme` alongside `pillar`
- Build `metrics-collector.ts` (FB fetch job)
- Build `/dashboard` route with all 5 sections
- Schedule the metrics collector in the pipeline cron

### Phase 2: Feedback loop
- Add `performanceBoost` computation
- Wire into discover stage
- Add feedback visualization to dashboard
- Tune guardrails based on real data

---

## 7. Files to Create/Modify

**New files:**
- `src/db/migrations/XXX_reel_metrics.sql` — schema migration
- `src/services/metrics-collector.ts` — FB insights fetch + benchmark computation
- `api/routes/dashboard.ts` — dashboard HTML endpoint
- `src/review/dashboard-html-builder.ts` — dashboard HTML renderer

**Modified files:**
- `src/db/schema.ts` — add three new tables
- `src/db/queries.ts` — add metric/benchmark CRUD queries
- `src/stages/stage1-discover.ts` — extend Gemini output to include `theme`
- `src/pipeline/reel-runner.ts` — persist theme from discover
- `bin/server.ts` — register `/dashboard` route
