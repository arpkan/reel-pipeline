import { describe, expect, it } from "vitest";

process.env.PIPELINE_DB_PATH = ":memory:";

const reelRunner = await import("../src/pipeline/reel-runner.js");

const { applyStage5Overrides, resolveStoredStage5Selection } = reelRunner;

describe("applyStage5Overrides", () => {
  it("uses explicit override over persisted renderer", () => {
    expect(applyStage5Overrides(
      { stage5Renderer: "hyperframes" as const, stage5Template: undefined },
      { stage5Renderer: "hyperframes", stage5Template: "enhanced-default" },
    )).toEqual({ stage5Renderer: "hyperframes", stage5Template: "enhanced-default" });
  });
});

describe("resolveStoredStage5Selection", () => {
  it("uses the current brand renderer before an older persisted renderer", () => {
    expect(resolveStoredStage5Selection(
      { stage5Renderer: "hyperframes" as const, stage5Template: undefined },
      { stage5Renderer: "hyperframes" as const, stage5Template: "enhanced-default" as const },
      {},
    )).toEqual({ stage5Renderer: "hyperframes", stage5Template: "enhanced-default" });
  });

  it("ignores legacy ffmpeg override and keeps brand renderer", () => {
    expect(resolveStoredStage5Selection(
      { stage5Renderer: "hyperframes" as const, stage5Template: "enhanced-default" as const },
      { stage5Renderer: "hyperframes" as const, stage5Template: "enhanced-default" as const },
      { stage5Renderer: undefined },
    )).toEqual({ stage5Renderer: "hyperframes", stage5Template: "enhanced-default" });
  });
});

describe("resolveStageTimeoutMs", () => {
  it("uses renderer timeout settings for stage5 when present", () => {
    const resolveStageTimeoutMs = (reelRunner as typeof reelRunner & {
      resolveStageTimeoutMs?: (stageName: string, ctx: { stage5RenderSettings?: { timeoutMs?: number } }) => number;
    }).resolveStageTimeoutMs;

    expect(resolveStageTimeoutMs).toBeTypeOf("function");
    expect(resolveStageTimeoutMs!("reel-stage5-assemble", {
      stage5RenderSettings: { timeoutMs: 30 * 60_000 },
    })).toBe(30 * 60_000);
    expect(resolveStageTimeoutMs!("reel-stage5-assemble", {})).toBe(15 * 60_000);
  });
});
