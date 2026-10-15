# Dashboard Redesign — Design Spec
**Date:** 2026-05-15  
**Status:** Approved

---

## Overview

Redesign `pipeline.example.com/dashboard` from a flat, utilitarian data dump into a clear command center. The primary complaint is that the current layout has no visual hierarchy, the score column is unexplained, and the reel table has too many columns to scan quickly.

**Also included:** new follower tracking data layer (follower_snapshots table + daily fetch job) to unlock CMP progress tracking and per-reel follower attribution.

---

## Page Layout (top to bottom)

### 1. Header
- Brand name + brand switcher (ThaiDaily / WorldBrief) — displays brand logo (base64-embedded PNG from `assets/brands/`) alongside the brand name
- Brand CSS theme injected per-brand via `brandThemeCss(brandId)` in `src/review/utils.ts` — sets CSS custom properties (`--c-accent`, `--c-bar`, `--c-accent-text`, etc.) so all accent colors track the active brand without hardcoding per-page

### 2. CMP Progress Bar
New section, directly below the header.

Two horizontal progress bars side by side:
- **Followers:** `X / 10,000` — amber gradient bar (followers is typically the lagging metric).
- **Watch Minutes (60d):** `X / 600,000` — blue gradient bar. Derived by summing `reelMetrics.totalWatchTimeSec / 60` over the last 60 days.
- **Estimated time label** top-right (e.g. "~4.2 months to eligibility") — computed as `max(days_to_follower_target, days_to_watch_target) / 30`, where each `days_to_target = remaining / daily_average_rate_7d`. Shows "—" if insufficient history.

Follower data comes from the new `follower_snapshots` table (see Data Layer section). Until that table has data, both bars show as empty with a "no follower data yet" note.

### 3. Hero — Trend Chart + KPI Cards
Two-column grid: chart takes ~75% width, KPI stack takes the rest.

**Left: two stacked bar charts**
1. **30-day daily views** — same data as current, larger and more prominent; hover tooltip per bar
2. **30-day daily follower gain** — net followers gained per day, derived from consecutive `follower_snapshots` rows; shown below the views chart

**Right: 4 KPI cards (stacked)**
1. Views (7d) — with delta vs average week
2. Avg Engagement (7d) — with delta vs 30d avg
3. Reels Published — "12 / 38" (7d / 30d)
4. **Followers Gained (7d)** ← new — total net follower gain over last 7 days, with delta vs prior 7 days. Shows "—" if no follower snapshot data yet.

### 4. Reel List (14d)
**Sort controls:** Score · Views · Eng % · Watch Time · Followers · Published (default: Score desc)

**Score legend:** ≥1.2x above target (green) · ≥0.8x on target (yellow) · below target (red) · no score (gray)

Each reel is a card with:
- **Color-coded left border** (green/yellow/red/gray matching score)
- **Score badge** — e.g. `1.42x` with matching color background
- **Headline** (truncated) + pillar, theme, and published date/time chips
- **4 metrics** right-aligned: Views · Eng% · Avg Watch (blue) · Followers Gained (purple)

Followers Gained per reel = `daily_net_follower_gain / reels_published_that_day` (equal attribution). Shows "—" if no snapshot data for that day.

Reel title links to `/review/reel/:id` (the reel-specific review route, **not** `/review/:brand/:id` which is for post-pipeline runs).

### 5. Breakdowns (30d)
Five collapsible panels: first four in a 2-column grid, fifth panel full-width (spans both columns):

1. By Pillar
2. By Theme
3. By Voice
4. By Music
5. **By Posting Time** ← new

Each panel: horizontal bar chart ranked by avg engagement rate. Bars show eng% with avg views and sample count as sub-label. Bars sized relative to the top performer in that panel (top = 100%).

**By Posting Time** derives from `reels.scheduledTime` — groups by hour (e.g. "07:00", "12:00", "18:00", "21:00"). Uses same `performanceBenchmarks` table with `dimension = "posting_time"`.

---

## Data Layer Changes

### New table: `follower_snapshots`

```ts
followerSnapshots = sqliteTable("follower_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),           // "ds" | "ns"
  date: text("date").notNull(),             // YYYY-MM-DD
  totalFollowers: integer("total_followers").notNull(),
  fetchedAt: text("fetched_at").notNull(),
}, (t) => ({
  uniq: uniqueIndex("follower_snapshots_brand_date").on(t.brand, t.date),
}));
```

### New daily fetch job
A new script/cron step that runs once per day per brand:
- Calls Facebook Graph API: `GET /{page_id}?fields=fan_count&access_token=...`
- Inserts a row into `follower_snapshots` with today's date and `fan_count`
- Idempotent: upserts on (brand, date) conflict

Reuses existing Facebook credentials from env vars (same pattern as metrics fetch).

### New DB queries
```ts
// Get follower snapshots for a date range
getFollowerSnapshots(brand: BrandId, since: string): FollowerSnapshot[]

// Compute net gain between two snapshots
getFollowerGain7d(brand: BrandId): number | null  // null if < 2 snapshots

// CMP: total watch minutes over last 60 days
getTotalWatchMinutes60d(brand: BrandId): number
```

### Benchmark update: posting_time dimension
`computeBenchmarks` (wherever that runs) should add a new dimension pass: group published reels by `scheduledTime` hour, compute avg views/eng/watch for each hour bucket, upsert into `performanceBenchmarks` with `dimension = "posting_time"`.

### DashboardData interface additions
```ts
interface DashboardData {
  // existing fields unchanged...
  cmpProgress: {
    watchMinutes60d: number;
    totalFollowers: number | null;       // null = no snapshot data
    followersGained7d: number | null;    // null if < 2 snapshots in range
    followersGainedPrior7d: number | null; // for KPI delta; null if insufficient history
  };
  scorecard: {
    // existing fields...
    // NOTE: followersGained7d is read from cmpProgress — not duplicated here.
    // The scorecard KPI card for followers reads cmpProgress.followersGained7d.
  };
}

interface ReelRow {
  // existing fields...
  watchTimeSec: number | null;     // avg watch time per view
  followersGained: number | null;  // attributed followers
  publishedLabel: string | null;   // brand-timezone formatted date/time (e.g. "17 May 14:00")
}

interface BreakdownRow {
  // existing fields...
  avgWatchTime: number | null;
}
```

---

## Brand Theming System

Both the dashboard and the reel review page (`src/review/reel-html-builder.ts`) use a shared theming system defined in `src/review/utils.ts`:

- **`brandThemeCss(brandId)`** — returns a `:root { ... }` CSS block with brand-specific custom properties. Both brands share the same neutral backgrounds (`--c-bg: #080B12`, `--c-card: #111420`, `--c-inner: #0C0F18`, `--c-border: #1C2030`) to avoid heavy color tinting. Brand color only appears in accent vars:
  - **NS (WorldBrief):** `--c-accent: #B21526` (crimson), `--c-bar: #7A1020`, `--c-accent2: #E8A020` (amber)
  - **DS (ThaiDaily):** `--c-accent: #1550C4` (royal blue), `--c-bar: #1040A0`, `--c-accent2: #FF5A00` (orange)
- **`brandLogoHtml(brandId, cls)`** — returns an `<img>` tag with the brand logo embedded as base64. Logos are loaded at module init from `assets/brands/worldbrief_logo.png` and `assets/brands/thaidaily_logo.png` using `readFileSync(join(process.cwd(), ...))`. Returns empty string gracefully if the file is missing.

The reel review page header uses a dark gradient (`linear-gradient(135deg, var(--c-accent-dim) 0%, #0d1020 100%)`) with a 2px brand-color bottom border — not a solid brand-color background.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/db/schema.ts` | Add `follower_snapshots` table |
| `src/db/queries.ts` | Add follower snapshot queries + `getTotalWatchMinutes60d` |
| `src/review/utils.ts` | Add `brandThemeCss()`, `brandLogoHtml()` (shared by dashboard + reel review page) |
| `src/review/dashboard-html-builder.ts` | Full rewrite with new layout; imports theming from utils |
| `src/review/reel-html-builder.ts` | Add brand theming + logo display in review page header |
| `api/routes/dashboard.ts` | Add CMP data, follower KPI, watch time to reel rows, posting_time breakdowns, daily follower gain chart |
| `src/services/follower-fetch.ts` | New: `collectFollowerSnapshot(brandId)` — daily cron helper; registered in `bin/server.ts` at `0 1 * * *` (01:00 UTC) |
| `src/services/metrics-collector.ts` | Add posting_time dimension to benchmark computation |

---

## What is NOT in scope

- Reel duration breakdown (duration not stored in DB; requires generation pipeline changes)
- Hook type breakdown (not tracked; requires generation pipeline changes)  
- Auto-optimization / strategy adjustment (separate project per PERFORMANCE_FEEDBACK_IMPLEMENTATION_GUIDE.md)
- ~~Follower-per-reel exact attribution (equal split by day is the approximation used)~~ — **superseded**: Facebook's `/{videoId}/video_insights` endpoint returns `post_video_followers` per reel directly; equal-split approach was replaced (see Session 2 fixes below)

---

## Post-Implementation Fixes (discovered during build)

The following issues were found and fixed during implementation — not in the original spec:

### Reel card link 404
Dashboard was linking reel cards to `/review/${brandId}/${r.id}`, which matched the post-pipeline run route `/review/:brand/:runId`. Reel IDs don't exist as run IDs so all links 404'd. Fixed: links now use `/review/reel/${r.id}` (the dedicated reel review route).

### Contrast / readability
Initial build had low-contrast text throughout — secondary labels at `#333`–`#555` against `#111420` cards were nearly invisible. Fixed by bumping all secondary text to `#777`–`#999`, and adding a dedicated `--c-bar` CSS var (`#7A1020` NS / `#1040A0` DS) for bar chart fills since `--c-accent-dim` was too close to the card background color.

### XSS in client-side reel list JS
Reel titles were interpolated directly into the HTML template literal in `DASHBOARD_JS`. Fixed by adding a minimal `eh()` escape function in the client-side JS block.

### N+1 query in `getTotalWatchMinutes60d`
Original implementation ran a separate DB query per reel to get its latest metrics. Fixed to use a single bulk query over all reel IDs + in-memory `Map` to deduplicate, making it O(1) DB round-trips regardless of reel count.

### posting_time colon-in-key bug
`recomputeBenchmarks` used `key.split(":")` to detect posting_time keys (keys that contain `:`). This split on every key in the map and discarded all but the first segment, corrupting non-posting-time values. Fixed: `key.indexOf(":")` is now used to test for the posting_time dimension.

### Brand name correction
Spec and original code used "DailySiam" — the correct brand name is **ThaiDaily**. Fixed throughout dashboard builder and brand switcher links.

### `collectFollowerSnapshot` cron
`src/services/follower-fetch.ts` is registered in `bin/server.ts` at `0 1 * * *` (01:00 UTC / 08:00 Bangkok). First data point appears the next morning; follower gain deltas appear after two days.

---

---

## Post-Implementation Fixes (Session 2 — 2026-05-17)

The following bugs were discovered after the initial deploy and fixed in a follow-up session.

### Facebook Insights API dual-period overwrite
`GET /{pagePostId}/insights` returns **two** entries per metric name: one with `period=lifetime` (correct) and one with `period=day` (yesterday's incremental count). The original for-loop processed all entries without filtering, so the day entry (e.g. 1 view) overwrote the lifetime entry (e.g. 693 views). Every reel showed `views: 1`. Fix: `if (metric.period !== "lifetime") continue;` inside the parsing loop.

### Switch to `/{videoId}/video_insights` endpoint
Facebook's Reels-specific endpoint provides better data than the generic post insights endpoint:

| Metric | Old endpoint | New endpoint |
|--------|-------------|-------------|
| Views | `post_video_views` via `/{pagePostId}/insights` | `blue_reels_play_count` via `/{videoId}/video_insights` |
| Avg watch time | manual: `totalWatchTimeSec / views` | `post_video_avg_time_watched` (ms, direct) |
| Total watch time | `post_video_view_time` ÷ 1000 | `post_video_view_time` ÷ 1000 (same) |
| Reach | `post_impressions_unique` | `post_impressions_unique` (same) |
| Followers | not available | **`post_video_followers`** — exact per-reel attribution |

The `likes`, `comments`, `shares` fields still come from `GET /{pagePostId}?fields=reactions,...` (unchanged).

### `followers_gained` column added to `reel_metrics`
Schema: `followers_gained INTEGER` added to the `reel_metrics` table. Migration: `ALTER TABLE reel_metrics ADD COLUMN followers_gained INTEGER`. `insertReelMetrics` updated to accept `followersGained?: number | null`. Spec's `reel_metrics` table definition (section 1 in the original dashboard spec) should add this column.

### Per-reel follower attribution — exact, not estimated
Previous implementation divided daily page follower gain by the number of reels published that day. This produced misleading numbers (e.g. reel `b0438f11` showed 5 followers when the actual value was 2). Now uses `post_video_followers` from `video_insights` directly. `followersGained` in `ReelRow` now maps to `latestMetrics.followersGained` instead of the computed daily-split value.

### `forcePillar` in scoring
`parseReelMeta` read pillar only from `pillarBalance.prioritise[0]`. NS reels using `{"prioritise":[],"forcePillar":"Controversy"}` were treated as pillar-less and skipped by `recomputeScores`. Fix: `pb?.prioritise?.[0] ?? pb?.forcePillar ?? fallback`.

### `getMetricsCandidates` — `updatedAt` vs `publishedAt` filter
Original query filtered candidates by `reels.updatedAt` in a 14-day window. DS reels hadn't been touched since April, so their `updated_at` was outside the May window → 0 DS candidates. Fix: filter by `reels.publishedAt` instead, with `isNotNull(reels.publishedAt)` guard. Window extended from 14 → 30 days (`FETCH_WINDOW_MAX_DAYS`) to match the benchmark computation period so all scoreable reels have current metrics.

### Auth failure silent-null bug
When the Facebook access token expires, the `catch { /* non-fatal */ }` in `fetchReelInsights` silently produces all-null metric rows. These rows have a valid `fetched_at` timestamp, so the 6-hour refetch guard skips them on the next cron run — the reels appear to have metrics but every field is null. Fix: the `video_insights` call now checks for `data.error` and logs `[meta] video_insights error for ${videoId}: ${code} ${message}`, and also logs HTTP non-OK responses. The DS token expired 2026-05-13; once renewed the fix will re-fetch correctly (null rows are skipped in favour of rows with views via `getLatestMetrics`'s `isNotNull(views)` preference).

### Scoring 48-hour grace period (by design — not a bug)
Reels published < 48h ago have no `performance_scores` row. This is intentional: `recomputeScores` uses `until = now − 48h` to give views time to stabilise before scoring. New reels show a gray "no score yet" badge in the dashboard until the next cron run after the grace period expires.

---

## Post-Implementation Fixes (Session 3 — 2026-05-17)

### Bar charts: zero-fill for full 30-day range
Both the daily views and daily follower gain charts only rendered bars for days that had data (days with published reels, or days with follower snapshots). This meant the charts showed ~14 bars instead of 30, with inconsistent bar widths between the two charts (fewer bars = wider bars). Fixed: `computeDailyViews` and `computeDailyFollowerGain` now generate all 30 calendar dates in the range, defaulting to 0 for days with no data. Both charts always render exactly 30 equal-width bars. `computeDailyViews` now takes a `since` parameter; `computeDailyFollowerGain` now takes a `since` parameter and zero-fills missing snapshot dates. Follower snapshot fetch window extended from 15 → 31 days so the first day in the 30-day window has a predecessor for gain computation.

### Follower gain chart: 90th percentile scaling
The follower gain chart scaled bars to the absolute max gain. Backfilled data included anomalous spikes (e.g. +509 on a single day from historical import), which crushed all normal daily gains (1-12) to ~1% bar height — making the chart appear "mostly zero". Fixed: the chart now uses the 90th percentile gain as the scale ceiling (`p90`). Outlier bars are capped at 100% height. `dashboard-html-builder.ts` line 176: `const p90 = absGains[Math.floor(absGains.length * 0.9)] ?? 1; const maxGain = Math.max(p90, 1);` with `Math.min(pct, 100)` clamping.

### Reel cards: published date/time in brand timezone
Reel cards showed no publishing timestamp. Added `publishedLabel` field to `ReelRow`, formatted via `Intl.DateTimeFormat` using the brand's timezone (`Asia/Bangkok` for DS, `Europe/Berlin` for NS). Displayed as a muted chip (e.g. `17 May 14:00`) alongside pillar/theme chips. Sourced from `reels.publishedAt`. `api/routes/dashboard.ts` imports `getBrand` to read the timezone; new `formatDateTz(iso, tz)` helper formats the date. Published column is also sortable — sort controls now include a "Published" button that sorts by `publishedAt` timestamp (newest first).

---

## Post-Implementation Fixes (Session 4 — 2026-05-17)

### Data Health card
Added an always-visible **Data Health** card below the dashboard header. It is brand-scoped and shows freshness for the two external data feeds that drive the dashboard:

- **Reel metrics** — latest `reel_metrics.fetched_at` joined through `reels.brand`; feeds views, engagement, watch time, score badges, and breakdowns. Expected cron cadence is every 6 hours. Status thresholds: `ok` < 12h, `warning` >= 12h, `critical` >= 24h.
- **Followers** — latest `follower_snapshots.fetched_at` for the active brand; feeds follower chart and CMP progress. Expected cron cadence is daily. Status thresholds: `ok` < 36h, `warning` >= 36h, `critical` >= 72h.

Missing data shows as `missing` with `Never`. This does not actively validate Facebook tokens on page load; expired tokens are detected indirectly because cron writes stop and freshness ages into warning/critical.

Implementation details:
- `src/db/queries.ts`: added `getDashboardHealth(brand)`.
- `api/routes/dashboard.ts`: added `buildDataHealth(...)`, `makeHealthItem(...)`, and `formatAge(...)` helpers.
- `src/review/dashboard-html-builder.ts`: added `DataHealthItem`, `DashboardData.dataHealth`, and `buildDataHealthHtml(...)`.

---

## Open Questions / Assumptions

- Facebook API credential pattern: assumes `FACEBOOK_PAGE_ID_DS`, `FACEBOOK_PAGE_ID_NS`, and `FACEBOOK_ACCESS_TOKEN_DS`, `FACEBOOK_ACCESS_TOKEN_NS` env vars (or similar) already exist for metrics fetching. Follower fetch reuses the same pattern.
- CMP threshold: 10,000 followers + 600,000 watch minutes in 60 days (Facebook CMP requirements as of 2026).
- Benchmark computation for posting_time: runs inside the dashboard route on each request (same as current pillar/theme/voice/music benchmarks via `getBenchmarks`), not a separate scheduled job.
