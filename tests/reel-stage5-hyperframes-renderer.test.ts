import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelContext } from "../src/types.js";

const { createRenderJobMock, executeRenderJobMock, uploadVideoMock } = vi.hoisted(() => ({
  createRenderJobMock: vi.fn((config) => ({ id: "job", config })),
  executeRenderJobMock: vi.fn(async (_job, _projectDir, outputPath) => {
    fs.writeFileSync(outputPath, Buffer.from("mp4"));
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
  const music1 = path.join(workDir, "music-source.mp3");
  fs.writeFileSync(image1, Buffer.from("png"));
  fs.writeFileSync(audio1, Buffer.from("mp3"));
  fs.writeFileSync(music1, Buffer.from("music"));
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
      reels: { enabled: true, voiceId: "voice", sceneCount: 1, reelTimes: [], musicVolume: 0.2, musicFiles: [music1] },
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
    const html = fs.readFileSync(path.join(workDir, "hyperframes", "index.html"), "utf8");
    expect(html).toContain('src="assets/scene1.png"');
    expect(html).toContain('id="voice-1"');
    expect(html).toContain('data-end="3"');
    expect(html).toContain('src="assets/scene1.mp3"');
    expect(html).toContain('id="music"');
    expect(html).toContain('data-end="3.6"');
    expect(html).toContain('data-volume="0.2"');
    expect(html).toContain('src="assets/music.mp3"');
    expect(html).toContain('class="clip watermark-layer"');
    expect(html).toContain('class="watermark-logo"');
    expect(html).not.toContain('class="watermark-logo clip"');
    expect(html).toContain('src="assets/worldbrief_logo_white_transparent.png"');
    expect(fs.existsSync(path.join(workDir, "hyperframes", "assets", "worldbrief_logo_white_transparent.png"))).toBe(true);
    expect(html).not.toContain("file://");
    expect(result).toEqual(expect.objectContaining({
      videoPath: path.join(workDir, "reel.mp4"),
      videoGcsUrl: "https://gcs/hyperframes.mp4",
      musicFile: "music-source.mp3",
      stage5RenderTelemetry: expect.objectContaining({ renderer: "hyperframes", template: "enhanced-default", fps: 24, quality: "standard" }),
    }));
  });

  it("resolves the WorldBrief watermark to an absolute runtime asset path", async () => {
    const { resolveBrandWatermarkPath, resolveWatermarkAssetPathForModuleDir } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const logoPath = resolveBrandWatermarkPath(makeCtx(workDir));

    expect(logoPath).toBeTruthy();
    expect(path.isAbsolute(logoPath!)).toBe(true);
    expect(fs.existsSync(logoPath!)).toBe(true);
    expect(logoPath).toContain(path.join("assets", "brands", "worldbrief_logo_white_transparent.png"));
    expect(resolveWatermarkAssetPathForModuleDir(path.join(process.cwd(), "dist", "src", "stages"), path.join("assets", "brands", "worldbrief_logo_white_transparent.png"))).toBe(logoPath);
  });

  it("uses a producer-supported fps for render job and telemetry", async () => {
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const ctx = makeCtx(workDir);
    ctx.stage5RenderSettings = { ...ctx.stage5RenderSettings!, fps: 20 };

    const result = await new HyperframesStage5Renderer().run(ctx);

    expect(createRenderJobMock).toHaveBeenCalledWith(expect.objectContaining({ fps: 24 }));
    expect(result.stage5RenderTelemetry).toEqual(expect.objectContaining({ fps: 24 }));
  });

  it("times out Hyperframes renders and does not upload", async () => {
    executeRenderJobMock.mockImplementationOnce((_job, _projectDir, _outputPath, _onProgress, abortSignal?: AbortSignal) => new Promise((_resolve, reject) => {
      abortSignal?.addEventListener("abort", () => reject(new Error("producer aborted")), { once: true });
    }));
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const ctx = makeCtx(workDir);
    ctx.stage5RenderSettings = { ...ctx.stage5RenderSettings!, timeoutMs: 1 };

    await expect(new HyperframesStage5Renderer().run(ctx)).rejects.toThrow("Hyperframes render timed out after");
    expect(uploadVideoMock).not.toHaveBeenCalled();
  });

  it("keeps timeout terminal when producer resolves after ignoring abort", async () => {
    executeRenderJobMock.mockImplementationOnce(async (_job, _projectDir, outputPath) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      fs.writeFileSync(outputPath, Buffer.from("mp4"));
      return { status: "complete" };
    });
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const ctx = makeCtx(workDir);
    ctx.stage5RenderSettings = { ...ctx.stage5RenderSettings!, timeoutMs: 1 };

    await expect(new HyperframesStage5Renderer().run(ctx)).rejects.toThrow("Hyperframes render timed out after");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(uploadVideoMock).not.toHaveBeenCalled();
  });

  it("does not fall back when Hyperframes render fails", async () => {
    executeRenderJobMock.mockRejectedValueOnce(new Error("hf exploded"));
    const { HyperframesStage5Renderer } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");

    await expect(new HyperframesStage5Renderer().run(makeCtx(workDir))).rejects.toThrow("Hyperframes render failed: hf exploded");
    expect(uploadVideoMock).not.toHaveBeenCalled();
  });

  it("can replace Hyperframes audio with the verified premixed audio after rendering", async () => {
    const videoPath = path.join(workDir, "reel.mp4");
    const audioPath = path.join(workDir, "audio-mixed.mp3");
    fs.writeFileSync(videoPath, Buffer.from("rendered-video"));
    fs.writeFileSync(audioPath, Buffer.from("premixed-audio"));
    const spawnSyncMock = vi.fn((_cmd, args: string[]) => {
      fs.writeFileSync(args[args.length - 1], Buffer.from("remuxed-video"));
      return { status: 0, stderr: Buffer.from("") };
    });

    const { muxPremixedAudioIntoVideo } = await import("../src/stages/reel-stage5-hyperframes-renderer.js");
    const remuxed = muxPremixedAudioIntoVideo(videoPath, audioPath, 58.172, spawnSyncMock as never);

    expect(remuxed).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
      "-i", videoPath,
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-t", "58.172",
    ]), { stdio: "pipe", timeout: 120_000 });
    expect(fs.readFileSync(videoPath)).toEqual(Buffer.from("remuxed-video"));
  });
});
