# Hyperframes Stage 5 Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable Hyperframes stage 5 renderer for reels with one enhanced default template while preserving the existing FFmpeg renderer and offload flow.

**Architecture:** Add a small renderer facade used by both local reel runs and EC2 offload workers. The facade resolves `ffmpeg` or `hyperframes` from per-run context, brand config, then default, and persists renderer/template/telemetry in reel context. The Hyperframes renderer generates a per-run composition inside `work/reels/<runId>/hyperframes`, renders with `@hyperframes/producer`, uploads through the existing GCS service, and fails clearly without fallback.

**Tech Stack:** TypeScript ESM, Vitest, Drizzle/better-sqlite3 context JSON, GCS service, existing reel runner/offload worker, Hyperframes `@hyperframes/producer`, GSAP loaded in generated HTML.

---

## File Structure

- Modify `package.json`: add `@hyperframes/producer` dependency.
- Modify `src/types.ts`: add stage 5 renderer/template/render-settings/telemetry types and fields on `ReelConfig`, `ReelContext`, and `ReelRunOptions`.
- Create `src/stages/reel-stage5-renderer.ts`: renderer interface, defaults, selector, render settings resolver, facade class.
- Create `src/stages/reel-stage5-ffmpeg-renderer.ts`: small wrapper around existing `ReelStage5Assemble`.
- Create `src/stages/reel-stage5-hyperframes-renderer.ts`: composition generation, Hyperframes lint/render execution, upload, telemetry.
- Create `src/stages/reel-stage5-templates/enhanced-default.ts`: deterministic HTML generation and template helper functions.
- Modify `src/stages/reel-music-selector.ts`: add shared music resolution helper so FFmpeg and Hyperframes choose tracks consistently.
- Modify `src/stages/reel-stage5-assemble.ts`: use shared music helper and add FFmpeg renderer telemetry.
- Modify `src/pipeline/reel-runner.ts`: persist selected renderer/template/settings before local/offload stage 5 execution, pass overrides through run/resume/rebuild paths.
- Modify `src/workers/reel-assembly-worker.ts`: reconstruct persisted renderer/template/settings/telemetry and use the facade by default.
- Modify `src/review/reel-html-builder.ts`: show renderer/template/performance metadata.
- Modify `bin/run.ts`: support `--stage5-renderer ffmpeg|hyperframes` and `--stage5-template enhanced-default` for reel CLI runs.
- Modify `src/pipeline/command-listener.ts`: support `-hf`, `-ffmpeg`, and `-template enhanced-default` flags for manual reel generation and rebuild commands.
- Create `tests/reel-stage5-renderer.test.ts`: selector, settings, facade, no-fallback behavior.
- Create `tests/reel-stage5-enhanced-template.test.ts`: generated HTML constraints.
- Create `tests/reel-stage5-hyperframes-renderer.test.ts`: renderer behavior with mocked producer/GCS/filesystem-light fixture.
- Modify `tests/reel-assembly-worker.test.ts`: prove persisted renderer metadata reaches worker stage 5 context.
- Modify `tests/reel-stage5-offload-toggle.test.ts`: prove dispatched context includes renderer metadata.
- Modify or create CLI/command listener tests for override parsing.

---

### Task 1: Add Stage 5 Renderer Types And Selector

**Files:**
- Modify: `src/types.ts`
- Create: `src/stages/reel-stage5-renderer.ts`
- Test: `tests/reel-stage5-renderer.test.ts`

- [ ] **Step 1: Write failing selector tests**

Add `tests/reel-stage5-renderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ReelContext } from "../src/types.js";

vi.mock("../src/db/queries.js", () => ({ updateReel: vi.fn() }));

function makeCtx(overrides: Partial<ReelContext> = {}): ReelContext {
  return {
    runId: "run-renderer-test",
    brand: {
      id: "ns",
      name: "WorldBrief",
      language: "en",
      timezone: "Europe/Berlin",
      postTimes: [],
      weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
      pillars: [],
      trustedSources: [],
      geographicFocus: "Europe",
      captionRules: {},
      themeWeights: {},
      viralCheck: false,
      gcsPrefix: "nscontent",
      metaPageId: "",
      metaPageToken: "",
      channels: {},
      useStockImages: true,
      reels: { enabled: true, voiceId: "v", sceneCount: 4, reelTimes: [], stage5Performance: { effectQuality: "balanced" } },
    },
    runDate: "2026-04-28",
    status: "running",
    stageLogs: [],
    ...overrides,
  };
}

describe("resolveStage5RendererSelection", () => {
  it("uses per-run renderer before brand config", async () => {
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");
    const ctx = makeCtx({
      stage5Renderer: "hyperframes",
      brand: { ...makeCtx().brand, reels: { ...makeCtx().brand.reels!, stage5Renderer: "ffmpeg" } },
    });

    expect(resolveStage5RendererSelection(ctx)).toEqual({
      renderer: "hyperframes",
      template: "enhanced-default",
    });
  });

  it("uses brand renderer when run override is absent", async () => {
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");
    const ctx = makeCtx({
      brand: { ...makeCtx().brand, reels: { ...makeCtx().brand.reels!, stage5Renderer: "hyperframes" } },
    });

    expect(resolveStage5RendererSelection(ctx)).toEqual({
      renderer: "hyperframes",
      template: "enhanced-default",
    });
  });

  it("defaults to ffmpeg", async () => {
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");
    expect(resolveStage5RendererSelection(makeCtx())).toEqual({ renderer: "ffmpeg" });
  });

  it("maps performance profiles to render settings", async () => {
    const { resolveStage5RenderSettings } = await import("../src/stages/reel-stage5-renderer.js");

    expect(resolveStage5RenderSettings(makeCtx({ stage5Renderer: "hyperframes" }))).toEqual({
      fps: 24,
      quality: "standard",
      workers: 1,
      timeoutMs: 30 * 60_000,
      performanceProfile: "balanced",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage5-renderer.test.ts`

Expected: FAIL with module not found for `reel-stage5-renderer.js` or missing exported functions.

- [ ] **Step 3: Add renderer types**

Modify `src/types.ts`:

```ts
export type Stage5RendererType = "ffmpeg" | "hyperframes";
export type Stage5TemplateName = "enhanced-default";
export type HyperframesRenderQuality = "draft" | "standard" | "high";

export interface Stage5RenderSettings {
  fps: number;
  quality: HyperframesRenderQuality;
  workers: number;
  timeoutMs: number;
  performanceProfile: import("./stages/reel-stage5-performance.js").Stage5EffectQuality;
}

export interface Stage5RenderTelemetry {
  renderer: Stage5RendererType;
  template?: Stage5TemplateName;
  fps?: number;
  quality?: HyperframesRenderQuality;
  workers?: number;
  durationMs: number;
  outputBytes?: number;
  mode?: "local" | "offloaded";
}
```

Extend `ReelConfig`:

```ts
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
```

Extend `ReelContext`:

```ts
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  stage5RenderSettings?: Stage5RenderSettings;
  stage5RenderTelemetry?: Stage5RenderTelemetry;
```

Extend `ReelRunOptions`:

```ts
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
```

- [ ] **Step 4: Implement selector and facade shell**

Create `src/stages/reel-stage5-renderer.ts`:

```ts
import type {
  ReelContext,
  ReelStage,
  Stage5RendererType,
  Stage5RenderSettings,
  Stage5TemplateName,
} from "../types.js";
import { resolveStage5Performance } from "./reel-stage5-performance.js";

export interface Stage5Renderer {
  readonly renderer: Stage5RendererType;
  run(ctx: ReelContext): Promise<Partial<ReelContext>>;
}

export interface Stage5RendererSelection {
  renderer: Stage5RendererType;
  template?: Stage5TemplateName;
}

const DEFAULT_HYPERFRAMES_TEMPLATE: Stage5TemplateName = "enhanced-default";

export function resolveStage5RendererSelection(ctx: ReelContext): Stage5RendererSelection {
  const renderer = ctx.stage5Renderer ?? ctx.brand.reels?.stage5Renderer ?? "ffmpeg";
  if (renderer === "hyperframes") {
    return {
      renderer,
      template: ctx.stage5Template ?? ctx.brand.reels?.stage5Template ?? DEFAULT_HYPERFRAMES_TEMPLATE,
    };
  }
  return { renderer: "ffmpeg" };
}

export function resolveStage5RenderSettings(ctx: ReelContext): Stage5RenderSettings {
  const profile = resolveStage5Performance(ctx.stage5Performance ?? ctx.brand.reels?.stage5Performance);
  const qualityByProfile = {
    fast: "draft",
    balanced: "standard",
    high: "high",
  } as const;

  return {
    fps: profile.targetFps,
    quality: qualityByProfile[profile.effectQuality],
    workers: 1,
    timeoutMs: ctx.stage5Renderer === "hyperframes" ? 30 * 60_000 : 15 * 60_000,
    performanceProfile: profile.effectQuality,
  };
}

export async function createStage5Renderer(ctx: ReelContext): Promise<Stage5Renderer> {
  const selection = resolveStage5RendererSelection(ctx);
  if (selection.renderer === "hyperframes") {
    const { HyperframesStage5Renderer } = await import("./reel-stage5-hyperframes-renderer.js");
    return new HyperframesStage5Renderer();
  }
  const { FfmpegStage5Renderer } = await import("./reel-stage5-ffmpeg-renderer.js");
  return new FfmpegStage5Renderer();
}

export class ReelStage5Facade implements ReelStage {
  name = "reel-stage5-assemble";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    const selection = resolveStage5RendererSelection(ctx);
    const settings = resolveStage5RenderSettings({ ...ctx, ...selection });
    const renderer = await createStage5Renderer({
      ...ctx,
      stage5Renderer: selection.renderer,
      stage5Template: selection.template,
      stage5RenderSettings: settings,
    });
    return renderer.run({
      ...ctx,
      stage5Renderer: selection.renderer,
      stage5Template: selection.template,
      stage5RenderSettings: settings,
    });
  }
}
```

- [ ] **Step 5: Add temporary renderer wrappers so imports compile**

Create `src/stages/reel-stage5-ffmpeg-renderer.ts`:

```ts
import type { ReelContext, Stage5RendererType } from "../types.js";
import type { Stage5Renderer } from "./reel-stage5-renderer.js";
import { ReelStage5Assemble } from "./reel-stage5-assemble.js";

export class FfmpegStage5Renderer implements Stage5Renderer {
  readonly renderer: Stage5RendererType = "ffmpeg";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    return new ReelStage5Assemble().run(ctx);
  }
}
```

Create `src/stages/reel-stage5-hyperframes-renderer.ts`:

```ts
import type { ReelContext, Stage5RendererType } from "../types.js";
import type { Stage5Renderer } from "./reel-stage5-renderer.js";

export class HyperframesStage5Renderer implements Stage5Renderer {
  readonly renderer: Stage5RendererType = "hyperframes";

  async run(_ctx: ReelContext): Promise<Partial<ReelContext>> {
    throw new Error("Hyperframes renderer is not implemented yet");
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/reel-stage5-renderer.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/stages/reel-stage5-renderer.ts src/stages/reel-stage5-ffmpeg-renderer.ts src/stages/reel-stage5-hyperframes-renderer.ts tests/reel-stage5-renderer.test.ts
git commit -m "feat: add stage5 renderer selection"
```

---

### Task 2: Persist Renderer Metadata Through Local And Offload Paths

**Files:**
- Modify: `src/pipeline/reel-runner.ts`
- Modify: `src/workers/reel-assembly-worker.ts`
- Modify: `tests/reel-stage5-offload-toggle.test.ts`
- Modify: `tests/reel-assembly-worker.test.ts`

- [ ] **Step 1: Write failing offload context test**

In `tests/reel-stage5-offload-toggle.test.ts`, update the `persistedContext` in the first `runReelStage5Boundary` test:

```ts
    const persistedContext = {
      imageSourceMap: { 1: { type: "stock", provider: "unsplash" } },
      apiSourceMap: { captions: "bedrock", discovery: "tavily", images: "imagen" },
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: {
        fps: 24,
        quality: "standard",
        workers: 1,
        timeoutMs: 30 * 60_000,
        performanceProfile: "balanced",
      },
    };
```

The existing assertion should continue to expect `context: persistedContext`.

- [ ] **Step 2: Write failing worker reconstruction test**

In `tests/reel-assembly-worker.test.ts`, add this test after `marks job succeeded and updates reel on success`:

```ts
  it("passes persisted stage5 renderer metadata to the worker renderer", async () => {
    getAssemblyJobByIdMock.mockReturnValue({ id: "job-renderer", runId: "run-renderer", brand: "ds", status: "running" });
    getReelByIdMock.mockReturnValue({
      id: "run-renderer",
      brand: "ds",
      runDate: "2026-04-28",
      script: JSON.stringify({ scenes: [{ sceneNumber: 1 }] }),
      context: JSON.stringify({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
        stage5RenderSettings: {
          fps: 24,
          quality: "standard",
          workers: 1,
          timeoutMs: 1800000,
          performanceProfile: "balanced",
        },
      }),
      category: "trending",
      sourceUrl: "https://example.com/story",
      headline: "test",
      snippet: "test",
    });
    getBrandMock.mockReturnValue({ id: "ds", gcsPrefix: "dscontent", reels: {} });

    const runStage5 = vi.fn(async () => ({
      videoGcsUrl: "https://gcs/reel-renderer.mp4",
      stage5RenderTelemetry: { renderer: "hyperframes", template: "enhanced-default", durationMs: 1234 },
    }));

    await runAssemblyJob(
      { jobId: "job-renderer" },
      { runStage5, registerTerminationSignals: () => () => {} },
    );

    expect(runStage5).toHaveBeenCalledWith(
      expect.objectContaining({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
        stage5RenderSettings: expect.objectContaining({ fps: 24, quality: "standard" }),
      }),
    );
    expect(updateReelMock).toHaveBeenCalledWith(
      "run-renderer",
      expect.objectContaining({
        context: expect.objectContaining({
          stage5Renderer: "hyperframes",
          stage5Template: "enhanced-default",
          stage5RenderTelemetry: expect.objectContaining({ renderer: "hyperframes", durationMs: 1234 }),
        }),
      }),
    );
  });
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/reel-stage5-offload-toggle.test.ts tests/reel-assembly-worker.test.ts`

Expected: FAIL because `buildPersistedReelContext` and worker context reconstruction do not include stage 5 renderer fields.

- [ ] **Step 4: Persist renderer fields in reel runner**

Modify `src/pipeline/reel-runner.ts` import list:

```ts
import { pickMusicFile } from "../stages/reel-music-selector.js";
import { ReelStage5Facade, resolveStage5RendererSelection, resolveStage5RenderSettings } from "../stages/reel-stage5-renderer.js";
```

Add these fields in `buildPersistedReelContext(ctx)`:

```ts
    stage5Renderer: ctx.stage5Renderer,
    stage5Template: ctx.stage5Template,
    stage5RenderSettings: ctx.stage5RenderSettings,
    stage5RenderTelemetry: ctx.stage5RenderTelemetry,
```

Before the stage list creates stage 5 in the initial run path, resolve and attach selection:

```ts
      const stage5Selection = resolveStage5RendererSelection(ctx);
      ctx = {
        ...ctx,
        stage5Renderer: stage5Selection.renderer,
        stage5Template: stage5Selection.template,
      };
      ctx = { ...ctx, stage5RenderSettings: resolveStage5RenderSettings(ctx) };
```

Replace local stage 5 creation:

```ts
      const stage5 = new ReelStage5Facade();
```

Apply the same `ReelStage5Facade` replacement anywhere `new ReelStage5Assemble()` is used for resume, rebuild, rerescript, or rebuild part video paths. Keep dynamic imports for other stages unchanged.

- [ ] **Step 5: Reconstruct renderer fields in worker**

Modify `src/workers/reel-assembly-worker.ts` import:

```ts
import { ReelStage5Facade } from "../stages/reel-stage5-renderer.js";
```

Replace default `runStage5`:

```ts
  const runStage5 = deps.runStage5 ?? (async (ctx: ReelContext) => new ReelStage5Facade().run(ctx));
```

Add to worker `buildPersistedReelContext(ctx)`:

```ts
    ...(ctx.stage5Renderer !== undefined && { stage5Renderer: ctx.stage5Renderer }),
    ...(ctx.stage5Template !== undefined && { stage5Template: ctx.stage5Template }),
    ...(ctx.stage5RenderSettings !== undefined && { stage5RenderSettings: ctx.stage5RenderSettings }),
    ...(ctx.stage5RenderTelemetry !== undefined && { stage5RenderTelemetry: ctx.stage5RenderTelemetry }),
```

Add to reconstructed `ctx`:

```ts
      ...(storedContext.stage5Renderer !== undefined && { stage5Renderer: storedContext.stage5Renderer as ReelContext["stage5Renderer"] }),
      ...(storedContext.stage5Template !== undefined && { stage5Template: storedContext.stage5Template as ReelContext["stage5Template"] }),
      ...(storedContext.stage5RenderSettings !== undefined && { stage5RenderSettings: storedContext.stage5RenderSettings as ReelContext["stage5RenderSettings"] }),
      ...(storedContext.stage5RenderTelemetry !== undefined && { stage5RenderTelemetry: storedContext.stage5RenderTelemetry as ReelContext["stage5RenderTelemetry"] }),
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- tests/reel-stage5-offload-toggle.test.ts tests/reel-assembly-worker.test.ts tests/reel-stage5-renderer.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/reel-runner.ts src/workers/reel-assembly-worker.ts tests/reel-stage5-offload-toggle.test.ts tests/reel-assembly-worker.test.ts
git commit -m "feat: persist stage5 renderer metadata"
```

---

### Task 3: Add Shared Music Resolution And FFmpeg Telemetry

**Files:**
- Modify: `src/stages/reel-music-selector.ts`
- Modify: `src/stages/reel-stage5-assemble.ts`
- Test: `tests/reel-music-selector.test.ts`
- Test: `tests/reel-stage5-assemble-telemetry.test.ts`

- [ ] **Step 1: Write failing music resolver tests**

Create or append to `tests/reel-music-selector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BrandConfig } from "../src/types.js";
import { resolveReelMusicFile } from "../src/stages/reel-music-selector.js";

function brand(): BrandConfig {
  return {
    id: "ns",
    name: "WorldBrief",
    language: "en",
    timezone: "Europe/Berlin",
    postTimes: [],
    weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
    pillars: [],
    trustedSources: [],
    geographicFocus: "Europe",
    captionRules: {},
    themeWeights: {},
    viralCheck: false,
    gcsPrefix: "nscontent",
    metaPageId: "",
    metaPageToken: "",
    channels: {},
    useStockImages: true,
    reels: {
      enabled: true,
      voiceId: "voice",
      sceneCount: 4,
      reelTimes: [],
      musicFiles: ["/music/fallback.mp3"],
      musicByCategory: { business: ["/music/business-1.mp3", "/music/business-2.mp3"] },
    },
  };
}

describe("resolveReelMusicFile", () => {
  it("prefers category pool and returns basename", () => {
    const result = resolveReelMusicFile({
      brand: brand(),
      category: "business",
      existsFn: () => true,
      randomFn: () => 0.75,
    });

    expect(result).toEqual({ path: "/music/business-2.mp3", fileName: "business-2.mp3" });
  });

  it("falls back when category files are unavailable", () => {
    const result = resolveReelMusicFile({
      brand: brand(),
      category: "business",
      existsFn: (file) => file === "/music/fallback.mp3",
      randomFn: () => 0,
    });

    expect(result).toEqual({ path: "/music/fallback.mp3", fileName: "fallback.mp3" });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/reel-music-selector.test.ts`

Expected: FAIL because `resolveReelMusicFile` is not exported.

- [ ] **Step 3: Implement shared music resolver**

Modify `src/stages/reel-music-selector.ts`:

```ts
import path from "path";
import type { BrandConfig, ReelCategory } from "../types.js";

export interface ResolveReelMusicFileInput {
  brand: BrandConfig;
  category?: ReelCategory;
  selector?: string;
  existsFn?: (filePath: string) => boolean;
  randomFn?: () => number;
}

export interface ResolvedReelMusicFile {
  path: string;
  fileName: string;
}
```

Keep existing `pickMusicFile`, then append:

```ts
export function resolveReelMusicFile(input: ResolveReelMusicFileInput): ResolvedReelMusicFile | undefined {
  const existsFn = input.existsFn ?? (() => true);
  const categoryPool = input.category ? (input.brand.reels?.musicByCategory?.[input.category] ?? []) : [];
  const fallbackPool = input.brand.reels?.musicFiles ?? [];
  const rawPool = categoryPool.length > 0 ? categoryPool : fallbackPool;
  let musicFiles = rawPool.filter((filePath) => existsFn(filePath));

  if (musicFiles.length === 0 && categoryPool.length > 0) {
    musicFiles = fallbackPool.filter((filePath) => existsFn(filePath));
  }
  if (musicFiles.length === 0) return undefined;

  const selected = pickMusicFile(musicFiles, input.selector, input.randomFn);
  return { path: selected, fileName: path.basename(selected) };
}
```

- [ ] **Step 4: Use resolver in FFmpeg renderer and add telemetry**

Modify `src/stages/reel-stage5-assemble.ts` import:

```ts
import { resolveReelMusicFile } from "./reel-music-selector.js";
```

Replace lines that build `categoryPool`, `fallbackPool`, `rawPool`, and `musicFiles` with:

```ts
    const resolvedMusic = resolveReelMusicFile({
      brand: ctx.brand,
      category: ctx.category ?? ctx.script?.category,
      selector: ctx.musicTrackOverride,
      existsFn: fs.existsSync,
    });
    let musicFileName: string | undefined;
    if (resolvedMusic) {
      const musicFile = resolvedMusic.path;
      musicFileName = resolvedMusic.fileName;
```

At the beginning of `run`, after validation, add:

```ts
    const stageStartMs = Date.now();
```

Before the final return, compute output size and telemetry:

```ts
    const outputBytes = fs.statSync(videoPath).size;
    return {
      videoPath,
      videoGcsUrl,
      musicFile: musicFileName,
      stage5RenderTelemetry: {
        renderer: "ffmpeg",
        fps: profile.targetFps,
        durationMs: Date.now() - stageStartMs,
        outputBytes,
      },
    };
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/reel-music-selector.test.ts tests/reel-stage5-assemble-telemetry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-music-selector.ts src/stages/reel-stage5-assemble.ts tests/reel-music-selector.test.ts tests/reel-stage5-assemble-telemetry.test.ts
git commit -m "feat: share reel music selection for stage5"
```

---

### Task 4: Generate The Enhanced Default Hyperframes Template

**Files:**
- Create: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Test: `tests/reel-stage5-enhanced-template.test.ts`

- [ ] **Step 1: Write failing template tests**

Create `tests/reel-stage5-enhanced-template.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ReelContext } from "../src/types.js";

function makeCtx(language: "en" | "th" = "en"): ReelContext {
  return {
    runId: "run-template",
    brand: {
      id: language === "th" ? "ds" : "ns",
      name: language === "th" ? "ThaiDaily" : "WorldBrief",
      language,
      timezone: "UTC",
      postTimes: [],
      weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
      pillars: [],
      trustedSources: [],
      geographicFocus: "World",
      captionRules: {},
      themeWeights: {},
      viralCheck: false,
      gcsPrefix: "content",
      metaPageId: "",
      metaPageToken: "",
      channels: {},
      useStockImages: true,
      reels: { enabled: true, voiceId: "voice", sceneCount: 2, reelTimes: [], musicVolume: 0.2 },
    },
    runDate: "2026-04-28",
    status: "running",
    stageLogs: [],
    workDir: "/tmp/reel",
    audioPaths: ["/tmp/reel/scene1.mp3", "/tmp/reel/scene2.mp3"],
    imagePaths: ["/tmp/reel/scene1.png", "/tmp/reel/scene2.png"],
    script: {
      title: "A useful story",
      hashtags: ["#News"],
      scenes: [
        {
          sceneNumber: 1,
          caption: language === "th" ? "ข่าวสำคัญ" : "Big update",
          voiceover: language === "th" ? "ข่าว สำคัญ วันนี้" : "Big update today",
          imagePrompt: "news image",
          durationSeconds: 3,
          wordTimings: [
            { word: language === "th" ? "ข่าว" : "Big", start: 0, end: 0.5 },
            { word: language === "th" ? "สำคัญ" : "update", start: 0.5, end: 1.1 },
          ],
        },
        {
          sceneNumber: 2,
          caption: language === "th" ? "ติดตามต่อ" : "Follow for more",
          voiceover: language === "th" ? "ติดตาม ต่อ" : "Follow for more",
          imagePrompt: "follow image",
          durationSeconds: 4,
          wordTimings: [{ word: language === "th" ? "ติดตาม" : "Follow", start: 0, end: 0.7 }],
        },
      ],
    },
  };
}

describe("buildEnhancedDefaultHyperframesHtml", () => {
  it("generates required Hyperframes attributes and timeline registration", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx(), musicPath: "/tmp/reel/music.mp3" });

    expect(html).toContain('data-composition-id="run-template"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('class="clip scene scene-1"');
    expect(html).toContain('class="clip voice voice-1"');
    expect(html).toContain('class="clip music"');
    expect(html).toContain('const tl = gsap.timeline({ paused: true });');
    expect(html).toContain('window.__timelines["run-template"] = tl;');
    expect(html).toContain('tl.set({}, {}, 11);');
    expect(html).not.toContain(".play()");
  });

  it("uses Thai-safe typography for DS content", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx("th") });

    expect(html).toContain("Noto Sans Thai");
    expect(html).toContain("line-height: 1.5");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`

Expected: FAIL because template module does not exist.

- [ ] **Step 3: Implement template generator**

Create `src/stages/reel-stage5-templates/enhanced-default.ts`:

```ts
import path from "path";
import type { ReelContext } from "../../types.js";

interface BuildEnhancedDefaultHtmlInput {
  ctx: ReelContext;
  musicPath?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileUrl(filePath: string): string {
  return `file://${path.resolve(filePath).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

function sceneDuration(ctx: ReelContext, sceneIndex: number): number {
  const scene = ctx.script!.scenes[sceneIndex];
  return Math.max(1, (scene.durationSeconds ?? 8) + 2.6);
}

function sceneStart(ctx: ReelContext, sceneIndex: number): number {
  let start = 0;
  for (let i = 0; i < sceneIndex; i++) start += sceneDuration(ctx, i);
  return Number(start.toFixed(3));
}

export function getEnhancedDefaultDuration(ctx: ReelContext): number {
  const total = ctx.script!.scenes.reduce((sum, _scene, index) => sum + sceneDuration(ctx, index), 0);
  return Number(total.toFixed(3));
}

export function buildEnhancedDefaultHyperframesHtml(input: BuildEnhancedDefaultHtmlInput): string {
  const { ctx, musicPath } = input;
  if (!ctx.script) throw new Error("No script for Hyperframes template");
  if (!ctx.imagePaths?.length) throw new Error("No images for Hyperframes template");
  if (!ctx.audioPaths?.length) throw new Error("No audio for Hyperframes template");

  const totalDuration = getEnhancedDefaultDuration(ctx);
  const isThai = ctx.brand.language === "th";
  const fontFamily = isThai
    ? "'Noto Sans Thai', 'TH Sarabun New', Arial, sans-serif"
    : "'Arial Black', Arial, sans-serif";
  const captionLineHeight = isThai ? "1.5" : "1.25";
  const captionFontSize = isThai ? 54 : 58;

  const sceneHtml = ctx.script.scenes.map((scene, index) => {
    const start = sceneStart(ctx, index);
    const duration = sceneDuration(ctx, index);
    const image = ctx.imagePaths![index];
    const audio = ctx.audioPaths![index];
    const words = (scene.wordTimings ?? []).slice(0, 16).map((word, wordIndex) => {
      const wordStart = Number((start + 2 + word.start).toFixed(3));
      const wordDuration = Math.max(0.08, Number((word.end - word.start).toFixed(3)));
      return `<span id="word-${scene.sceneNumber}-${wordIndex}" class="clip subtitle-word" data-start="${wordStart}" data-duration="${wordDuration}" data-track-index="${20 + scene.sceneNumber}">${esc(word.word)}</span>`;
    }).join(isThai ? "" : " ");

    return `
      <img id="scene-${scene.sceneNumber}" class="clip scene scene-${scene.sceneNumber}" data-start="${start}" data-duration="${duration}" data-track-index="${scene.sceneNumber}" src="${fileUrl(image)}" />
      <div id="shade-${scene.sceneNumber}" class="clip shade" data-start="${start}" data-duration="${duration}" data-track-index="${10 + scene.sceneNumber}"></div>
      <div id="hook-${scene.sceneNumber}" class="clip hook" data-start="${start}" data-duration="2" data-track-index="${30 + scene.sceneNumber}">${esc(scene.caption)}</div>
      <div id="subs-${scene.sceneNumber}" class="clip subtitles" data-start="${start + 2}" data-duration="${Math.max(1, duration - 2)}" data-track-index="${40 + scene.sceneNumber}">${words}</div>
      <audio id="voice-${scene.sceneNumber}" class="clip voice voice-${scene.sceneNumber}" data-start="${start + 2}" data-duration="${Math.max(1, duration - 2)}" data-track-index="${50 + scene.sceneNumber}" data-volume="1.0" src="${fileUrl(audio)}"></audio>`;
  }).join("\n");

  const musicHtml = musicPath
    ? `<audio id="music" class="clip music" data-start="0" data-duration="${totalDuration}" data-track-index="90" data-volume="${ctx.brand.reels?.musicVolume ?? 0.13}" src="${fileUrl(musicPath)}"></audio>`
    : "";

  const animationJs = ctx.script.scenes.map((scene, index) => {
    const start = sceneStart(ctx, index);
    return `
      gsap.set("#scene-${scene.sceneNumber}", { opacity: 0, scale: 1.06 });
      tl.to("#scene-${scene.sceneNumber}", { opacity: 1, scale: 1.0, duration: 0.45, ease: "power2.out" }, ${start});
      tl.to("#scene-${scene.sceneNumber}", { scale: 1.08, duration: ${sceneDuration(ctx, index).toFixed(3)}, ease: "none" }, ${start});
      gsap.set("#hook-${scene.sceneNumber}", { opacity: 0, y: 36, scale: 0.96 });
      tl.to("#hook-${scene.sceneNumber}", { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.5)" }, ${start + 0.15});
      tl.to("#hook-${scene.sceneNumber}", { opacity: 0, y: -20, duration: 0.25, ease: "power2.in" }, ${start + 1.75});`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    ${isThai ? "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700;900&display=swap');" : ""}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1080px; height: 1920px; overflow: hidden; background: #05070b; font-family: ${fontFamily}; }
    #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #05070b; }
    .scene { position: absolute; inset: 0; width: 1080px; height: 1920px; object-fit: cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.15) 42%, rgba(0,0,0,.72)); }
    .hook { position: absolute; left: 64px; right: 64px; top: 180px; padding: 26px 34px; border-radius: 28px; background: rgba(8,10,18,.78); color: #fff; font-size: ${captionFontSize}px; line-height: ${captionLineHeight}; font-weight: 900; text-align: center; text-shadow: 0 4px 16px rgba(0,0,0,.65); }
    .subtitles { position: absolute; left: 70px; right: 70px; bottom: 245px; display: flex; justify-content: center; flex-wrap: wrap; gap: ${isThai ? 2 : 12}px; font-size: ${isThai ? 46 : 50}px; line-height: ${captionLineHeight}; font-weight: 900; color: rgba(255,255,255,.58); text-align: center; }
    .subtitle-word { display: inline-block; color: #ffe66d; text-shadow: 0 0 18px rgba(255,230,109,.55), 0 3px 10px rgba(0,0,0,.8); }
    .brand { position: absolute; right: 42px; top: 42px; color: rgba(255,255,255,.86); font-size: 28px; font-weight: 800; letter-spacing: .08em; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${esc(ctx.runId)}" data-start="0" data-width="1080" data-height="1920">
    ${sceneHtml}
    ${musicHtml}
    <div id="brand" class="clip brand" data-start="0" data-duration="${totalDuration}" data-track-index="100">${esc(ctx.brand.name)}</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${animationJs}
    tl.set({}, {}, ${totalDuration});
    window.__timelines = window.__timelines || {};
    window.__timelines["${esc(ctx.runId)}"] = tl;
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage5-templates/enhanced-default.ts tests/reel-stage5-enhanced-template.test.ts
git commit -m "feat: add enhanced hyperframes reel template"
```

---

### Task 5: Implement Hyperframes Renderer With Mocked Producer Tests

**Files:**
- Modify: `package.json`
- Modify: `src/stages/reel-stage5-hyperframes-renderer.ts`
- Test: `tests/reel-stage5-hyperframes-renderer.test.ts`

- [ ] **Step 1: Install dependency**

Run: `npm install @hyperframes/producer`

Expected: `package.json` and `package-lock.json` change with `@hyperframes/producer` installed.

- [ ] **Step 2: Write failing mocked renderer tests**

Create `tests/reel-stage5-hyperframes-renderer.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelContext } from "../src/types.js";

const { createRenderJobMock, executeRenderJobMock, uploadVideoMock } = vi.hoisted(() => ({
  createRenderJobMock: vi.fn((job) => job),
  executeRenderJobMock: vi.fn(async (job) => {
    fs.writeFileSync(job.output, Buffer.from("mp4"));
    return { status: "complete" };
  }),
  uploadVideoMock: vi.fn(async () => "https://gcs/hyperframes.mp4"),
}));

vi.mock("@hyperframes/producer", () => ({
  createRenderJob: createRenderJobMock,
  executeRenderJob: executeRenderJobMock,
}));

vi.mock("../src/services/gcs.js", () => ({
  createGcsService: () => ({ uploadVideo: uploadVideoMock }),
}));

function makeCtx(workDir: string): ReelContext {
  const image1 = path.join(workDir, "scene1.png");
  const audio1 = path.join(workDir, "scene1.mp3");
  fs.writeFileSync(image1, Buffer.from("png"));
  fs.writeFileSync(audio1, Buffer.from("mp3"));
  return {
    runId: "run-hf",
    brand: {
      id: "ns",
      name: "WorldBrief",
      language: "en",
      timezone: "UTC",
      postTimes: [],
      weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
      pillars: [],
      trustedSources: [],
      geographicFocus: "World",
      captionRules: {},
      themeWeights: {},
      viralCheck: false,
      gcsPrefix: "nscontent",
      metaPageId: "",
      metaPageToken: "",
      channels: {},
      useStockImages: true,
      reels: { enabled: true, voiceId: "voice", sceneCount: 1, reelTimes: [], musicVolume: 0.2 },
    },
    runDate: "2026-04-28",
    workDir,
    status: "running",
    stageLogs: [],
    imagePaths: [image1],
    audioPaths: [audio1],
    stage5Renderer: "hyperframes",
    stage5Template: "enhanced-default",
    stage5RenderSettings: { fps: 24, quality: "standard", workers: 1, timeoutMs: 1800000, performanceProfile: "balanced" },
    script: {
      title: "Story",
      hashtags: ["#News"],
      scenes: [{ sceneNumber: 1, caption: "Hook", voiceover: "Voice", imagePrompt: "Image", durationSeconds: 1 }],
    },
  };
}

describe("HyperframesStage5Renderer", () => {
  let workDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-renderer-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("renders a Hyperframes composition, uploads video, and returns telemetry", async () => {
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const result = await new HyperframesStage5Renderer().run(makeCtx(workDir));

    expect(createRenderJobMock).toHaveBeenCalledWith(expect.objectContaining({
      input: path.join(workDir, "hyperframes", "index.html"),
      output: path.join(workDir, "reel.mp4"),
      fps: 24,
      quality: "standard",
      workers: 1,
      format: "mp4",
    }));
    expect(executeRenderJobMock).toHaveBeenCalledTimes(1);
    expect(uploadVideoMock).toHaveBeenCalledWith("nscontent", "run-hf", "reel.mp4", Buffer.from("mp4"));
    expect(result).toEqual(expect.objectContaining({
      videoPath: path.join(workDir, "reel.mp4"),
      videoGcsUrl: "https://gcs/hyperframes.mp4",
      stage5RenderTelemetry: expect.objectContaining({ renderer: "hyperframes", template: "enhanced-default", fps: 24, quality: "standard" }),
    }));
  });

  it("does not fall back when Hyperframes render fails", async () => {
    executeRenderJobMock.mockRejectedValueOnce(new Error("hf exploded"));
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");

    await expect(new HyperframesStage5Renderer().run(makeCtx(workDir))).rejects.toThrow("Hyperframes render failed: hf exploded");
    expect(uploadVideoMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/reel-stage5-hyperframes-renderer.test.ts`

Expected: FAIL because renderer still throws “not implemented”.

- [ ] **Step 4: Implement renderer**

Replace `src/stages/reel-stage5-hyperframes-renderer.ts` with:

```ts
import fs from "fs";
import path from "path";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import type { ReelContext, Stage5RendererType } from "../types.js";
import { createGcsService } from "../services/gcs.js";
import { resolveReelMusicFile } from "./reel-music-selector.js";
import type { Stage5Renderer } from "./reel-stage5-renderer.js";
import { buildEnhancedDefaultHyperframesHtml } from "./reel-stage5-templates/enhanced-default.js";

export class HyperframesStage5Renderer implements Stage5Renderer {
  readonly renderer: Stage5RendererType = "hyperframes";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script");
    if (!ctx.audioPaths?.length) throw new Error("No audio — run reel-stage3-voice first");
    if (!ctx.imagePaths?.length) throw new Error("No images — run reel-stage4-images first");
    if (!ctx.workDir) throw new Error("No reel workDir for Hyperframes render");

    const startedAt = Date.now();
    const compositionDir = path.join(ctx.workDir, "hyperframes");
    fs.mkdirSync(compositionDir, { recursive: true });

    const resolvedMusic = resolveReelMusicFile({
      brand: ctx.brand,
      category: ctx.category ?? ctx.script.category,
      selector: ctx.musicTrackOverride,
      existsFn: fs.existsSync,
    });
    const htmlPath = path.join(compositionDir, "index.html");
    const videoPath = path.join(ctx.workDir, "reel.mp4");
    const settings = ctx.stage5RenderSettings ?? {
      fps: 24,
      quality: "standard" as const,
      workers: 1,
      timeoutMs: 30 * 60_000,
      performanceProfile: "balanced" as const,
    };

    fs.writeFileSync(htmlPath, buildEnhancedDefaultHyperframesHtml({ ctx, musicPath: resolvedMusic?.path }), "utf8");

    try {
      const job = createRenderJob({
        input: htmlPath,
        output: videoPath,
        fps: settings.fps,
        quality: settings.quality,
        workers: settings.workers,
        format: "mp4",
      });
      await executeRenderJob(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Hyperframes render failed: ${message}`);
    }

    const output = fs.readFileSync(videoPath);
    const videoGcsUrl = await createGcsService().uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", output);

    return {
      videoPath,
      videoGcsUrl,
      musicFile: resolvedMusic?.fileName,
      stage5RenderTelemetry: {
        renderer: "hyperframes",
        template: ctx.stage5Template ?? "enhanced-default",
        fps: settings.fps,
        quality: settings.quality,
        workers: settings.workers,
        durationMs: Date.now() - startedAt,
        outputBytes: output.byteLength,
      },
    };
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/reel-stage5-hyperframes-renderer.test.ts tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-renderer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/stages/reel-stage5-hyperframes-renderer.ts tests/reel-stage5-hyperframes-renderer.test.ts
git commit -m "feat: render reels with hyperframes"
```

---

### Task 6: Add Brand Config Defaults And CLI Overrides

**Files:**
- Modify: `src/brands/ds.ts`
- Modify: `src/brands/ns.ts`
- Modify: `bin/run.ts`
- Test: `tests/cli-args.test.ts` if existing; otherwise create `tests/run-cli-args.test.ts`

- [ ] **Step 1: Export and test CLI parser**

Modify `bin/run.ts` so `parseArgs` is exported:

```ts
export function parseArgs(args: string[]): {
  brand: BrandId;
  theme?: Theme;
  dryRun: boolean;
  stageFilter?: number;
  resumeRunId?: string;
  reel: boolean;
  sourceUrls?: string[];
  stage5Renderer?: "ffmpeg" | "hyperframes";
  stage5Template?: "enhanced-default";
} {
```

Create `tests/run-cli-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseArgs } from "../bin/run.js";

describe("parseArgs reel stage5 overrides", () => {
  it("parses Hyperframes renderer and template", () => {
    expect(parseArgs(["ns", "--reel", "--stage5-renderer", "hyperframes", "--stage5-template", "enhanced-default"])).toEqual(
      expect.objectContaining({
        brand: "ns",
        reel: true,
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/run-cli-args.test.ts`

Expected: FAIL until parser handles flags without exiting.

- [ ] **Step 3: Implement CLI override parsing**

In `bin/run.ts`, add local variables:

```ts
  let stage5Renderer: "ffmpeg" | "hyperframes" | undefined;
  let stage5Template: "enhanced-default" | undefined;
```

Add parsing branches:

```ts
    } else if (args[i] === "--stage5-renderer" && args[i + 1]) {
      const value = args[++i];
      if (value !== "ffmpeg" && value !== "hyperframes") {
        console.error(`Unknown stage5 renderer: ${value}. Valid: ffmpeg, hyperframes`);
        process.exit(1);
      }
      stage5Renderer = value;
    } else if (args[i] === "--stage5-template" && args[i + 1]) {
      const value = args[++i];
      if (value !== "enhanced-default") {
        console.error(`Unknown stage5 template: ${value}. Valid: enhanced-default`);
        process.exit(1);
      }
      stage5Template = value;
```

Return them:

```ts
    stage5Renderer,
    stage5Template,
```

Pass into `ReelRunner.run`:

```ts
      const ctx = await ReelRunner.run(brand, { theme, sourceUrls, dryRun, stage5Renderer, stage5Template });
```

- [ ] **Step 4: Add brand defaults**

Modify both `src/brands/ds.ts` and `src/brands/ns.ts` inside `reels` after `stage5Performance`:

```ts
    stage5Renderer: "ffmpeg",
    stage5Template: "enhanced-default",
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/run-cli-args.test.ts tests/reel-stage5-renderer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/run.ts src/brands/ds.ts src/brands/ns.ts tests/run-cli-args.test.ts
git commit -m "feat: add stage5 renderer cli override"
```

---

### Task 7: Add Telegram Command Overrides

**Files:**
- Modify: `src/pipeline/command-listener.ts`
- Modify: existing command listener tests or create `tests/reel-stage5-command-flags.test.ts`

- [ ] **Step 1: Add flag parser tests**

If `parseReelCommandFlags` does not exist, create and export it from `src/pipeline/command-listener.ts`. Add `tests/reel-stage5-command-flags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReelCommandFlags } from "../src/pipeline/command-listener.js";

describe("parseReelCommandFlags", () => {
  it("parses renderer and template flags while preserving command text", () => {
    expect(parseReelCommandFlags("trending ken_burns -hf -template enhanced-default -nostock")).toEqual({
      cleaned: "trending ken_burns",
      useStockImages: false,
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    });
  });

  it("parses ffmpeg override", () => {
    expect(parseReelCommandFlags("business -ffmpeg")).toEqual({
      cleaned: "business",
      useStockImages: undefined,
      stage5Renderer: "ffmpeg",
      stage5Template: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-stage5-command-flags.test.ts`

Expected: FAIL because parser does not exist.

- [ ] **Step 3: Implement parser**

Add near command parser helpers in `src/pipeline/command-listener.ts`:

```ts
export function parseReelCommandFlags(input: string): {
  cleaned: string;
  useStockImages?: boolean;
  stage5Renderer?: "ffmpeg" | "hyperframes";
  stage5Template?: "enhanced-default";
} {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let useStockImages: boolean | undefined;
  let stage5Renderer: "ffmpeg" | "hyperframes" | undefined;
  let stage5Template: "enhanced-default" | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    if (token === "-nostock") {
      useStockImages = false;
      continue;
    }
    if (token === "-hf" || token === "-hyperframes") {
      stage5Renderer = "hyperframes";
      continue;
    }
    if (token === "-ffmpeg") {
      stage5Renderer = "ffmpeg";
      continue;
    }
    if (token === "-template" && tokens[i + 1] === "enhanced-default") {
      stage5Template = "enhanced-default";
      i++;
      continue;
    }
    kept.push(tokens[i]);
  }

  return { cleaned: kept.join(" "), useStockImages, stage5Renderer, stage5Template };
}
```

- [ ] **Step 4: Use parsed flags in reel commands**

At the start of reel command handling, replace direct `-nostock` handling with parser output:

```ts
    const parsedFlags = parseReelCommandFlags(subCmdPreserveCase);
    const subCmdForRouting = parsedFlags.cleaned.toLowerCase();
    const useStockImages = parsedFlags.useStockImages ?? (subCmd.includes("-nostock") ? false : undefined);
```

Use `subCmdForRouting` in the manual generation branch that currently uses `subCmd`, while preserving existing case-sensitive paths for IDs. In the final `ReelRunner.run` call, pass overrides:

```ts
      ReelRunner.run(brandId, {
        theme: reelTheme,
        category: reelCategory,
        sourceUrls: reelUrls,
        categorySource: "manual" as const,
        useStockImages,
        cameraEffect: reelCameraEffect,
        stage5Renderer: parsedFlags.stage5Renderer,
        stage5Template: parsedFlags.stage5Template,
      }).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
```

For `confirm`, `resume`, `rebuild`, and `rebuildPart`, pass `stage5Renderer` and `stage5Template` only where the target `ReelRunner` method accepts options after Task 8. If a method currently has positional arguments, defer method signature changes to Task 8 and keep generation command override working in this task.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/reel-stage5-command-flags.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/command-listener.ts tests/reel-stage5-command-flags.test.ts
git commit -m "feat: parse reel stage5 renderer flags"
```

---

### Task 8: Thread Overrides Through Resume, Confirm, Rebuild, And Rebuild Part

**Files:**
- Modify: `src/pipeline/reel-runner.ts`
- Modify: `src/pipeline/command-listener.ts`
- Test: existing reel runner command tests or `tests/reel-stage5-runner-overrides.test.ts`

- [ ] **Step 1: Add runner override type**

In `src/pipeline/reel-runner.ts`, add:

```ts
interface Stage5OverrideOptions {
  stage5Renderer?: import("../types.js").Stage5RendererType;
  stage5Template?: import("../types.js").Stage5TemplateName;
}
```

- [ ] **Step 2: Update method signatures**

Change public methods that execute stage 5 to accept an optional final object:

```ts
static async confirm(reelId: string, brandId: BrandId, useStockImages?: boolean, stage5Overrides: Stage5OverrideOptions = {})
static async resume(reelId: string, brandId: BrandId, useStockImages?: boolean, stage5Overrides: Stage5OverrideOptions = {})
static async rebuild(reelId: string, brandId: BrandId, useStockImages?: boolean, stage5Overrides: Stage5OverrideOptions = {})
static async rerescript(reelId: string, brandId: BrandId, category?: ReelCategory, useStockImages?: boolean, cameraEffect?: CameraEffectType, stage5Overrides: Stage5OverrideOptions = {})
```

When each method reconstructs `ctx`, include:

```ts
      stage5Renderer: stage5Overrides.stage5Renderer ?? stored.stage5Renderer,
      stage5Template: stage5Overrides.stage5Template ?? stored.stage5Template,
```

Before stage 5, resolve settings as in Task 2:

```ts
      const stage5Selection = resolveStage5RendererSelection(ctx);
      ctx = { ...ctx, stage5Renderer: stage5Selection.renderer, stage5Template: stage5Selection.template };
      ctx = { ...ctx, stage5RenderSettings: resolveStage5RenderSettings(ctx) };
```

- [ ] **Step 3: Update command calls**

In `src/pipeline/command-listener.ts`, pass parsed flags into calls:

```ts
ReelRunner.confirm(target.id, brandId, useStockImages, {
  stage5Renderer: parsedFlags.stage5Renderer,
  stage5Template: parsedFlags.stage5Template,
})
```

Apply the same shape to `resume`, `rebuild`, and `rerescript` calls.

For `rebuildPart`, add fields to the options object:

```ts
        stage5Renderer: parsedFlags.stage5Renderer,
        stage5Template: parsedFlags.stage5Template,
```

Update the `rebuildPart` options type and context reconstruction to use those fields when `part` is `video` or when a downstream stage 5 render is invoked.

- [ ] **Step 4: Add focused tests for persisted override**

Create `tests/reel-stage5-runner-overrides.test.ts` with a unit-level test for a helper if available. If no helper exists, extract a pure helper from `reel-runner.ts`:

```ts
export function applyStage5Overrides<T extends Pick<ReelContext, "stage5Renderer" | "stage5Template">>(
  ctx: T,
  overrides: Stage5OverrideOptions,
): T {
  return {
    ...ctx,
    stage5Renderer: overrides.stage5Renderer ?? ctx.stage5Renderer,
    stage5Template: overrides.stage5Template ?? ctx.stage5Template,
  };
}
```

Test:

```ts
import { describe, expect, it } from "vitest";
import { applyStage5Overrides } from "../src/pipeline/reel-runner.js";

describe("applyStage5Overrides", () => {
  it("uses explicit override over persisted renderer", () => {
    expect(applyStage5Overrides(
      { stage5Renderer: "ffmpeg" as const, stage5Template: undefined },
      { stage5Renderer: "hyperframes", stage5Template: "enhanced-default" },
    )).toEqual({ stage5Renderer: "hyperframes", stage5Template: "enhanced-default" });
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/reel-stage5-runner-overrides.test.ts tests/reel-stage5-command-flags.test.ts tests/reel-stage5-renderer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/reel-runner.ts src/pipeline/command-listener.ts tests/reel-stage5-runner-overrides.test.ts
git commit -m "feat: thread stage5 renderer overrides through reel actions"
```

---

### Task 9: Show Renderer Telemetry In Review Page

**Files:**
- Modify: `src/review/reel-html-builder.ts`
- Test: create or modify `tests/reel-review-html-builder.test.ts`

- [ ] **Step 1: Write failing review test**

Create `tests/reel-review-html-builder.test.ts` if missing:

```ts
import { describe, expect, it } from "vitest";
import type { ReelContext } from "../src/types.js";
import { buildReelReviewHtml } from "../src/review/reel-html-builder.js";

describe("buildReelReviewHtml renderer metadata", () => {
  it("shows stage5 renderer and template telemetry", () => {
    const ctx = {
      runId: "run-review",
      brand: {
        id: "ns",
        name: "WorldBrief",
        language: "en",
        timezone: "UTC",
        reels: { enabled: true, voiceId: "voice", sceneCount: 1, reelTimes: [], musicVolume: 0.2 },
      },
      runDate: "2026-04-28",
      status: "awaiting_approval",
      story: { headline: "Headline", sourceUrl: "https://example.com", source: "example.com" },
      script: { title: "Title", hashtags: ["#News"], scenes: [{ sceneNumber: 1, caption: "Hook", voiceover: "Voice", imagePrompt: "Image" }] },
      videoGcsUrl: "https://gcs/reel.mp4",
      stageLogs: [],
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderTelemetry: { renderer: "hyperframes", template: "enhanced-default", fps: 24, quality: "standard", workers: 1, durationMs: 32100, outputBytes: 1024 },
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).toContain("Renderer");
    expect(html).toContain("hyperframes");
    expect(html).toContain("enhanced-default");
    expect(html).toContain("24fps");
    expect(html).toContain("32.1s");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-review-html-builder.test.ts`

Expected: FAIL because review HTML does not show renderer telemetry.

- [ ] **Step 3: Implement telemetry display**

In `src/review/reel-html-builder.ts`, extend `reelContext` type with:

```ts
    stage5Renderer?: ReelContext["stage5Renderer"];
    stage5Template?: ReelContext["stage5Template"];
    stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
```

Near existing metadata constants, add:

```ts
  const stage5Renderer = ctx.stage5Renderer ?? reelContext?.stage5Renderer ?? ctx.stage5RenderTelemetry?.renderer ?? reelContext?.stage5RenderTelemetry?.renderer ?? "ffmpeg";
  const stage5Template = ctx.stage5Template ?? reelContext?.stage5Template ?? ctx.stage5RenderTelemetry?.template ?? reelContext?.stage5RenderTelemetry?.template;
  const stage5Telemetry = ctx.stage5RenderTelemetry ?? reelContext?.stage5RenderTelemetry;
  const renderDuration = stage5Telemetry?.durationMs !== undefined ? `${(stage5Telemetry.durationMs / 1000).toFixed(1)}s` : "n/a";
  const renderProfile = stage5Telemetry?.fps ? `${stage5Telemetry.fps}fps${stage5Telemetry.quality ? ` · ${stage5Telemetry.quality}` : ""}` : "n/a";
```

Add rows inside the metadata card after camera effect:

```html
        <div class="meta-row"><span class="meta-key">Renderer</span><span class="meta-value">${escapeHtml(stage5Renderer)}</span></div>
        <div class="meta-row"><span class="meta-key">Template</span><span class="meta-value">${escapeHtml(stage5Template ?? "n/a")}</span></div>
        <div class="meta-row"><span class="meta-key">Render profile</span><span class="meta-value">${escapeHtml(renderProfile)}</span></div>
        <div class="meta-row"><span class="meta-key">Render time</span><span class="meta-value">${escapeHtml(renderDuration)}</span></div>
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/reel-review-html-builder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review/reel-html-builder.ts tests/reel-review-html-builder.test.ts
git commit -m "feat: show stage5 renderer in reel review"
```

---

### Task 10: Add Preflight And Manual Benchmark Script

**Files:**
- Create: `scripts/benchmark-stage5-renderers.ts`
- Modify: `package.json`

- [ ] **Step 1: Add script entry**

Modify `package.json` scripts:

```json
"benchmark:stage5": "tsx scripts/benchmark-stage5-renderers.ts"
```

- [ ] **Step 2: Create benchmark script**

Create `scripts/benchmark-stage5-renderers.ts`:

```ts
import "dotenv/config";
import { execFileSync } from "child_process";

function usage(): never {
  console.error("Usage: npm run benchmark:stage5 -- <brand> <source-url>");
  console.error("Example: npm run benchmark:stage5 -- ns https://example.com/story");
  process.exit(1);
}

const [brand, url] = process.argv.slice(2);
if ((brand !== "ds" && brand !== "ns") || !url) usage();

function run(label: "ffmpeg" | "hyperframes"): number {
  const startedAt = Date.now();
  execFileSync("npm", ["run", "cli", "--", brand, "--reel", "--url", url, "--stage5-renderer", label], {
    stdio: "inherit",
    env: process.env,
  });
  return Date.now() - startedAt;
}

console.log("Checking Hyperframes environment...");
try {
  execFileSync("npx", ["hyperframes", "doctor"], { stdio: "inherit", env: process.env });
} catch (err) {
  console.warn("hyperframes doctor failed; continuing so the renderer path can surface the exact error");
}

console.log("Running FFmpeg render...");
const ffmpegMs = run("ffmpeg");
console.log("Running Hyperframes render...");
const hyperframesMs = run("hyperframes");

const ratio = hyperframesMs / Math.max(1, ffmpegMs);
console.log(JSON.stringify({
  brand,
  url,
  ffmpegSeconds: Number((ffmpegMs / 1000).toFixed(1)),
  hyperframesSeconds: Number((hyperframesMs / 1000).toFixed(1)),
  ratio: Number(ratio.toFixed(2)),
}, null, 2));
```

- [ ] **Step 3: Run typecheck**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/benchmark-stage5-renderers.ts
git commit -m "chore: add stage5 renderer benchmark script"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/reel-stage5-renderer.test.ts tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-hyperframes-renderer.test.ts tests/reel-stage5-offload-toggle.test.ts tests/reel-assembly-worker.test.ts tests/reel-music-selector.test.ts tests/reel-review-html-builder.test.ts tests/run-cli-args.test.ts tests/reel-stage5-command-flags.test.ts tests/reel-stage5-runner-overrides.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit final changes**

```bash
git add package.json package-lock.json src tests scripts
git commit -m "chore: verify hyperframes stage5 renderer"
```

If there are no remaining changes after previous commits, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Configurable renderer and no fallback are covered in Tasks 1, 2, 5, 6, 7, and 8.
- Existing offload flow and worker consistency are covered in Task 2.
- One enhanced default template and Hyperframes constraints are covered in Task 4.
- Telemetry and review visibility are covered in Tasks 3, 5, and 9.
- Performance benchmark and preflight are covered in Task 10.
- Testing strategy is covered across Tasks 1 through 11.

Placeholder scan:

- No placeholder markers or unspecified test instructions remain.
- The plan chooses concrete command flags: CLI uses `--stage5-renderer` and `--stage5-template`; Telegram uses `-hf`, `-ffmpeg`, and `-template enhanced-default`.
- The plan chooses `@hyperframes/producer` instead of CLI for production rendering.

Type consistency:

- The renderer type names are `Stage5RendererType`, `Stage5TemplateName`, `Stage5RenderSettings`, and `Stage5RenderTelemetry` throughout.
- The template name is consistently `enhanced-default`.
- The persisted context fields are consistently `stage5Renderer`, `stage5Template`, `stage5RenderSettings`, and `stage5RenderTelemetry`.
