import type { HyperframesCameraPreset, ReelCategory, ReelConfig } from "../types.js";

export const HYPERFRAMES_CAMERA_PRESETS: HyperframesCameraPreset[] = [
  "cinematic_drift",
  "urgent_push",
  "slow_reveal",
  "documentary_slide",
  "portrait_float",
  "locked_frame",
];

const DEFAULT_PRESET_BY_CATEGORY: Record<ReelCategory, HyperframesCameraPreset> = {
  breaking: "urgent_push",
  trending: "cinematic_drift",
  human_interest: "documentary_slide",
  business: "slow_reveal",
  open: "cinematic_drift",
};

export function resolveHyperframesCameraPreset(
  category: ReelCategory | undefined,
  brandConfig: ReelConfig | undefined,
  override?: HyperframesCameraPreset,
): HyperframesCameraPreset {
  if (override) {
    return override;
  }

  if (category) {
    const configured = brandConfig?.cameraPresetByCategory?.[category];
    if (configured) {
      return configured;
    }

    const defaultPreset = DEFAULT_PRESET_BY_CATEGORY[category];
    if (defaultPreset) {
      return defaultPreset;
    }
  }

  return "cinematic_drift";
}

export interface SceneMotionParams {
  scaleStart: number;
  scaleEnd: number;
  translateXStart: string;
  translateXEnd: string;
  translateYStart: string;
  translateYEnd: string;
  easing: string;
  transformOrigin: string;
}

const EASING = "cubic-bezier(0.25, 0.1, 0.25, 1)";
const TRANSFORM_ORIGIN = "center center";

function pct(value: number): string {
  return value.toFixed(2) + "%";
}

function varyByScene(base: number, index: number, count: number, amplitude: number): number {
  const offset = ((index * 2.39996322) % 1) * 2 - 1;
  const spread = count > 1 ? amplitude : amplitude * 0.5;
  return base + offset * spread;
}

export function buildSceneMotion(
  preset: HyperframesCameraPreset,
  sceneIndex: number,
  sceneCount: number,
): SceneMotionParams {
  if (preset === "locked_frame") {
    return {
      scaleStart: 1,
      scaleEnd: 1,
      translateXStart: "0%",
      translateXEnd: "0%",
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  if (preset === "cinematic_drift") {
    const scaleStart = varyByScene(1.05, sceneIndex, sceneCount, 0.015);
    const scaleEnd = varyByScene(1.12, sceneIndex, sceneCount, 0.015);
    const txStart = varyByScene(-1.5, sceneIndex, sceneCount, 1.5);
    const txEnd = varyByScene(1.5, sceneIndex, sceneCount, 1.0);
    const tyStart = varyByScene(-1.0, sceneIndex, sceneCount, 0.8);
    const tyEnd = varyByScene(1.0, sceneIndex, sceneCount, 0.6);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: pct(txStart),
      translateXEnd: pct(txEnd),
      translateYStart: pct(tyStart),
      translateYEnd: pct(tyEnd),
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  if (preset === "urgent_push") {
    const scaleStart = varyByScene(1.04, sceneIndex, sceneCount, 0.01);
    const scaleEnd = varyByScene(1.12, sceneIndex, sceneCount, 0.01);
    const driftX = varyByScene(0.6, sceneIndex, sceneCount, 0.5);
    const driftY = varyByScene(0.5, sceneIndex, sceneCount, 0.4);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: pct(-driftX),
      translateXEnd: pct(driftX),
      translateYStart: pct(-driftY),
      translateYEnd: pct(driftY),
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  if (preset === "slow_reveal") {
    const scaleStart = varyByScene(1.10, sceneIndex, sceneCount, 0.01);
    const scaleEnd = varyByScene(1.04, sceneIndex, sceneCount, 0.01);
    const txStart = varyByScene(-1.0, sceneIndex, sceneCount, 0.6);
    const txEnd = varyByScene(1.2, sceneIndex, sceneCount, 0.4);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: pct(txStart),
      translateXEnd: pct(txEnd),
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  if (preset === "documentary_slide") {
    const scaleStart = 1.08;
    const scaleEnd = 1.08;
    const direction = sceneIndex % 2 === 0 ? 1 : -1;
    const txStart = direction * varyByScene(2.0, sceneIndex, sceneCount, 0.5);
    const txEnd = direction * varyByScene(-1.5, sceneIndex, sceneCount, 0.3);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: pct(txStart),
      translateXEnd: pct(txEnd),
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  if (preset === "portrait_float") {
    const scaleStart = varyByScene(1.04, sceneIndex, sceneCount, 0.005);
    const scaleEnd = varyByScene(1.06, sceneIndex, sceneCount, 0.005);
    const txStart = varyByScene(-0.5, sceneIndex, sceneCount, 0.3);
    const txEnd = varyByScene(0.5, sceneIndex, sceneCount, 0.2);
    const tyStart = varyByScene(-0.6, sceneIndex, sceneCount, 0.2);
    const tyEnd = varyByScene(0.6, sceneIndex, sceneCount, 0.15);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: pct(txStart),
      translateXEnd: pct(txEnd),
      translateYStart: pct(tyStart),
      translateYEnd: pct(tyEnd),
      easing: EASING,
      transformOrigin: TRANSFORM_ORIGIN,
    };
  }

  return {
    scaleStart: 1,
    scaleEnd: 1,
    translateXStart: "0%",
    translateXEnd: "0%",
    translateYStart: "0%",
    translateYEnd: "0%",
    easing: EASING,
    transformOrigin: TRANSFORM_ORIGIN,
  };
}
