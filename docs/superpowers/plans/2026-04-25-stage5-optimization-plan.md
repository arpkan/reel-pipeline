# Reel Stage 5 Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `reel-stage5-assemble` wall-clock time and improve speed-per-dollar on current EC2 `t3.medium` while preserving current operator workflows.

**Architecture:** Introduce an explicit Stage 5 performance profile (`fast|balanced|high`) and thread it through camera filter construction and ffmpeg encode settings. Refactor Stage 5 internals into focused builders to make heavy-path tuning testable, then add scene-level timing telemetry to prove gains. Preserve existing command contracts and keep `balanced` as the default compatibility profile.

**Tech Stack:** TypeScript, Node.js, FFmpeg/ffprobe, Vitest, Drizzle-backed pipeline context

---

## File Structure (planned changes)

- Create: `src/stages/reel-stage5-performance.ts`
  - Owns profile types, defaults, and resolution logic (`effectQuality`, fps, preset, scale cap).
- Modify: `src/types.ts`
  - Extend `ReelConfig` and `ReelContext` with optional Stage 5 performance settings.
- Modify: `src/brands/ds.ts`
  - Set explicit Stage 5 default profile for ThaiDaily.
- Modify: `src/brands/ns.ts`
  - Set explicit Stage 5 default profile for WorldBrief.
- Modify: `src/effects/camera-effects.ts`
  - Replace hardcoded `scale=8000` with bounded scale/fps settings.
- Create: `src/stages/reel-stage5-ffmpeg-builder.ts`
  - Pure builders for encode args and filter graph fragments.
- Modify: `src/stages/reel-stage5-assemble.ts`
  - Integrate profile resolution, builder usage, and timing telemetry.
- Create: `tests/reel-stage5-performance.test.ts`
  - Unit tests for profile resolution.
- Create: `tests/camera-effects.test.ts`
  - Unit tests for bounded effect filter generation.
- Create: `tests/reel-stage5-ffmpeg-builder.test.ts`
  - Deterministic tests for generated ffmpeg args.
- Modify: `docs/superpowers/specs/2026-04-25-assembly-stage5-optimization-design.md`
  - Mark status as implemented after delivery (final step).

---

### Task 1: Add Stage 5 performance profile model and defaults

**Files:**
- Create: `src/stages/reel-stage5-performance.ts`
- Modify: `src/types.ts`
- Modify: `src/brands/ds.ts`
- Modify: `src/brands/ns.ts`
- Test: `tests/reel-stage5-performance.test.ts`

- [ ] **Step 1: Write the failing test for profile resolution**

```ts
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
    const out = resolveStage5Performance({ effectQuality: "high", targetFps: 30, bgScaleCap: 3072, videoPreset: "faster" });
    expect(out.targetFps).toBe(30);
    expect(out.bgScaleCap).toBe(3072);
    expect(out.videoPreset).toBe("faster");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage5-performance.test.ts`
Expected: FAIL with module/function not found for `resolveStage5Performance`.

- [ ] **Step 3: Implement profile types and resolver**

```ts
// src/stages/reel-stage5-performance.ts
export type Stage5EffectQuality = "fast" | "balanced" | "high";

export interface Stage5PerformanceConfig {
  effectQuality?: Stage5EffectQuality;
  targetFps?: number;
  videoPreset?: "veryfast" | "faster" | "medium";
  bgScaleCap?: number;
}

export interface ResolvedStage5Performance {
  effectQuality: Stage5EffectQuality;
  targetFps: number;
  videoPreset: "veryfast" | "faster" | "medium";
  bgScaleCap: number;
}

const DEFAULTS: Record<Stage5EffectQuality, Omit<ResolvedStage5Performance, "effectQuality">> = {
  fast: { targetFps: 20, videoPreset: "veryfast", bgScaleCap: 1920 },
  balanced: { targetFps: 24, videoPreset: "veryfast", bgScaleCap: 2560 },
  high: { targetFps: 30, videoPreset: "faster", bgScaleCap: 3072 },
};

export function resolveStage5Performance(cfg?: Stage5PerformanceConfig): ResolvedStage5Performance {
  const effectQuality = cfg?.effectQuality ?? "balanced";
  const base = DEFAULTS[effectQuality];
  return {
    effectQuality,
    targetFps: cfg?.targetFps ?? base.targetFps,
    videoPreset: cfg?.videoPreset ?? base.videoPreset,
    bgScaleCap: cfg?.bgScaleCap ?? base.bgScaleCap,
  };
}
```

- [ ] **Step 4: Extend pipeline types and brand config defaults**

```ts
// src/types.ts additions
import type { Stage5PerformanceConfig } from "./stages/reel-stage5-performance.js";

export interface ReelConfig {
  // ...existing fields...
  stage5Performance?: Stage5PerformanceConfig;
}

export interface ReelContext {
  // ...existing fields...
  stage5Performance?: Stage5PerformanceConfig;
}
```

```ts
// src/brands/ds.ts and src/brands/ns.ts inside reels
stage5Performance: {
  effectQuality: "balanced",
},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/reel-stage5-performance.test.ts`
Expected: PASS (all profile resolution assertions green).

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage5-performance.ts src/types.ts src/brands/ds.ts src/brands/ns.ts tests/reel-stage5-performance.test.ts
git commit -m "feat: add stage5 performance profile defaults"
```

---

### Task 2: Optimize camera effect filter generation with bounded scaling

**Files:**
- Modify: `src/effects/camera-effects.ts`
- Test: `tests/camera-effects.test.ts`

- [ ] **Step 1: Write failing tests for bounded scaling and fps threading**

```ts
import { describe, expect, it } from "vitest";
import { buildBgFilter } from "../src/effects/camera-effects.js";

describe("buildBgFilter", () => {
  it("does not use scale=8000 for motion effects", () => {
    const filter = buildBgFilter("zoom_in", 8, 24, 2560);
    expect(filter.includes("scale=8000")).toBe(false);
  });

  it("uses provided fps and cap for zoom_in", () => {
    const filter = buildBgFilter("zoom_in", 8, 20, 1920);
    expect(filter).toContain("fps=20");
    expect(filter).toContain("scale=1920:-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/camera-effects.test.ts`
Expected: FAIL due to signature mismatch and/or `scale=8000` assertions.

- [ ] **Step 3: Implement bounded-scale filter builder**

```ts
// src/effects/camera-effects.ts signature update
export function buildBgFilter(
  effect: CameraEffectType,
  totalDurationSeconds: number,
  fps = 25,
  bgScaleCap = 2560,
): string {
  const frames = Math.max(1, Math.round(totalDurationSeconds * fps));
  const scaleWide = `scale=${bgScaleCap}:-1`;
  const scaleTall = `scale=-1:${bgScaleCap}`;

  // use scaleWide/scaleTall in motion branches, never 8000
  // keep existing effect naming and fallback behavior
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/camera-effects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/camera-effects.ts tests/camera-effects.test.ts
git commit -m "perf: bound reel camera-effect scaling for stage5"
```

---

### Task 3: Extract deterministic FFmpeg argument builders and test them

**Files:**
- Create: `src/stages/reel-stage5-ffmpeg-builder.ts`
- Modify: `src/stages/reel-stage5-assemble.ts`
- Test: `tests/reel-stage5-ffmpeg-builder.test.ts`

- [ ] **Step 1: Write failing tests for encode args with profile values**

```ts
import { describe, expect, it } from "vitest";
import { buildEncodeTailArgs } from "../src/stages/reel-stage5-ffmpeg-builder.js";

describe("buildEncodeTailArgs", () => {
  it("includes libx264 preset and audio settings", () => {
    const args = buildEncodeTailArgs({
      videoPreset: "veryfast",
      totalDuration: 9.2,
      stillImageTune: true,
      mapVideoLabel: "vtmp",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-preset");
    expect(args).toContain("veryfast");
    expect(args).toContain("-b:a");
    expect(args).toContain("192k");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: FAIL because builder module does not exist.

- [ ] **Step 3: Implement pure ffmpeg arg builders and wire Stage 5 to use them**

```ts
// src/stages/reel-stage5-ffmpeg-builder.ts
export function buildEncodeTailArgs(input: {
  videoPreset: "veryfast" | "faster" | "medium";
  totalDuration: number;
  stillImageTune: boolean;
  mapVideoLabel: string;
}): string[] {
  return [
    "-map", `[${input.mapVideoLabel}]`, "-map", "[delayed_audio]",
    "-c:v", "libx264",
    "-preset", input.videoPreset,
    ...(input.stillImageTune ? ["-tune", "stillimage"] : []),
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(input.totalDuration), "-pix_fmt", "yuv420p",
  ];
}
```

- [ ] **Step 4: Run targeted tests to verify pass**

Run: `npm test -- tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage5-ffmpeg-builder.ts src/stages/reel-stage5-assemble.ts tests/reel-stage5-ffmpeg-builder.test.ts
git commit -m "refactor: extract stage5 ffmpeg argument builders"
```

---

### Task 4: Integrate profile tuning and timing telemetry into Stage 5

**Files:**
- Modify: `src/stages/reel-stage5-assemble.ts`
- Modify: `src/pipeline/reel-runner.ts`
- Test: `tests/reel-stage5-ffmpeg-builder.test.ts` (extend)

- [ ] **Step 1: Write failing test for telemetry shape helper**

```ts
import { describe, expect, it } from "vitest";
import { buildScenePerfLog } from "../src/stages/reel-stage5-assemble.js";

describe("buildScenePerfLog", () => {
  it("formats scene performance payload with profile", () => {
    const row = buildScenePerfLog({ sceneNumber: 2, profile: "balanced", renderMs: 420, encodeMs: 1800 });
    expect(row).toContain("scene=2");
    expect(row).toContain("profile=balanced");
    expect(row).toContain("encodeMs=1800");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement profile resolution and timing instrumentation in Stage 5**

```ts
// reel-stage5-assemble.ts (inside run)
const perf = resolveStage5Performance(ctx.stage5Performance ?? ctx.brand.reels?.stage5Performance);
const scenePerf: Array<{ scene: number; renderMs: number; encodeMs: number }> = [];

// when building bg filter
filterParts.push(buildBgFilter(cameraEffect, totalDuration, perf.targetFps, perf.bgScaleCap));

// when building encode args
ffmpegArgs.push(...buildEncodeTailArgs({
  videoPreset: perf.videoPreset,
  totalDuration,
  stillImageTune: cameraEffect === "none",
  mapVideoLabel: finalV,
}));

// after each scene
scenePerf.push({ scene: scene.sceneNumber, renderMs, encodeMs });
console.log(buildScenePerfLog({ sceneNumber: scene.sceneNumber, profile: perf.effectQuality, renderMs, encodeMs }));
```

- [ ] **Step 4: Persist minimal telemetry context for debugging**

```ts
// reel-runner.ts -> buildPersistedReelContext
return {
  // ...existing fields
  stage5Performance: ctx.stage5Performance,
};
```

- [ ] **Step 5: Run verification tests**

Run: `npm test -- tests/reel-stage5-performance.test.ts tests/camera-effects.test.ts tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage5-assemble.ts src/pipeline/reel-runner.ts tests/reel-stage5-performance.test.ts tests/camera-effects.test.ts tests/reel-stage5-ffmpeg-builder.test.ts
git commit -m "perf: apply stage5 profile tuning and timing telemetry"
```

---

### Task 5: Reduce subtitle overlay fan-out in safe, incremental way

**Files:**
- Modify: `src/stages/reel-stage5-assemble.ts`
- Test: `tests/reel-stage5-ffmpeg-builder.test.ts` (extend)

- [ ] **Step 1: Write failing test for highlight-skipping policy**

```ts
import { describe, expect, it } from "vitest";
import { shouldRenderHighlight } from "../src/stages/reel-stage5-assemble.js";

describe("shouldRenderHighlight", () => {
  it("skips highlight frames for very short words", () => {
    expect(shouldRenderHighlight(0.02)).toBe(false);
    expect(shouldRenderHighlight(0.12)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: FAIL because helper is undefined.

- [ ] **Step 3: Implement conservative fan-out reduction**

```ts
// reel-stage5-assemble.ts
export function shouldRenderHighlight(wordDuration: number): boolean {
  return wordDuration >= 0.05;
}

// inside highlight generation loop
const duration = block[wi].end - block[wi].start;
if (!shouldRenderHighlight(duration)) continue;
```

- [ ] **Step 4: Re-run targeted tests**

Run: `npm test -- tests/reel-stage5-ffmpeg-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage5-assemble.ts tests/reel-stage5-ffmpeg-builder.test.ts
git commit -m "perf: reduce stage5 subtitle overlay fan-out for short word spans"
```

---

### Task 6: End-to-end verification and docs closure

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-assembly-stage5-optimization-design.md`

- [ ] **Step 1: Run full targeted reel test suite**

Run: `npm test -- tests/reel-stage3-voice.test.ts tests/reel-stage3-stock.test.ts tests/reel-music-selector.test.ts tests/reel-runner-rebuild-part.test.ts tests/reel-runner-rebuild-part-cancel.test.ts`
Expected: PASS.

- [ ] **Step 2: Run complete project test suite**

Run: `npm test`
Expected: PASS with no new failures.

- [ ] **Step 3: Mark spec status as implemented and summarize measured result fields**

```md
**Status:** Implemented

Implementation note:
- Added Stage 5 performance profile controls.
- Replaced unbounded effect scaling path.
- Added scene-level timing telemetry for render/encode/mix.
```

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/specs/2026-04-25-assembly-stage5-optimization-design.md
git commit -m "docs: close stage5 optimization spec after implementation"
```

---

## Plan Self-Review

### Spec coverage check

- Performance profile (`effectQuality`, fps, preset, scale cap): covered in Tasks 1 and 4.
- Camera effect optimization (`scale=8000` removal): covered in Task 2.
- Stage 5 modularization and tunable encode path: covered in Task 3.
- Subtitle overlay overhead reduction: covered in Task 5.
- Telemetry and measurable verification: covered in Tasks 4 and 6.
- Backward compatibility and command continuity: preserved by scoped file changes and no command-surface changes.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation placeholders.
- All code-modifying steps include concrete code snippets.
- All test/verification steps include exact commands and expected outcomes.

### Type consistency check

- `Stage5PerformanceConfig` and resolver names are consistent across tasks.
- `buildBgFilter` signature update is referenced consistently where consumed.
- `effectQuality`, `targetFps`, `videoPreset`, `bgScaleCap` naming is consistent across tests and implementation steps.
