import { describe, expect, it } from "vitest";
import {
  buildBgFilter,
  CAMERA_EFFECT_TYPES,
  DEFAULT_EFFECT_BY_CATEGORY,
  resolveEffect,
  type CameraEffectType,
} from "../src/effects/camera-effects.js";
import type { ReelCategory, ReelConfig } from "../src/types.js";

describe("resolveEffect", () => {
  const category: ReelCategory = "breaking";
  const brandConfig = {
    cameraEffectByCategory: {
      breaking: "pan_down",
    },
  } as ReelConfig & {
    cameraEffectByCategory?: Partial<Record<ReelCategory, CameraEffectType>>;
  };

  it("uses explicit override first", () => {
    const resolved = resolveEffect(category, brandConfig, "zoom_out");

    expect(resolved).toBe("zoom_out");
  });

  it("falls back to brand config mapping when override is missing", () => {
    const resolved = resolveEffect(category, brandConfig);

    expect(resolved).toBe("pan_down");
  });

  it("falls back to default category mapping when brand config has no mapping", () => {
    const resolved = resolveEffect("business", { enabled: true } as ReelConfig);

    expect(resolved).toBe(DEFAULT_EFFECT_BY_CATEGORY.business);
  });

  it("falls back to ken_burns when category is undefined", () => {
    const resolved = resolveEffect(undefined, brandConfig);

    expect(resolved).toBe("ken_burns");
  });
});

describe("buildBgFilter", () => {
  it("does not use hardcoded 8000 scaling for motion effects", () => {
    const motionEffects = CAMERA_EFFECT_TYPES.filter((effect) => effect !== "none");

    for (const effect of motionEffects) {
      const filter = buildBgFilter(effect, 6);
      expect(filter).not.toContain("scale=8000");
      expect(filter).not.toContain("scale=-1:8000");
    }
  });

  it("threads fps and bgScaleCap into generated filter", () => {
    const filter = buildBgFilter("zoom_in", 5, 18, 2048);

    expect(filter).toContain("fps=18");
    expect(filter).toContain("2048");
  });

  it("uses bounded x/y expressions for pan effects and ken burns", () => {
    const duration = 6;
    const fps = 25;
    const frames = Math.round(duration * fps);

    const panLeft = buildBgFilter("pan_left", duration, fps);
    expect(panLeft).toContain(`x='(iw-iw/zoom)*(on/${frames})'`);
    expect(panLeft).toContain("y='ih/2-(ih/zoom/2)'");

    const panRight = buildBgFilter("pan_right", duration, fps);
    expect(panRight).toContain(`x='(iw-iw/zoom)*(1-on/${frames})'`);

    const panUp = buildBgFilter("pan_up", duration, fps);
    expect(panUp).toContain("x='iw/2-(iw/zoom/2)'");
    expect(panUp).toContain(`y='(ih-ih/zoom)*(on/${frames})'`);

    const panDown = buildBgFilter("pan_down", duration, fps);
    expect(panDown).toContain(`y='(ih-ih/zoom)*(1-on/${frames})'`);

    const kenBurns = buildBgFilter("ken_burns", duration, fps);
    expect(kenBurns).toContain(`x='(iw-iw/zoom)*(on/${frames})'`);
    expect(kenBurns).toContain(`y='(ih-ih/zoom)*(on/${frames})'`);
  });
});
