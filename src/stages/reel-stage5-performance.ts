export type Stage5EffectQuality = "fast" | "balanced" | "high";

export type Stage5VideoPreset = "veryfast" | "faster" | "medium";

export interface Stage5PerformanceConfig {
  effectQuality?: Stage5EffectQuality;
  targetFps?: number;
  videoPreset?: Stage5VideoPreset;
  bgScaleCap?: number;
}

export interface ResolvedStage5Performance {
  effectQuality: Stage5EffectQuality;
  targetFps: number;
  videoPreset: Stage5VideoPreset;
  bgScaleCap: number;
}

const DEFAULTS: Record<
  Stage5EffectQuality,
  Omit<ResolvedStage5Performance, "effectQuality">
> = {
  fast: { targetFps: 20, videoPreset: "veryfast", bgScaleCap: 1920 },
  balanced: { targetFps: 24, videoPreset: "veryfast", bgScaleCap: 2560 },
  high: { targetFps: 30, videoPreset: "faster", bgScaleCap: 3072 },
};

export function resolveStage5Performance(
  cfg?: Stage5PerformanceConfig,
): ResolvedStage5Performance {
  const effectQuality = cfg?.effectQuality ?? "balanced";
  const base = DEFAULTS[effectQuality];

  return {
    effectQuality,
    targetFps: cfg?.targetFps ?? base.targetFps,
    videoPreset: cfg?.videoPreset ?? base.videoPreset,
    bgScaleCap: cfg?.bgScaleCap ?? base.bgScaleCap,
  };
}
