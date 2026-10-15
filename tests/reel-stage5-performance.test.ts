import { describe, expect, it } from "vitest";
import { resolveStage5Performance } from "../src/stages/reel-stage5-performance.js";

describe("resolveStage5Performance", () => {
  it("uses balanced defaults when config is missing", () => {
    const out = resolveStage5Performance(undefined);
    expect(out.effectQuality).toBe("balanced");
    expect(out.targetFps).toBe(24);
    expect(out.videoPreset).toBe("veryfast");
    expect(out.bgScaleCap).toBe(2560);
  });

  it("uses fast profile values", () => {
    const out = resolveStage5Performance({ effectQuality: "fast" });
    expect(out.targetFps).toBe(20);
    expect(out.videoPreset).toBe("veryfast");
    expect(out.bgScaleCap).toBe(1920);
  });

  it("allows explicit overrides", () => {
    const out = resolveStage5Performance({
      effectQuality: "high",
      targetFps: 30,
      bgScaleCap: 3072,
      videoPreset: "faster",
    });
    expect(out.targetFps).toBe(30);
    expect(out.bgScaleCap).toBe(3072);
    expect(out.videoPreset).toBe("faster");
  });
});
