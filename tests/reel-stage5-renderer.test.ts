import { describe, expect, it, vi } from "vitest";
import type { ReelContext } from "../src/types.js";

vi.mock("../src/db/queries.js", () => ({ updateReel: vi.fn() }));
vi.mock("../src/stages/reel-stage5-hyperframes-renderer.js", () => ({
  HyperframesStage5Renderer: class {
    readonly renderer = "hyperframes";

    async run(): Promise<Partial<ReelContext>> {
      return { videoPath: "/tmp/mock-hyperframes.mp4" };
    }
  },
}));

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
  it("uses Hyperframes as the NS brand default", async () => {
    const { ns } = await import("../src/brands/ns.js");
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");

    expect(resolveStage5RendererSelection(makeCtx({ brand: ns }))).toEqual({
      renderer: "hyperframes",
      template: "enhanced-default",
    });
  });

  it("defaults to hyperframes", async () => {
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");

    expect(resolveStage5RendererSelection(makeCtx())).toEqual({
      renderer: "hyperframes",
      template: "enhanced-default",
    });
  });

  it("uses run template before brand template", async () => {
    const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");
    const ctx = makeCtx({
      stage5Template: "enhanced-default",
      brand: { ...makeCtx().brand, reels: { ...makeCtx().brand.reels!, stage5Template: "enhanced-default" } },
    });

    expect(resolveStage5RendererSelection(ctx)).toEqual({
      renderer: "hyperframes",
      template: "enhanced-default",
    });
  });

  it("uses single Hyperframes timeout", async () => {
    const { resolveStage5RenderSettings } = await import("../src/stages/reel-stage5-renderer.js");

    expect(resolveStage5RenderSettings(makeCtx())).toEqual({
      fps: 24,
      quality: "standard",
      workers: 1,
      timeoutMs: 30 * 60_000,
      performanceProfile: "balanced",
    });
  });

  it("maps performance profiles to render settings", async () => {
    const { resolveStage5RenderSettings } = await import("../src/stages/reel-stage5-renderer.js");

    expect(resolveStage5RenderSettings(makeCtx({
      brand: {
        ...makeCtx().brand,
        reels: {
          ...makeCtx().brand.reels!,
          stage5Performance: { effectQuality: "high", imageAnimation: "moderate", targetFps: 30 },
        },
      },
    }))).toEqual({
      fps: 30,
      quality: "high",
      workers: 1,
      timeoutMs: 30 * 60_000,
      performanceProfile: "high",
    });
  });

  it("returns renderer metadata and settings from the facade patch", async () => {
    const { ReelStage5Facade } = await import("../src/stages/reel-stage5-renderer.js");

    const result = await new ReelStage5Facade().run(makeCtx({
      stage5Renderer: "hyperframes",
    }));

    expect(result).toEqual({
      videoPath: "/tmp/mock-hyperframes.mp4",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      stage5RenderSettings: {
        fps: 24,
        quality: "standard",
        workers: 1,
        timeoutMs: 30 * 60_000,
        performanceProfile: "balanced",
      },
    });
  });
});
