import fs from "fs";
import path from "path";
import { createBotnoiService, selectBotnoiVoice } from "../services/botnoi.js";
import {
  generateVoiceover,
  mixVoiceAndMusic,
  muxVideoAndAudio,
  selectSharedVoice,
  writeVoiceArtifacts,
  type ElevenLabsTtsFn,
  type FfmpegAudioExecutor,
  type SelectedSharedVoice,
  type SharedVoiceSearchFn,
} from "./audio-poc.js";
import { validateDirection as validateDirectorDirection, type StoryReelDirectorDirection } from "./director-poc.js";
import {
  buildAssemblyPlan,
  buildRoughCutHtml,
  loadDirection,
  prepareSegments,
  renderWithHyperframes,
  validateSourceClips,
  writeRoughCutArtifacts,
  type FfmpegExecutor,
  type HyperframesRenderer,
  type RoughCutFps,
  type RoughCutQuality,
} from "./rough-cut-poc.js";

const DEFAULT_OUTPUT_BASE_DIR = "work/storyreel-poc/audio-rough-cuts";
type AudioVoiceProvider = "elevenlabs" | "botnoi";

export interface StoryReelAudioRoughCutArgs {
  runDir: string;
  clips: string[];
  music: string;
  voiceId?: string;
  voiceProvider: AudioVoiceProvider;
  outputBaseDir: string;
  fps: RoughCutFps;
  quality: RoughCutQuality;
}

export interface RunStoryReelAudioRoughCutPocOptions {
  now?: Date;
  ffmpegExecutor?: FfmpegExecutor & FfmpegAudioExecutor;
  hyperframesRenderer?: HyperframesRenderer;
  sharedVoiceSearch?: SharedVoiceSearchFn;
  tts?: ElevenLabsTtsFn;
}

function usage(): string {
  return "Usage: tsx scripts/storyreel-audio-rough-cut-poc.ts --run-dir <dir> --clips <clip...> --music <path> [--voice-provider elevenlabs|botnoi] [--voice-id <id>] [--output-dir <dir>] [--fps 24|30] [--quality draft|standard|high]";
}

export function parseAudioRoughCutArgs(argv: string[]): StoryReelAudioRoughCutArgs {
  let runDir = "";
  const clips: string[] = [];
  let music = "";
  let voiceId: string | undefined;
  let voiceProvider: AudioVoiceProvider = "elevenlabs";
  let outputBaseDir = DEFAULT_OUTPUT_BASE_DIR;
  let fps: RoughCutFps = 24;
  let quality: RoughCutQuality = "standard";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--clips") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) clips.push(argv[++i]);
    } else if (arg === "--music") {
      music = argv[++i] ?? "";
    } else if (arg === "--voice-id") {
      voiceId = argv[++i] ?? "";
    } else if (arg === "--voice-provider") {
      const value = argv[++i];
      if (value !== "elevenlabs" && value !== "botnoi") throw new Error(`${usage()}\nInvalid --voice-provider: ${value}`);
      voiceProvider = value;
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
  if (!music.trim()) throw new Error(`${usage()}\nMissing --music`);
  if (voiceId !== undefined && !voiceId.trim()) throw new Error(`${usage()}\n--voice-id cannot be empty`);
  if (voiceProvider === "botnoi" && !voiceId) throw new Error(`${usage()}\n--voice-id is required when --voice-provider botnoi is used`);
  if (!outputBaseDir.trim()) throw new Error(`${usage()}\n--output-dir cannot be empty`);

  return { runDir, clips, music: validateMusicPath(music), voiceId, voiceProvider, outputBaseDir, fps, quality };
}

export function createAudioRoughCutRunId(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return `storyreel-audio-roughcut-${timestamp.slice(0, 8)}-${timestamp.slice(9)}`;
}

function validateMusicPath(musicPath: string): string {
  if (!fs.existsSync(musicPath)) throw new Error(`Music file not found: ${musicPath}`);
  const resolved = path.resolve(musicPath);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Music path is not a file: ${musicPath}`);
  return resolved;
}

function selectedVoiceFromId(voiceId: string, provider: AudioVoiceProvider): SelectedSharedVoice & { provider: AudioVoiceProvider } {
  return {
    voiceId,
    name: voiceId,
    provider,
    searchQuery: `provided via --voice-id for ${provider}`,
    verifiedLanguages: [],
    reason: `provided via --voice-id for ${provider}`,
  };
}

async function generateBotnoiVoiceover(
  text: string,
  voiceId: string,
  language: string,
  tts?: ElevenLabsTtsFn,
): Promise<{ audio: Buffer; wordTimings: Awaited<ReturnType<ElevenLabsTtsFn>>["wordTimings"] }> {
  if (tts) return tts({ text, voiceId, modelId: "botnoi" });
  return createBotnoiService().textToSpeechWithTimestamps(text, voiceId, language);
}

export async function runStoryReelAudioRoughCutPoc(
  argv: string[],
  options: RunStoryReelAudioRoughCutPocOptions = {},
): Promise<{ outputDir: string; videoPath: string }> {
  const args = parseAudioRoughCutArgs(argv);
  const musicPath = args.music;
  const direction = loadDirection(args.runDir) as StoryReelDirectorDirection;
  const sourceClips = validateSourceClips(args.clips);
  const directionErrors = validateDirectorDirection(direction, sourceClips.length);
  if (directionErrors.length > 0) {
    throw new Error(`Audio rough-cut direction failed validation:\n- ${directionErrors.join("\n- ")}`);
  }
  const outputDir = path.join(args.outputBaseDir, createAudioRoughCutRunId(options.now ?? new Date()));
  const plan = buildAssemblyPlan({ direction, sourceClips, outputDir, fps: args.fps, quality: args.quality, languageCode: direction.voice_direction.language_code });

  fs.mkdirSync(plan.outputDir, { recursive: true });
  let selectedVoice: SelectedSharedVoice & { provider?: string };
  let usedBotnoi = false;

  if (args.voiceProvider === "botnoi" && args.voiceId) {
    selectedVoice = selectedVoiceFromId(args.voiceId, "botnoi");
    usedBotnoi = true;
  } else if (args.voiceProvider === "botnoi") {
    try {
      selectedVoice = await selectBotnoiVoice(direction.voice_direction);
      usedBotnoi = true;
      console.log(`  [storyreel] Botnoi auto-selected voice: ${selectedVoice.name} (${selectedVoice.voiceId}) — ${selectedVoice.reason}`);
    } catch (err) {
      console.log(`  [storyreel] Botnoi voice selection failed (${err}) — falling back to ElevenLabs`);
      selectedVoice = await selectSharedVoice(direction.voice_direction, options.sharedVoiceSearch);
    }
  } else if (args.voiceId) {
    selectedVoice = selectedVoiceFromId(args.voiceId, "elevenlabs");
  } else {
    selectedVoice = await selectSharedVoice(direction.voice_direction, options.sharedVoiceSearch);
  }

  const voiceover = usedBotnoi
    ? await generateBotnoiVoiceover(direction.voiceover_script.full_text, selectedVoice.voiceId, direction.voice_direction.language_code, options.tts)
    : await generateVoiceover({ text: direction.voiceover_script.full_text, voice: selectedVoice, tts: options.tts });
  writeVoiceArtifacts({
    outputDir: plan.outputDir,
    voiceoverAudio: voiceover.audio,
    wordTimings: voiceover.wordTimings,
    selectedVoice,
  });

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

  if (!fs.existsSync(plan.videoPath)) throw new Error(`Hyperframes render did not create silent rough cut: ${plan.videoPath}`);

  const silentVideoPath = path.join(plan.outputDir, "rough-cut-silent.mp4");
  const voicePath = path.join(plan.outputDir, "voiceover.mp3");
  const finalAudioPath = path.join(plan.outputDir, "final-audio.m4a");
  const finalVideoPath = path.join(plan.outputDir, "rough-cut-with-audio.mp4");
  fs.copyFileSync(plan.videoPath, silentVideoPath);
  mixVoiceAndMusic({
    voicePath,
    musicPath,
    outputPath: finalAudioPath,
    durationSec: plan.totalDurationSec,
    musicVolume: direction.music_direction.volume,
  }, options.ffmpegExecutor);
  muxVideoAndAudio({ videoPath: silentVideoPath, audioPath: finalAudioPath, outputPath: finalVideoPath }, options.ffmpegExecutor);

  return { outputDir: plan.outputDir, videoPath: finalVideoPath };
}
