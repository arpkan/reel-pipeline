# Hyperframes Camera Presets — Design

**Date**: 2026-05-05
**Status**: Approved

## Problem

Hyperframes Stage 5 does not render camera effects. The ffmpeg Stage 5 assembler has camera motion (zoom, pan, Ken Burns) via `buildBgFilter()` from `src/effects/camera-effects.ts`, but Hyperframes only shows static full-frame images. Operators and brand configs can already set `cameraEffect`, but it is silently ignored when the Hyperframes renderer is active.

## Decision

Add a **new public preset system** for Hyperframes camera motion, independent of the existing `CameraEffectType` used by ffmpeg.

Key choices:
- **Improve visuals**: Hyperframes motion should be smoother and more cinematic than ffmpeg's `zoompan`.
- **Vary per scene**: Same preset family, but subtle differences in origin, intensity, and easing per scene.
- **Subtle cinematic strength**: Default motion is slow and polished, not distracting.
- **Full public presets**: Operators choose named visual styles directly.
- **Hyperframes-only**: Presets apply only when Stage 5 renderer is `hyperframes`. ffmpeg ignores them.
- **Small curated set**: Launch with 6 presets.

## New Type

```ts
export type HyperframesCameraPreset =
  | "cinematic_drift"
  | "urgent_push"
  | "slow_reveal"
  | "documentary_slide"
  | "portrait_float"
  | "locked_frame";

export const HYPERFRAMES_CAMERA_PRESETS: HyperframesCameraPreset[] = [
  "cinematic_drift",
  "urgent_push",
  "slow_reveal",
  "documentary_slide",
  "portrait_float",
  "locked_frame",
];
```

## Preset Definitions

| Preset | Motion | Best for | Visual feel |
|---|---|---|---|
| `cinematic_drift` | Diagonal drift + gentle zoom | Default, trending, open | Polished, alive |
| `urgent_push` | Subtle forward push | Breaking, trending | Direct, high-energy |
| `slow_reveal` | Starts close, slowly pulls out | Business, explainers | Context-building |
| `documentary_slide` | Calm horizontal move | Human interest, news footage | Storytelling, grounded |
| `portrait_float` | Tiny vertical/horizontal drift | People-centered images | Gentle, personal |
| `locked_frame` | No motion | Any (explicit opt-out) | Static, stable |

### Motion Parameters

Each preset defines a motion personality with per-scene variation. The helper returns deterministic parameters based on preset, scene index, and total scene count.

```ts
interface SceneMotionParams {
  scaleStart: number;       // e.g. 1.03
  scaleEnd: number;         // e.g. 1.08
  translateXStart: string;  // e.g. "-1%"
  translateXEnd: string;    // e.g. "1%"
  translateYStart: string;  // e.g. "0%"
  translateYEnd: string;    // e.g. "-0.5%"
  easing: string;           // e.g. "cubic-bezier(0.25, 0.1, 0.25, 1)"
  transformOrigin: string;  // e.g. "center center"
}
```

Scale ranges stay within 1.0–1.12 for subtle cinematic feel. Transforms use `translate3d` for GPU acceleration. Easing uses CSS cubic-bezier for smoothness without requiring GSAP runtime at render time.

Per-scene variation is deterministic: scene index modulates origin and direction slightly so consecutive scenes don't feel identical, but the same input always produces the same output.

## Resolution Order

When renderer is `hyperframes`:

```
1. Explicit ctx.cameraPreset (from command -preset flag)
2. Brand config cameraPresetByCategory[category]
3. Category-based default preset (hardcoded mapping)
4. Fallback: "cinematic_drift"
```

When renderer is `ffmpeg`:
- Uses existing `cameraEffect` resolution via `resolveEffect()`.
- `cameraPreset` is ignored.

## New Context Fields

```ts
// In ReelContext:
cameraPreset?: HyperframesCameraPreset;        // operator override
usedCameraPreset?: HyperframesCameraPreset;    // resolved value (set after stage 5)

// In ReelConfig (brand config):
cameraPresetByCategory?: Partial<Record<ReelCategory, HyperframesCameraPreset>>;

// In ReelRunOptions:
cameraPreset?: HyperframesCameraPreset;
```

## New Module: `src/effects/hyperframes-presets.ts`

```ts
export function resolveHyperframesCameraPreset(
  category: ReelCategory | undefined,
  brandConfig: ReelConfig | undefined,
  override?: HyperframesCameraPreset,
): HyperframesCameraPreset;

export function buildSceneMotion(
  preset: HyperframesCameraPreset,
  sceneIndex: number,      // 0-based
  sceneCount: number,
): SceneMotionParams;
```

This module is independent from `src/effects/camera-effects.ts` (which remains ffmpeg-only).

## Category Default Mapping

```ts
const DEFAULT_PRESET_BY_CATEGORY: Record<ReelCategory, HyperframesCameraPreset> = {
  breaking: "urgent_push",
  trending: "cinematic_drift",
  human_interest: "documentary_slide",
  business: "slow_reveal",
  open: "cinematic_drift",
};
```

## Template Changes

`buildEnhancedDefaultHyperframesHtml` receives the resolved preset and scene count. For each scene clip, the template:

1. Calls `buildSceneMotion(preset, sceneIndex, sceneCount)` to get motion params.
2. Sets the scene image's initial CSS transform to the start state.
3. Emits an inline `<style>` block with a unique `@keyframes` rule per scene and applies it via CSS animation on the image element. No GSAP runtime needed.

The image container is oversized slightly (e.g. 112% width/height) so transforms don't reveal edges. `object-fit: cover` and `overflow: hidden` on the clip element keep the frame clean.

No GSAP runtime dependency — the motion is pure CSS so the Hyperframes producer can render it without JavaScript animation at capture time.

## Command Integration

New `-preset` flag added to reel command parsing:

```text
!reel breaking -preset cinematic_drift
!reel trending -preset urgent_push
!reel rebuild abcdef12 -preset slow_reveal
!re-effect abcdef12 -preset documentary_slide
```

Validation: if renderer is `ffmpeg` and a preset is provided, the command rejects with:

```
Camera presets require Hyperframes renderer. Use -renderer hyperframes or remove -preset.
```

## Database and State

`usedCameraPreset` is stored in the reel's context JSON blob (same as `usedCameraEffect` today). Review pages and telemetry show the resolved preset name.

## ffmpeg Compatibility

No changes to ffmpeg Stage 5. The two systems coexist:
- `cameraEffect` → ffmpeg only
- `cameraPreset` → Hyperframes only
- Both fields can be set simultaneously; the active renderer picks the right one.

## Files to Modify

| File | Change |
|---|---|
| `src/types.ts` | Add `HyperframesCameraPreset`, new context/config fields |
| `src/effects/hyperframes-presets.ts` | New module: preset resolution, scene motion params |
| `src/stages/reel-stage5-templates/enhanced-default.ts` | Accept preset, render per-scene CSS motion |
| `src/stages/reel-stage5-hyperframes-renderer.ts` | Resolve preset, pass to template, set `usedCameraPreset` |
| `src/pipeline/reel-runner.ts` | Accept `cameraPreset` in options, thread through context |
| `src/pipeline/command-listener.ts` | Parse `-preset` flag, validate renderer compatibility |
| `src/db/schema.ts` | No schema change (preset stored in context JSON) |
| `src/review/reel-html-builder.ts` | Display preset badge on review page |

## Testing

- Unit tests for `resolveHyperframesCameraPreset` (override > category config > default > fallback).
- Unit tests for `buildSceneMotion` determinism (same input → same output) and per-scene variation.
- Template tests asserting CSS transform/animation present when preset is set.
- Command parsing tests for `-preset` flag.
- Integration test: Hyperframes render with preset produces video without error.
- Validation test: ffmpeg + preset rejects cleanly.
