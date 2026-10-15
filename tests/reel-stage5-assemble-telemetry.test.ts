import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/queries.js", () => ({
  updateReel: vi.fn(),
}));

describe("formatStage5SceneTelemetry", () => {
  it("formats per-scene timing and profile in one deterministic log line", async () => {
    const { formatStage5SceneTelemetry } = await import("../src/stages/reel-stage5-assemble.js");
    const line = formatStage5SceneTelemetry({
      sceneNumber: 2,
      sceneCount: 4,
      renderMs: 1234,
      encodeMs: 4567,
      totalMs: 5801,
      profile: {
        effectQuality: "balanced",
        targetFps: 24,
        videoPreset: "veryfast",
        bgScaleCap: 2560,
      },
    });

    expect(line).toBe(
      "    telemetry scene 2/4: render=1.23s encode=4.57s total=5.80s profile=balanced@24fps preset=veryfast bgScaleCap=2560",
    );
  });
});

describe("buildFfmpegStage5RenderTelemetry", () => {
  it("uses render completion time instead of later upload time", async () => {
    const { buildFfmpegStage5RenderTelemetry } = await import("../src/stages/reel-stage5-assemble.js");

    expect(buildFfmpegStage5RenderTelemetry({
      fps: 24,
      stageStartMs: 1_000,
      renderEndMs: 3_500,
      outputBytes: 123_456,
    })).toEqual({
      renderer: "hyperframes",
      fps: 24,
      durationMs: 2_500,
      outputBytes: 123_456,
    });
  });
});

describe("shouldRenderHighlight", () => {
  it("returns false for very short word durations", async () => {
    const { shouldRenderHighlight } = await import("../src/stages/reel-stage5-assemble.js");
    expect(shouldRenderHighlight(0.049)).toBe(false);
  });

  it("returns true for normal word durations", async () => {
    const { shouldRenderHighlight } = await import("../src/stages/reel-stage5-assemble.js");
    expect(shouldRenderHighlight(0.2)).toBe(true);
  });
});
