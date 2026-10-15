import { describe, it, expect } from "vitest";

describe("resolveHyperframesCameraPreset", () => {
  it("returns override when provided", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset("breaking", undefined, "portrait_float")).toBe("portrait_float");
  });

  it("returns category default from brand config", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset("breaking", { cameraPresetByCategory: { breaking: "slow_reveal" } } as any)).toBe("slow_reveal");
  });

  it("returns hardcoded category default when no brand config", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset("breaking", undefined)).toBe("urgent_push");
    expect(resolveHyperframesCameraPreset("trending", undefined)).toBe("cinematic_drift");
    expect(resolveHyperframesCameraPreset("human_interest", undefined)).toBe("documentary_slide");
    expect(resolveHyperframesCameraPreset("business", undefined)).toBe("slow_reveal");
    expect(resolveHyperframesCameraPreset("open", undefined)).toBe("cinematic_drift");
  });

  it("falls back to cinematic_drift when no category", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset(undefined, undefined)).toBe("cinematic_drift");
  });

  it("override takes precedence over brand config", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset("breaking", { cameraPresetByCategory: { breaking: "slow_reveal" } } as any, "locked_frame")).toBe("locked_frame");
  });

  it("brand config takes precedence over hardcoded default", async () => {
    const { resolveHyperframesCameraPreset } = await import("../src/effects/hyperframes-presets.js");
    expect(resolveHyperframesCameraPreset("trending", { cameraPresetByCategory: { trending: "portrait_float" } } as any)).toBe("portrait_float");
  });
});

describe("buildSceneMotion", () => {
  it("returns locked_frame with identity transforms", async () => {
    const { buildSceneMotion } = await import("../src/effects/hyperframes-presets.js");
    const motion = buildSceneMotion("locked_frame", 0, 3);
    expect(motion.scaleStart).toBe(1);
    expect(motion.scaleEnd).toBe(1);
    expect(motion.translateXStart).toBe("0%");
    expect(motion.translateXEnd).toBe("0%");
    expect(motion.translateYStart).toBe("0%");
    expect(motion.translateYEnd).toBe("0%");
  });

  it("returns scale > 1 for non-locked presets", async () => {
    const { buildSceneMotion } = await import("../src/effects/hyperframes-presets.js");
    const motion = buildSceneMotion("cinematic_drift", 0, 3);
    expect(motion.scaleEnd).toBeGreaterThan(1);
  });

  it("is deterministic: same inputs produce same outputs", async () => {
    const { buildSceneMotion } = await import("../src/effects/hyperframes-presets.js");
    const a = buildSceneMotion("urgent_push", 2, 5);
    const b = buildSceneMotion("urgent_push", 2, 5);
    expect(a).toEqual(b);
  });

  it("varies by scene index within same preset", async () => {
    const { buildSceneMotion } = await import("../src/effects/hyperframes-presets.js");
    const a = buildSceneMotion("cinematic_drift", 0, 3);
    const b = buildSceneMotion("cinematic_drift", 1, 3);
    const c = buildSceneMotion("cinematic_drift", 2, 3);
    const allSame = a.scaleStart === b.scaleStart && b.scaleStart === c.scaleStart
      && a.translateXStart === b.translateXStart && b.translateXStart === c.translateXStart;
    expect(allSame).toBe(false);
  });

  it("keeps scale within 1.0-1.15 range for all presets and scenes", async () => {
    const { buildSceneMotion, HYPERFRAMES_CAMERA_PRESETS } = await import("../src/effects/hyperframes-presets.js");
    for (const preset of HYPERFRAMES_CAMERA_PRESETS) {
      for (let i = 0; i < 6; i++) {
        const motion = buildSceneMotion(preset, i, 6);
        expect(motion.scaleStart).toBeGreaterThanOrEqual(1.0);
        expect(motion.scaleStart).toBeLessThanOrEqual(1.15);
        expect(motion.scaleEnd).toBeGreaterThanOrEqual(1.0);
        expect(motion.scaleEnd).toBeLessThanOrEqual(1.15);
      }
    }
  });

  it("handles single scene without error", async () => {
    const { buildSceneMotion } = await import("../src/effects/hyperframes-presets.js");
    const motion = buildSceneMotion("cinematic_drift", 0, 1);
    expect(motion.scaleEnd).toBeGreaterThan(1);
  });
});
