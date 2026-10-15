import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandConfig, ReelContext } from "../src/types.js";
import { isReelAssemblyOffloadEnabled } from "../src/config.js";
import * as config from "../src/config.js";

const {
  createAssemblyJobMock,
  updateReelMock,
  buildAssemblyMessageMock,
  enqueueAssemblyJobMock,
  canLaunchAssemblyWorkerMock,
  launchAssemblyWorkerMock,
} = vi.hoisted(() => ({
  createAssemblyJobMock: vi.fn(),
  updateReelMock: vi.fn(),
  buildAssemblyMessageMock: vi.fn((jobId: string, runId: string, brand: "ds" | "ns") => ({
    jobId,
    runId,
    brand,
    requestedAt: "2026-04-26T00:00:00.000Z",
  })),
  enqueueAssemblyJobMock: vi.fn(async () => {}),
  canLaunchAssemblyWorkerMock: vi.fn(() => true),
  launchAssemblyWorkerMock: vi.fn(async () => ({ instanceId: "i-test" })),
}));

vi.mock("../src/db/queries.js", () => ({
  createAssemblyJob: createAssemblyJobMock,
  updateReel: updateReelMock,
}));

vi.mock("../src/services/assembly-queue.js", () => ({
  buildAssemblyMessage: buildAssemblyMessageMock,
  enqueueAssemblyJob: enqueueAssemblyJobMock,
}));

vi.mock("../src/services/assembly-launcher.js", () => ({
  canLaunchAssemblyWorker: canLaunchAssemblyWorkerMock,
  launchAssemblyWorker: launchAssemblyWorkerMock,
}));

import * as queries from "../src/db/queries.js";
import * as assemblyQueue from "../src/services/assembly-queue.js";
import * as assemblyLauncher from "../src/services/assembly-launcher.js";
import { markReelStage5Dispatched, resolveStage5MusicUploadPath, runReelStage5Boundary } from "../src/pipeline/reel-runner.js";

const originalReelAssemblyOffloadEnabled = process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED;

afterEach(() => {
  if (originalReelAssemblyOffloadEnabled === undefined) {
    delete process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED;
    return;
  }

  process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED = originalReelAssemblyOffloadEnabled;
});

describe("isReelAssemblyOffloadEnabled", () => {
  it("returns false when env var is missing", () => {
    delete process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED;

    expect(isReelAssemblyOffloadEnabled()).toBe(false);
  });

  it("returns true when env var is true", () => {
    process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED = "true";

    expect(isReelAssemblyOffloadEnabled()).toBe(true);
  });
});

describe("runReelStage5Boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches assembly job and skips local stage5 when offload is enabled", async () => {
    vi.spyOn(config, "isReelAssemblyOffloadEnabled").mockReturnValue(true);
    const createAssemblyJobSpy = vi.mocked(queries.createAssemblyJob);
    const updateReelSpy = vi.mocked(queries.updateReel);
    const enqueueSpy = vi.mocked(assemblyQueue.enqueueAssemblyJob);
    const buildMessageSpy = vi.mocked(assemblyQueue.buildAssemblyMessage);
    const canLaunchSpy = vi.mocked(assemblyLauncher.canLaunchAssemblyWorker);
    const launchSpy = vi.mocked(assemblyLauncher.launchAssemblyWorker);
    const runLocalStage5 = vi.fn(async () => {});
    const persistedContext = {
      imageSourceMap: { 1: { type: "stock", provider: "unsplash" } },
      apiSourceMap: { captions: "bedrock", discovery: "tavily", images: "imagen" },
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: {
        fps: 24,
        quality: "standard",
        workers: 1,
        timeoutMs: 30 * 60_000,
        performanceProfile: "balanced",
      },
    };

    const mode = await runReelStage5Boundary({
      runId: "run-1",
      brandId: "ns",
      runLocalStage5,
      persistedContext,
    });

    expect(mode).toBe("offloaded");
    expect(runLocalStage5).not.toHaveBeenCalled();
    expect(createAssemblyJobSpy).toHaveBeenCalledTimes(1);
    const [{ id: jobId }] = createAssemblyJobSpy.mock.calls.map(([args]) => args);
    expect(createAssemblyJobSpy).toHaveBeenCalledWith({
      id: jobId,
      runId: "run-1",
      brand: "ns",
    });
    expect(buildMessageSpy).toHaveBeenCalledWith(jobId, "run-1", "ns", "i-test");
    expect(enqueueSpy).toHaveBeenCalledWith({
      jobId,
      runId: "run-1",
      brand: "ns",
      requestedAt: "2026-04-26T00:00:00.000Z",
    });
    expect(updateReelSpy.mock.invocationCallOrder[0]).toBeLessThan(enqueueSpy.mock.invocationCallOrder[0]);
    expect(canLaunchSpy).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledWith({ jobId });
    expect(updateReelSpy).toHaveBeenCalledWith("run-1", {
      status: "generating",
      currentStage: "reel-stage5-dispatched",
      context: persistedContext,
    });
  });

  it("skips launch attempt when single-flight guard blocks new worker", async () => {
    vi.spyOn(config, "isReelAssemblyOffloadEnabled").mockReturnValue(true);
    vi.mocked(assemblyLauncher.canLaunchAssemblyWorker).mockReturnValue(false);
    const launchSpy = vi.mocked(assemblyLauncher.launchAssemblyWorker);

    const mode = await runReelStage5Boundary({
      runId: "run-guarded",
      brandId: "ns",
      runLocalStage5: vi.fn(async () => {}),
      persistedContext: {},
    });

    expect(mode).toBe("offloaded");
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it("surfaces offload launch failures instead of reporting dispatched", async () => {
    vi.spyOn(config, "isReelAssemblyOffloadEnabled").mockReturnValue(true);
    vi.mocked(assemblyLauncher.canLaunchAssemblyWorker).mockReturnValue(true);
    vi.mocked(assemblyLauncher.launchAssemblyWorker).mockRejectedValueOnce(new Error("ec2 unavailable"));
    const updateReelSpy = vi.mocked(queries.updateReel);

    await expect(
      runReelStage5Boundary({
        runId: "run-failed-launch",
        brandId: "ds",
        runLocalStage5: vi.fn(async () => {}),
        persistedContext: {},
      }),
    ).rejects.toThrow("ec2 unavailable");
    expect(updateReelSpy).not.toHaveBeenCalledWith("run-failed-launch", {
      status: "generating",
      currentStage: "reel-stage5-dispatched",
    });
  });

  it("runs local stage5 path when offload is disabled", async () => {
    vi.spyOn(config, "isReelAssemblyOffloadEnabled").mockReturnValue(false);
    const createAssemblyJobSpy = vi.mocked(queries.createAssemblyJob);
    const updateReelSpy = vi.mocked(queries.updateReel);
    const enqueueSpy = vi.mocked(assemblyQueue.enqueueAssemblyJob);
    const runLocalStage5 = vi.fn(async () => {});

    const mode = await runReelStage5Boundary({
      runId: "run-2",
      brandId: "ds",
      runLocalStage5,
      persistedContext: {},
    });

    expect(mode).toBe("local");
    expect(runLocalStage5).toHaveBeenCalledTimes(1);
    expect(createAssemblyJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(updateReelSpy).not.toHaveBeenCalled();
  });
});

describe("resolveStage5MusicUploadPath", () => {
  it("falls back to configured music when category files are unavailable", () => {
    const brand: BrandConfig = {
      id: "ns",
      name: "WorldBrief",
      language: "en",
      timezone: "Europe/Berlin",
      postTimes: [],
      weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
      pillars: [],
      trustedSources: [],
      geographicFocus: "Europe",
      captionRules: {},
      themeWeights: {},
      viralCheck: false,
      gcsPrefix: "nscontent",
      metaPageId: "",
      metaPageToken: "",
      channels: {},
      useStockImages: true,
      reels: {
        enabled: true,
        voiceId: "voice",
        sceneCount: 4,
        reelTimes: [],
        musicFiles: ["/music/fallback.mp3"],
        musicByCategory: { business: ["/music/business.mp3"] },
      },
    };

    expect(resolveStage5MusicUploadPath({
      brand,
      category: "business",
      script: { category: "business", title: "Title", scenes: [], hashtags: [] },
    } as ReelContext, (filePath) => filePath === "/music/fallback.mp3")).toBe("/music/fallback.mp3");
  });
});

describe("markReelStage5Dispatched", () => {
  it("keeps reel context running and records dispatch stage", () => {
    const next = markReelStage5Dispatched({
      runId: "run-ctx",
      brand: { id: "ns" } as never,
      runDate: "2026-04-26",
      status: "awaiting_approval",
      stageLogs: [{ stage: "reel-stage4-images", status: "ok", durationMs: 123 }],
    });

    expect(next.status).toBe("running");
    expect(next.stageLogs).toEqual([
      { stage: "reel-stage4-images", status: "ok", durationMs: 123 },
      { stage: "reel-stage5-dispatched", status: "ok", durationMs: 0 },
    ]);
  });
});
