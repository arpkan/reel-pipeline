import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/queries.js", () => ({ updateReel: vi.fn() }));

describe("bin worker stage5 context helpers", () => {
  it("reconstructs and persists stage5 renderer metadata", async () => {
    const { buildWorkerPersistedReelContext, buildWorkerReelContext } = await import("../bin/worker.js");

    const ctx = buildWorkerReelContext({
      runId: "run-worker",
      reel: {
        runDate: "2026-04-28",
        category: "trending",
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
          stage5RenderTelemetry: { renderer: "hyperframes", template: "enhanced-default", durationMs: 321 },
        }),
      },
      brand: { id: "ds", reels: {} } as never,
      workDir: "/tmp/reel-worker",
      script: { scenes: [{ sceneNumber: 1 }] },
      audioPaths: ["/tmp/reel-worker/scene1.mp3"],
      imagePaths: ["/tmp/reel-worker/scene1.png"],
    });

    expect(ctx).toMatchObject({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: expect.objectContaining({ fps: 24, quality: "standard" }),
      stage5RenderTelemetry: expect.objectContaining({ renderer: "hyperframes", durationMs: 321 }),
    });

    expect(buildWorkerPersistedReelContext({
      ...ctx,
      stage5RenderTelemetry: { renderer: "hyperframes", template: "enhanced-default", durationMs: 654 },
    })).toMatchObject({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: expect.objectContaining({ fps: 24, quality: "standard" }),
      stage5RenderTelemetry: expect.objectContaining({ durationMs: 654 }),
    });
  });
});
