import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getReelById: vi.fn(),
}));

vi.mock("../src/db/queries.js", async () => {
  return {
    getRunById: vi.fn(),
    getPostsByRun: vi.fn(),
    getStageLogsForRun: vi.fn(),
    getReelById: mocks.getReelById,
  };
});

function baseReel() {
  return {
    id: "reel-1",
    brand: "ns",
    runDate: "2026-04-23",
    category: "business",
    headline: "Headline",
    sourceUrl: "https://example.com/story",
    snippet: "Snippet",
    script: JSON.stringify({
      title: "Title",
      category: "business",
      hashtags: ["#a"],
      scenes: [
        {
          sceneNumber: 1,
          caption: "Cap",
          voiceover: "VO",
          imagePrompt: "NEW PROMPT",
          durationSeconds: 2,
          wordTimings: [{ word: "hello", start: 0, end: 0.5 }],
        },
      ],
    }),
    videoGcsUrl: "https://storage.googleapis.com/bucket/reel.mp4",
    reviewUrl: null,
    status: "awaiting_approval",
    context: null,
  };
}

describe("reel review metadata fidelity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("renders latest music file and scene source badge from persisted context", () => {
    mocks.getReelById.mockReturnValue({
      ...baseReel(),
      context: JSON.stringify({
        musicFile: "business-2.mp3",
        imageSourceMap: { 1: { type: "stock", provider: "unsplash" } },
      }),
    });

    return import("../api/routes/review.js").then(async ({ reviewRouter }) => {
      const res = await reviewRouter.request(new Request("http://localhost/review/reel/reel-1"));
      const html = await res.text();
      expect(html).toContain("business-2.mp3");
      expect(html).toContain("📷 Unsplash");
    });
  });

  it("renders latest script prompt after regeneration", () => {
    mocks.getReelById.mockReturnValue(baseReel());

    return import("../api/routes/review.js").then(async ({ reviewRouter }) => {
      const res = await reviewRouter.request(new Request("http://localhost/review/reel/reel-1"));
      const html = await res.text();
      expect(html).toContain("NEW PROMPT");
    });
  });

  it("renders manual source provenance when source is a free-text label", () => {
    mocks.getReelById.mockReturnValue({
      ...baseReel(),
      sourceUrl: "internal memo",
      context: JSON.stringify({
        inputMode: "manual_text",
        manualSourceLabel: "internal memo",
        manualTextProvided: true,
        manualTextInputType: "txt_upload",
      }),
    });

    return import("../api/routes/review.js").then(async ({ reviewRouter }) => {
      const res = await reviewRouter.request(new Request("http://localhost/review/reel/reel-1"));
      const html = await res.text();
      expect(html).toContain("Manual text");
      expect(html).toContain("Source type");
      expect(html).toContain("internal memo");
      expect(html).toContain("Source: internal memo");
    });
  });

  it("renders URL source provenance and Tavily extract download link from persisted context", () => {
    mocks.getReelById.mockReturnValue({
      ...baseReel(),
      context: JSON.stringify({
        inputMode: "url",
        sourceReadMode: "tavily_extract",
        sourceExtractAvailable: true,
        sourceExtractChars: 5994,
        sourceExtractDownloadUrl: "https://storage.googleapis.com/bucket/reel-1/source-extract.txt",
      }),
    });

    return import("../api/routes/review.js").then(async ({ reviewRouter }) => {
      const res = await reviewRouter.request(new Request("http://localhost/review/reel/reel-1"));
      const html = await res.text();
      expect(html).toContain("Source basis");
      expect(html).toContain("Tavily extract");
      expect(html).toContain("Tavily text");
      expect(html).toContain("5,994 chars");
      expect(html).toContain("Download .txt");
    });
  });

  it("renders stage5 renderer telemetry from persisted context", () => {
    mocks.getReelById.mockReturnValue({
      ...baseReel(),
      context: JSON.stringify({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
        stage5RenderTelemetry: {
          renderer: "hyperframes",
          template: "enhanced-default",
          fps: 24,
          quality: "standard",
          workers: 1,
          durationMs: 32100,
          outputBytes: 1024,
        },
      }),
    });

    return import("../api/routes/review.js").then(async ({ reviewRouter }) => {
      const res = await reviewRouter.request(new Request("http://localhost/review/reel/reel-1"));
      const html = await res.text();
      expect(html).toContain("Renderer");
      expect(html).toContain("hyperframes");
      expect(html).toContain("enhanced-default");
      expect(html).toContain("24fps");
      expect(html).toContain("32.1s");
    });
  });
});
