import fs from "fs";
import path from "path";
import { spawnSync, type SpawnSyncReturns } from "child_process";

export type RoughCutQuality = "draft" | "standard" | "high";
export type RoughCutFps = 24 | 30;

export interface StoryReelRoughCutArgs {
  runDir: string;
  clips: string[];
  outputBaseDir: string;
  fps: RoughCutFps;
  quality: RoughCutQuality;
}

export interface StoryReelRoughCutDirection {
  hook_clip: {
    clip_index: number;
    start_sec: number;
    end_sec: number;
    reason: string;
  };
  clips: Array<{
    clip_index: number;
    start_sec: number;
    end_sec: number;
    order: number;
    role: string;
  }>;
  voiceover_script: { full_text: string };
  hook_text_overlay: string;
  caption_lines: string[];
  cta_text: string;
  facebook_caption: string;
  hashtags: string[];
  total_duration_sec: number;
  director_notes: string;
}

const DEFAULT_OUTPUT_BASE_DIR = "work/storyreel-poc/rough-cuts";

function usage(): string {
  return "Usage: tsx scripts/storyreel-rough-cut-poc.ts --run-dir <dir> --clips <clip...> [--output-dir <dir>] [--fps 24|30] [--quality draft|standard|high]";
}

export function parseRoughCutArgs(argv: string[]): StoryReelRoughCutArgs {
  let runDir = "";
  const clips: string[] = [];
  let outputBaseDir = DEFAULT_OUTPUT_BASE_DIR;
  let fps: RoughCutFps = 24;
  let quality: RoughCutQuality = "standard";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--clips") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) clips.push(argv[++i]);
    } else if (arg === "--output-dir") {
      outputBaseDir = argv[++i] ?? "";
    } else if (arg === "--fps") {
      const value = Number(argv[++i]);
      if (value !== 24 && value !== 30) throw new Error(`${usage()}\nInvalid --fps: ${value}`);
      fps = value;
    } else if (arg === "--quality") {
      const value = argv[++i];
      if (value !== "draft" && value !== "standard" && value !== "high") {
        throw new Error(`${usage()}\nInvalid --quality: ${value}`);
      }
      quality = value;
    } else {
      throw new Error(`${usage()}\nUnknown argument: ${arg}`);
    }
  }

  if (!runDir.trim()) throw new Error(`${usage()}\nMissing --run-dir`);
  if (clips.length === 0) throw new Error(`${usage()}\nMissing --clips`);
  if (!outputBaseDir.trim()) throw new Error(`${usage()}\n--output-dir cannot be empty`);

  return { runDir, clips, outputBaseDir, fps, quality };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "number" && Number.isFinite(obj[key]);
}

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string";
}

function hasNonEmptyString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string" && obj[key].trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateDirection(direction: unknown): asserts direction is StoryReelRoughCutDirection {
  const errors: string[] = [];
  if (!isObject(direction)) throw new Error("Invalid direction.json: direction must be an object");

  if (!isObject(direction.hook_clip)) {
    errors.push("hook_clip must be an object");
  } else {
    if (!hasNumber(direction.hook_clip, "clip_index")) errors.push("hook_clip.clip_index must be numeric");
    if (!hasNumber(direction.hook_clip, "start_sec")) errors.push("hook_clip.start_sec must be numeric");
    if (!hasNumber(direction.hook_clip, "end_sec")) errors.push("hook_clip.end_sec must be numeric");
    if (!hasNonEmptyString(direction.hook_clip, "reason")) errors.push("hook_clip.reason must be non-empty");
  }

  if (!Array.isArray(direction.clips) || direction.clips.length === 0) {
    errors.push("clips must be a non-empty array");
  } else {
    direction.clips.forEach((clip, index) => {
      if (!isObject(clip)) {
        errors.push(`clips[${index}] must be an object`);
        return;
      }
      if (!hasNumber(clip, "clip_index")) errors.push(`clips[${index}].clip_index must be numeric`);
      if (!hasNumber(clip, "start_sec")) errors.push(`clips[${index}].start_sec must be numeric`);
      if (!hasNumber(clip, "end_sec")) errors.push(`clips[${index}].end_sec must be numeric`);
      if (!hasNumber(clip, "order")) errors.push(`clips[${index}].order must be numeric`);
      if (!hasNonEmptyString(clip, "role")) errors.push(`clips[${index}].role must be non-empty`);
    });
  }

  if (!isObject(direction.voiceover_script)) {
    errors.push("voiceover_script must be an object");
  } else if (!hasString(direction.voiceover_script, "full_text")) {
    errors.push("voiceover_script.full_text must be a string");
  }

  if (!hasString(direction, "hook_text_overlay")) errors.push("hook_text_overlay must be a string");
  if (!isStringArray(direction.caption_lines)) errors.push("caption_lines must be an array of strings");
  if (!hasString(direction, "cta_text")) errors.push("cta_text must be a string");
  if (!hasString(direction, "facebook_caption")) errors.push("facebook_caption must be a string");
  if (!isStringArray(direction.hashtags)) errors.push("hashtags must be an array of strings");
  if (!hasNumber(direction, "total_duration_sec")) errors.push("total_duration_sec must be numeric");
  if (!hasString(direction, "director_notes")) errors.push("director_notes must be a string");

  if (errors.length > 0) throw new Error(`Invalid direction.json: ${errors.join("; ")}`);
}

export function loadDirection(runDir: string): StoryReelRoughCutDirection {
  const filePath = path.join(runDir, "direction.json");
  if (!fs.existsSync(filePath)) throw new Error(`Missing direction.json: ${filePath}`);
  let direction: unknown;
  try {
    direction = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid direction.json: ${message}`);
  }
  validateDirection(direction);
  return direction;
}

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv"]);

export interface RoughCutSegmentPlan {
  index: number;
  clipIndex: number;
  sourceClip: string;
  segmentPath: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  outputStartSec: number;
  role: string;
}

export interface RoughCutAssemblyPlan {
  outputDir: string;
  hyperframesDir: string;
  assetsDir: string;
  videoPath: string;
  fps: RoughCutFps;
  quality: RoughCutQuality;
  totalDurationSec: number;
  segments: RoughCutSegmentPlan[];
  hookText: string;
  captionLines: string[];
  voiceoverText: string;
  facebookCaption: string;
  hashtags: string[];
  ctaText: string;
  directorNotes: string;
  languageCode: string;
}

export interface BuildAssemblyPlanInput {
  direction: StoryReelRoughCutDirection;
  sourceClips: string[];
  outputDir: string;
  fps: RoughCutFps;
  quality: RoughCutQuality;
  languageCode?: string;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function createRoughCutRunId(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return `storyreel-roughcut-${timestamp.slice(0, 8)}-${timestamp.slice(9)}`;
}

export function validateSourceClips(sourceClips: string[]): string[] {
  return sourceClips.map((clip) => {
    const extension = path.extname(clip).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported clip extension: ${clip}`);
    if (!fs.existsSync(clip)) throw new Error(`Clip not found: ${clip}`);
    const resolvedClip = path.resolve(clip);
    if (!fs.statSync(resolvedClip).isFile()) throw new Error(`Clip path is not a file: ${clip}`);
    return resolvedClip;
  });
}

export function buildAssemblyPlan(input: BuildAssemblyPlanInput): RoughCutAssemblyPlan {
  const hyperframesDir = path.join(input.outputDir, "hyperframes");
  const assetsDir = path.join(hyperframesDir, "assets");
  const videoPath = path.join(hyperframesDir, "storyreel-rough-cut.mp4");

  input.direction.clips.forEach((clip, index) => {
    if (!Number.isFinite(clip.start_sec)) throw new Error(`clips[${index}].start_sec must be numeric`);
    if (!Number.isFinite(clip.end_sec)) throw new Error(`clips[${index}].end_sec must be numeric`);
    if (!Number.isInteger(clip.clip_index)) throw new Error(`clips[${index}].clip_index must be an integer`);
    if (!Number.isInteger(clip.order)) throw new Error(`clips[${index}].order must be an integer`);
    if (clip.end_sec <= clip.start_sec) throw new Error(`clips[${index}].end_sec must be greater than start_sec`);
    if (clip.clip_index < 0 || clip.clip_index >= input.sourceClips.length) {
      throw new Error(
        `clips[${index}].clip_index ${clip.clip_index} is outside supplied clip range 0-${input.sourceClips.length - 1}`,
      );
    }
  });

  let outputStartSec = 0;
  const segments = [...input.direction.clips]
    .sort((a, b) => a.order - b.order)
    .map((clip, index): RoughCutSegmentPlan => {
      const durationSec = roundSeconds(clip.end_sec - clip.start_sec);
      const segment: RoughCutSegmentPlan = {
        index: index + 1,
        clipIndex: clip.clip_index,
        sourceClip: input.sourceClips[clip.clip_index],
        segmentPath: path.join(assetsDir, `segment-${String(index + 1).padStart(3, "0")}.mp4`),
        startSec: clip.start_sec,
        endSec: clip.end_sec,
        durationSec,
        outputStartSec,
        role: clip.role,
      };
      outputStartSec = roundSeconds(outputStartSec + durationSec);
      return segment;
    });

  return {
    outputDir: input.outputDir,
    hyperframesDir,
    assetsDir,
    videoPath,
    fps: input.fps,
    quality: input.quality,
    totalDurationSec: outputStartSec,
    segments,
    hookText: input.direction.hook_text_overlay,
    captionLines: input.direction.caption_lines,
    voiceoverText: input.direction.voiceover_script.full_text,
    facebookCaption: input.direction.facebook_caption,
    hashtags: input.direction.hashtags,
    ctaText: input.direction.cta_text,
    directorNotes: input.direction.director_notes,
    languageCode: input.languageCode ?? "th",
  };
}

function fontFamilyForLanguage(languageCode: string): string {
  if (languageCode.startsWith("th")) return "'Noto Sans Thai', 'Noto Sans', Arial, sans-serif";
  return "'Noto Sans', Arial, sans-serif";
}

export type FfmpegExecutor = (args: string[]) => Pick<SpawnSyncReturns<Buffer>, "status" | "stderr">;

export interface BuildFfmpegSegmentArgsInput {
  sourceClip: string;
  startSec: number;
  durationSec: number;
  outputPath: string;
  fps: RoughCutFps;
}

export function buildStoryReelCropFilter(input: { width: number; height: number }): string {
  const ratio = input.width / input.height;
  if (Math.abs(ratio - 9 / 16) < 0.03) return "scale=1080:1920";
  if (Math.abs(ratio - 16 / 9) < 0.03) return "crop=608:1080:656:0,scale=1080:1920";
  if (Math.abs(ratio - 1) < 0.03) return "crop=607:1080:236:0,scale=1080:1920";
  const targetRatio = 9 / 16;
  const cropW = Math.min(input.width, Math.floor(input.height * targetRatio));
  const cropH = Math.min(input.height, Math.floor(input.width / targetRatio));
  const x = Math.max(0, Math.floor((input.width - cropW) / 2));
  const y = Math.max(0, Math.floor((input.height - cropH) / 2));
  return `crop=${cropW}:${cropH}:${x}:${y},scale=1080:1920`;
}

export function buildFfmpegSegmentArgs(input: BuildFfmpegSegmentArgsInput): string[] {
  return [
    "-y",
    "-ss", String(input.startSec),
    "-t", String(input.durationSec),
    "-i", input.sourceClip,
    "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${input.fps},setsar=1`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    input.outputPath,
  ];
}

export function prepareSegments(
  plan: RoughCutAssemblyPlan,
  executor: FfmpegExecutor = (args) => spawnSync("ffmpeg", args),
): void {
  fs.mkdirSync(plan.assetsDir, { recursive: true });

  for (const segment of plan.segments) {
    const result = executor(buildFfmpegSegmentArgs({
      sourceClip: segment.sourceClip,
      startSec: segment.startSec,
      durationSec: segment.durationSec,
      outputPath: segment.segmentPath,
      fps: plan.fps,
    }));

    if (result.status !== 0) {
      const stderr = result.stderr?.toString("utf8").slice(0, 500) ?? "";
      throw new Error(
        `FFmpeg failed for segment ${segment.index} (${segment.sourceClip} ${segment.startSec}s-${segment.endSec}s): ${stderr}`,
      );
    }

    if (!fs.existsSync(segment.segmentPath)) {
      throw new Error(
        `FFmpeg succeeded for segment ${segment.index} but output file missing: ${segment.segmentPath}`,
      );
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function captionStart(plan: RoughCutAssemblyPlan, index: number): number {
  if (plan.captionLines.length === 0) return 0;
  return roundSeconds((plan.totalDurationSec / plan.captionLines.length) * index);
}

export function buildRoughCutHtml(plan: RoughCutAssemblyPlan): string {
  const videoClips = plan.segments.map((segment) => `
      <video class="clip video-segment segment-${segment.index}" data-start="${segment.outputStartSec}" data-duration="${segment.durationSec}" data-track-index="0" src="assets/${path.basename(segment.segmentPath)}" muted playsinline></video>`).join("");
  const captionDuration = plan.captionLines.length > 0 ? roundSeconds(plan.totalDurationSec / plan.captionLines.length) : 0;
  const captionClips = plan.captionLines.map((line, index) => `
      <div class="clip caption caption-${index + 1}" data-start="${captionStart(plan, index)}" data-duration="${captionDuration}" data-track-index="3">${escapeHtml(line)}</div>`).join("");

  return `<!doctype html>
<html lang="${plan.languageCode}">
  <head>
    <meta charset="utf-8" />
    <style>
      :root { font-family: ${fontFamilyForLanguage(plan.languageCode)}; }
      body { margin: 0; background: #05070d; }
      .composition { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #05070d; }
      .clip { position: absolute; inset: 0; }
      .video-segment { width: 100%; height: 100%; object-fit: cover; }
      .hook { left: 72px; right: 72px; top: 260px; bottom: auto; color: white; font-size: 82px; font-weight: 900; line-height: 1.2; text-shadow: 0 8px 40px rgba(0,0,0,0.8); }
      .caption { inset: auto 72px 190px 72px; color: white; background: rgba(0,0,0,0.62); border-radius: 28px; padding: 30px 42px; font-size: 54px; font-weight: 800; line-height: 1.35; text-align: center; }
    </style>
  </head>
  <body>
    <main class="composition" data-composition-id="storyreel-rough-cut" data-width="1080" data-height="1920" data-duration="${plan.totalDurationSec}">
${videoClips}
      <div class="clip hook" data-start="0" data-duration="${Math.min(3, plan.totalDurationSec)}" data-track-index="2">${escapeHtml(plan.hookText)}</div>
${captionClips}
    </main>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: ${plan.totalDurationSec} });
      window.__timelines['storyreel-rough-cut'] = tl;
    </script>
  </body>
</html>`;
}

export function writeRoughCutArtifacts(plan: RoughCutAssemblyPlan, html: string): void {
  fs.mkdirSync(plan.hyperframesDir, { recursive: true });
  fs.writeFileSync(path.join(plan.hyperframesDir, "index.html"), html);
  fs.writeFileSync(path.join(plan.outputDir, "assembly-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const lines = [
    "StoryReel Rough Cut Assembly",
    "============================",
    "",
    `Output: ${plan.videoPath}`,
    `Duration: ${plan.totalDurationSec}s`,
    `FPS: ${plan.fps}`,
    `Quality: ${plan.quality}`,
    "",
    "Segments:",
    ...plan.segments.map((segment) => `${segment.index}. ${segment.sourceClip} ${segment.startSec}s-${segment.endSec}s -> ${segment.segmentPath}`),
    "",
  ];
  fs.writeFileSync(path.join(plan.outputDir, "assembly-log.txt"), lines.join("\n"));
}

export interface HyperframesRenderInput {
  htmlPath: string;
  projectDir: string;
  outputPath: string;
  fps: RoughCutFps;
  quality: RoughCutQuality;
}

export type HyperframesRenderer = (input: HyperframesRenderInput) => Promise<void>;

export interface RunStoryReelRoughCutPocOptions {
  now?: Date;
  ffmpegExecutor?: FfmpegExecutor;
  hyperframesRenderer?: HyperframesRenderer;
}

interface HyperframesProducerModule {
  createRenderJob(config: {
    input: string;
    output: string;
    entryFile: string;
    fps: RoughCutFps;
    quality: RoughCutQuality;
    workers: number;
    format: "mp4";
  }): unknown;
  executeRenderJob(job: unknown, projectDir: string, outputPath: string, onProgress?: unknown, abortSignal?: AbortSignal): Promise<unknown>;
}

async function loadHyperframesProducer(): Promise<HyperframesProducerModule> {
  const specifier = "@hyperframes/producer";
  return await import(specifier) as HyperframesProducerModule;
}

export async function renderWithHyperframes(input: HyperframesRenderInput): Promise<void> {
  const producer = await loadHyperframesProducer();
  const job = producer.createRenderJob({
    input: input.htmlPath,
    output: input.outputPath,
    entryFile: "index.html",
    fps: input.fps,
    quality: input.quality,
    workers: 1,
    format: "mp4",
  });
  await producer.executeRenderJob(job, input.projectDir, input.outputPath);
}

export async function runStoryReelRoughCutPoc(argv: string[], options: RunStoryReelRoughCutPocOptions = {}): Promise<{ outputDir: string; videoPath: string }> {
  const args = parseRoughCutArgs(argv);
  const direction = loadDirection(args.runDir);
  const sourceClips = validateSourceClips(args.clips);
  const outputDir = path.join(args.outputBaseDir, createRoughCutRunId(options.now ?? new Date()));
  const plan = buildAssemblyPlan({ direction, sourceClips, outputDir, fps: args.fps, quality: args.quality });

  fs.mkdirSync(plan.outputDir, { recursive: true });
  prepareSegments(plan, options.ffmpegExecutor);
  const html = buildRoughCutHtml(plan);
  writeRoughCutArtifacts(plan, html);

  const renderer = options.hyperframesRenderer ?? renderWithHyperframes;
  await renderer({
    htmlPath: path.join(plan.hyperframesDir, "index.html"),
    projectDir: plan.hyperframesDir,
    outputPath: plan.videoPath,
    fps: plan.fps,
    quality: plan.quality,
  });

  if (!fs.existsSync(plan.videoPath)) throw new Error(`Hyperframes render did not create rough-cut.mp4: ${plan.videoPath}`);

  fs.copyFileSync(plan.videoPath, path.join(plan.outputDir, "rough-cut.mp4"));

  return { outputDir: plan.outputDir, videoPath: plan.videoPath };
}
