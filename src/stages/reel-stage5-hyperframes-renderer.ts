import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createGcsService } from "../services/gcs.js";
import type { ReelContext, Stage5RendererType, Stage5RenderSettings } from "../types.js";
import { resolveReelMusicFile } from "./reel-music-selector.js";
import { resolveHyperframesCameraPreset } from "../effects/hyperframes-presets.js";
import { C2paSigner } from "../services/c2pa-signer.js";
import type { Stage5Renderer } from "./reel-stage5-renderer.js";
import { buildEnhancedDefaultHyperframesHtml, calculateSceneTimings, getEnhancedDefaultDuration } from "./reel-stage5-templates/enhanced-default.js";

const DEFAULT_SETTINGS: Stage5RenderSettings = {
  fps: 24,
  quality: "standard",
  workers: 1,
  timeoutMs: 30 * 60_000,
  performanceProfile: "balanced",
};

const TIMEOUT_CLEANUP_GRACE_MS = 2_000;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WATERMARK_PATHS: Record<string, string> = {
  ns: path.join("assets", "brands", "worldbrief_logo_white_transparent.png"),
  ds: path.join("assets", "brands", "thaidaily_logo_white_transparent.png"),
  ts: path.join("assets", "brands", "tagesbrief_logo_white_transparent.png"),
};

interface HyperframesRenderJobConfig {
  input: string;
  output: string;
  entryFile: string;
  fps: 24 | 30 | 60;
  quality: Stage5RenderSettings["quality"];
  workers: number;
  format: "mp4";
}

interface HyperframesProducerModule {
  createRenderJob(config: HyperframesRenderJobConfig): unknown;
  executeRenderJob(job: unknown, projectDir: string, outputPath: string, onProgress?: unknown, abortSignal?: AbortSignal): Promise<unknown>;
}

async function loadHyperframesProducer(): Promise<HyperframesProducerModule> {
  const specifier = "@hyperframes/producer";
  return await import(specifier) as HyperframesProducerModule;
}

function preMixAudio(
  voicePaths: string[],
  musicFilePath: string | undefined,
  musicVolume: number,
  totalDuration: number,
  timings: ReturnType<typeof calculateSceneTimings>,
  outputPath: string,
): boolean {
  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    let inputIndex = 0;

    if (musicFilePath) {
      inputs.push("-i", musicFilePath);
      filters.push(
        `[${inputIndex}:a]volume=${musicVolume},apad=whole_dur=${totalDuration},atrim=0:${totalDuration},asetpts=PTS-STARTPTS[music]`,
      );
      inputIndex++;
    }

    const voiceLabels: string[] = [];
    for (let i = 0; i < voicePaths.length; i++) {
      inputs.push("-i", voicePaths[i]);
      const delayMs = Math.round(timings[i].audioStart * 1000);
      const label = `v${i}`;
      filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs}[${label}]`);
      voiceLabels.push(`[${label}]`);
      inputIndex++;
    }

    const allLabels = musicFilePath ? ["[music]", ...voiceLabels] : voiceLabels;
    const inputCount = allLabels.length;
    filters.push(
      `${allLabels.join("")}amix=inputs=${inputCount}:duration=longest:normalize=0,volume=${inputCount},alimiter=limit=0.95[out]`,
    );

    const args = [
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[out]",
      "-t", String(totalDuration),
      "-c:a", "libmp3lame", "-b:a", "128k",
      outputPath,
    ];

    const result = spawnSync("ffmpeg", args, { stdio: "pipe", timeout: 60_000 });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString("utf8") ?? "";
      throw new Error(`ffmpeg exited ${result.status}: ${stderr.slice(0, 300)}`);
    }
    return fs.existsSync(outputPath);
  } catch (err) {
    console.warn(`  ⚠️ Audio pre-mix failed, falling back to producer mixing: ${(err as Error).message?.slice(0, 200)}`);
    return false;
  }
}

export function muxPremixedAudioIntoVideo(
  videoPath: string,
  audioPath: string,
  totalDuration: number,
  spawn: typeof spawnSync = spawnSync,
): boolean {
  const remuxedPath = videoPath.replace(/\.mp4$/u, "_audio_remuxed.mp4");
  const result = spawn("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(totalDuration),
    "-movflags", "+faststart",
    remuxedPath,
  ], { stdio: "pipe", timeout: 120_000 });

  if (result.status !== 0 || !fs.existsSync(remuxedPath)) {
    const stderr = result.stderr?.toString("utf8") ?? "";
    console.warn(`  ⚠️ Audio remux failed, keeping producer audio: ${stderr.slice(0, 300)}`);
    return false;
  }

  fs.renameSync(remuxedPath, videoPath);
  return true;
}

export class HyperframesStage5Renderer implements Stage5Renderer {
  readonly renderer: Stage5RendererType = "hyperframes";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    validateContext(ctx);

    const stageStartMs = Date.now();
    const settings = ctx.stage5RenderSettings ?? DEFAULT_SETTINGS;
    const fps = normalizeProducerFps(settings.fps);
    const hyperframesDir = path.join(ctx.workDir, "hyperframes");
    const assetsDir = path.join(hyperframesDir, "assets");
    const htmlPath = path.join(hyperframesDir, "index.html");
    const videoPath = path.join(ctx.workDir, "reel.mp4");
    const category = ctx.category ?? ctx.script?.category;
    const cameraPreset = resolveHyperframesCameraPreset(category, ctx.brand.reels, ctx.cameraPreset);
    ctx.usedCameraPreset = cameraPreset;
    const watermarkSourcePath = resolveBrandWatermarkPath(ctx);
    const resolvedMusic = resolveReelMusicFile({
      brand: ctx.brand,
      category,
      selector: ctx.musicTrackOverride,
      existsFn: fs.existsSync,
    });

    fs.mkdirSync(assetsDir, { recursive: true });
    const assetMap = copyProducerAssets(ctx, assetsDir, resolvedMusic?.path, watermarkSourcePath);

    const scenes = ctx.script!.scenes;
    const timings = calculateSceneTimings(scenes);
    const totalDuration = getEnhancedDefaultDuration(ctx);
    const musicVolume = ctx.brand.reels?.musicVolume ?? 0.13;
    const mixedAudioName = "audio-mixed.mp3";
    const mixedAudioPath = path.join(assetsDir, mixedAudioName);
    const preMixedOk = preMixAudio(
      ctx.audioPaths!,
      resolvedMusic?.path,
      musicVolume,
      totalDuration,
      timings,
      mixedAudioPath,
    );

    const preMixedAudioForHtml = preMixedOk ? mixedAudioPath : undefined;
    if (preMixedOk) assetMap.set(mixedAudioPath, `assets/${mixedAudioName}`);

    fs.writeFileSync(htmlPath, buildEnhancedDefaultHyperframesHtml({
      ctx,
      cameraPreset,
      musicPath: preMixedOk ? undefined : resolvedMusic?.path,
      assetSrc: (filePath) => assetMap.get(filePath) ?? filePath,
      watermarkPath: watermarkSourcePath ? assetMap.get(watermarkSourcePath) : undefined,
      preMixedAudioPath: preMixedAudioForHtml,
    }));

    const { createRenderJob, executeRenderJob } = await loadHyperframesProducer();
    const renderJob = createRenderJob({
      input: htmlPath,
      output: videoPath,
      entryFile: "index.html",
      fps,
      quality: settings.quality,
      workers: settings.workers,
      format: "mp4",
    });

    const abortController = new AbortController();
    try {
      await withRenderTimeout(
        executeRenderJob(renderJob, hyperframesDir, videoPath, undefined, abortController.signal),
        settings.timeoutMs,
        abortController,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Hyperframes render timed out after")) {
        throw new Error(message);
      }
      throw new Error(`Hyperframes render failed: ${message}`);
    }

    if (preMixedOk) {
      muxPremixedAudioIntoVideo(videoPath, mixedAudioPath, totalDuration);
    }

    const renderEndMs = Date.now();
    let uploadBuffer: Buffer = fs.readFileSync(videoPath);
    if (ctx.imageSourceMap && ctx.script) {
      try {
        const c2pa = new C2paSigner();
        const sourceMap = ctx.imageSourceMap;
        const sceneImages = ctx.script.scenes.map((scene) => ({
          path: ctx.imagePaths![scene.sceneNumber - 1],
          sceneNumber: scene.sceneNumber,
          source: sourceMap[scene.sceneNumber] ?? { type: "failed" as const },
        }));
        const signed = await c2pa.signReel(Buffer.from(uploadBuffer), sceneImages);
        if (signed !== uploadBuffer) {
          uploadBuffer = signed;
          const aiCount = Object.values(sourceMap).filter((s) => s.type === "ai").length;
          console.log(`  C2PA manifest embedded (${aiCount} AI scenes)`);
        }
      } catch (err) {
        console.warn(`  ⚠️ C2PA signing failed (video still valid): ${(err as Error).message}`);
      }
    }
    const videoGcsUrl = await createGcsService().uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", uploadBuffer);

    return {
      videoPath,
      videoGcsUrl,
      musicFile: resolvedMusic?.fileName,
      usedCameraPreset: cameraPreset,
      stage5RenderTelemetry: {
        renderer: "hyperframes",
        template: ctx.stage5Template ?? "enhanced-default",
        fps,
        quality: settings.quality,
        workers: settings.workers,
        durationMs: renderEndMs - stageStartMs,
        outputBytes: uploadBuffer.length,
        mode: "local",
      },
    };
  }
}

function copyProducerAssets(ctx: ReelContext & { workDir: string }, assetsDir: string, musicPath: string | undefined, watermarkPath: string | undefined): Map<string, string> {
  const assetMap = new Map<string, string>();
  for (const [index, imagePath] of ctx.imagePaths!.entries()) {
    const assetName = `scene${index + 1}.png`;
    fs.copyFileSync(imagePath, path.join(assetsDir, assetName));
    assetMap.set(imagePath, `assets/${assetName}`);
  }
  for (const [index, audioPath] of ctx.audioPaths!.entries()) {
    const assetName = `scene${index + 1}.mp3`;
    fs.copyFileSync(audioPath, path.join(assetsDir, assetName));
    assetMap.set(audioPath, `assets/${assetName}`);
  }
  if (musicPath) {
    fs.copyFileSync(musicPath, path.join(assetsDir, "music.mp3"));
    assetMap.set(musicPath, "assets/music.mp3");
  }
  if (watermarkPath) {
    const assetName = path.basename(WATERMARK_PATHS[ctx.brand.id] ?? WATERMARK_PATHS.ns);
    fs.copyFileSync(watermarkPath, path.join(assetsDir, assetName));
    assetMap.set(watermarkPath, `assets/${assetName}`);
  }
  return assetMap;
}

export function resolveBrandWatermarkPath(ctx: ReelContext): string | undefined {
  const relativePath = WATERMARK_PATHS[ctx.brand.id];
  if (!relativePath) return undefined;
  return resolveWatermarkAssetPathForModuleDir(MODULE_DIR, relativePath);
}

export function resolveWatermarkAssetPathForModuleDir(moduleDir: string, relativePath: string): string | undefined {
  const candidates = [
    process.cwd(),
    path.resolve(moduleDir, "../.."),
    path.resolve(moduleDir, "../../.."),
  ];

  for (const root of candidates) {
    const logoPath = path.join(root, relativePath);
    if (fs.existsSync(logoPath)) return logoPath;
  }

  return undefined;
}

function normalizeProducerFps(fps: number): 24 | 30 | 60 {
  if (fps === 30 || fps === 60) return fps;
  return 24;
}

async function withRenderTimeout<T>(promise: Promise<T>, timeoutMs: number, abortController: AbortController): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeoutError = () => new Error(`Hyperframes render timed out after ${Math.ceil(timeoutMs / 1000)}s`);
  const renderPromise = promise.catch((err) => {
    if (timedOut) {
      return undefined as T;
    }
    throw err;
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(timeoutError());
      abortController.abort();
      void Promise.race([
        promise.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, TIMEOUT_CLEANUP_GRACE_MS)),
      ]).catch(() => undefined);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([renderPromise, timeoutPromise]);
    if (timedOut) {
      throw timeoutError();
    }
    return result;
  } catch (err) {
    if (timedOut) {
      throw timeoutError();
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function validateContext(ctx: ReelContext): asserts ctx is ReelContext & { workDir: string } {
  if (!ctx.workDir) {
    throw new Error("Hyperframes renderer requires workDir");
  }
  if (!ctx.script || ctx.script.scenes.length === 0) {
    throw new Error("Hyperframes renderer requires a reel script");
  }
  if (!ctx.audioPaths || ctx.audioPaths.length < ctx.script.scenes.length) {
    throw new Error("Hyperframes renderer requires audio for every scene");
  }
  if (!ctx.imagePaths || ctx.imagePaths.length < ctx.script.scenes.length) {
    throw new Error("Hyperframes renderer requires images for every scene");
  }
}
