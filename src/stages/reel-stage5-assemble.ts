import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import type { ReelContext, ReelStage, Stage5RenderTelemetry, ImageSource } from "../types.js";
import { createGcsService } from "../services/gcs.js";
import { updateReel } from "../db/queries.js";
import { resolveReelMusicFile } from "./reel-music-selector.js";
import { buildReelStage5EncodeTailArgs } from "./reel-stage5-ffmpeg-builder.js";
import { buildBgFilter, resolveEffect } from "../effects/camera-effects.js";
import { resolveStage5Performance } from "./reel-stage5-performance.js";
import type { ResolvedStage5Performance } from "./reel-stage5-performance.js";
import { splitIntoBlocks } from "./reel-subtitle-blocks.js";
import { C2paSigner } from "../services/c2pa-signer.js";

const VW = 1080, VH = 1920;
const HOOK_DURATION = 2.0;
const HOOK_FADE_OUT = 0.3;
const TAIL_PADDING  = 0.6;
const HOOK_Y        = 220;
const SUBTITLE_Y    = 1480;
const MIN_HIGHLIGHT_DURATION = 0.05;

let _puppeteer: any = null;
async function getPuppeteer() {
  if (!_puppeteer) _puppeteer = (await import("node-html-to-image")).default;
  return _puppeteer;
}

const WRAP_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:980px; background:transparent; display:flex; justify-content:center; }
  .wrap {
    font-family:'Noto Sans Thai',Arial Black,Arial,sans-serif,'Noto Color Emoji';
    font-variant-emoji: text;
    font-size:54px; font-weight:bold;
    padding:22px 40px; border-radius:16px;
    text-align:center; line-height:1.45;
    display:flex; align-items:center; justify-content:center;
    flex-wrap:wrap; column-gap:14px; row-gap:4px;
  }
`;

function escHtml(w: string): string {
  return w.replace(/[.,!?:;—\-]+$/, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface WordTiming { word: string; start: number; end: number; }

interface Stage5SceneTelemetryInput {
  sceneNumber: number;
  sceneCount: number;
  renderMs: number;
  encodeMs: number;
  totalMs: number;
  profile: ResolvedStage5Performance;
}

interface FfmpegStage5RenderTelemetryInput {
  fps: number;
  stageStartMs: number;
  renderEndMs: number;
  outputBytes: number;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatStage5SceneTelemetry(input: Stage5SceneTelemetryInput): string {
  const profile = `${input.profile.effectQuality}@${input.profile.targetFps}fps preset=${input.profile.videoPreset} bgScaleCap=${input.profile.bgScaleCap}`;
  return `    telemetry scene ${input.sceneNumber}/${input.sceneCount}: render=${formatSeconds(input.renderMs)} encode=${formatSeconds(input.encodeMs)} total=${formatSeconds(input.totalMs)} profile=${profile}`;
}

export function buildFfmpegStage5RenderTelemetry(input: FfmpegStage5RenderTelemetryInput): Stage5RenderTelemetry {
  return {
    renderer: "hyperframes",
    fps: input.fps,
    durationMs: input.renderEndMs - input.stageStartMs,
    outputBytes: input.outputBytes,
  };
}

export function shouldRenderHighlight(wordDuration: number): boolean {
  return wordDuration >= MIN_HIGHLIGHT_DURATION;
}

async function renderBasePng(words: string[], outPath: string): Promise<void> {
  const pup = await getPuppeteer();
  const spans = words.map(w => `<span style="color:rgba(255,255,255,0.45)">${escHtml(w)}</span>`).join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${WRAP_CSS}
    .wrap { background:rgba(0,0,0,0.72); }
  </style></head><body><div class="wrap">${spans}</div></body></html>`;
  await pup({ output: outPath, html, transparent: true,
    puppeteerArgs: { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] } });
}

async function renderHighlightPng(words: string[], highlightIdx: number, outPath: string): Promise<void> {
  const pup = await getPuppeteer();
  const spans = words.map((w, i) => {
    const e = escHtml(w);
    if (i === highlightIdx)
      return `<span style="color:#FFD700;text-shadow:0 0 16px rgba(255,215,0,0.6)">${e}</span>`;
    return `<span style="color:transparent">${e}</span>`;
  }).join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${WRAP_CSS}
    .wrap { background:transparent; }
  </style></head><body><div class="wrap">${spans}</div></body></html>`;
  await pup({ output: outPath, html, transparent: true,
    puppeteerArgs: { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] } });
}

async function renderHookPng(text: string, outPath: string): Promise<void> {
  const pup = await getPuppeteer();
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 980px; background: transparent; display: flex; justify-content: center; }
    .caption {
      font-size: 56px; font-family: 'Noto Sans Thai','Noto Color Emoji',Arial,sans-serif;
      font-variant-emoji: text;
      font-weight: bold; color: white; background: rgba(0,0,0,0.75);
      padding: 22px 36px; border-radius: 14px; text-align: center;
      line-height: 1.4; word-wrap: break-word; text-shadow: 2px 2px 4px rgba(0,0,0,0.9);
    }
  </style></head><body><div class="caption">${escaped}</div></body></html>`;
  await pup({ output: outPath, html, transparent: true,
    puppeteerArgs: { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] } });
}

export class ReelStage5Assemble implements ReelStage {
  name = "reel-stage5-assemble";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script");
    if (!ctx.audioPaths?.length) throw new Error("No audio — run reel-stage2-voice first");
    if (!ctx.imagePaths?.length) throw new Error("No images — run reel-stage3-images first");

    const stageStartMs = Date.now();

    const tmpDir = ctx.workDir!;
    fs.mkdirSync(tmpDir, { recursive: true });

    const profile = resolveStage5Performance(ctx.stage5Performance ?? ctx.brand.reels?.stage5Performance);
    const _category = ctx.category ?? ctx.script?.category;
    const cameraEffect = resolveEffect(_category, ctx.brand.reels, ctx.cameraEffect);
    ctx.usedCameraEffect = cameraEffect;
    console.log(`  Stage5 profile: quality=${profile.effectQuality}, fps=${profile.targetFps}, preset=${profile.videoPreset}, bgScaleCap=${profile.bgScaleCap}, effect=${cameraEffect}`);

    const segmentPaths: string[] = [];
    const sceneCount = ctx.script.scenes.length;

    for (const scene of ctx.script.scenes) {
      const sceneStartMs = Date.now();
      const imgPath   = ctx.imagePaths[scene.sceneNumber - 1];
      const audioPath = ctx.audioPaths[scene.sceneNumber - 1];
      const segPath   = path.join(tmpDir, `segment${scene.sceneNumber}.mp4`);
      let audioDuration: number;
      try {
        const probedDur = execSync(
          `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
          { encoding: "utf8" }
        ).trim();
        audioDuration = parseFloat(probedDur);
        if (!isFinite(audioDuration) || audioDuration <= 0) throw new Error("bad probe");
      } catch {
        audioDuration = scene.durationSeconds ?? 8;
      }
      const isLastScene    = scene.sceneNumber === ctx.script.scenes.length;
      const totalDuration  = HOOK_DURATION + audioDuration + (isLastScene ? TAIL_PADDING : 0);
      const wordTimings    = (scene.wordTimings ?? []) as WordTiming[];
      const renderStartMs = Date.now();

      console.log(`  Segment ${scene.sceneNumber} (hook=${HOOK_DURATION}s + audio=${audioDuration.toFixed(1)}s = ${totalDuration.toFixed(1)}s, ${wordTimings.length} words)...`);

      const hookPng = path.join(tmpDir, `hook${scene.sceneNumber}.png`);
      await renderHookPng(scene.caption, hookPng);
      const hookDims = execSync(`identify -format "%w %h" "${hookPng}"`, { encoding: "utf8" })
        .trim().split(" ").map(Number);
      const hookX = Math.round((VW - hookDims[0]) / 2);

      const blocks = splitIntoBlocks(wordTimings);

      const basePngs: Array<{ png: string; start: number; end: number }> = [];
      const hlPngs:   Array<{ png: string; start: number; end: number }> = [];

      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        const words = block.map(w => w.word);
        const nextBlock = blocks[bi + 1];
        const blockEnd = nextBlock
          ? nextBlock[0].start
          : block[block.length - 1].end;

        const basePng = path.join(tmpDir, `base_${scene.sceneNumber}_${bi}.png`);
        await renderBasePng(words, basePng);
        basePngs.push({
          png:   basePng,
          start: block[0].start + HOOK_DURATION,
          end:   blockEnd       + HOOK_DURATION,
        });

        for (let wi = 0; wi < block.length; wi++) {
          const wordDuration = block[wi].end - block[wi].start;
          if (!shouldRenderHighlight(wordDuration)) continue;

          const nextWord = block[wi + 1];
          const hlEnd = nextWord ? nextWord.start : block[block.length - 1].end;

          const hlPng = path.join(tmpDir, `hl_${scene.sceneNumber}_${bi}_${wi}.png`);
          await renderHighlightPng(words, wi, hlPng);
          hlPngs.push({
            png:   hlPng,
            start: block[wi].start + HOOK_DURATION,
            end:   hlEnd           + HOOK_DURATION,
          });
        }
        process.stdout.write(`    block ${bi + 1}/${blocks.length}\r`);
      }
      console.log(`    ${basePngs.length} base + ${hlPngs.length} highlight PNGs`);
      const renderMs = Date.now() - renderStartMs;

      const ffmpegArgs: string[] = ["-y",
        "-loop", "1", "-i", imgPath,
        "-i", audioPath,
        "-loop", "1", "-t", String(totalDuration), "-i", hookPng,
      ];
      for (const b of basePngs) ffmpegArgs.push("-loop", "1", "-t", String(totalDuration), "-i", b.png);
      for (const h of hlPngs)   ffmpegArgs.push("-loop", "1", "-t", String(totalDuration), "-i", h.png);

      const filterParts: string[] = [];

      filterParts.push(buildBgFilter(cameraEffect, totalDuration, profile.targetFps, profile.bgScaleCap));

      const hookFOS = (HOOK_DURATION - HOOK_FADE_OUT).toFixed(3);
      filterParts.push(
        `[2:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,` +
        `fade=t=out:st=${hookFOS}:d=${HOOK_FADE_OUT}:alpha=1[hook]`
      );
      filterParts.push(`[bg][hook]overlay=${hookX}:${HOOK_Y}[v0]`);

      let lastV = "v0";
      let inputIdx = 3;

      for (let bi = 0; bi < basePngs.length; bi++) {
        const { start, end } = basePngs[bi];
        const outLabel = `vb${bi}`;
        filterParts.push(`[${inputIdx}:v]format=rgba[base${bi}]`);
        filterParts.push(
          `[${lastV}][base${bi}]overlay=` +
          `x=(W-w)/2:y=${SUBTITLE_Y}:` +
          `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'` +
          `[${outLabel}]`
        );
        lastV = outLabel;
        inputIdx++;
      }

      for (let hi = 0; hi < hlPngs.length; hi++) {
        const { start, end } = hlPngs[hi];
        const wEnd = Math.max(end, start + MIN_HIGHLIGHT_DURATION);
        const outLabel = hi < hlPngs.length - 1 ? `vh${hi}` : "vtmp";
        filterParts.push(`[${inputIdx}:v]format=rgba[hl${hi}]`);
        filterParts.push(
          `[${lastV}][hl${hi}]overlay=` +
          `x=(W-w)/2:y=${SUBTITLE_Y}:` +
          `enable='between(t,${start.toFixed(3)},${wEnd.toFixed(3)})'` +
          `[${outLabel}]`
        );
        lastV = outLabel;
        inputIdx++;
      }

      const delayMs = Math.round(HOOK_DURATION * 1000);
      filterParts.push(`[1:a]adelay=${delayMs}|${delayMs}[delayed_audio]`);

      const finalV = hlPngs.length > 0
        ? "vtmp"
        : (basePngs.length > 0 ? `vb${basePngs.length - 1}` : "v0");

      ffmpegArgs.push(
        "-filter_complex", filterParts.join(";"),
        ...buildReelStage5EncodeTailArgs({
          finalVideoLabel: finalV,
          audioLabel: "delayed_audio",
          totalDuration,
          outputPath: segPath,
          preset: profile.videoPreset,
        }),
      );

      const encodeStartMs = Date.now();
      const result = spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
      if (result.status !== 0) {
        throw new Error(`FFmpeg segment ${scene.sceneNumber} failed:\n${result.stderr?.toString().slice(0, 1000)}`);
      }
      const encodeMs = Date.now() - encodeStartMs;
      const totalMs = Date.now() - sceneStartMs;
      console.log(formatStage5SceneTelemetry({
        sceneNumber: scene.sceneNumber,
        sceneCount,
        renderMs,
        encodeMs,
        totalMs,
        profile,
      }));
      segmentPaths.push(segPath);

      updateReel(ctx.runId, { currentStage: `reel-stage5-assemble (segment ${scene.sceneNumber}/${ctx.script.scenes.length})` });
    }

    const concatFile = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(concatFile, segmentPaths.map((p) => `file '${p}'`).join("\n"));
    const videoPath = path.join(tmpDir, "reel.mp4");
    const concatResult = spawnSync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", videoPath,
    ], { stdio: "pipe" });
    if (concatResult.status !== 0) {
      throw new Error(`FFmpeg concat failed:\n${concatResult.stderr?.toString()}`);
    }
    console.log(`  Video assembled: ${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)} MB`);

    const category = ctx.category ?? ctx.script?.category;
    const resolvedMusic = resolveReelMusicFile({
      brand: ctx.brand,
      category,
      selector: ctx.musicTrackOverride,
      existsFn: fs.existsSync,
    });
    let musicFileName: string | undefined;
    if (resolvedMusic) {
      const musicFile = resolvedMusic.path;
      musicFileName = resolvedMusic.fileName;
      const volume    = ctx.brand.reels?.musicVolume ?? 0.13;
      const mixedPath = path.join(tmpDir, "reel_music.mp4");
      const musicResult = spawnSync("ffmpeg", [
        "-y", "-i", videoPath,
        "-stream_loop", "-1", "-i", musicFile,
        "-filter_complex", `[1:a]volume=${volume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[audio]`,
        "-map", "0:v", "-map", "[audio]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        mixedPath,
      ], { stdio: "pipe" });
      if (musicResult.status !== 0) {
        const ffmpegErr = musicResult.stderr?.toString() ?? "";
        const errLines = ffmpegErr.split("\n").filter((l) => !l.startsWith("ffmpeg version") && !l.startsWith("  built") && !l.startsWith("  config") && !l.startsWith("  lib") && l.trim());
        console.warn(`  ⚠️ Music mix failed:\n${errLines.slice(-10).join("\n")}`);
      } else {
        fs.renameSync(mixedPath, videoPath);
        console.log(`  Music added: ${path.basename(musicFile)} (vol ${volume}, category: ${category ?? "fallback"})`);
      }
    }

    let videoBuffer = fs.readFileSync(videoPath);
    if (ctx.imageSourceMap) {
      try {
        const c2pa = new C2paSigner();
        const sourceMap = ctx.imageSourceMap;
        const sceneImages = ctx.script.scenes.map((scene) => ({
          path: ctx.imagePaths![scene.sceneNumber - 1],
          sceneNumber: scene.sceneNumber,
          source: sourceMap[scene.sceneNumber] ?? { type: "failed" as const },
        }));
        const signed = await c2pa.signReel(videoBuffer, sceneImages);
        if (signed !== videoBuffer) {
          fs.writeFileSync(videoPath, signed);
          videoBuffer = Buffer.from(signed);
          const aiCount = Object.values(sourceMap).filter((s) => s.type === "ai").length;
          console.log(`  C2PA manifest embedded (${aiCount} AI scenes)`);
        }
      } catch (err) {
        console.warn(`  ⚠️ C2PA signing failed (video still valid): ${(err as Error).message}`);
      }
    }

    const outputBytes = videoBuffer.length;
    const stage5RenderTelemetry = buildFfmpegStage5RenderTelemetry({
      fps: profile.targetFps,
      stageStartMs,
      renderEndMs: Date.now(),
      outputBytes,
    });

    const gcs = createGcsService();
    const videoGcsUrl = await gcs.uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", videoBuffer);
    console.log(`  Uploaded: ${videoGcsUrl}`);

    return {
      videoPath,
      videoGcsUrl,
      musicFile: musicFileName,
      usedCameraEffect: cameraEffect,
      stage5RenderTelemetry,
    };
  }
}
