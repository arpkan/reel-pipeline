import { describe, expect, it } from "vitest";
import { resolveEffect } from "../src/effects/camera-effects.js";

describe("resolveEffect", () => {
  it("honors explicit override", () => {
    expect(resolveEffect("breaking", undefined, "zoom_in")).toBe("zoom_in");
  });

  it("uses brand category mapping when override is missing", () => {
    expect(
      resolveEffect("breaking", {
        enabled: true,
        voiceId: "x",
        sceneCount: 4,
        reelTimes: [],
        cameraEffectByCategory: { breaking: "pan_left" },
      }),
    ).toBe("pan_left");
  });

  it("falls back to default category mapping", () => {
    expect(
      resolveEffect("business", {
        enabled: true,
        voiceId: "x",
        sceneCount: 4,
        reelTimes: [],
      }),
    ).toBe("zoom_in");
  });
});
