# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Redesign the performance dashboard with a clearer layout (CMP progress bar, hero chart, reel cards with sort, collapsible breakdown panels) and add a follower tracking data layer for CMP and per-reel attribution.

**Architecture:** Data layer first (schema → queries → services → benchmark update), then route, then HTML builder. Each task is independently deployable. The HTML builder is a full rewrite of `src/review/dashboard-html-builder.ts`; the route is updated in-place. No new API endpoints.

**Tech Stack:** TypeScript, Drizzle ORM (better-sqlite3), Vitest, Hono, vanilla JS (client-side interactivity inlined in HTML)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/db/schema.ts` | Modify | Add `followerSnapshots` table definition |
| `src/db/client.ts` | Modify | Add `CREATE TABLE IF NOT EXISTS follower_snapshots` DDL |
| `src/db/queries.ts` | Modify | Add `upsertFollowerSnapshot`, `getFollowerStats`, `getTotalWatchMinutes60d`; add `scheduledTime` to `getMetricsCandidates` return |
| `src/services/meta.ts` | Modify | Add `fetchFollowerCount(pageId, token)` method |
| `src/services/follower-fetch.ts` | Create | `collectFollowerSnapshot(brandId)` — daily cron helper |
| `src/services/metrics-collector.ts` | Modify | Add `posting_time` dimension to `recomputeBenchmarks`; add `scheduledTime` to candidate loop |
| `src/review/dashboard-html-builder.ts` | Rewrite | New layout: CMP bar, hero chart, reel cards, collapsible breakdowns |
| `api/routes/dashboard.ts` | Modify | Wire cmpProgress, watchTimeSec, followersGained, posting_time breakdowns into DashboardData |
| `tests/follower-fetch.test.ts` | Create | Unit tests for `collectFollowerSnapshot` |
| `tests/metrics-posting-time.test.ts` | Create | Unit tests for posting_time benchmark dimension |

---

## Task 1: follower_snapshots — schema and DDL

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`

- [x] **Step 1: Add table to schema.ts**

Add after the `performanceScores` table definition (end of file):

```ts
// src/db/schema.ts  — add at bottom, after performanceScores
import { uniqueIndex } from "drizzle-orm/sqlite-core";  // add to existing imports

export const followerSnapshots = sqliteTable("follower_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),
  date: text("date").notNull(),             // YYYY-MM-DD
  totalFollowers: integer("total_followers").notNull(),
  fetchedAt: text("fetched_at").notNull(),
}, (t) => ({
  uniq: uniqueIndex("follower_snapshots_brand_date_uniq").on(t.brand, t.date),
}));
```

Note: `uniqueIndex` may already be imported — check existing imports first and only add it if missing.

- [x] **Step 2: Add DDL to client.ts**

In `client.ts`, add this block at the end, just before the `export const db = drizzle(...)` line:

```ts
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS follower_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    date TEXT NOT NULL,
    total_followers INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE(brand, date)
  );
`);
```

- [x] **Step 3: Verify the server starts without errors**

```bash
cd <repo>
npx tsx src/db/client.ts 2>&1 || echo "import-only check done"
```

Expected: no errors (the file just exports `db`, it won't hang).

- [x] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/client.ts
git commit -m "feat: add follower_snapshots table"
```

---

## Task 2: follower snapshot queries

**Files:**
- Modify: `src/db/queries.ts`

- [x] **Step 1: Add imports to queries.ts**

Confirm `followerSnapshots` is imported from schema. The existing import line is:
```ts
import { runs, posts, stageLogs, lineEvents, reelIntakeSessions, themeWeights, reels, reelSchedule, batchRuns, batchRunReels, assemblyJobs, reelMetrics, performanceBenchmarks, performanceScores } from "./schema.js";
```

Add `followerSnapshots` to that import:
```ts
import { runs, posts, stageLogs, lineEvents, reelIntakeSessions, themeWeights, reels, reelSchedule, batchRuns, batchRunReels, assemblyJobs, reelMetrics, performanceBenchmarks, performanceScores, followerSnapshots } from "./schema.js";
```

- [x] **Step 2: Add upsertFollowerSnapshot**

Append to the end of `src/db/queries.ts`:

```ts
// ─── Follower Snapshots ───────────────────────────────────────────────────────

export function upsertFollowerSnapshot(brand: BrandId, date: string, totalFollowers: number): void {
  db.insert(followerSnapshots)
    .values({ brand, date, totalFollowers, fetchedAt: now() })
    .onConflictDoUpdate({
      target: [followerSnapshots.brand, followerSnapshots.date],
      set: { totalFollowers, fetchedAt: now() },
    })
    .run();
}
```

- [x] **Step 3: Add getFollowerStats**

```ts
export interface FollowerStats {
  totalFollowers: number | null;
  gained7d: number | null;
  gainedPrior7d: number | null;
}

export function getFollowerStats(brand: BrandId): FollowerStats {
  const today = new Date();
  const d7 = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const d14 = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);

  const snapshots = db.select()
    .from(followerSnapshots)
    .where(and(eq(followerSnapshots.brand, brand), gte(followerSnapshots.date, d14)))
    .orderBy(asc(followerSnapshots.date))
    .all();

  if (snapshots.length === 0) return { totalFollowers: null, gained7d: null, gainedPrior7d: null };

  const latest = snapshots[snapshots.length - 1];
  const totalFollowers = latest.totalFollowers;

  const snap7dAgo = snapshots.filter(s => s.date <= d7).at(-1);
  const snap14dAgo = snapshots.filter(s => s.date < d7).at(0);

  const gained7d = snap7dAgo != null ? totalFollowers - snap7dAgo.totalFollowers : null;
  const gainedPrior7d = (snap7dAgo != null && snap14dAgo != null)
    ? snap7dAgo.totalFollowers - snap14dAgo.totalFollowers
    : null;

  return { totalFollowers, gained7d, gainedPrior7d };
}
```

- [x] **Step 4: Add getFollowerSnapshotsByDate (for per-reel attribution)**

```ts
export function getFollowerSnapshotsByDate(brand: BrandId, since: string): Array<{ date: string; totalFollowers: number }> {
  return db.select({ date: followerSnapshots.date, totalFollowers: followerSnapshots.totalFollowers })
    .from(followerSnapshots)
    .where(and(eq(followerSnapshots.brand, brand), gte(followerSnapshots.date, since)))
    .orderBy(asc(followerSnapshots.date))
    .all();
}
```

- [x] **Step 5: Confirm TypeScript compiles**

```bash
cd <repo>
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to new functions.

- [x] **Step 6: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: add follower snapshot queries"
```

---

## Task 3: getTotalWatchMinutes60d + scheduledTime in candidates

**Files:**
- Modify: `src/db/queries.ts`

- [x] **Step 1: Add getTotalWatchMinutes60d**

Append to `src/db/queries.ts` (still in the follower/metrics section):

```ts
export function getTotalWatchMinutes60d(brand: BrandId): number {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();

  const brandReelIds = db.select({ id: reels.id })
    .from(reels)
    .where(and(eq(reels.brand, brand), gte(reels.createdAt, since), isNotNull(reels.facebookPostId)))
    .all()
    .map(r => r.id);

  if (brandReelIds.length === 0) return 0;

  const rows = db.select({ total: reelMetrics.totalWatchTimeSec })
    .from(reelMetrics)
    .where(inArray(reelMetrics.reelId, brandReelIds))
    .all();

  // Use the latest metric per reel (avoid double-counting re-fetches)
  const latestPerReel = new Map<string, number>();
  for (const reel of brandReelIds) {
    const latest = db.select({ total: reelMetrics.totalWatchTimeSec })
      .from(reelMetrics)
      .where(eq(reelMetrics.reelId, reel))
      .orderBy(desc(reelMetrics.fetchedAt))
      .limit(1)
      .get();
    if (latest?.total != null) latestPerReel.set(reel, latest.total);
  }

  const totalSec = Array.from(latestPerReel.values()).reduce((s, v) => s + v, 0);
  return totalSec / 60;
}
```

- [x] **Step 2: Add scheduledTime to getMetricsCandidates return**

Find `getMetricsCandidates` in `queries.ts`. Currently selects `{ id, facebookPostId, headline, context }`. Update it to also select `scheduledTime`:

```ts
export function getMetricsCandidates(brand: string, since: string, until: string): Array<{
  id: string;
  facebookPostId: string | null;
  headline: string;
  context: string | null;
  scheduledTime: string | null;
}> {
  return db.select({
    id: reels.id,
    facebookPostId: reels.facebookPostId,
    headline: reels.headline,
    context: reels.context,
    scheduledTime: reels.scheduledTime,
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
```

- [x] **Step 3: Compile check**

```bash
cd <repo>
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: add watch minutes query and scheduledTime to metrics candidates"
```

---

## Task 4: fetchFollowerCount in MetaService

**Files:**
- Modify: `src/services/meta.ts`

- [x] **Step 1: Write the failing test**

Create `tests/follower-fetch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch before importing anything that uses it
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { MetaService } from "../src/services/meta.js";

describe("MetaService.fetchFollowerCount", () => {
  let svc: MetaService;
  beforeEach(() => {
    svc = new MetaService();
    vi.clearAllMocks();
  });

  it("returns fan_count from page response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "123", fan_count: 4200 }),
    });

    const count = await svc.fetchFollowerCount("PAGE_ID", "TOKEN");

    expect(count).toBe(4200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("PAGE_ID"),
      undefined,
    );
    expect(mockFetch.mock.calls[0][0]).toContain("fan_count");
    expect(mockFetch.mock.calls[0][0]).toContain("TOKEN");
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" });

    await expect(svc.fetchFollowerCount("PAGE_ID", "TOKEN")).rejects.toThrow("401");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd <repo>
npx vitest run tests/follower-fetch.test.ts 2>&1 | tail -20
```

Expected: FAIL — `svc.fetchFollowerCount is not a function`

- [x] **Step 3: Add fetchFollowerCount to MetaService**

In `src/services/meta.ts`, inside the `MetaService` class, add this method (before the closing `}`):

```ts
async fetchFollowerCount(pageId: string, token: string): Promise<number> {
  const url = `${BASE_URL}/${pageId}?fields=fan_count&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fetchFollowerCount failed: ${res.status} ${err}`);
  }
  const data = await res.json() as { fan_count: number };
  return data.fan_count;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd <repo>
npx vitest run tests/follower-fetch.test.ts 2>&1 | tail -20
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/services/meta.ts tests/follower-fetch.test.ts
git commit -m "feat: add fetchFollowerCount to MetaService"
```

---

## Task 5: collectFollowerSnapshot service

**Files:**
- Create: `src/services/follower-fetch.ts`
- Modify: `tests/follower-fetch.test.ts`

- [x] **Step 1: Add tests for collectFollowerSnapshot**

Append to `tests/follower-fetch.test.ts`:

```ts
// Add these imports at the top of the file, after existing imports
import { vi } from "vitest";  // already imported above

vi.mock("../src/db/queries.js", () => ({
  upsertFollowerSnapshot: vi.fn(),
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn().mockReturnValue({
    metaPageId: "MOCK_PAGE_ID",
    metaPageToken: "MOCK_TOKEN",
  }),
}));

vi.mock("../src/services/meta.js", () => ({
  createMetaService: vi.fn().mockReturnValue({
    fetchFollowerCount: vi.fn().mockResolvedValue(3840),
  }),
}));

import { collectFollowerSnapshot } from "../src/services/follower-fetch.js";
import { upsertFollowerSnapshot } from "../src/db/queries.js";

describe("collectFollowerSnapshot", () => {
  it("fetches follower count and upserts snapshot for today", async () => {
    await collectFollowerSnapshot("ns");

    expect(upsertFollowerSnapshot).toHaveBeenCalledWith(
      "ns",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      3840,
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd <repo>
npx vitest run tests/follower-fetch.test.ts 2>&1 | tail -20
```

Expected: FAIL — `collectFollowerSnapshot` not found

- [x] **Step 3: Create src/services/follower-fetch.ts**

```ts
import { getBrand } from "../brands/index.js";
import { createMetaService } from "./meta.js";
import { upsertFollowerSnapshot } from "../db/queries.js";
import type { BrandId } from "../types.js";

export async function collectFollowerSnapshot(brandId: BrandId): Promise<void> {
  const brand = getBrand(brandId);
  const meta = createMetaService();

  const count = await meta.fetchFollowerCount(brand.metaPageId, brand.metaPageToken);
  const today = new Date().toISOString().slice(0, 10);

  upsertFollowerSnapshot(brandId, today, count);
  console.log(`[followers] ${brandId}: ${count} followers on ${today}`);
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd <repo>
npx vitest run tests/follower-fetch.test.ts 2>&1 | tail -20
```

Expected: all PASS

- [x] **Step 5: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/services/follower-fetch.ts tests/follower-fetch.test.ts
git commit -m "feat: add collectFollowerSnapshot service"
```

---

## Task 6: posting_time benchmark dimension

**Files:**
- Modify: `src/services/metrics-collector.ts`
- Create: `tests/metrics-posting-time.test.ts`

- [x] **Step 1: Write failing test**

Create `tests/metrics-posting-time.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMetricsCandidates = vi.fn();
const mockGetLatestMetrics = vi.fn();
const mockUpsertBenchmark = vi.fn();
const mockGetBenchmarks = vi.fn().mockReturnValue([]);
const mockInsertReelMetrics = vi.fn();
const mockUpsertPerformanceScore = vi.fn();
const mockGetMetricsForPeriod = vi.fn().mockReturnValue([]);

vi.mock("../src/db/queries.js", () => ({
  getMetricsCandidates: mockGetMetricsCandidates,
  getLatestMetrics: mockGetLatestMetrics,
  insertReelMetrics: mockInsertReelMetrics,
  upsertBenchmark: mockUpsertBenchmark,
  upsertPerformanceScore: mockUpsertPerformanceScore,
  getBenchmarks: mockGetBenchmarks,
  getMetricsForPeriod: mockGetMetricsForPeriod,
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn().mockReturnValue({ metaPageId: "PID", metaPageToken: "TOK" }),
}));

vi.mock("../src/services/meta.js", () => ({
  createMetaService: vi.fn().mockReturnValue({
    fetchReelInsights: vi.fn().mockResolvedValue({
      views: 1000, likes: 20, comments: 5, shares: 10,
      saves: 2, reach: 900, watchTimeSec: 22, totalWatchTimeSec: 22000,
    }),
  }),
}));

import { collectMetrics } from "../src/services/metrics-collector.js";

describe("posting_time benchmark dimension", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts a posting_time benchmark entry based on scheduledTime hour", async () => {
    mockGetMetricsCandidates.mockReturnValue([{
      id: "reel-1",
      facebookPostId: "fb-1",
      headline: "Test",
      context: JSON.stringify({ pillarBalance: { prioritise: ["Economy"] } }),
      scheduledTime: "2026-05-14 18:00",
    }]);
    mockGetLatestMetrics.mockReturnValue(null); // force fetch

    await collectMetrics("ns");

    const postingTimeCalls = mockUpsertBenchmark.mock.calls.filter(
      ([args]) => args.dimension === "posting_time"
    );
    expect(postingTimeCalls.length).toBeGreaterThan(0);
    expect(postingTimeCalls[0][0].dimensionValue).toBe("18:00");
  });

  it("skips posting_time benchmark when scheduledTime is null", async () => {
    mockGetMetricsCandidates.mockReturnValue([{
      id: "reel-2",
      facebookPostId: "fb-2",
      headline: "Test 2",
      context: null,
      scheduledTime: null,
    }]);
    mockGetLatestMetrics.mockReturnValue(null);

    await collectMetrics("ns");

    const postingTimeCalls = mockUpsertBenchmark.mock.calls.filter(
      ([args]) => args.dimension === "posting_time"
    );
    expect(postingTimeCalls.length).toBe(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd <repo>
npx vitest run tests/metrics-posting-time.test.ts 2>&1 | tail -20
```

Expected: FAIL — posting_time calls not found

- [x] **Step 3: Add posting_time dimension to recomputeBenchmarks**

In `src/services/metrics-collector.ts`, inside the `recomputeBenchmarks` function, inside the `for (const reel of candidates)` loop, add `posting_time` to the `dims` array:

Find this block:
```ts
      const dims: Array<{ dimension: string; value: string | null }> = [
        { dimension: "pillar", value: meta.pillar },
        { dimension: "theme", value: meta.theme },
        { dimension: "category", value: meta.category },
        { dimension: "voice", value: meta.voiceId },
        { dimension: "music", value: meta.musicFile },
      ];
```

Replace with:
```ts
      const postingHour = reel.scheduledTime
        ? reel.scheduledTime.slice(11, 16)  // "HH:MM" from "YYYY-MM-DD HH:MM"
        : null;

      const dims: Array<{ dimension: string; value: string | null }> = [
        { dimension: "pillar", value: meta.pillar },
        { dimension: "theme", value: meta.theme },
        { dimension: "category", value: meta.category },
        { dimension: "voice", value: meta.voiceId },
        { dimension: "music", value: meta.musicFile },
        { dimension: "posting_time", value: postingHour },
      ];
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd <repo>
npx vitest run tests/metrics-posting-time.test.ts 2>&1 | tail -20
```

Expected: PASS

- [x] **Step 5: Run full test suite to confirm no regressions**

```bash
cd <repo>
npx vitest run 2>&1 | tail -20
```

Expected: all existing tests pass.

- [x] **Step 6: Commit**

```bash
git add src/services/metrics-collector.ts tests/metrics-posting-time.test.ts
git commit -m "feat: add posting_time dimension to benchmark computation"
```

---

## Task 7: update dashboard route

**Files:**
- Modify: `api/routes/dashboard.ts`

This task wires the new data (CMP, watch time, follower gain) into the dashboard route. The `DashboardData` interface lives in `dashboard-html-builder.ts` — we'll update it in Task 8. For now we add the data collection logic and pass it through. Temporarily cast to `any` if the builder isn't updated yet, but Task 8 is the next task so they can be done together.

- [x] **Step 1: Add imports**

At the top of `api/routes/dashboard.ts`, add these imports:

```ts
import { getFollowerStats, getFollowerSnapshotsByDate, getTotalWatchMinutes60d } from "../../src/db/queries.js";
```

- [x] **Step 2: Add CMP progress computation**

Inside the `dashboardRouter.get("/dashboard", ...)` handler, after the `const benchmarks = getBenchmarks(...)` line, add:

```ts
  const followerStats = getFollowerStats(brand);
  const watchMinutes60d = getTotalWatchMinutes60d(brand);

  // Per-reel follower attribution
  const followerSnapshots = getFollowerSnapshotsByDate(brand, since30d.slice(0, 10));
  const followerGainByDate = computeDailyFollowerGain(followerSnapshots);
```

- [x] **Step 3: Add computeDailyFollowerGain helper at bottom of file**

After the existing `buildBreakdowns` function, add:

```ts
function computeDailyFollowerGain(
  snapshots: Array<{ date: string; totalFollowers: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < snapshots.length; i++) {
    const gain = snapshots[i].totalFollowers - snapshots[i - 1].totalFollowers;
    map.set(snapshots[i].date, gain);
  }
  return map;
}
```

- [x] **Step 4: Add watchTimeSec and followersGained to reelRows**

Find the `const reelRows: ReelRow[] = recent14d.map(r => {` block. Update the returned object to include new fields:

```ts
  const reelRows: ReelRow[] = recent14d.map(r => {
    const ctx = parseContext(r.reel.context);
    const reelDate = r.reel.createdAt.slice(0, 10);
    const reelsOnSameDay = recent14d.filter(x => x.reel.createdAt.slice(0, 10) === reelDate).length;
    const dailyGain = followerGainByDate.get(reelDate);
    const followersGained = (dailyGain != null && reelsOnSameDay > 0)
      ? Math.round(dailyGain / reelsOnSameDay)
      : null;

    return {
      id: r.reel.id,
      headline: r.reel.headline,
      brand: r.reel.brand,
      pillar: ctx.pillar,
      theme: ctx.theme,
      category: r.reel.category ?? null,
      voiceId: ctx.voiceId,
      views: r.latestMetrics?.views ?? null,
      likes: r.latestMetrics?.likes ?? null,
      shares: r.latestMetrics?.shares ?? null,
      engRate: computeEngRate(r.latestMetrics),
      overallScore: r.score?.overallScore ?? null,
      watchTimeSec: r.latestMetrics?.watchTimeSec ?? null,
      followersGained,
    };
  });
```

- [x] **Step 5: Add cmpProgress to DashboardData object**

Find the `const data: DashboardData = {` block. Add `cmpProgress` and update `scorecard`:

```ts
  const data: DashboardData = {
    brandId: brand,
    cmpProgress: {
      watchMinutes60d,
      totalFollowers: followerStats.totalFollowers,
      followersGained7d: followerStats.gained7d,
      followersGainedPrior7d: followerStats.gainedPrior7d,
    },
    scorecard: {
      totalReels7d: recent7d.length,
      totalReels30d: reelsWithMetrics.length,
      totalViews7d,
      totalViews30d,
      avgEngRate7d: avgEng7d,
      avgEngRate30d: avgEng30d,
      topDimension: topDim,
    },
    dailyViews,
    reels: reelRows,
    breakdowns,
  };
```

- [x] **Step 6: Compile check**

```bash
cd <repo>
npx tsc --noEmit 2>&1 | head -30
```

There will be type errors about `ReelRow` and `DashboardData` missing the new fields — that's expected and will be fixed in Task 8. Check that there are no other unexpected errors.

- [x] **Step 7: Commit**

```bash
git add api/routes/dashboard.ts
git commit -m "feat: add cmpProgress, watchTimeSec, followersGained to dashboard route"
```

---

## Task 8: rewrite dashboard-html-builder.ts

**Files:**
- Rewrite: `src/review/dashboard-html-builder.ts`

This is a complete replacement of the file. The design follows the approved mockup (v2). The CSS is dark-themed, the layout matches: CMP bar → hero chart + KPI stack → reel cards with sort → collapsible breakdown panels.

- [x] **Step 1: Replace the interfaces**

The new file starts with updated interfaces. Replace the entire file with:

```ts
import { escapeHtml } from "./utils.js";

export interface ReelRow {
  id: string;
  headline: string;
  brand: string;
  pillar: string | null;
  theme: string | null;
  category: string | null;
  voiceId: string | null;
  views: number | null;
  likes: number | null;
  shares: number | null;
  engRate: number | null;
  overallScore: number | null;
  watchTimeSec: number | null;
  followersGained: number | null;
}

export interface BreakdownRow {
  value: string;
  avgViews: number | null;
  avgEngRate: number | null;
  avgWatchTime: number | null;
  sampleCount: number;
  trend: "up" | "down" | "flat" | "new";
}

export interface CmpProgress {
  watchMinutes60d: number;
  totalFollowers: number | null;
  followersGained7d: number | null;
  followersGainedPrior7d: number | null;
}

export interface DashboardData {
  brandId: string;
  cmpProgress: CmpProgress;
  scorecard: {
    totalReels7d: number;
    totalReels30d: number;
    totalViews7d: number;
    totalViews30d: number;
    avgEngRate7d: number;
    avgEngRate30d: number;
    topDimension: { dimension: string; value: string; avgEngRate: number } | null;
  };
  dailyViews: Array<{ date: string; views: number }>;
  reels: ReelRow[];
  breakdowns: {
    pillar: BreakdownRow[];
    theme: BreakdownRow[];
    voice: BreakdownRow[];
    music: BreakdownRow[];
    postingTime: BreakdownRow[];
  };
}

export function buildDashboardPage(data: DashboardData): string {
  const brandLabel = data.brandId === "ds" ? "DailySiam" : "WorldBrief";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(brandLabel)} Performance Dashboard</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="shell">
  ${buildHeaderHtml(brandLabel, data.brandId)}
  ${buildCmpHtml(data.cmpProgress)}
  ${buildHeroHtml(data.dailyViews, data.scorecard, data.cmpProgress)}
  ${buildReelListHtml(data.reels, data.brandId)}
  ${buildBreakdownsHtml(data.breakdowns)}
</div>
${DASHBOARD_JS}
</body>
</html>`;
}
```

- [x] **Step 2: Add header and CMP builders**

Continue the file (append after the function above):

```ts
function buildHeaderHtml(brandLabel: string, brandId: string): string {
  return `
  <header class="topbar">
    <div class="topbar-title"><strong>${escapeHtml(brandLabel)}</strong> Performance Dashboard</div>
    <div class="brand-switch">
      <a href="/dashboard?brand=ds" class="${brandId === "ds" ? "active" : ""}">DailySiam</a>
      <a href="/dashboard?brand=ns" class="${brandId === "ns" ? "active" : ""}">WorldBrief</a>
    </div>
  </header>`;
}

function buildCmpHtml(cmp: CmpProgress): string {
  const followerPct = cmp.totalFollowers != null
    ? Math.min(100, (cmp.totalFollowers / 10000) * 100).toFixed(1)
    : "0";
  const watchPct = Math.min(100, (cmp.watchMinutes60d / 600000) * 100).toFixed(1);

  const followerDisplay = cmp.totalFollowers != null
    ? `${formatNum(cmp.totalFollowers)} / 10,000`
    : "No data yet";

  // Estimate months to CMP
  let etaLabel = "—";
  if (cmp.totalFollowers != null && cmp.followersGained7d != null && cmp.followersGained7d > 0) {
    const dailyFollowerRate = cmp.followersGained7d / 7;
    const dailyWatchRate = cmp.watchMinutes60d / 60; // rough daily rate
    const daysForFollowers = (10000 - cmp.totalFollowers) / dailyFollowerRate;
    const daysForWatch = Math.max(0, (600000 - cmp.watchMinutes60d) / Math.max(dailyWatchRate, 1));
    const daysTotal = Math.max(daysForFollowers, daysForWatch);
    etaLabel = `~${(daysTotal / 30).toFixed(1)} months to eligibility`;
  }

  return `
  <section class="cmp-section">
    <div class="cmp-header">
      <span class="cmp-label">Content Monetization Progress</span>
      <span class="cmp-eta">${escapeHtml(etaLabel)}</span>
    </div>
    <div class="cmp-bars">
      <div class="cmp-bar-group">
        <div class="cmp-bar-row">
          <span class="cmp-bar-name">Followers</span>
          <span class="cmp-bar-nums"><strong>${escapeHtml(followerDisplay)}</strong></span>
        </div>
        <div class="cmp-track"><div class="cmp-fill amber" style="width:${followerPct}%"></div></div>
      </div>
      <div class="cmp-bar-group">
        <div class="cmp-bar-row">
          <span class="cmp-bar-name">Watch Minutes (60d)</span>
          <span class="cmp-bar-nums"><strong>${formatNum(Math.round(cmp.watchMinutes60d))} / 600,000</strong></span>
        </div>
        <div class="cmp-track"><div class="cmp-fill blue" style="width:${watchPct}%"></div></div>
      </div>
    </div>
  </section>`;
}
```

- [x] **Step 3: Add hero builder (chart + KPI cards)**

```ts
function buildHeroHtml(
  dailyViews: DashboardData["dailyViews"],
  sc: DashboardData["scorecard"],
  cmp: CmpProgress,
): string {
  const viewsDelta = sc.totalViews30d > 0
    ? ((sc.totalViews7d / (sc.totalViews30d / 4)) - 1) * 100 : 0;
  const engDelta = sc.avgEngRate30d > 0
    ? ((sc.avgEngRate7d / sc.avgEngRate30d) - 1) * 100 : 0;
  const followersDelta = (cmp.followersGained7d != null && cmp.followersGainedPrior7d != null && cmp.followersGainedPrior7d > 0)
    ? ((cmp.followersGained7d / cmp.followersGainedPrior7d) - 1) * 100 : null;

  const maxViews = Math.max(...dailyViews.map(d => d.views), 1);
  const bars = dailyViews.map(d => {
    const pct = (d.views / maxViews) * 100;
    const lbl = d.date.slice(5);
    return `<div class="bar-col" title="${escapeHtml(d.date)}: ${formatNum(d.views)} views">
      <div class="bar" style="height:${pct}%"></div>
      <div class="bar-lbl">${lbl}</div>
    </div>`;
  }).join("");

  const followersKpiValue = cmp.followersGained7d != null
    ? `+${formatNum(cmp.followersGained7d)}`
    : "—";
  const followersDeltaHtml = followersDelta != null
    ? deltaHtml(followersDelta)
    : `<span class="delta-flat">no prior data</span>`;

  return `
  <div class="hero">
    <div class="chart-card">
      <div class="chart-label">Daily views — last 30 days</div>
      <div class="bar-chart">${bars}</div>
    </div>
    <div class="kpi-stack">
      <div class="kpi-card">
        <div class="kpi-label">Views (7d)</div>
        <div class="kpi-value">${formatNum(sc.totalViews7d)}</div>
        <div class="kpi-delta">${deltaHtml(viewsDelta)} vs avg week</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Engagement (7d)</div>
        <div class="kpi-value">${(sc.avgEngRate7d * 100).toFixed(2)}%</div>
        <div class="kpi-delta">${deltaHtml(engDelta)} vs 30d avg</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Reels Published</div>
        <div class="kpi-value">${sc.totalReels7d} <span class="kpi-sub">/ ${sc.totalReels30d}</span></div>
        <div class="kpi-delta kpi-flat">7d / 30d</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Followers Gained (7d)</div>
        <div class="kpi-value kpi-purple">${escapeHtml(followersKpiValue)}</div>
        <div class="kpi-delta">${followersDeltaHtml} vs prior 7d</div>
      </div>
    </div>
  </div>`;
}
```

- [x] **Step 4: Add reel list builder**

```ts
function buildReelListHtml(reels: ReelRow[], brandId: string): string {
  if (!reels.length) {
    return `<section class="reel-section"><div class="section-header"><span class="section-title">Reels — last 14 days</span></div><div class="empty">No reels with metrics yet</div></section>`;
  }

  const reelJson = JSON.stringify(reels.map(r => ({
    id: r.id,
    title: r.headline.slice(0, 80),
    score: r.overallScore,
    views: r.views,
    eng: r.engRate != null ? r.engRate * 100 : null,
    watchTime: r.watchTimeSec,
    followers: r.followersGained,
    pillar: r.pillar ?? "",
    theme: r.theme ?? "",
    color: r.overallScore == null ? "gray" : r.overallScore >= 1.2 ? "green" : r.overallScore >= 0.8 ? "yellow" : "red",
    href: `/review/${brandId}/${r.id}`,
  })));

  return `
  <section class="reel-section">
    <div class="section-header">
      <span class="section-title">Reels — last 14 days</span>
      <div class="sort-controls">
        <button class="sort-btn active" onclick="sortReels('score',this)">Score</button>
        <button class="sort-btn" onclick="sortReels('views',this)">Views</button>
        <button class="sort-btn" onclick="sortReels('eng',this)">Eng %</button>
        <button class="sort-btn" onclick="sortReels('watchTime',this)">Watch Time</button>
        <button class="sort-btn" onclick="sortReels('followers',this)">Followers</button>
      </div>
    </div>
    <div class="score-legend">
      <span class="legend-item"><span class="dot green"></span> ≥1.2x above target</span>
      <span class="legend-item"><span class="dot yellow"></span> ≥0.8x on target</span>
      <span class="legend-item"><span class="dot red"></span> below target</span>
      <span class="legend-item"><span class="dot gray"></span> no score yet</span>
    </div>
    <div class="reels-list" id="reelsList"></div>
    <script>var REEL_DATA = ${reelJson};</script>
  </section>`;
}
```

- [x] **Step 5: Add breakdowns builder**

```ts
function buildBreakdownsHtml(breakdowns: DashboardData["breakdowns"]): string {
  const panels = [
    { id: "pillar", title: "By Pillar", rows: breakdowns.pillar },
    { id: "theme", title: "By Theme", rows: breakdowns.theme },
    { id: "voice", title: "By Voice", rows: breakdowns.voice },
    { id: "music", title: "By Music", rows: breakdowns.music },
  ];
  const mainPanels = panels.map(p => buildBreakdownPanel(p.id, p.title, p.rows)).join("");
  const timingPanel = buildBreakdownPanel("posting-time", "By Posting Time", breakdowns.postingTime);

  return `
  <section class="breakdowns">
    <div class="section-header"><span class="section-title">Breakdowns — last 30 days</span></div>
    <div class="breakdown-grid">${mainPanels}</div>
    <div class="breakdown-full">${timingPanel}</div>
  </section>`;
}

function buildBreakdownPanel(id: string, title: string, rows: BreakdownRow[]): string {
  if (!rows.length) {
    return `<div class="breakdown-panel"><div class="panel-header" onclick="togglePanel('${id}')"><span class="panel-title">${title}</span><span class="panel-toggle">▾</span></div><div class="panel-body"><div class="empty">No data</div></div></div>`;
  }

  const maxEng = Math.max(...rows.map(r => r.avgEngRate ?? 0), 0.0001);
  const body = rows.map(r => {
    const engPct = r.avgEngRate != null ? `${(r.avgEngRate * 100).toFixed(2)}%` : "—";
    const barWidth = r.avgEngRate != null ? ((r.avgEngRate / maxEng) * 100).toFixed(1) : "0";
    const avgV = r.avgViews != null ? formatNum(Math.round(r.avgViews)) : "—";
    return `<div class="bar-row">
      <div class="bar-row-header">
        <span class="bar-row-label">${escapeHtml(r.value)}</span>
        <span class="bar-row-value">${engPct}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${barWidth}%"></div></div>
      <div class="bar-meta">${avgV} avg views · ${r.sampleCount} reels</div>
    </div>`;
  }).join("");

  return `
  <div class="breakdown-panel" id="panel-${id}">
    <div class="panel-header" onclick="togglePanel('panel-${id}')">
      <span class="panel-title">${title}</span>
      <span class="panel-toggle">▾</span>
    </div>
    <div class="panel-body">${body}</div>
  </div>`;
}
```

- [x] **Step 6: Add formatNum, deltaHtml, DASHBOARD_CSS, DASHBOARD_JS**

```ts
function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function deltaHtml(pct: number): string {
  if (Math.abs(pct) < 0.5) return `<span class="delta-flat">—</span>`;
  const cls = pct > 0 ? "delta-up" : "delta-down";
  const sign = pct > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
}

const DASHBOARD_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #080b12; color: #e0e0e0; line-height: 1.5; }
  .shell { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }

  /* Header */
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .topbar-title { font-size: 15px; font-weight: 600; color: #aaa; }
  .topbar-title strong { color: #fff; }
  .brand-switch { display: flex; gap: 6px; }
  .brand-switch a { padding: 5px 14px; border-radius: 5px; font-size: 12px; font-weight: 500; text-decoration: none; }
  .brand-switch a.active { background: #2563eb; color: #fff; }
  .brand-switch a:not(.active) { background: #161922; color: #666; border: 1px solid #1f2333; }

  /* CMP */
  .cmp-section { background: #111420; border: 1px solid #1c2030; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .cmp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .cmp-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .8px; }
  .cmp-eta { font-size: 11px; color: #eab308; font-weight: 500; }
  .cmp-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .cmp-bar-group { display: flex; flex-direction: column; gap: 5px; }
  .cmp-bar-row { display: flex; justify-content: space-between; }
  .cmp-bar-name { font-size: 12px; color: #bbb; }
  .cmp-bar-nums { font-size: 11px; color: #666; }
  .cmp-bar-nums strong { color: #bbb; }
  .cmp-track { background: #161922; border-radius: 4px; height: 8px; }
  .cmp-fill { height: 8px; border-radius: 4px; }
  .cmp-fill.amber { background: linear-gradient(90deg, #78350f, #eab308); }
  .cmp-fill.blue { background: linear-gradient(90deg, #1e3a6e, #2563eb); }

  /* Hero */
  .hero { display: grid; grid-template-columns: 1fr 220px; gap: 16px; margin-bottom: 28px; }
  .chart-card { background: #111420; border: 1px solid #1c2030; border-radius: 12px; padding: 20px; }
  .chart-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 16px; }
  .bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 100px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; cursor: default; }
  .bar { width: 100%; background: #1e3a6e; border-radius: 3px 3px 0 0; min-height: 2px; transition: background .15s; }
  .bar:hover { background: #2563eb; }
  .bar-lbl { font-size: 8px; color: #333; margin-top: 4px; }
  .kpi-stack { display: flex; flex-direction: column; gap: 10px; }
  .kpi-card { background: #111420; border: 1px solid #1c2030; border-radius: 10px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .kpi-sub { font-size: 14px; color: #444; font-weight: 400; }
  .kpi-purple { color: #a78bfa; }
  .kpi-delta { font-size: 11px; margin-top: 3px; }
  .kpi-flat { color: #555; }
  .delta-up { color: #22c55e; }
  .delta-down { color: #ef4444; }
  .delta-flat { color: #555; }

  /* Reel section */
  .reel-section { margin-bottom: 28px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .section-title { font-size: 12px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .8px; }
  .sort-controls { display: flex; gap: 6px; }
  .sort-btn { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid #1f2333; background: #111420; color: #666; cursor: pointer; }
  .sort-btn.active { background: #1e3a6e; border-color: #2563eb; color: #93c5fd; }
  .score-legend { display: flex; gap: 14px; margin-bottom: 12px; font-size: 10px; color: #555; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .dot.green { background: #22c55e; } .dot.yellow { background: #eab308; }
  .dot.red { background: #ef4444; } .dot.gray { background: #333; }
  .reels-list { display: flex; flex-direction: column; gap: 8px; }
  .reel-card { display: flex; align-items: center; background: #111420; border: 1px solid #1c2030; border-radius: 8px; overflow: hidden; text-decoration: none; color: inherit; }
  .reel-card:hover { border-color: #2a3050; }
  .reel-stripe { width: 4px; align-self: stretch; flex-shrink: 0; }
  .reel-stripe.green { background: #22c55e; } .reel-stripe.yellow { background: #eab308; }
  .reel-stripe.red { background: #ef4444; } .reel-stripe.gray { background: #272b3a; }
  .reel-body { display: flex; align-items: center; gap: 12px; padding: 11px 16px; flex: 1; min-width: 0; }
  .reel-score { width: 44px; flex-shrink: 0; text-align: center; }
  .score-badge { display: inline-block; padding: 3px 6px; border-radius: 5px; font-size: 11px; font-weight: 700; }
  .score-badge.green { background: #22c55e1a; color: #22c55e; border: 1px solid #22c55e33; }
  .score-badge.yellow { background: #eab3081a; color: #eab308; border: 1px solid #eab30833; }
  .score-badge.red { background: #ef44441a; color: #ef4444; border: 1px solid #ef444433; }
  .score-badge.gray { background: #1a1d27; color: #555; border: 1px solid #272b3a; }
  .reel-headline { flex: 1; min-width: 0; }
  .reel-title { font-size: 13px; color: #d0d0d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .reel-chips { display: flex; gap: 5px; margin-top: 4px; }
  .chip { font-size: 9px; padding: 2px 7px; border-radius: 3px; background: #161922; color: #666; border: 1px solid #1f2333; text-transform: uppercase; }
  .reel-metrics { display: flex; gap: 16px; flex-shrink: 0; }
  .metric { text-align: right; }
  .metric-val { font-size: 13px; font-weight: 600; color: #c0c0c0; }
  .metric-val.blue { color: #7aa3d4; } .metric-val.purple { color: #a78bfa; }
  .metric-lbl { font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: .4px; margin-top: 1px; }

  /* Breakdowns */
  .breakdowns { margin-top: 8px; }
  .breakdown-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .breakdown-full { }
  .breakdown-panel { background: #111420; border: 1px solid #1c2030; border-radius: 10px; overflow: hidden; }
  .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #1c2030; user-select: none; }
  .panel-header:hover { background: #13172080; }
  .panel-title { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: .7px; }
  .panel-toggle { font-size: 11px; color: #333; transition: transform .2s; }
  .panel-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
  .breakdown-panel.collapsed .panel-body { display: none; }
  .breakdown-panel.collapsed .panel-toggle { transform: rotate(-90deg); }
  .bar-row { display: flex; flex-direction: column; gap: 3px; }
  .bar-row-header { display: flex; justify-content: space-between; align-items: baseline; }
  .bar-row-label { font-size: 12px; color: #c0c0c0; }
  .bar-row-value { font-size: 11px; font-weight: 600; color: #7aa3d4; }
  .bar-track { background: #161922; border-radius: 3px; height: 6px; }
  .bar-fill { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #1e3a6e, #2563eb); }
  .bar-meta { font-size: 9px; color: #444; }

  .empty { color: #666; font-size: 13px; padding: 16px 0; }

  @media (max-width: 768px) {
    .hero { grid-template-columns: 1fr; }
    .kpi-stack { display: grid; grid-template-columns: 1fr 1fr; }
    .cmp-bars { grid-template-columns: 1fr; }
    .breakdown-grid { grid-template-columns: 1fr; }
  }
`;

const DASHBOARD_JS = `<script>
function sc(s){return s===null?'gray':s>=1.2?'green':s>=0.8?'yellow':'red';}
function st(s){return s===null?'—':s.toFixed(2)+'x';}
function fv(v){return v===null?'—':v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(Math.round(v));}
function fe(e){return e===null?'—':e.toFixed(1)+'%';}
function fw(w){return w===null?'—':Math.round(w)+'s';}
function ff(f){return f===null?'—':'+'+f;}

function renderReels(sorted){
  const list=document.getElementById('reelsList');
  if(!list)return;
  list.innerHTML=sorted.map(r=>\`
    <a class="reel-card" href="\${r.href}">
      <div class="reel-stripe \${r.color}"></div>
      <div class="reel-body">
        <div class="reel-score"><span class="score-badge \${sc(r.score)}">\${st(r.score)}</span></div>
        <div class="reel-headline">
          <div class="reel-title">\${r.title}</div>
          <div class="reel-chips">
            \${r.pillar?'<span class="chip">'+r.pillar+'</span>':''}
            \${r.theme?'<span class="chip">'+r.theme+'</span>':''}
          </div>
        </div>
        <div class="reel-metrics">
          <div class="metric"><div class="metric-val">\${fv(r.views)}</div><div class="metric-lbl">Views</div></div>
          <div class="metric"><div class="metric-val">\${fe(r.eng)}</div><div class="metric-lbl">Eng</div></div>
          <div class="metric"><div class="metric-val blue">\${fw(r.watchTime)}</div><div class="metric-lbl">Watch</div></div>
          <div class="metric"><div class="metric-val purple">\${ff(r.followers)}</div><div class="metric-lbl">Followers</div></div>
        </div>
      </div>
    </a>\`).join('');
}

function sortReels(by,btn){
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderReels([...REEL_DATA].sort((a,b)=>((b[by]??-Infinity)-(a[by]??-Infinity))));
}

function togglePanel(id){document.getElementById(id).classList.toggle('collapsed');}

if(typeof REEL_DATA!=='undefined')renderReels(REEL_DATA);
</script>`;
```

- [x] **Step 7: Update breakdowns builder in dashboard.ts to include postingTime**

In `api/routes/dashboard.ts`, update `buildBreakdowns` to also return `postingTime`:

```ts
function buildBreakdowns(benchmarks: Array<{ dimension: string; dimensionValue: string; avgViews: number | null; avgEngagementRate: number | null; avgWatchTime: number | null; sampleCount: number }>): DashboardData["breakdowns"] {
  const byDimension = new Map<string, Array<{ value: string; avgViews: number | null; avgEngRate: number | null; avgWatchTime: number | null; sampleCount: number }>>();
  for (const b of benchmarks) {
    if (!byDimension.has(b.dimension)) byDimension.set(b.dimension, []);
    byDimension.get(b.dimension)!.push({
      value: b.dimensionValue,
      avgViews: b.avgViews,
      avgEngRate: b.avgEngagementRate,
      avgWatchTime: b.avgWatchTime,
      sampleCount: b.sampleCount,
    });
  }

  const toRows = (dim: string): BreakdownRow[] => {
    const entries = byDimension.get(dim) ?? [];
    return entries
      .sort((a, b) => (b.avgEngRate ?? 0) - (a.avgEngRate ?? 0))
      .map(e => ({
        value: e.value,
        avgViews: e.avgViews,
        avgEngRate: e.avgEngRate,
        avgWatchTime: e.avgWatchTime,
        sampleCount: e.sampleCount,
        trend: e.sampleCount < 3 ? "new" as const : "flat" as const,
      }));
  };

  return {
    pillar: toRows("pillar"),
    theme: toRows("theme"),
    voice: toRows("voice"),
    music: toRows("music"),
    postingTime: toRows("posting_time"),
  };
}
```

- [x] **Step 8: Full compile check**

```bash
cd <repo>
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [x] **Step 9: Run full test suite**

```bash
cd <repo>
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 10: Commit**

```bash
git add src/review/dashboard-html-builder.ts api/routes/dashboard.ts
git commit -m "feat: rewrite dashboard with new layout — CMP bar, reel cards, collapsible breakdowns"
```

---

## Post-Plan Work Session 2 (2026-05-17 — metrics accuracy fixes)

The following bugs were found during production use after the initial deploy and fixed in a single follow-up session.

### Task A: Fix dual-period overwrite in `fetchReelInsights`

**File:** `src/services/meta.ts`

`GET /{pagePostId}/insights` returns entries for each metric twice: `period=lifetime` and `period=day`. The for-loop processed both, so the daily entry (e.g. 1 view) overwrote the lifetime entry (e.g. 693 views). Fix: `if (metric.period !== "lifetime") continue;`.

### Task B: Switch to `/{videoId}/video_insights` endpoint

**File:** `src/services/meta.ts`

Replaced the `/{pagePostId}/insights` call with `/{videoId}/video_insights?metric=blue_reels_play_count,post_video_avg_time_watched,post_video_view_time,post_impressions_unique,post_video_followers`. Benefits:
- `blue_reels_play_count` → actual Reels play count (more accurate than generic `post_video_views`)
- `post_video_avg_time_watched` (ms) → `watchTimeSec` directly — no manual division needed
- `post_video_followers` → exact per-reel follower attribution (replaces the daily-gain-split approximation)

Updated `fetchReelInsights` return type to add `followersGained: number | null`. Added HTTP non-OK logging and `data.error` detection so token expiry is no longer silent.

### Task C: Add `followers_gained` column to `reel_metrics`

**Files:** `src/db/schema.ts`, `src/db/client.ts`, `src/db/queries.ts`

- Schema: `followersGained: integer("followers_gained")` added to `reelMetrics` table
- Migration: `try { sqlite.exec('ALTER TABLE reel_metrics ADD COLUMN followers_gained INTEGER'); } catch {}`
- `insertReelMetrics` params extended with `followersGained?: number | null`

### Task D: Wire `followersGained` through to dashboard

**Files:** `src/services/metrics-collector.ts`, `api/routes/dashboard.ts`, `src/review/dashboard-html-builder.ts`

- Collector: removed manual `avgWatchSec = totalWatchTimeSec / views` (now provided directly by API); passes `followersGained: insights.followersGained`
- Route: `followersGained: r.latestMetrics?.followersGained ?? null` (was hardcoded `null`)
- Builder: Followers sort button re-added (was removed when the column was temporarily null)

### Task E: Fix `forcePillar` in pillar parsing

**File:** `src/services/metrics-collector.ts`

`parseReelMeta` only read `pillarBalance.prioritise[0]`. NS reels using `{"prioritise":[],"forcePillar":"Controversy"}` got `pillar: null` and were skipped by both benchmark and score computation. Fix: `pb?.prioritise?.[0] ?? pb?.forcePillar ?? fallback`.

### Task F: Fix `getMetricsCandidates` to use `publishedAt`

**Files:** `src/db/queries.ts`, `src/services/metrics-collector.ts`

Original query filtered by `reels.updatedAt`. DS reels hadn't been touched since April → their `updated_at` was before the `since` cutoff → 0 DS candidates. Changes:
- Filter changed from `gte(reels.updatedAt, since) + lte(reels.updatedAt, until)` to `isNotNull(reels.publishedAt) + gte(reels.publishedAt, since) + lte(reels.publishedAt, until)`
- `FETCH_WINDOW_MAX_DAYS` extended 14 → 30 to match the 30d benchmark/scoring window

---

## Post-Plan Work (Session 1 — completed after initial 8 tasks)

The following work was done after all 8 tasks were deployed, in response to issues discovered in production:

### Brand theming + logo display
Added `brandThemeCss(brandId)` and `brandLogoHtml(brandId, cls)` to `src/review/utils.ts`. Both dashboard and reel review page now inject per-brand CSS custom properties and embed brand logos (base64 PNGs from `assets/brands/`). Brand name corrected from "DailySiam" → "ThaiDaily" throughout.

### Reel card link fix
Dashboard was linking to `/review/${brandId}/${r.id}` (post-pipeline run route) — all reel clicks 404'd. Fixed to `/review/reel/${r.id}`. Root cause: two distinct review routes exist and the wrong one was referenced.

### Reel review page brand theming
`src/review/reel-html-builder.ts` updated to call `brandThemeCss(ctx.brand.id)` and `brandLogoHtml(ctx.brand.id, "header-logo")`. Header background changed from a hardcoded blue gradient to `linear-gradient(135deg, var(--c-accent-dim) 0%, #0d1020 100%)` with a 2px `var(--c-accent)` bottom border.

### Contrast improvements
- All secondary text colors bumped from `#333`–`#555` range to `#777`–`#999`
- `--c-accent-dim` (used as bar fill) was nearly invisible against card background — added `--c-bar` CSS var (`#7A1020` NS / `#1040A0` DS)
- Date labels: `#333` → `#777`

### Daily follower gain chart
Added a second bar chart below the daily views chart showing net follower gain per day, derived from consecutive `follower_snapshots` rows via `computeDailyFollowerGain`. Data wired through `DashboardData.dailyFollowerGain`.

### DS data restore
115 ThaiDaily reels were missing from the live DB (lost when schema was reset post May 2nd). Restored from backup using:
```sql
ATTACH '<repo>/data/backups/pipeline-2026-05-01-102923.db' AS bak;
INSERT OR IGNORE INTO reels SELECT * FROM bak.reels WHERE brand='ds';
```
No code changes required.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| CMP progress bar (followers + watch minutes) | Tasks 1-3, 7, 8 |
| Estimated months to eligibility | Task 8 `buildCmpHtml` |
| Hero: trend chart + 4 KPI cards | Task 8 `buildHeroHtml` |
| Followers Gained (7d) KPI card | Tasks 2, 7, 8 |
| Reel cards with color border + score badge | Task 8 `buildReelListHtml` |
| 4 metrics per card: Views, Eng%, Watch, Followers | Task 8 `DASHBOARD_JS` |
| Sort by Score/Views/Eng/WatchTime/Followers | Task 8 `DASHBOARD_JS` |
| Score legend (≥1.2x, ≥0.8x, below) | Task 8 |
| Collapsible breakdown panels | Task 8 `buildBreakdownPanel` + `togglePanel` JS |
| By Pillar/Theme/Voice/Music breakdowns | Tasks 7, 8 |
| By Posting Time breakdown | Tasks 3, 6, 7, 8 |
| Horizontal bar charts in breakdowns | Task 8 `buildBreakdownPanel` |
| 5th panel full-width | Task 8 `buildBreakdownsHtml` |
| follower_snapshots table | Task 1 |
| daily follower fetch job | Task 5 |
| Per-reel follower attribution | Task 7 |
| posting_time benchmark dimension | Task 6 |
| watchTimeSec in reel rows | Tasks 3, 7 |
| `getFollowerStats` query | Task 2 |
| `getTotalWatchMinutes60d` query | Task 3 |

**Placeholder scan:** None found — all steps contain concrete code.

**Type consistency check:**
- `BreakdownRow.avgWatchTime` added in Task 8 interfaces, consumed in Task 8 builder (not yet used in bar rendering — intentionally omitted from bar display per spec, which only shows eng% and avg views in bar meta).
- `DashboardData.breakdowns.postingTime` defined in Task 8 interfaces, populated in Task 7 `buildBreakdowns`.
- `ReelRow.watchTimeSec` and `ReelRow.followersGained` defined in Task 8 interfaces, populated in Task 7 route.
- `getMetricsCandidates` now returns `scheduledTime` (Task 3) — `metrics-collector.ts` uses it via `reel.scheduledTime` (Task 6). ✓
# Session 4: Data Health Card Addendum

**Goal:** Add an always-visible, brand-scoped Data Health card to the dashboard so stale metrics/follower data is visible without checking logs.

**Files:**
- Modify: `src/db/queries.ts` — add `getDashboardHealth(brand)` for latest metrics/follower fetch timestamps.
- Modify: `api/routes/dashboard.ts` — build two health items with cadence-aware thresholds.
- Modify: `src/review/dashboard-html-builder.ts` — render the Data Health card and styles.
- Modify: `docs/superpowers/specs/2026-05-15-dashboard-redesign-design.md` — document Session 4 behavior.

## Task 15: Dashboard Data Health card

- [x] **Step 1: Add health timestamp query**

Add `getDashboardHealth(brand)` in `src/db/queries.ts`. It returns latest `reel_metrics.fetched_at` joined through `reels.brand` and latest `follower_snapshots.fetched_at` for the active brand.

- [x] **Step 2: Build health items in dashboard route**

In `api/routes/dashboard.ts`, call `getDashboardHealth(brand)` and convert timestamps into `DataHealthItem[]` with thresholds:
- Reel metrics: warning at 12h, critical at 24h.
- Followers: warning at 36h, critical at 72h.
- Missing data: `missing`, updated label `Never`.

- [x] **Step 3: Render Data Health card**

In `src/review/dashboard-html-builder.ts`, add `DataHealthItem`, `DashboardData.dataHealth`, and `buildDataHealthHtml(...)`. Render it below the header and before CMP progress.

- [x] **Step 4: Verify and deploy**

Run `npm run build`. Restart production with `pm2 restart pipeline` after build succeeds.

---
