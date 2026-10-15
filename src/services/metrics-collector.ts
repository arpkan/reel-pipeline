import { createMetaService } from "./meta.js";
import { getBrand } from "../brands/index.js";
import {
  getMetricsCandidates,
  getLatestMetrics,
  insertReelMetrics,
  upsertBenchmark,
  upsertPerformanceScore,
  getBenchmarks,
  getMetricsForPeriod,
} from "../db/queries.js";
import type { BrandId } from "../types.js";

const FETCH_WINDOW_MIN_HOURS = 12;
const FETCH_WINDOW_MAX_DAYS = 30;
const REFETCH_INTERVAL_HOURS = 6;

interface ReelMeta {
  theme: string | null;
  category: string | null;
  voiceId: string | null;
  musicFile: string | null;
}

function parseReelMeta(contextJson: string | null, categoryFallback?: string | null): ReelMeta {
  const fallback = categoryFallback ?? null;
  if (!contextJson) return { theme: null, category: fallback, voiceId: null, musicFile: null };
  try {
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    return {
      theme: (ctx.theme as string) ?? null,
      category: (ctx.category as string) ?? fallback,
      voiceId: (ctx.usedVoiceId as string) ?? null,
      musicFile: (ctx.musicFile as string) ?? null,
    };
  } catch {
    return { theme: null, category: fallback, voiceId: null, musicFile: null };
  }
}

export async function collectMetrics(brandId: BrandId): Promise<void> {
  const brand = getBrand(brandId);
  const meta = createMetaService();

  const now = new Date();
  const since = new Date(now.getTime() - FETCH_WINDOW_MAX_DAYS * 86400000).toISOString();
  const until = new Date(now.getTime() - FETCH_WINDOW_MIN_HOURS * 3600000).toISOString();

  const candidates = getMetricsCandidates(brandId, since, until);
  console.log(`[metrics] ${brandId}: ${candidates.length} candidates`);

  let fetched = 0;
  for (const reel of candidates) {
    if (!reel.facebookPostId) continue;

    const latest = getLatestMetrics(reel.id);
    if (latest) {
      const hoursSinceFetch = (now.getTime() - new Date(latest.fetchedAt).getTime()) / 3600000;
      if (hoursSinceFetch < REFETCH_INTERVAL_HOURS) continue;
    }

    try {
      const insights = await meta.fetchReelInsights(reel.facebookPostId, brand.metaPageId, brand.metaPageToken);
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
        followersGained: insights.followersGained,
      });
      fetched++;
    } catch (err) {
      console.warn(`[metrics] failed for reel ${reel.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[metrics] ${brandId}: fetched ${fetched} reels`);

  await recomputeBenchmarks(brandId);
  await recomputeScores(brandId);
}

async function recomputeBenchmarks(brandId: BrandId): Promise<void> {
  const now = new Date();

  for (const periodDays of [7, 30]) {
    const period = `${periodDays}d`;
    const since = new Date(now.getTime() - periodDays * 86400000).toISOString();
    const until = new Date(now.getTime() - FETCH_WINDOW_MIN_HOURS * 3600000).toISOString();

    const candidates = getMetricsCandidates(brandId, since, until);
    const dimensionMap = new Map<string, Array<{ views: number; likes: number; comments: number; shares: number; reach: number; watchTime: number }>>();

    for (const reel of candidates) {
      if (!reel.facebookPostId) continue;
      const latest = getLatestMetrics(reel.id);
      if (!latest || latest.views == null) continue;

      const meta = parseReelMeta(reel.context, reel.category);
      const eng = (latest.likes ?? 0) + (latest.comments ?? 0) + (latest.shares ?? 0);
      const entry = {
        views: latest.views,
        likes: latest.likes ?? 0,
        comments: latest.comments ?? 0,
        shares: latest.shares ?? 0,
        reach: latest.reach ?? 0,
        watchTime: latest.watchTimeSec ?? 0,
      };

      const postingHour = reel.publishedAt
        ? toPostingTimeBucket(reel.publishedAt, getBrand(brandId).timezone)
        : null;

      const dims: Array<{ dimension: string; value: string | null }> = [
        { dimension: "theme", value: meta.theme },
        { dimension: "category", value: meta.category },
        { dimension: "voice", value: meta.voiceId },
        { dimension: "music", value: meta.musicFile },
        { dimension: "posting_time", value: postingHour },
      ];

      for (const { dimension, value } of dims) {
        if (!value) continue;
        const key = `${dimension}:${value}`;
        if (!dimensionMap.has(key)) dimensionMap.set(key, []);
        dimensionMap.get(key)!.push(entry);
      }
    }

    for (const [key, entries] of dimensionMap) {
      const colonIdx = key.indexOf(":");
      const dimension = key.slice(0, colonIdx);
      const value = key.slice(colonIdx + 1);
      const n = entries.length;
      const avgViews = entries.reduce((s, e) => s + e.views, 0) / n;
      const avgEngRate = entries.reduce((s, e) => {
        const totalEng = e.likes + e.comments + e.shares;
        return s + (e.views > 0 ? totalEng / e.views : 0);
      }, 0) / n;
      const avgWatchTime = entries.reduce((s, e) => s + e.watchTime, 0) / n;

      upsertBenchmark({
        brandId,
        dimension,
        dimensionValue: value,
        period,
        avgViews,
        avgEngagementRate: avgEngRate,
        avgWatchTime,
        sampleCount: n,
      });
    }
  }
}

async function recomputeScores(brandId: BrandId): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const until = new Date(now.getTime() - 48 * 3600000).toISOString();

  const benchmarks = getBenchmarks(brandId, "30d");
  const categoryBenchmarks = new Map<string, { avgViews: number; avgEngRate: number }>();
  for (const b of benchmarks) {
    if (b.dimension === "category" && b.avgViews != null && b.avgEngagementRate != null) {
      categoryBenchmarks.set(b.dimensionValue, { avgViews: b.avgViews, avgEngRate: b.avgEngagementRate });
    }
  }

  const candidates = getMetricsCandidates(brandId, since, until);

  for (const reel of candidates) {
    if (!reel.facebookPostId) continue;
    const latest = getLatestMetrics(reel.id);
    if (!latest || latest.views == null) continue;

    const meta = parseReelMeta(reel.context, reel.category);
    if (!meta.category) continue;

    const bench = categoryBenchmarks.get(meta.category);
    if (!bench || bench.avgViews === 0) continue;

    const totalEng = (latest.likes ?? 0) + (latest.comments ?? 0) + (latest.shares ?? 0);
    const reelEngRate = latest.views > 0 ? totalEng / latest.views : 0;

    const viewsRatio = latest.views / bench.avgViews;
    const engagementRatio = bench.avgEngRate > 0 ? reelEngRate / bench.avgEngRate : 0;
    const overallScore = 0.5 * viewsRatio + 0.5 * engagementRatio;

    upsertPerformanceScore({
      reelId: reel.id,
      viewsRatio,
      engagementRatio,
      overallScore,
    });
  }
}

function toPostingTimeBucket(publishedAt: string, timezone: string): string {
  const localHour = parseInt(
    new Date(publishedAt).toLocaleTimeString("en-CA", { timeZone: timezone, hour: "2-digit", hour12: false }),
    10,
  );
  if (localHour < 6)  return "Night (00–05)";
  if (localHour < 9)  return "Early Morning (06–08)";
  if (localHour < 12) return "Morning (09–11)";
  if (localHour < 15) return "Midday (12–14)";
  if (localHour < 18) return "Afternoon (15–17)";
  if (localHour < 21) return "Evening (18–20)";
  return "Late Night (21–23)";
}
