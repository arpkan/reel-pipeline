import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAssemblyJobByIdMock,
  getReelByIdMock,
  updateReelMock,
  updateAssemblyJobMock,
  getOldestQueuedAssemblyJobMock,
  getBrandMock,
  notifyReelReadyMock,
  gcsDownloadFileMock,
  createGcsServiceMock,
  canLaunchAssemblyWorkerMock,
  launchAssemblyWorkerMock,
} = vi.hoisted(() => ({
  getAssemblyJobByIdMock: vi.fn(),
  getReelByIdMock: vi.fn(),
  updateReelMock: vi.fn(),
  updateAssemblyJobMock: vi.fn(),
  getOldestQueuedAssemblyJobMock: vi.fn(),
  getBrandMock: vi.fn(),
  notifyReelReadyMock: vi.fn(),
  gcsDownloadFileMock: vi.fn(),
  createGcsServiceMock: vi.fn(),
  canLaunchAssemblyWorkerMock: vi.fn(),
  launchAssemblyWorkerMock: vi.fn(),
}));

vi.mock("../src/db/queries.js", () => ({
  getAssemblyJobById: getAssemblyJobByIdMock,
  getReelById: getReelByIdMock,
  updateReel: updateReelMock,
  updateAssemblyJob: updateAssemblyJobMock,
  getOldestQueuedAssemblyJob: getOldestQueuedAssemblyJobMock,
}));

vi.mock("../src/services/assembly-launcher.js", () => ({
  canLaunchAssemblyWorker: canLaunchAssemblyWorkerMock,
  launchAssemblyWorker: launchAssemblyWorkerMock,
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: getBrandMock,
}));

vi.mock("../src/pipeline/reel-runner.js", () => ({
  notifyReelReady: notifyReelReadyMock,
}));

vi.mock("../src/services/gcs.js", () => ({
  createGcsService: createGcsServiceMock,
}));

const { runAssemblyJob } = await import("../src/workers/reel-assembly-worker.js");

describe("runAssemblyJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canLaunchAssemblyWorkerMock.mockReturnValue(false);
    createGcsServiceMock.mockReturnValue({
      downloadFile: gcsDownloadFileMock,
    });
  });

  it("downloads missing stage5 assets from GCS before assembly", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-remote-1",
      runId: "run-remote-1",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-remote-1",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({
        scenes: [{ sceneNumber: 1 }, { sceneNumber: 2 }],
      }),
      context: JSON.stringify({}),
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", gcsPrefix: "nscontent", reels: {} });

    const runStage5 = vi.fn(async () => ({
      videoGcsUrl: "https://gcs/reel-remote.mp4",
    }));

    await runAssemblyJob(
      { jobId: "job-remote-1" },
      {
        runStage5,
        registerTerminationSignals: () => () => {},
      },
    );

    expect(createGcsServiceMock).toHaveBeenCalledTimes(1);
    expect(gcsDownloadFileMock).toHaveBeenCalledTimes(4);
    expect(gcsDownloadFileMock).toHaveBeenCalledWith(
      "nscontent",
      "run-remote-1",
      "scene1.mp3",
      expect.stringContaining("scene1.mp3"),
    );
    expect(gcsDownloadFileMock).toHaveBeenCalledWith(
      "nscontent",
      "run-remote-1",
      "scene2.mp3",
      expect.stringContaining("scene2.mp3"),
    );
    expect(gcsDownloadFileMock).toHaveBeenCalledWith(
      "nscontent",
      "run-remote-1",
      "scene1.png",
      expect.stringContaining("scene1.png"),
    );
    expect(gcsDownloadFileMock).toHaveBeenCalledWith(
      "nscontent",
      "run-remote-1",
      "scene2.png",
      expect.stringContaining("scene2.png"),
    );
    expect(runStage5).toHaveBeenCalledTimes(1);
  });

  it("marks job succeeded and updates reel on success", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-1",
      runId: "run-1",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-1",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({
        scenes: [{ sceneNumber: 1 }, { sceneNumber: 2 }],
      }),
      context: JSON.stringify({
        themeSource: "weight-winning",
        useStockImages: true,
        imageSourceMap: {
          1: { type: "stock", provider: "unsplash" },
        },
        apiSourceMap: {
          captions: "bedrock",
          discovery: "tavily",
        },
      }),
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", reels: {} });

    const runStage5 = vi.fn(async () => ({
      videoGcsUrl: "https://gcs/reel.mp4",
      musicFile: "music.mp3",
      imageSourceMap: {
        2: { type: "ai", model: "imagen-4", provider: "gemini" },
      },
      apiSourceMap: {
        images: "imagen",
      },
    }));
    const signalSupervisor = vi.fn(async () => {});

    await runAssemblyJob(
      { jobId: "job-1" },
      {
        runStage5,
        signalSupervisor,
        registerTerminationSignals: () => () => {},
      },
    );

    expect(runStage5).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        audioPaths: [expect.stringContaining("scene1.mp3"), expect.stringContaining("scene2.mp3")],
        imagePaths: [expect.stringContaining("scene1.png"), expect.stringContaining("scene2.png")],
      }),
    );
    expect(updateReelMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "awaiting_approval",
        currentStage: null,
        videoGcsUrl: "https://gcs/reel.mp4",
        reviewUrl: expect.stringContaining("/review/reel/run-1"),
        context: expect.objectContaining({
          themeSource: "weight-winning",
          useStockImages: true,
          musicFile: "music.mp3",
          imageSourceMap: {
            1: { type: "stock", provider: "unsplash" },
            2: { type: "ai", model: "imagen-4", provider: "gemini" },
          },
          apiSourceMap: {
            captions: "bedrock",
            discovery: "tavily",
            images: "imagen",
          },
        }),
      }),
    );
    expect(notifyReelReadyMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ns" }),
      expect.objectContaining({
        runId: "run-1",
        reviewUrl: expect.stringContaining("/review/reel/run-1"),
      }),
    );
    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "succeeded", finishedAt: expect.any(String), error: "" }),
    );
    expect(signalSupervisor).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        runId: "run-1",
        status: "succeeded",
      }),
    );
  });

  it("passes persisted stage5 renderer metadata to the worker renderer", async () => {
    getAssemblyJobByIdMock.mockReturnValue({ id: "job-renderer", runId: "run-renderer", brand: "ds", status: "running" });
    getReelByIdMock.mockReturnValue({
      id: "run-renderer",
      brand: "ds",
      runDate: "2026-04-28",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
        stage5RenderSettings: {
          fps: 24,
          quality: "standard",
          workers: 1,
          timeoutMs: 1800000,
          performanceProfile: "balanced",
        },
      }),
      category: "trending",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ds", gcsPrefix: "dscontent", reels: {} });

    const runStage5 = vi.fn(async () => ({
      videoGcsUrl: "https://gcs/reel-renderer.mp4",
      stage5RenderTelemetry: { renderer: "hyperframes", template: "enhanced-default", durationMs: 1234 },
    }));

    await runAssemblyJob(
      { jobId: "job-renderer" },
      { runStage5, registerTerminationSignals: () => () => {} },
    );

    expect(runStage5).toHaveBeenCalledWith(
      expect.objectContaining({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
        stage5RenderSettings: expect.objectContaining({ fps: 24, quality: "standard" }),
      }),
    );
    expect(updateReelMock).toHaveBeenCalledWith(
      "run-renderer",
      expect.objectContaining({
        context: expect.objectContaining({
          stage5Renderer: "hyperframes",
          stage5Template: "enhanced-default",
          stage5RenderTelemetry: expect.objectContaining({ renderer: "hyperframes", durationMs: 1234, mode: "offloaded" }),
        }),
      }),
    );
  });

  it("marks job and reel failed when stage5 assembly throws", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-2",
      runId: "run-2",
      brand: "ds",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-2",
      brand: "ds",
      runDate: "2026-04-26",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: null,
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ds", reels: {} });

    const signalSupervisor = vi.fn(async () => {});

    await expect(
      runAssemblyJob(
        { jobId: "job-2" },
        {
          runStage5: async () => {
            throw new Error("assemble exploded");
          },
          signalSupervisor,
          registerTerminationSignals: () => () => {},
        },
      ),
    ).rejects.toThrow("assemble exploded");

    expect(updateReelMock).toHaveBeenCalledWith("run-2", { status: "failed", currentStage: null });
    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("assemble exploded"),
        finishedAt: expect.any(String),
      }),
    );
    expect(signalSupervisor).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "assemble exploded",
      }),
    );
  });

  it("avoids duplicate ready notification when review URL already exists", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-dup-1",
      runId: "run-dup-1",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-dup-1",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({ themeSource: "weight-winning" }),
      category: "breaking",
      status: "awaiting_approval",
      reviewUrl: "https://pipeline.example/review/reel/run-dup-1",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", reels: {} });

    await runAssemblyJob(
      { jobId: "job-dup-1" },
      {
        runStage5: async () => ({ videoGcsUrl: "https://gcs/reel-dup-1.mp4" }),
        registerTerminationSignals: () => () => {},
      },
    );

    expect(updateReelMock).toHaveBeenCalledWith(
      "run-dup-1",
      expect.objectContaining({
        reviewUrl: "https://pipeline.example/review/reel/run-dup-1",
        status: "awaiting_approval",
      }),
    );
    expect(notifyReelReadyMock).not.toHaveBeenCalled();
  });

  it("treats termination signal as explicit failed outcome", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-3",
      runId: "run-3",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-3",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({}),
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", reels: {} });

    let onSignal: ((signal: NodeJS.Signals) => void) | undefined;
    const signalSupervisor = vi.fn(async () => {});
    await expect(
      runAssemblyJob(
        { jobId: "job-3" },
        {
          runStage5: async () => {
            onSignal?.("SIGTERM");
            return { videoGcsUrl: "https://gcs/reel3.mp4" };
          },
          registerTerminationSignals: (handler) => {
            onSignal = handler;
            return () => {};
          },
          signalSupervisor,
        },
      ),
    ).rejects.toThrow("Worker received SIGTERM during job job-3");

    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-3",
      expect.objectContaining({ status: "failed", error: expect.stringContaining("SIGTERM") }),
    );
    expect(signalSupervisor).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        signal: "SIGTERM",
      }),
    );
  });

  it("marks job failed when reel run is missing", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-4",
      runId: "run-4",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue(null);

    await expect(runAssemblyJob({ jobId: "job-4" })).rejects.toThrow(
      "Reel run not found for assembly job job-4: run-4",
    );

    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-4",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("Reel run not found"),
        finishedAt: expect.any(String),
      }),
    );
  });

  it("marks job failed when reel script is missing", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-5",
      runId: "run-5",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-5",
      brand: "ns",
      runDate: "2026-04-26",
      script: null,
      context: null,
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });

    await expect(runAssemblyJob({ jobId: "job-5" })).rejects.toThrow(
      "Reel run-5 has no script for stage5 assembly",
    );

    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-5",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("has no script"),
        finishedAt: expect.any(String),
      }),
    );
  });

  it("fails and persists mismatch when input runId differs from job runId", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-6",
      runId: "run-6",
      brand: "ns",
      status: "running",
    });

    await expect(runAssemblyJob({ jobId: "job-6", runId: "run-other" })).rejects.toThrow(
      "Assembly job runId mismatch for job-6: expected run-6, got run-other",
    );

    expect(updateAssemblyJobMock).toHaveBeenCalledWith(
      "job-6",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("runId mismatch"),
        finishedAt: expect.any(String),
      }),
    );
  });

  it("attempts to launch oldest queued job after successful completion", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-7",
      runId: "run-7",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-7",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({}),
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", reels: {} });
    canLaunchAssemblyWorkerMock.mockReturnValue(true);
    getOldestQueuedAssemblyJobMock.mockReturnValue({ id: "job-next-1" });

    await runAssemblyJob(
      { jobId: "job-7" },
      {
        runStage5: async () => ({ videoGcsUrl: "https://gcs/reel7.mp4" }),
        registerTerminationSignals: () => () => {},
      },
    );

    expect(getOldestQueuedAssemblyJobMock).toHaveBeenCalledTimes(1);
    expect(launchAssemblyWorkerMock).toHaveBeenCalledWith({ jobId: "job-next-1" });
  });

  it("attempts to launch oldest queued job after failure path", async () => {
    getAssemblyJobByIdMock.mockReturnValue({
      id: "job-8",
      runId: "run-8",
      brand: "ns",
      status: "running",
    });
    getReelByIdMock.mockReturnValue({
      id: "run-8",
      brand: "ns",
      runDate: "2026-04-26",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({}),
      category: "breaking",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ns", reels: {} });
    canLaunchAssemblyWorkerMock.mockReturnValue(true);
    getOldestQueuedAssemblyJobMock.mockReturnValue({ id: "job-next-2" });

    await expect(
      runAssemblyJob(
        { jobId: "job-8" },
        {
          runStage5: async () => {
            throw new Error("explode-and-launch-next");
          },
          registerTerminationSignals: () => () => {},
        },
      ),
    ).rejects.toThrow("explode-and-launch-next");

    expect(getOldestQueuedAssemblyJobMock).toHaveBeenCalledTimes(1);
    expect(launchAssemblyWorkerMock).toHaveBeenCalledWith({ jobId: "job-next-2" });
  });
});
