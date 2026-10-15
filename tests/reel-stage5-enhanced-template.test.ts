import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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
  it("imports without opening the pipeline database", () => {
    const templatePath = new URL("../src/stages/reel-stage5-templates/enhanced-default.ts", import.meta.url).pathname;

    expect(() => execFileSync("npx", ["tsx", "-e", `(async () => { await import(${JSON.stringify(templatePath)}); })();`], {
      cwd: "/tmp",
      env: {
        ...process.env,
        PIPELINE_DB_PATH: "/tmp/missing-template-import-db/pipeline.db",
      },
      stdio: "pipe",
    })).not.toThrow();
  });

  it("generates required Hyperframes attributes and timeline registration", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx(), musicPath: "/tmp/reel/music.mp3" });

    expect(html).toContain('data-composition-id="run-template"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('class="clip scene scene-1"');
    expect(html).toContain('class="clip voice voice-1"');
    expect(html).toContain('class="clip music"');
    expect(html).toContain("const tl = gsap.timeline({ paused: true });");
    expect(html).toContain('window.__timelines["run-template"] = tl;');
    expect(html).toContain("tl.set({}, {}, 11.6);");
    expect(html).toContain("window.gsap = window.gsap ||");
    expect(html).toContain('class="clip subtitle-layer"');
    expect(html).not.toContain('class="clip subtitle-phrase"');
    expect(html).toContain('class="subtitle-word active-word"');
    expect(html).toContain('data-start="2"');
    expect(html).not.toContain("https://cdn.jsdelivr.net");
    expect(html).not.toContain(".play()");
  });

  it("uses Thai-safe typography for DS content", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx("th") });

    expect(html).toContain("Noto Sans Thai");
    expect(html).toContain("line-height: 1.5");
  });

  it("serializes run IDs safely inside scripts", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = { ...makeCtx(), runId: 'run-</script><script>alert("x")</script>' } as ReelContext;
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    expect(html).not.toContain('run-</script><script>alert("x")</script>');
    expect(html).toContain('window.__timelines["run-\\u003c/script>\\u003cscript>alert(\\"x\\")\\u003c/script>"] = tl;');
  });

  it("rejects out-of-order scene numbers", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes = [ctx.script!.scenes[1], ctx.script!.scenes[0]];

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Scene numbers must be ordered from 1 to N");
  });

  it("rejects non-contiguous scene numbers", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[1].sceneNumber = 3;

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Scene numbers must be ordered from 1 to N");
  });

  it("includes render-safe fallback APIs without external scripts", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx() });

    expect(html).toContain("seek(value)");
    expect(html).toContain("totalDuration()");
    expect(html).toContain("eventCallback()");
    expect(html).not.toContain("cdn.jsdelivr");
  });

  it("renders stable phrase subtitles with premium active-word highlights", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx() });

    expect(html).toContain('class="clip subtitle-layer"');
    expect(html).toContain("bottom: 280px");
    expect(html).toContain("justify-content: center");
    expect(html).toContain(".subtitle-phrase");
    expect(html).toContain(".subtitle-word");
    expect(html).not.toContain('active-phrase');
    expect(html).not.toContain('data-track-index="5"');
    expect(html).toContain('class="clip subtitle-layer" data-start="2" data-duration="0.5" data-track-index="4"');
    expect(html).toContain('class="clip subtitle-layer" data-start="2.5" data-duration="0.6" data-track-index="4"');
    expect(html).toContain('<span class="subtitle-word active-word">Big</span><span class="subtitle-word">update</span>');
    expect(html).toContain('<span class="subtitle-word">Big</span><span class="subtitle-word active-word">update</span>');
    expect(html).not.toContain('transform: scale(1.06)');
    expect(html).toContain("animation: hook-enter 500ms");
    expect(html).toContain("translate3d(-60px, 0, 0)");
  });

  it("renders a small hook with red accent and no hook card background", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx() });

    expect(html).toContain('hook-copy');
    expect(html).toContain('class="hook-accent"');
    expect(html).toContain("font-size: 64px");
    expect(html).toContain("background: #b01934");
    expect(html).not.toContain("hook-card");
    expect(html).not.toContain("border-radius: 20px");
  });

  it("renders optional WorldBrief watermark markup", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx(), watermarkPath: "assets/worldbrief_logo_white_transparent.png" });

    expect(html).toContain('class="clip watermark-layer"');
    expect(html).toContain('class="watermark-logo"');
    expect(html).not.toContain('class="watermark-logo clip"');
    expect(html).toContain('src="assets/worldbrief_logo_white_transparent.png"');
    expect(html).toContain("width: 256px");
    expect(html).toContain("height: auto");
    expect(html).toContain("object-fit: contain");
    expect(html).toContain("opacity: 0.78");
  });

  it("throws a clear error when a scene image is missing", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.imagePaths![1] = "";

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Missing image for scene 2");
  });

  it("throws a clear error for invalid scene numbers", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[0].sceneNumber = 0;

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Invalid scene number: 0");
  });

  it("skips word timings with non-positive duration", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[0].wordTimings = [{ word: "BadTiming", start: 1, end: 1 }];
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    expect(html).not.toContain("BadTiming");
  });

  it("clamps word timings to voice and composition bounds", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[0].wordTimings = [
      { word: "Negative", start: -0.5, end: 0.2 },
      { word: "TooLate", start: 3, end: 3.4 },
      { word: "Extending", start: 2.8, end: 4 },
    ];
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    expect(html).toContain('data-start="2" data-duration="2.8" data-track-index="4"');
    expect(html).not.toContain("TooLate");
    expect(html).toContain('data-start="4.8" data-duration="0.2" data-track-index="4"');
    expect(html).not.toContain('data-duration="Infinity"');
    expect(html).not.toContain('data-duration="0"');
  });

  it("throws a clear error for non-finite scene durations", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[0].durationSeconds = Infinity;

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Invalid duration for scene 1");
  });

  it("defaults missing scene durations to eight seconds", async () => {
    const { buildEnhancedDefaultHyperframesHtml, getEnhancedDefaultDuration } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    delete ctx.script!.scenes[0].durationSeconds;

    expect(getEnhancedDefaultDuration(ctx)).toBe(16.6);
    expect(buildEnhancedDefaultHyperframesHtml({ ctx })).toContain('data-duration="10"');
  });

  it("throws a clear error for duplicate scene numbers", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.script!.scenes[1].sceneNumber = 1;

    expect(() => buildEnhancedDefaultHyperframesHtml({ ctx })).toThrow("Duplicate scene number: 1");
  });

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

  it("renders ai-badge-layer clips only for AI-sourced scenes", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.imageSourceMap = {
      1: { type: "ai", model: "imagen-3" },
      2: { type: "ai", model: "imagen-3" },
    };
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    // Both scenes are AI — badge appears twice
    const matches = html.match(/class="clip ai-badge-layer"/g);
    expect(matches).toHaveLength(2);
    expect(html).toContain('class="clip ai-badge-layer" data-start="0" data-duration="5" data-track-index="7"');
    expect(html).toContain('class="clip ai-badge-layer" data-start="5" data-duration="6.6" data-track-index="7"');
    expect(html).toContain("✨ AI");
    expect(html).toContain(".ai-badge-layer");
    expect(html).toContain("left: 68px");
    expect(html).toContain("top: 270px");
    expect(html).toContain("rgba(255, 255, 255, 0.65)");
  });

  it("omits ai-badge-layer when all scenes are stock", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.imageSourceMap = {
      1: { type: "stock", provider: "unsplash" },
      2: { type: "stock", provider: "pexels" },
    };
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    expect(html).not.toContain("ai-badge-layer");
    expect(html).not.toContain("✨ AI");
  });

  it("renders ai-badge-layer only on the AI scene in a mixed reel", async () => {
    const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
    const ctx = makeCtx();
    ctx.imageSourceMap = {
      1: { type: "ai", model: "azure-dall-e-3" },
      2: { type: "stock", provider: "pixabay" },
    };
    const html = buildEnhancedDefaultHyperframesHtml({ ctx });

    // Only scene 1 (start=0) gets the badge
    const matches = html.match(/class="clip ai-badge-layer"/g);
    expect(matches).toHaveLength(1);
    expect(html).toContain('class="clip ai-badge-layer" data-start="0" data-duration="5" data-track-index="7"');
    expect(html).not.toContain('data-start="5" data-duration="6.6" data-track-index="7"');
  });
});
