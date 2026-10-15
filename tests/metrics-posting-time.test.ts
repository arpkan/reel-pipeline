import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/queries.js");
vi.mock("../src/brands/index.js");
vi.mock("../src/services/meta.js");

import { collectMetrics } from "../src/services/metrics-collector.js";
import * as queriesModule from "../src/db/queries.js";
import * as brandsModule from "../src/brands/index.js";
import * as metaModule from "../src/services/meta.js";

const mockGetMetricsCandidates = vi.mocked(queriesModule.getMetricsCandidates);
const mockGetLatestMetrics = vi.mocked(queriesModule.getLatestMetrics);
const mockUpsertBenchmark = vi.mocked(queriesModule.upsertBenchmark);
const mockGetBenchmarks = vi.mocked(queriesModule.getBenchmarks);
const mockInsertReelMetrics = vi.mocked(queriesModule.insertReelMetrics);
const mockUpsertPerformanceScore = vi.mocked(queriesModule.upsertPerformanceScore);

describe("posting_time benchmark dimension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBenchmarks.mockReturnValue([]);
    vi.mocked(brandsModule.getBrand).mockReturnValue({
      metaPageId: "PID",
      metaPageToken: "TOK",
      timezone: "UTC",
    } as any);
    vi.mocked(metaModule.createMetaService).mockReturnValue({
      fetchReelInsights: vi.fn().mockResolvedValue({
        views: 1000,
        likes: 20,
        comments: 5,
        shares: 10,
        saves: 2,
        reach: 900,
        watchTimeSec: 22,
        totalWatchTimeSec: 22000,
      }),
    } as any);
  });

  it("upserts a posting_time benchmark entry bucketed by publishedAt local hour", async () => {
    mockGetMetricsCandidates.mockReturnValue([{
      id: "reel-1",
      facebookPostId: "fb-1",
      headline: "Test",
      context: JSON.stringify({ pillarBalance: { prioritise: ["Economy"] } }),
      publishedAt: "2026-05-14T18:00:00.000Z",
    }] as any);
    mockGetLatestMetrics.mockReturnValue({
      fetchedAt: new Date(Date.now() - 10 * 3600000).toISOString(),
      views: 1000,
      likes: 20,
      comments: 5,
      shares: 10,
      reach: 900,
      saves: 2,
      watchTimeSec: 22,
      totalWatchTimeSec: 22000,
    } as any);

    await collectMetrics("ns");

    const postingTimeCalls = mockUpsertBenchmark.mock.calls.filter(
      (args) => args[0].dimension === "posting_time"
    );
    expect(postingTimeCalls.length).toBeGreaterThan(0);
    expect(postingTimeCalls[0][0].dimensionValue).toBe("Evening (18–20)");
  });

  it("skips posting_time benchmark when publishedAt is null", async () => {
    mockGetMetricsCandidates.mockReturnValue([{
      id: "reel-2",
      facebookPostId: "fb-2",
      headline: "Test 2",
      context: null,
      publishedAt: null,
    }] as any);
    mockGetLatestMetrics.mockReturnValue({
      fetchedAt: new Date(Date.now() - 10 * 3600000).toISOString(),
      views: 500,
      likes: 10,
      comments: 2,
      shares: 5,
      reach: 450,
      saves: 1,
      watchTimeSec: 15,
      totalWatchTimeSec: 7500,
    } as any);

    await collectMetrics("ns");

    const postingTimeCalls = mockUpsertBenchmark.mock.calls.filter(
      (args) => args[0].dimension === "posting_time"
    );
    expect(postingTimeCalls.length).toBe(0);
  });
});
