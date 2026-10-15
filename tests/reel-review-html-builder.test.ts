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

  it("shows renderer fps when quality telemetry is absent", () => {
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
      stage5RenderTelemetry: { renderer: "hyperframes", fps: 24, durationMs: 32100 },
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).toContain("24fps");
    expect(html).not.toContain("24fps ·");
  });

  it("defaults renderer label to hyperframes when renderer metadata is absent", () => {
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
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).toContain("Renderer");
    expect(html).toContain("hyperframes");
  });

  it("adds noopener noreferrer on source links opened in new tabs", () => {
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
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).toContain('class="source-link" href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });

  it("renders non-http source values as escaped text instead of links", () => {
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
      story: { headline: "Headline", sourceUrl: "javascript:alert(1) <b>", source: "example.com" },
      script: { title: "Title", hashtags: ["#News"], scenes: [{ sceneNumber: 1, caption: "Hook", voiceover: "Voice", imagePrompt: "Image" }] },
      videoGcsUrl: "https://gcs/reel.mp4",
      stageLogs: [],
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).not.toContain('<a class="source-link"');
    expect(html).toContain('<span class="source-link">');
    expect(html).toContain('javascript:alert(1) &lt;b&gt;');
  });

  it("renders non-http extract download URL as escaped plain text, not clickable", () => {
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
      story: {
        headline: "Headline",
        sourceUrl: "https://example.com",
        source: "example.com",
        sourceExtractAvailable: true,
        sourceExtractDownloadUrl: "javascript:alert(1) <b>",
      },
      script: { title: "Title", hashtags: ["#News"], scenes: [{ sceneNumber: 1, caption: "Hook", voiceover: "Voice", imagePrompt: "Image" }] },
      videoGcsUrl: "https://gcs/reel.mp4",
      stageLogs: [],
      context: {
        inputMode: "url",
        sourceReadMode: "tavily_extract",
        sourceExtractAvailable: true,
        sourceExtractDownloadUrl: "javascript:alert(1) <b>",
      },
    } as ReelContext;

    const html = buildReelReviewHtml(ctx);

    expect(html).toContain('<span class="panel-label">Extract file</span>');
    expect(html).not.toContain('href="javascript:alert(1)');
    expect(html).not.toContain('Download .txt</a>');
    expect(html).toContain('javascript:alert(1) &lt;b&gt;');
  });
});
