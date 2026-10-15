import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const stageRuns: Array<{ stage: string; runId: string; stage5Performance: unknown }> = [];
  const reels = new Map<string, any>();
  const updateReel = vi.fn();
  const createReel = vi.fn();
  let failStage0 = false;
  let failStage4 = false;
  return { stageRuns, reels, updateReel, createReel, get failStage0() { return failStage0; }, set failStage0(value: boolean) { failStage0 = value; }, get failStage4() { return failStage4; }, set failStage4(value: boolean) { failStage4 = value; } };
});

vi.mock("../src/db/queries.js", () => ({
  createReel: hoisted.createReel,
  getReelById: (id: string) => hoisted.reels.get(id) ?? null,
  getBlockingReelCount: () => 0,
  acquireReelStartLock: () => true,
  releaseReelStartLock: vi.fn(),
  getRecentGeneratingReelCount: () => 0,
  getRecentPostHeadlines: () => [],
  getRecentReelInfo: () => [],
  updateReel: hoisted.updateReel,
}));

vi.mock("../src/brands/index.js", () => ({
    ds: {
      id: "ds",
      name: "Daily Story",
      channels: {},
      useStockImages: true,
      timezone: "UTC",
      reels: { enabled: true, sceneCount: 1 },
    },
    ns: {
      id: "ns",
      name: "News Story",
      channels: {},
      useStockImages: true,
      timezone: "UTC",
      reels: { enabled: true, sceneCount: 1 },
    },
    ts: {
      id: "ts",
      name: "TagesBrief",
      channels: {},
      useStockImages: true,
      timezone: "UTC",
      reels: { enabled: true, sceneCount: 1 },
    },
  getBrand: () => ({
    id: "ds",
    name: "Daily Story",
    channels: {},
    useStockImages: true,
    timezone: "UTC",
    reels: { enabled: true, sceneCount: 1 },
  }),
}));

vi.mock("../src/services/telegram.js", () => ({
  createTelegramService: () => ({
    sendMessageWithId: vi.fn(async () => 1),
    editMessage: vi.fn(async () => undefined),
  }),
}));

vi.mock("../src/services/line.js", () => ({
  createLineService: () => ({}),
}));

vi.mock("../src/services/messaging.js", () => ({
  getEnabledChannels: () => [],
}));

vi.mock("../src/services/search.js", () => ({ createSearchService: () => ({}) }));
vi.mock("../src/services/bedrock.js", () => ({ createBedrockService: () => ({}) }));
vi.mock("../src/services/gemini.js", () => ({ createGeminiService: () => ({}) }));
vi.mock("../src/services/image-gen.js", () => ({ createImageGenService: () => ({}) }));
vi.mock("../src/services/stock-image.js", () => ({ createStockImageService: () => ({}) }));
vi.mock("../src/services/gcs.js", () => ({ createGcsService: () => ({}) }));
vi.mock("../src/services/meta.js", () => ({ createMetaService: () => ({}) }));

vi.mock("../src/stages/stage0-from-url.js", () => ({
  Stage0FromUrl: class {
    async run(): Promise<any> {
      if (hoisted.failStage0) throw new Error("stage0 failed");
      return {
        stories: [{
          headline: "URL headline",
          source: "example.com",
          sourceUrl: "https://example.com/url-story",
          snippet: "URL snippet",
          theme: "Tech",
        }],
      };
    }
  },
}));

vi.mock("../src/stages/reel-stage2-script.js", () => ({
  CATEGORY_RULES: {
    breaking: { discoveryBias: "" },
    trending: { discoveryBias: "" },
  },
  ReelStage2Script: class {
    name = "reel-stage2-script";
    async run(ctx: any): Promise<any> {
      hoisted.stageRuns.push({ stage: this.name, runId: ctx.runId, stage5Performance: ctx.stage5Performance });
      return { script: { scenes: [{ text: "scene" }] } };
    }
  },
}));

vi.mock("../src/stages/reel-stage3-voice.js", () => ({
  ReelStage3Voice: class {
    name = "reel-stage3-voice";
    async run(ctx: any): Promise<any> {
      hoisted.stageRuns.push({ stage: this.name, runId: ctx.runId, stage5Performance: ctx.stage5Performance });
      return { usedVoiceId: "voice-1", usedVoiceProvider: "minimax", usedVoiceSpeed: 1.2 };
    }
  },
}));

vi.mock("../src/stages/reel-stage4-images.js", () => ({
  ReelStage4Images: class {
    name = "reel-stage4-images";
    async run(ctx: any): Promise<any> {
      hoisted.stageRuns.push({ stage: this.name, runId: ctx.runId, stage5Performance: ctx.stage5Performance });
      if (hoisted.failStage4) throw new Error("stage4 failed");
      return {};
    }
  },
}));

vi.mock("../src/stages/reel-stage5-assemble.js", () => ({
  ReelStage5Assemble: class {
    name = "reel-stage5-assemble";
    async run(ctx: any): Promise<any> {
      hoisted.stageRuns.push({ stage: this.name, runId: ctx.runId, stage5Performance: ctx.stage5Performance });
      return { videoGcsUrl: "gs://bucket/reel.mp4" };
    }
  },
}));

vi.mock("../src/stages/reel-stage5-renderer.js", () => ({
  resolveStage5RendererSelection: () => ({ renderer: "hyperframes", template: "enhanced-default" }),
  resolveStage5RenderSettings: () => ({
    fps: 24,
    quality: "standard",
    workers: 1,
    timeoutMs: 30 * 60_000,
    performanceProfile: "balanced",
  }),
  ReelStage5Facade: class {
    name = "reel-stage5-assemble";
    async run(ctx: any): Promise<any> {
      hoisted.stageRuns.push({ stage: this.name, runId: ctx.runId, stage5Performance: ctx.stage5Performance });
      return { videoGcsUrl: "gs://bucket/reel.mp4" };
    }
  },
}));

const stage5Performance = {
  effectQuality: "high",
  targetFps: 30,
  videoPreset: "faster",
  bgScaleCap: 3072,
};

function makeReel(id: string): any {
  return {
    id,
    brand: "ds",
    runDate: "2026-01-01",
    category: "breaking",
    headline: "Headline",
    sourceUrl: "https://example.com/story",
    snippet: "Snippet",
    context: JSON.stringify({ stage5Performance, useStockImages: true }),
    script: JSON.stringify({ scenes: [{ text: "existing" }] }),
    videoGcsUrl: null,
  };
}

describe("buildPersistedReelContext", () => {
  it("persists stage5Performance in reel context blob", async () => {
    const { buildPersistedReelContext } = await import("../src/pipeline/reel-runner.js");
    const out = buildPersistedReelContext({
      stage5Performance,
      musicFile: "track-1.mp3",
    } as never);

    expect(out).toMatchObject({
      musicFile: "track-1.mp3",
      stage5Performance,
    });
  });

  it("persists URL source provenance in reel context blob", async () => {
    const { buildPersistedReelContext } = await import("../src/pipeline/reel-runner.js");
    const out = buildPersistedReelContext({
      manualSourceMode: undefined,
      manualSourceInput: undefined,
      story: {
        sourceReadMode: "tavily_extract",
        sourceExtractAvailable: true,
        sourceExtractChars: 18008,
        sourceExtractDownloadUrl: "https://storage.googleapis.com/bucket/run/source-extract.txt",
      },
    } as never);

    expect(out).toMatchObject({
      inputMode: "url",
      sourceReadMode: "tavily_extract",
      sourceExtractAvailable: true,
      sourceExtractChars: 18008,
      sourceExtractDownloadUrl: "https://storage.googleapis.com/bucket/run/source-extract.txt",
    });
  });

  it("prepares new stage5 render metadata without carrying stale telemetry", async () => {
    const { prepareStage5RenderContext } = await import("../src/pipeline/reel-runner.js");

    const out = prepareStage5RenderContext({
      brand: { reels: { stage5Renderer: "hyperframes" } },
      stage5RenderTelemetry: { renderer: "hyperframes", durationMs: 999 },
      status: "running",
      stageLogs: [],
    } as never);

    expect(out).toMatchObject({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: expect.objectContaining({ fps: 24, quality: "standard" }),
    });
    expect(out.stage5RenderTelemetry).toBeUndefined();
  });

  it("formats duplicate story error with headline", async () => {
    const { formatRecentDuplicateStoryError } = await import("../src/pipeline/reel-runner.js");
    expect(
      formatRecentDuplicateStoryError({
        sourceUrl: "https://example.com/story",
        headline: "Sample headline",
      }),
    ).toBe("Reel story already covered recently: https://example.com/story — Sample headline");
  });
});

describe("ReelRunner context restore", () => {
  beforeEach(() => {
    hoisted.stageRuns.length = 0;
    hoisted.reels.clear();
    hoisted.updateReel.mockReset();
    hoisted.createReel.mockReset();
    hoisted.failStage0 = false;
    hoisted.failStage4 = false;
    process.env.PIPELINE_BASE_URL = "https://pipeline.local";
  });

  it("persists explicit URL reel start before URL classification finishes", async () => {
    hoisted.failStage0 = true;
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await expect(ReelRunner.run("ds", { sourceUrls: ["https://example.com/url-story"] })).rejects.toThrow("stage0 failed");

    expect(hoisted.createReel).toHaveBeenCalledWith(expect.objectContaining({
      brand: "ds",
      headline: "Starting URL reel",
      sourceUrl: "https://example.com/url-story",
    }));
  });

  it("persists stage5 renderer overrides when initial run pauses for script confirmation", async () => {
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.run("ds", {
      manualSourceMode: "text",
      manualSourceInput: "Manual Source",
      manualSourceText: "Manual source text for a paused reel run.",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    });

    expect(hoisted.createReel).toHaveBeenCalledTimes(1);
    const createArg = hoisted.createReel.mock.calls[0][0];
    expect(JSON.parse(createArg.context)).toMatchObject({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    });
  });

  it("restores stage5Performance from serialized context in rerescript", async () => {
    const reelId = "reel-rerescript";
    hoisted.reels.set(reelId, makeReel(reelId));
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.rerescript(reelId, "ds");

    expect(hoisted.stageRuns.find((r) => r.runId === reelId)?.stage5Performance).toEqual(stage5Performance);
  });

  it("persists voice metadata immediately after rerescript voice stage", async () => {
    const reelId = "reel-rerescript-voice-context";
    hoisted.reels.set(reelId, makeReel(reelId));
    hoisted.failStage4 = true;
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await expect(ReelRunner.rerescript(reelId, "ds")).rejects.toThrow("stage4 failed");

    expect(hoisted.updateReel).toHaveBeenCalledWith(
      reelId,
      expect.objectContaining({
        context: expect.objectContaining({
          usedVoiceId: "voice-1",
          usedVoiceProvider: "minimax",
          usedVoiceSpeed: 1.2,
        }),
      }),
    );
  });

  it("restores stage5Performance from serialized context in resume", async () => {
    const reelId = "reel-resume";
    hoisted.reels.set(reelId, makeReel(reelId));
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.resume(reelId, "ds");

    expect(hoisted.stageRuns.find((r) => r.runId === reelId)?.stage5Performance).toEqual(stage5Performance);
  });

  it("restores stage5Performance from serialized context in rebuild", async () => {
    const reelId = "reel-rebuild";
    hoisted.reels.set(reelId, makeReel(reelId));
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.rebuild(reelId, "ds");

    expect(hoisted.stageRuns.find((r) => r.runId === reelId)?.stage5Performance).toEqual(stage5Performance);
  });

  it("restores stage5Performance from serialized context in rebuildPart", async () => {
    const reelId = "reel-rebuild-part";
    hoisted.reels.set(reelId, makeReel(reelId));
    const workDir = path.join(process.cwd(), "work", "reels", reelId);
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "scene1.mp3"), "audio");
    fs.writeFileSync(path.join(workDir, "scene1.png"), "image");
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.rebuildPart(reelId, "ds", "music");

    expect(hoisted.stageRuns.find((r) => r.runId === reelId)?.stage5Performance).toEqual(stage5Performance);
  });

  it("preserves stored musicFile as musicTrackOverride on re-images rebuild", async () => {
    const reelId = "reel-re-images-music";
    hoisted.reels.set(reelId, {
      ...makeReel(reelId),
      context: JSON.stringify({ stage5Performance, musicFile: "upbeat-rock.mp3" }),
    });
    const workDir = path.join(process.cwd(), "work", "reels", reelId);
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "scene1.mp3"), "audio");
    fs.writeFileSync(path.join(workDir, "scene1.png"), "image");
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");

    await ReelRunner.rebuildPart(reelId, "ds", "images");

    const stage5Run = hoisted.stageRuns.find((r) => r.runId === reelId && r.stage === "reel-stage5-assemble");
    expect(stage5Run).toBeTruthy();
  });
});
