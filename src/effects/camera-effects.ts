import type { CameraEffectType, ReelCategory, ReelConfig } from "../types.js";

export const CAMERA_EFFECT_TYPES: CameraEffectType[] = [
  "zoom_in", "zoom_out",
  "pan_left", "pan_right", "pan_up", "pan_down",
  "ken_burns", "none",
];

export const DEFAULT_EFFECT_BY_CATEGORY: Record<ReelCategory, CameraEffectType> = {
  breaking: "zoom_in",
  trending: "ken_burns",
  human_interest: "pan_left",
  business: "zoom_in",
  open: "ken_burns",
};

export function resolveEffect(
  category: ReelCategory | undefined,
  brandConfig: ReelConfig | undefined,
  override?: CameraEffectType,
): CameraEffectType {
  if (override) {
    return override;
  }

  if (category) {
    const configuredEffect = (
      brandConfig as (ReelConfig & {
        cameraEffectByCategory?: Partial<Record<ReelCategory, CameraEffectType>>;
      }) | undefined
    )?.cameraEffectByCategory?.[category];

    if (configuredEffect) {
      return configuredEffect;
    }

    const defaultEffect = DEFAULT_EFFECT_BY_CATEGORY[category];
    if (defaultEffect) {
      return defaultEffect;
    }
  }

  return "ken_burns";
}

const VW = 1080;
const VH = 1920;

function buildBoundedScale(bgScaleCap: number): string {
  return `scale='if(gt(a,${VW}/${VH}),${bgScaleCap},-2)':'if(gt(a,${VW}/${VH}),-2,${bgScaleCap})'`;
}

export function buildBgFilter(
  effect: CameraEffectType,
  totalDurationSeconds: number,
  fps = 25,
  bgScaleCap = 2560,
): string {
  if (effect === "none") {
    return `[0:v]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH}[bg]`;
  }

  const frames = Math.max(1, Math.round(totalDurationSeconds * fps));
  const boundedScale = buildBoundedScale(bgScaleCap);

  if (effect === "zoom_in") {
    const maxZoom = 1.5;
    const rate = ((maxZoom - 1.0) / frames).toFixed(6);
    return `[0:v]${boundedScale},zoompan=z='min(zoom+${rate},${maxZoom})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "zoom_out") {
    const startZoom = 1.5;
    const rate = ((startZoom - 1.0) / frames).toFixed(6);
    return `[0:v]${boundedScale},zoompan=z='if(eq(on,1),${startZoom},max(zoom-${rate},1.0))':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "pan_left") {
    const zoom = 1.3;
    return `[0:v]${boundedScale},zoompan=z='${zoom}':x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "pan_right") {
    const zoom = 1.3;
    return `[0:v]${boundedScale},zoompan=z='${zoom}':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "pan_up") {
    const zoom = 1.3;
    return `[0:v]${boundedScale},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${frames})':d=${frames}:s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "pan_down") {
    const zoom = 1.3;
    return `[0:v]${boundedScale},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${frames})':d=${frames}:s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  if (effect === "ken_burns") {
    const maxZoom = 1.5;
    const rate = ((maxZoom - 1.0) / frames).toFixed(6);
    return `[0:v]${boundedScale},zoompan=z='min(zoom+${rate},${maxZoom})':x='(iw-iw/zoom)*(on/${frames})':y='(ih-ih/zoom)*(on/${frames})':d=${frames}:s=${VW}x${VH}:fps=${fps}[bg]`;
  }

  return `[0:v]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH}[bg]`;
}
