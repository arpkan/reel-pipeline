import { Hono } from "hono";
import type { BrandId } from "../../src/types.js";
import { getBrand } from "../../src/brands/index.js";
import { getPublishedReelsWithMetrics, getBenchmarks, getFollowerStats, getFollowerSnapshotsByDate, getTotalWatchMinutes60d, getDashboardHealth } from "../../src/db/queries.js";
import { buildDashboardPage, type DashboardData, type ReelRow, type BreakdownRow, type DataHealthItem } from "../../src/review/dashboard-html-builder.js";

export const dashboardRouter = new Hono();

const DASHBOARD_COOKIE = "dashboard_auth";

async function authGuard(c: any, next: any) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return next();
  const token = c.req.query("token");
  if (token === secret) {
    await next();
    c.res.headers.append("Set-Cookie", `${DASHBOARD_COOKIE}=${secret}; Path=/dashboard; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return;
  }
  const cookie = c.req.header("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${DASHBOARD_COOKIE}=([^;]+)`));
  if (match?.[1] === secret) return next();
  return c.text("Unauthorized — pass ?token=<secret>", 401);
}

dashboardRouter.use("/dashboard", authGuard);

dashboardRouter.get("/dashboard", (c) => {
  const brand = (c.req.query("brand") ?? "ds") as BrandId;
  if (brand !== "ds" && brand !== "ns") return c.json({ error: "Invalid brand" }, 400);

  const now = new Date();
  const since14d = new Date(now.getTime() - 14 * 86400000).toISOString();
  const since30d = new Date(now.getTime() - 30 * 86400000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 86400000).toISOString();

  const reelsWithMetrics = getPublishedReelsWithMetrics(brand, since30d);

  const recent14d = reelsWithMetrics.filter(r => r.reel.createdAt >= since14d);
  const recent7d = reelsWithMetrics.filter(r => r.reel.createdAt >= since7d);

  const totalViews7d = recent7d.reduce((s, r) => s + (r.latestMetrics?.views ?? 0), 0);
  const totalViews30d = reelsWithMetrics.reduce((s, r) => s + (r.latestMetrics?.views ?? 0), 0);

  const engRates7d = recent7d
    .map(r => computeEngRate(r.latestMetrics))
    .filter((e): e is number => e !== null);
  const engRates30d = reelsWithMetrics
    .map(r => computeEngRate(r.latestMetrics))
    .filter((e): e is number => e !== null);
  const avgEng7d = engRates7d.length ? engRates7d.reduce((a, b) => a + b, 0) / engRates7d.length : 0;
  const avgEng30d = engRates30d.length ? engRates30d.reduce((a, b) => a + b, 0) / engRates30d.length : 0;

  const benchmarks = getBenchmarks(brand, "30d");
  const topDim = findTopEngagementDimension(benchmarks);

  const dailyViews = computeDailyViews(reelsWithMetrics, since30d);

  // CMP and follower data
  const followerStats = getFollowerStats(brand);
  const watchMinutes60d = getTotalWatchMinutes60d(brand);
  // Fetch one extra day before since30d so the first day's gain can be computed
  const since31d = new Date(now.getTime() - 31 * 86400000).toISOString().slice(0, 10);
  const followerSnapshots = getFollowerSnapshotsByDate(brand, since31d);
  const followerGainByDate = computeDailyFollowerGain(followerSnapshots, since30d);

  const brandConfig = getBrand(brand);
  const tz = brandConfig.timezone;
  const reelRows: ReelRow[] = recent14d.map(r => {
    const ctx = parseContext(r.reel.context);
    const publishedLabel = r.reel.publishedAt
      ? formatDateTz(r.reel.publishedAt, tz)
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
      followersGained: r.latestMetrics?.followersGained ?? null,
      publishedLabel,
      publishedAt: r.reel.publishedAt ?? null,
    };
  });

  const breakdowns = buildBreakdowns(benchmarks);
  const dataHealth = buildDataHealth(getDashboardHealth(brand), now);

  const data: DashboardData = {
    brandId: brand,
    dataHealth,
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
    dailyFollowerGain: Array.from(followerGainByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, gain]) => ({ date, gain })),
    reels: reelRows,
    breakdowns,
  };

  c.header("Cache-Control", "no-store");
  return c.html(buildDashboardPage(data));
});

function computeEngRate(m: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null } | null): number | null {
  if (!m || m.views == null || m.views === 0) return null;
  const eng = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
  return eng / m.views;
}

function parseContext(contextJson: string | null): {
  pillar: string | null; theme: string | null; voiceId: string | null; musicFile: string | null;
} {
  if (!contextJson) return { pillar: null, theme: null, voiceId: null, musicFile: null };
  try {
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    const pb = ctx.pillarBalance as { prioritise?: string[] } | undefined;
    return {
      pillar: pb?.prioritise?.[0] ?? null,
      theme: (ctx.theme as string) ?? null,
      voiceId: (ctx.usedVoiceId as string) ?? null,
      musicFile: (ctx.musicFile as string) ?? null,
    };
  } catch {
    return { pillar: null, theme: null, voiceId: null, musicFile: null };
  }
}

function computeDailyViews(reels: Array<{ reel: { createdAt: string }; latestMetrics: { views?: number | null } | null }>, since: string): Array<{ date: string; views: number }> {
  const map = new Map<string, number>();
  for (const r of reels) {
    const date = r.reel.createdAt.slice(0, 10);
    const views = r.latestMetrics?.views ?? 0;
    map.set(date, (map.get(date) ?? 0) + views);
  }
  const days: Array<{ date: string; views: number }> = [];
  const start = new Date(since.slice(0, 10));
  const now = new Date();
  for (let d = new Date(start); d <= now; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, views: map.get(key) ?? 0 });
  }
  return days;
}

function computeDailyFollowerGain(
  snapshots: Array<{ date: string; totalFollowers: number }>,
  since: string,
): Map<string, number> {
  const raw = new Map<string, number>();
  for (let i = 1; i < snapshots.length; i++) {
    const gain = snapshots[i].totalFollowers - snapshots[i - 1].totalFollowers;
    raw.set(snapshots[i].date, gain);
  }
  const result = new Map<string, number>();
  const start = new Date(since.slice(0, 10));
  const now = new Date();
  const lastKnown = snapshots.length > 0 ? snapshots[snapshots.length - 1].totalFollowers : null;
  for (let d = new Date(start); d <= now; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    result.set(key, raw.get(key) ?? 0);
  }
  return result;
}

function findTopEngagementDimension(benchmarks: Array<{ dimension: string; dimensionValue: string; avgEngagementRate: number | null }>): DashboardData["scorecard"]["topDimension"] {
  let best: { dimension: string; value: string; rate: number } | null = null;
  for (const b of benchmarks) {
    if (b.avgEngagementRate == null) continue;
    if (!best || b.avgEngagementRate > best.rate) {
      best = { dimension: b.dimension, value: b.dimensionValue, rate: b.avgEngagementRate };
    }
  }
  return best ? { dimension: best.dimension, value: best.value, avgEngRate: best.rate } : null;
}

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
    theme: toRows("theme"),
    voice: toRows("voice"),
    music: toRows("music"),
    postingTime: toRows("posting_time"),
  };
}

function buildDataHealth(
  health: { latestMetricsFetchedAt: string | null; latestFollowerFetchedAt: string | null },
  now: Date,
): DataHealthItem[] {
  return [
    makeHealthItem("Reel metrics", health.latestMetricsFetchedAt, now, 12, 24, "Views, engagement, watch time, scores"),
    makeHealthItem("Followers", health.latestFollowerFetchedAt, now, 36, 72, "Follower chart and CMP progress"),
  ];
}

function makeHealthItem(
  label: string,
  fetchedAt: string | null,
  now: Date,
  warningHours: number,
  criticalHours: number,
  detail: string,
): DataHealthItem {
  if (!fetchedAt) {
    return { label, status: "missing", detail: `${detail} - no data yet`, updatedLabel: "Never" };
  }

  const ageHours = Math.max(0, (now.getTime() - Date.parse(fetchedAt)) / 3600000);
  const status = ageHours >= criticalHours ? "critical" : ageHours >= warningHours ? "warning" : "ok";
  return {
    label,
    status,
    detail,
    updatedLabel: `${formatAge(ageHours)} ago`,
  };
}

function formatAge(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDateTz(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
}
