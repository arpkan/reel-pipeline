# Hyperframes Camera Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public camera preset system for Hyperframes Stage 5 so operators can choose named visual styles for camera motion.

**Architecture:** New `HyperframesCameraPreset` type and resolution module sit alongside the existing `CameraEffectType` / `camera-effects.ts` used by ffmpeg. The Hyperframes renderer resolves a preset, passes it to the enhanced-default template, which emits per-scene CSS `@keyframes` animations for cinematic motion. ffmpeg ignores presets entirely.

**Tech Stack:** TypeScript, Vitest, CSS animations, Hyperframes producer.

---

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Create | `src/effects/hyperframes-presets.ts` | Preset type, resolution, scene motion params |
| Modify | `src/types.ts` | Add `HyperframesCameraPreset`, new context/config fields |
| Modify | `src/stages/reel-stage5-templates/enhanced-default.ts` | Accept preset, render per-scene CSS motion |
| Modify | `src/stages/reel-stage5-hyperframes-renderer.ts` | Resolve preset, pass to template, set `usedCameraPreset` |
| Modify | `src/pipeline/command-listener.ts` | Parse `-preset` flag, add to `ReelCommandFlags` |
| Modify | `src/pipeline/reel-runner.ts` | Thread `cameraPreset` through run/rerescript/rebuild |
| Modify | `src/review/reel-html-builder.ts` | Display preset badge on review page |
| Modify | `src/brands/ds.ts` | Add `cameraPresetByCategory` config |
| Modify | `src/brands/ns.ts` | Add `cameraPresetByCategory` config |
| Create | `tests/hyperframes-presets.test.ts` | Unit tests for preset resolution and scene motion |
| Modify | `tests/reel-stage5-enhanced-template.test.ts` | Template tests for preset CSS output |
| Modify | `tests/reel-telegram-stage5-flags.test.ts` | Command flag tests for `-preset` |

---

### Task 1: Add `HyperframesCameraPreset` type and preset constants

**Files:**
- Modify: `src/types.ts:10` (after `CameraEffectType` definition)

- [ ] **Step 1: Add the new type to `src/types.ts`**

After line 10 (`export type CameraEffectType = ...;`), add:

```ts
export type HyperframesCameraPreset =
  | "cinematic_drift"
  | "urgent_push"
  | "slow_reveal"
  | "documentary_slide"
  | "portrait_float"
  | "locked_frame";
```

- [ ] **Step 2: Add `cameraPresetByCategory` to `ReelConfig`**

In `src/types.ts`, inside the `ReelConfig` interface (around line 266, after `cameraEffectByCategory`), add:

```ts
  cameraPresetByCategory?: Partial<Record<ReelCategory, HyperframesCameraPreset>>;
```

- [ ] **Step 3: Add `cameraPreset`, `usedCameraPreset` to `ReelContext`**

In `src/types.ts`, inside the `ReelContext` interface (around line 319, after `cameraEffect`), add:

```ts
  cameraPreset?: HyperframesCameraPreset;
```

After line 324 (`usedCameraEffect`), add:

```ts
  usedCameraPreset?: HyperframesCameraPreset;
```

- [ ] **Step 4: Add `cameraPreset` to `ReelRunOptions`**

In `src/types.ts`, inside the `ReelRunOptions` interface (around line 352, after `cameraEffect`), add:

```ts
  cameraPreset?: HyperframesCameraPreset;
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors related to `HyperframesCameraPreset`. Existing code should compile since new fields are all optional.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat: add HyperframesCameraPreset type and context fields"
```

---

### Task 2: Create `hyperframes-presets.ts` module with resolution and scene motion

**Files:**
- Create: `src/effects/hyperframes-presets.ts`
- Create: `tests/hyperframes-presets.test.ts`

- [ ] **Step 1: Write the test file `tests/hyperframes-presets.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveHyperframesCameraPreset, buildSceneMotion, HYPERFRAMES_CAMERA_PRESETS } from "../src/effects/hyperframes-presets.js";

describe("resolveHyperframesCameraPreset", () => {
  it("returns override when provided", () => {
    expect(resolveHyperframesCameraPreset("breaking", undefined, "portrait_float")).toBe("portrait_float");
  });

  it("returns category default from brand config", () => {
    expect(resolveHyperframesCameraPreset("breaking", { cameraPresetByCategory: { breaking: "slow_reveal" } } as any)).toBe("slow_reveal");
  });

  it("returns hardcoded category default when no brand config", () => {
    expect(resolveHyperframesCameraPreset("breaking", undefined)).toBe("urgent_push");
    expect(resolveHyperframesCameraPreset("trending", undefined)).toBe("cinematic_drift");
    expect(resolveHyperframesCameraPreset("human_interest", undefined)).toBe("documentary_slide");
    expect(resolveHyperframesCameraPreset("business", undefined)).toBe("slow_reveal");
    expect(resolveHyperframesCameraPreset("open", undefined)).toBe("cinematic_drift");
  });

  it("falls back to cinematic_drift when no category", () => {
    expect(resolveHyperframesCameraPreset(undefined, undefined)).toBe("cinematic_drift");
  });

  it("override takes precedence over brand config", () => {
    expect(resolveHyperframesCameraPreset("breaking", { cameraPresetByCategory: { breaking: "slow_reveal" } } as any, "locked_frame")).toBe("locked_frame");
  });

  it("brand config takes precedence over hardcoded default", () => {
    expect(resolveHyperframesCameraPreset("trending", { cameraPresetByCategory: { trending: "portrait_float" } } as any)).toBe("portrait_float");
  });
});

describe("buildSceneMotion", () => {
  it("returns locked_frame with identity transforms", () => {
    const motion = buildSceneMotion("locked_frame", 0, 3);
    expect(motion.scaleStart).toBe(1);
    expect(motion.scaleEnd).toBe(1);
    expect(motion.translateXStart).toBe("0%");
    expect(motion.translateXEnd).toBe("0%");
    expect(motion.translateYStart).toBe("0%");
    expect(motion.translateYEnd).toBe("0%");
  });

  it("returns scale > 1 for non-locked presets", () => {
    const motion = buildSceneMotion("cinematic_drift", 0, 3);
    expect(motion.scaleEnd).toBeGreaterThan(1);
  });

  it("is deterministic: same inputs produce same outputs", () => {
    const a = buildSceneMotion("urgent_push", 2, 5);
    const b = buildSceneMotion("urgent_push", 2, 5);
    expect(a).toEqual(b);
  });

  it("varies by scene index within same preset", () => {
    const a = buildSceneMotion("cinematic_drift", 0, 3);
    const b = buildSceneMotion("cinematic_drift", 1, 3);
    const c = buildSceneMotion("cinematic_drift", 2, 3);
    const allSame = a.scaleStart === b.scaleStart && b.scaleStart === c.scaleStart
      && a.translateXStart === b.translateXStart && b.translateXStart === c.translateXStart;
    expect(allSame).toBe(false);
  });

  it("keeps scale within 1.0-1.12 range for all presets and scenes", () => {
    for (const preset of HYPERFRAMES_CAMERA_PRESETS) {
      for (let i = 0; i < 6; i++) {
        const motion = buildSceneMotion(preset, i, 6);
        expect(motion.scaleStart).toBeGreaterThanOrEqual(1.0);
        expect(motion.scaleStart).toBeLessThanOrEqual(1.12);
        expect(motion.scaleEnd).toBeGreaterThanOrEqual(1.0);
        expect(motion.scaleEnd).toBeLessThanOrEqual(1.12);
      }
    }
  });

  it("handles single scene without error", () => {
    const motion = buildSceneMotion("cinematic_drift", 0, 1);
    expect(motion.scaleEnd).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hyperframes-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/effects/hyperframes-presets.ts`**

```ts
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
  if (override) return override;

  if (category) {
    const configured = brandConfig?.cameraPresetByCategory?.[category];
    if (configured) return configured;

    const defaultPreset = DEFAULT_PRESET_BY_CATEGORY[category];
    if (defaultPreset) return defaultPreset;
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

const SUBTLE_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

function makePercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function varyByScene(base: number, index: number, count: number, amplitude: number): number {
  if (count <= 1) return base;
  const offset = ((index % count) / (count - 1) - 0.5) * 2 * amplitude;
  return base + offset;
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
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  const variation = varyByScene;

  if (preset === "cinematic_drift") {
    const scaleBase = 1.04;
    const scaleDelta = 0.04;
    const driftX = variation(1.0, sceneIndex, sceneCount, 0.5);
    const driftY = variation(0.5, sceneIndex, sceneCount, 0.3);
    return {
      scaleStart: scaleBase,
      scaleEnd: scaleBase + scaleDelta,
      translateXStart: makePercent(-driftX),
      translateXEnd: makePercent(driftX),
      translateYStart: makePercent(-driftY),
      translateYEnd: makePercent(driftY),
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  if (preset === "urgent_push") {
    const scaleBase = 1.02;
    const scaleDelta = variation(0.06, sceneIndex, sceneCount, 0.01);
    return {
      scaleStart: scaleBase,
      scaleEnd: scaleBase + scaleDelta,
      translateXStart: "0%",
      translateXEnd: "0%",
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  if (preset === "slow_reveal") {
    const scaleStart = 1.08;
    const scaleEnd = 1.03;
    const driftX = variation(0.5, sceneIndex, sceneCount, 0.3);
    return {
      scaleStart,
      scaleEnd,
      translateXStart: makePercent(-driftX),
      translateXEnd: makePercent(driftX),
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  if (preset === "documentary_slide") {
    const scale = 1.06;
    const direction = sceneIndex % 2 === 0 ? 1 : -1;
    const slideAmount = variation(1.5, sceneIndex, sceneCount, 0.4);
    return {
      scaleStart: scale,
      scaleEnd: scale,
      translateXStart: makePercent(-slideAmount * direction),
      translateXEnd: makePercent(slideAmount * direction),
      translateYStart: "0%",
      translateYEnd: "0%",
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  if (preset === "portrait_float") {
    const scale = 1.03;
    const driftX = variation(0.3, sceneIndex, sceneCount, 0.15);
    const driftY = variation(0.4, sceneIndex, sceneCount, 0.2);
    return {
      scaleStart: scale,
      scaleEnd: scale + 0.01,
      translateXStart: makePercent(-driftX),
      translateXEnd: makePercent(driftX),
      translateYStart: makePercent(-driftY),
      translateYEnd: makePercent(driftY),
      easing: SUBTLE_EASE,
      transformOrigin: "center center",
    };
  }

  return {
    scaleStart: 1,
    scaleEnd: 1,
    translateXStart: "0%",
    translateXEnd: "0%",
    translateYStart: "0%",
    translateYEnd: "0%",
    easing: SUBTLE_EASE,
    transformOrigin: "center center",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hyperframes-presets.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/hyperframes-presets.ts tests/hyperframes-presets.test.ts
git commit -m "feat: add hyperframes camera preset resolution and scene motion"
```

---

### Task 3: Integrate preset resolution into Hyperframes renderer

**Files:**
- Modify: `src/stages/reel-stage5-hyperframes-renderer.ts`
- Modify: `tests/reel-stage5-hyperframes-renderer.test.ts`

- [ ] **Step 1: Read current renderer and test to understand context**

Read `src/stages/reel-stage5-hyperframes-renderer.ts` (221 lines) and `tests/reel-stage5-hyperframes-renderer.test.ts`.

- [ ] **Step 2: Add preset resolution to the Hyperframes renderer**

In `src/stages/reel-stage5-hyperframes-renderer.ts`, add the import at the top:

```ts
import { resolveHyperframesCameraPreset } from "../effects/hyperframes-presets.js";
```

Inside the `run()` method, after `const category = ctx.category ?? ctx.script?.category;` (line 55), add:

```ts
    const cameraPreset = resolveHyperframesCameraPreset(category, ctx.brand.reels, ctx.cameraPreset);
    ctx.usedCameraPreset = cameraPreset;
```

Pass `cameraPreset` to the template by updating the `buildEnhancedDefaultHyperframesHtml` call (around line 66):

Change the call to include `cameraPreset`:

```ts
    fs.writeFileSync(htmlPath, buildEnhancedDefaultHyperframesHtml({
      ctx,
      cameraPreset,
      musicPath: resolvedMusic?.path,
      assetSrc: (filePath) => assetMap.get(filePath) ?? filePath,
      watermarkPath: watermarkSourcePath ? assetMap.get(watermarkSourcePath) : undefined,
    }));
```

Add `usedCameraPreset` to the return object (after `musicFile`, around line 108):

```ts
      usedCameraPreset: cameraPreset,
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: May fail because `buildEnhancedDefaultHyperframesHtml` doesn't accept `cameraPreset` yet. That's expected — Task 4 will fix this.

- [ ] **Step 4: Commit partial progress**

```bash
git add src/stages/reel-stage5-hyperframes-renderer.ts
git commit -m "feat: resolve camera preset in hyperframes renderer"
```

---

### Task 4: Add preset motion CSS to the enhanced-default template

**Files:**
- Modify: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Modify: `tests/reel-stage5-enhanced-template.test.ts`

- [ ] **Step 1: Update the template's options interface**

In `src/stages/reel-stage5-templates/enhanced-default.ts`, update the import to include the preset types:

```ts
import type { ReelContext, ReelScene, WordTiming, HyperframesCameraPreset } from "../../types.js";
```

Update the `BuildEnhancedDefaultHyperframesHtmlOptions` interface (line 11) to add:

```ts
  cameraPreset?: HyperframesCameraPreset;
```

- [ ] **Step 2: Import `buildSceneMotion` and generate per-scene CSS**

Add to imports at the top:

```ts
import { buildSceneMotion } from "../../effects/hyperframes-presets.js";
```

Inside `buildEnhancedDefaultHyperframesHtml`, after `const timedScenes = buildTimedScenes(ctx);`, add:

```ts
  const preset = cameraPreset ?? "locked_frame";
```

Change the `sceneClips` generation to include the oversized container and per-scene animation class. Replace the existing `sceneClips` block:

```ts
  const sceneMotionStyles = timedScenes.map(({ index }, i) => {
    const motion = buildSceneMotion(preset, i, timedScenes.length);
    const name = `scene-motion-${index + 1}`;
    return `@keyframes ${name} { from { transform: translate3d(${motion.translateXStart}, ${motion.translateYStart}, 0) scale(${motion.scaleStart}); } to { transform: translate3d(${motion.translateXEnd}, ${motion.translateYEnd}, 0) scale(${motion.scaleEnd}); } }`;
  }).join("\n      ");

  const sceneClips = timedScenes.map(({ index, start, duration, imagePath }, i) => `
      <section class="clip scene scene-${index + 1}" data-start="${start}" data-duration="${duration}" data-track-index="0">
        <div class="scene-image-wrapper"><img class="scene-image" src="${escapeAttr(resolveAssetSrc(imagePath))}" alt="" style="animation: scene-motion-${index + 1} ${duration}s ${SUBTLE_EASE} both; transform-origin: center center;" /></div>
        <div class="scrim"></div>
      </section>`).join("");
```

Where `SUBTLE_EASE` is a local constant:

```ts
const SUBTLE_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";
```

- [ ] **Step 3: Add CSS for oversized image wrapper**

In the `<style>` block, update `.scene-image` to remove its own sizing (the wrapper handles it), and add the wrapper:

Replace the existing `.scene-image` rule with:

```css
      .scene-image-wrapper {
        position: absolute;
        inset: -6%;
        overflow: visible;
      }
      .scene-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
```

The `inset: -6%` oversizes the image container so transforms don't show edges.

- [ ] **Step 4: Emit the keyframes in the style block**

In the `<style>` section, just before the closing `</style>`, add the keyframes output:

```css
      ${sceneMotionStyles}
```

- [ ] **Step 5: Write template tests**

Add to `tests/reel-stage5-enhanced-template.test.ts`:

```ts
  it("emits per-scene CSS keyframes when cameraPreset is set", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx(), cameraPreset: "cinematic_drift" });
    expect(html).toContain("@keyframes scene-motion-1");
    expect(html).toContain("@keyframes scene-motion-2");
    expect(html).toContain("animation: scene-motion-1");
    expect(html).toContain("scene-image-wrapper");
  });

  it("does not emit motion keyframes for locked_frame", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx(), cameraPreset: "locked_frame" });
    expect(html).not.toContain("@keyframes scene-motion-1");
  });
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/reel-stage5-enhanced-template.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/stages/reel-stage5-templates/enhanced-default.ts tests/reel-stage5-enhanced-template.test.ts
git commit -m "feat: add per-scene CSS motion to hyperframes template via camera preset"
```

---

### Task 5: Parse `-preset` flag in command listener

**Files:**
- Modify: `src/pipeline/command-listener.ts:34-80`
- Modify: `tests/reel-telegram-stage5-flags.test.ts`

- [ ] **Step 1: Add import for `HyperframesCameraPreset`**

At `src/pipeline/command-listener.ts` line 1, update the import to include:

```ts
import type { BrandId, ReelCategory, Theme, ImageSource, ReelScript, CategorySource, CameraEffectType, Stage5RendererType, Stage5TemplateName, HyperframesCameraPreset } from "../types.js";
```

- [ ] **Step 2: Add preset constant and update `ReelCommandFlags`**

After line 4 (`const CAMERA_EFFECT_TYPES...`), add:

```ts
const HYPERFRAMES_CAMERA_PRESETS: HyperframesCameraPreset[] = ["cinematic_drift", "urgent_push", "slow_reveal", "documentary_slide", "portrait_float", "locked_frame"];
```

Update the `ReelCommandFlags` interface (line 34) to add:

```ts
  cameraPreset?: HyperframesCameraPreset;
```

- [ ] **Step 3: Parse `-preset` in `parseReelCommandFlags`**

Inside the `for` loop in `parseReelCommandFlags` (around line 63, after the `-template` block), add:

```ts
    if (lower === "-preset") {
      const preset = tokens[i + 1]?.toLowerCase();
      if (preset && HYPERFRAMES_CAMERA_PRESETS.includes(preset as HyperframesCameraPreset)) {
        cameraPreset = preset as HyperframesCameraPreset;
        i++;
        continue;
      }
      cleanedTokens.push(token);
      continue;
    }
```

Declare `let cameraPreset: HyperframesCameraPreset | undefined;` alongside the other `let` declarations at the top of the function (after `let stage5Template`).

Add `cameraPreset` to the return object:

```ts
  return {
    cleaned: cleanedTokens.join(" "),
    useStockImages,
    stage5Renderer,
    stage5Template,
    cameraPreset,
  };
```

- [ ] **Step 4: Thread `cameraPreset` into `ReelRunner.run` call**

Around line 900, update the `ReelRunner.run` call to include `cameraPreset: commandFlags.cameraPreset`:

```ts
      ReelRunner.run(brandId, { theme: reelTheme, category: reelCategory, sourceUrls: reelUrls, categorySource: "manual" as const, useStockImages: manualUseStockImages, cameraEffect: reelCameraEffect, cameraPreset: commandFlags.cameraPreset, stage5Renderer: commandFlags.stage5Renderer, stage5Template: commandFlags.stage5Template }).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
```

Also add preset validation — if a preset is specified but renderer is ffmpeg (or would resolve to ffmpeg), reject early. Around line 899, before the `ReelRunner.run` call, add:

```ts
      if (commandFlags.cameraPreset && (commandFlags.stage5Renderer === "ffmpeg" || (!commandFlags.stage5Renderer && brand.reels?.stage5Renderer !== "hyperframes"))) {
        await telegram.sendMessage(chatId, `❌ Camera presets require Hyperframes renderer. Use -hf or -hyperframes flag.`);
        return;
      }
```

- [ ] **Step 5: Add preset to `re-effect` rebuild command**

Update `ReelRebuildCommand` interface (line 22) to add:

```ts
  cameraPresetOverride?: HyperframesCameraPreset;
```

In the `parseReelRebuildCommand` function's `re-effect` block (line 104), add support for preset names. After the existing effect validation check, add a fallback that checks presets:

```ts
  if (cmd === "re-effect") {
    if (args.length === 0) throw new Error("Usage: !reel re-effect [id] <effect|preset>");
    if (args.length === 1) {
      const val = args[0].toLowerCase();
      if (CAMERA_EFFECT_TYPES.includes(val as CameraEffectType)) return { part: "video", cameraEffectOverride: val as CameraEffectType };
      if (HYPERFRAMES_CAMERA_PRESETS.includes(val as HyperframesCameraPreset)) return { part: "video", cameraPresetOverride: val as HyperframesCameraPreset };
      throw new Error(`Unknown effect/preset "${args[0]}". Effects: ${CAMERA_EFFECT_TYPES.join(", ")}. Presets: ${HYPERFRAMES_CAMERA_PRESETS.join(", ")}`);
    }
    if (args.length === 2) {
      const val = args[1].toLowerCase();
      if (CAMERA_EFFECT_TYPES.includes(val as CameraEffectType)) return { part: "video", reelShortId: args[0], cameraEffectOverride: val as CameraEffectType };
      if (HYPERFRAMES_CAMERA_PRESETS.includes(val as HyperframesCameraPreset)) return { part: "video", reelShortId: args[0], cameraPresetOverride: val as HyperframesCameraPreset };
      throw new Error(`Unknown effect/preset "${args[1]}". Effects: ${CAMERA_EFFECT_TYPES.join(", ")}. Presets: ${HYPERFRAMES_CAMERA_PRESETS.join(", ")}`);
    }
    throw new Error("Usage: !reel re-effect [id] <effect|preset>");
  }
```

- [ ] **Step 6: Thread preset override into rebuild call**

Find the rebuild call that uses `parsed.cameraEffectOverride` (around line 800). Update to also pass `cameraPresetOverride`:

```ts
        cameraEffectOverride: parsed.cameraEffectOverride,
        cameraPresetOverride: parsed.cameraPresetOverride,
```

- [ ] **Step 7: Add command flag test**

Add to `tests/reel-telegram-stage5-flags.test.ts`:

```ts
  it("parses -preset cinematic_drift flag", () => {
    const { parseReelCommandFlags } = await import("../src/pipeline/command-listener.js");
    const flags = parseReelCommandFlags("breaking -preset cinematic_drift");
    expect(flags.cameraPreset).toBe("cinematic_drift");
    expect(flags.cleaned).toBe("breaking");
  });

  it("ignores unknown -preset values", () => {
    const { parseReelCommandFlags } = await import("../src/pipeline/command-listener.js");
    const flags = parseReelCommandFlags("breaking -preset unknown_preset");
    expect(flags.cameraPreset).toBeUndefined();
  });
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/reel-telegram-stage5-flags.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/command-listener.ts tests/reel-telegram-stage5-flags.test.ts
git commit -m "feat: parse -preset flag for hyperframes camera presets"
```

---

### Task 6: Thread `cameraPreset` through ReelRunner

**Files:**
- Modify: `src/pipeline/reel-runner.ts`

- [ ] **Step 1: Add `cameraPreset` to initial context in `run()`**

Around line 652, after `cameraEffect: options.cameraEffect,`, add:

```ts
      cameraPreset: options.cameraPreset,
```

- [ ] **Step 2: Add `cameraPreset` to context serialization in `saveReelContext()`**

Around line 220, after `cameraEffect: ctx.cameraEffect,`, add:

```ts
    cameraPreset: ctx.cameraPreset,
```

After `usedCameraEffect: ctx.usedCameraEffect,` (line 224), add:

```ts
    usedCameraPreset: ctx.usedCameraPreset,
```

- [ ] **Step 3: Add `cameraPreset` to context deserialization in all restore points**

In the `rerescript` method's stored context parsing (around line 897, after `cameraEffect: cameraEffectOverride,`), add:

```ts
      cameraPreset: undefined,
```

In the stored context type and restore for `rerescript` (around line 926), add to the stored type:

```ts
          cameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedCameraPreset?: import("../types.js").HyperframesCameraPreset;
```

And in the context restore (after `cameraEffect: stored.cameraEffect,`):

```ts
          cameraPreset: stored.cameraPreset,
          usedCameraPreset: stored.usedCameraPreset,
```

Repeat the same pattern for `rebuildPart`'s stored context (around line 1497), and the other restore points (around lines 1136 and 1317).

- [ ] **Step 4: Add `cameraPresetOverride` to `rebuildPart` options**

Update the `rebuildPart` signature (line 1443) to include:

```ts
    options?: { useStockImagesOverride?: boolean; musicTrackSelector?: string; cameraEffectOverride?: import("../types.js").CameraEffectType; cameraPresetOverride?: import("../types.js").HyperframesCameraPreset; voiceSpeedOverride?: number; voiceIdOverride?: string; stage5Renderer?: Stage5RendererType; stage5Template?: Stage5TemplateName },
```

And at the bottom of `rebuildPart` (after line 1542, `if (options?.cameraEffectOverride)`), add:

```ts
    if (options?.cameraPresetOverride) ctx.cameraPreset = options.cameraPresetOverride;
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/reel-runner.ts
git commit -m "feat: thread cameraPreset through reel runner context"
```

---

### Task 7: Display preset badge on review page

**Files:**
- Modify: `src/review/reel-html-builder.ts:82-98`

- [ ] **Step 1: Add preset label and icon to review HTML**

At `src/review/reel-html-builder.ts`, after line 82 (`const effectLabel = ...`), add:

```ts
  const presetLabel = ctx.usedCameraPreset ?? ctx.cameraPreset ?? undefined;
```

After the `effectIcon` object (line 94-98), add:

```ts
  const presetIcon: Record<string, string> = {
    cinematic_drift: "🎬", urgent_push: "⚡", slow_reveal: "🔍",
    documentary_slide: "📽️", portrait_float: "🌀", locked_frame: "⏹️",
  };
```

Find where the effect badge is rendered in the HTML and add a preset badge alongside it. Search for `effectLabel` usage in the template string and add after it:

```ts
${presetLabel ? `<span style="display:inline-block;background:#4a5568;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;letter-spacing:0.04em;">${presetIcon[presetLabel] ?? "🎬"} ${(presetLabel ?? "").toUpperCase()}</span>` : ""}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/review/reel-html-builder.ts
git commit -m "feat: display camera preset badge on reel review page"
```

---

### Task 8: Add `cameraPresetByCategory` to brand configs

**Files:**
- Modify: `src/brands/ds.ts:125`
- Modify: `src/brands/ns.ts:113`

- [ ] **Step 1: Add preset config to `ds.ts`**

After the `cameraEffectByCategory` block in `src/brands/ds.ts` (line 131), add:

```ts
    cameraPresetByCategory: {
      breaking:       "urgent_push",
      trending:       "cinematic_drift",
      human_interest: "documentary_slide",
      business:       "slow_reveal",
      open:           "cinematic_drift",
    },
```

- [ ] **Step 2: Add preset config to `ns.ts`**

After the `cameraEffectByCategory` block in `src/brands/ns.ts` (line 119), add the same:

```ts
    cameraPresetByCategory: {
      breaking:       "urgent_push",
      trending:       "cinematic_drift",
      human_interest: "documentary_slide",
      business:       "slow_reveal",
      open:           "cinematic_drift",
    },
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/brands/ds.ts src/brands/ns.ts
git commit -m "feat: add cameraPresetByCategory to brand configs"
```

---

### Task 9: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run lint if available**

Run: `npm run lint 2>/dev/null || true`
Expected: No new errors.
