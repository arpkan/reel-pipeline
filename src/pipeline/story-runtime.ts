import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as queries from "../db/queries.js";
import { createGcsService } from "../services/gcs.js";
import type { StoryReelClipMetadata, StoryReelClipOrientation } from "../storyreel/types.js";
import { generateVoiceover, mixVoiceAndMusic, mixMusicOnly, muxVideoAndAudio, selectSharedVoice, writeVoiceArtifacts } from "../storyreel/audio-poc.js";
import { pickStoryMusicTrack, loadStoryMusicIndex } from "../storyreel/music.js";
import {
  buildAssemblyPlan,
  buildRoughCutHtml,
  prepareSegments,
  renderWithHyperframes,
  writeRoughCutArtifacts,
  type RoughCutAssemblyPlan,
} from "../storyreel/rough-cut-poc.js";
import { StoryStage1Direction } from "../stages/story-stage1-direction.js";
import { StoryStage2Voice } from "../stages/story-stage2-voice.js";
import { StoryStage3Assembly } from "../stages/story-stage3-assembly.js";
import { StoryStage4Publish } from "../stages/story-stage4-publish.js";
import { acquireStoryAssemblyLock, releaseStoryAssemblyLock, StoryRunner } from "./story-runner.js";
import { clearStoryIntakeSession, consumeStoryMusicOverride, getStoryIntakeSession, setStoryIntakeSession } from "./story-intake-session-store.js";

const ROOT_DIR = process.env.PIPELINE_DB_PATH
  ? path.dirname(path.dirname(process.env.PIPELINE_DB_PATH))
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function storyIntakeDir(chatId: string): string {
  return path.join(ROOT_DIR, "work", "stories", "intake", chatId);
}

function probeMediaDurationSec(mediaPath: string): number {
  const raw = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    mediaPath,
  ], { encoding: "utf8" });
  return Number(raw.trim());
}

function padVideoToDuration(videoPath: string, workDir: string, durationSec: number): string {
  const currentDurationSec = probeMediaDurationSec(videoPath);
  const padSec = Math.max(0, durationSec - currentDurationSec);
  if (padSec <= 0.05) return videoPath;

  const outputPath = path.join(workDir, "rough-cut", "video-padded.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vf", `tpad=stop_mode=clone:stop_duration=${padSec}`,
    "-t", String(durationSec),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-an",
    outputPath,
  ], { stdio: "pipe" });
  return outputPath;
}

export function storyIntakeFilePath(chatId: string, index: number, fileName = "clip.mp4"): string {
  const ext = path.extname(fileName) || ".mp4";
  return path.join(storyIntakeDir(chatId), `clip-${index + 1}${ext}`);
}

export function removeStoryIntakeFiles(chatId: string): void {
  fs.rmSync(storyIntakeDir(chatId), { recursive: true, force: true });
}

export function removeStoryIntakeFile(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

function orientationFor(width: number, height: number): StoryReelClipOrientation {
  if (Math.abs(width / height - 9 / 16) < 0.08) return "vertical";
  if (Math.abs(width / height - 16 / 9) < 0.08) return "horizontal";
  if (Math.abs(width / height - 1) < 0.08) return "square";
  return "other";
}

export function probeStoryClipMetadata(clipPath: string): StoryReelClipMetadata {
  const raw = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration:format=duration",
    "-of", "json",
    clipPath,
  ], { encoding: "utf8" });
  const parsed = JSON.parse(raw) as { streams?: Array<{ width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
  const stream = parsed.streams?.[0] ?? {};
  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const durationSec = Math.round(Number(stream.duration ?? parsed.format?.duration ?? 0));
  const sizeMb = Math.round((fs.statSync(clipPath).size / 1024 / 1024) * 10) / 10;
  return { path: clipPath, sizeMb, durationSec, orientation: orientationFor(width, height), width, height };
}

export function copyStoryLocalClipToIntake(localPath: string, chatId: string, index: number): string {
  const destination = storyIntakeFilePath(chatId, index, localPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(localPath, destination);
  return destination;
}

export function copyStoryIntakeClipsToWorkDir(clips: StoryReelClipMetadata[], workDir: string): StoryReelClipMetadata[] {
  const clipsDir = path.join(workDir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  return clips.map((clip, index) => {
    const ext = path.extname(clip.path) || ".mp4";
    const destination = path.join(clipsDir, `clip-${index + 1}${ext}`);
    fs.copyFileSync(clip.path, destination);
    return { ...clip, path: destination };
  });
}

interface StoryTelegramSender {
  sendPhoto(chatId: string, buffer: Buffer, caption: string): Promise<unknown>;
  sendPhotoWithButtons(
    chatId: string,
    buffer: Buffer,
    caption: string,
    buttons: Array<Array<{ text: string; url: string }>>,
  ): Promise<unknown>;
}

export function createProductionStoryRunner(telegram: StoryTelegramSender): StoryRunner {
  const updateStoryRun = async (storyId: string, data: Record<string, unknown>) => queries.updateStoryRun(storyId, data as never);
  const planByWorkDir = new Map<string, RoughCutAssemblyPlan>();
  const gcs = createGcsService();

  return new StoryRunner({
    stages: [
      new StoryStage1Direction({ updateStoryRun }),
      new StoryStage2Voice({
        updateStoryRun: async (storyId, data) => queries.updateStoryRun(storyId, data as never),
        updateStoryProfileVoice: async (profileId, voiceId, provider) => queries.updateStoryProfileVoice(profileId, voiceId, provider as never),
        getStoryVoices: (language, style) => queries.getStoryVoices(language as never, style as never),
        selectSharedVoice: async ({ language, style }) => {
          const selected = await selectSharedVoice({ tone: "friendly", pace: "moderate", style } as never);
          return { voiceId: selected.voiceId, provider: "elevenlabs", name: selected.name };
        },
        generateVoiceover: async ({ voiceId, text, outputDir }) => {
          const voiceDir = path.join(outputDir, "voice");
          const result = await generateVoiceover({
            text,
            voice: { voiceId, name: voiceId, searchQuery: "", verifiedLanguages: [], reason: "StoryReel selected voice" },
          });
          writeVoiceArtifacts({
            outputDir: voiceDir,
            voiceoverAudio: result.audio,
            wordTimings: result.wordTimings,
            selectedVoice: { voiceId, name: voiceId, searchQuery: "", verifiedLanguages: [], reason: "StoryReel selected voice" },
          });
          return {
            voiceoverPath: path.join(voiceDir, "voiceover.mp3"),
            wordTimingsPath: path.join(voiceDir, "word-timings.json"),
          };
        },
      }),
      new StoryStage3Assembly({
        acquireAssemblyLock: async () => acquireStoryAssemblyLock(),
        releaseAssemblyLock: async () => releaseStoryAssemblyLock(),
        pickMusicTrack: (criteria) => {
          const baseDir = path.resolve("music/storyreel");
          const index = loadStoryMusicIndex(baseDir);
          return pickStoryMusicTrack({ ...criteria, baseDir, index, randomFn: Math.random });
        },
        buildAssemblyPlan: (ctx) => {
          const outputDir = path.join(ctx.workDir, "rough-cut");
          const plan = buildAssemblyPlan({
            direction: ctx.direction as never,
            sourceClips: ctx.clips.map((clip) => clip.path),
            outputDir,
            fps: 24,
            quality: "standard",
            languageCode: ctx.profile.audienceLanguage === "thai" ? "th" : ctx.profile.audienceLanguage,
          });
          planByWorkDir.set(ctx.workDir, plan);
          return plan as never;
        },
        buildRoughCutHtml: (plan) => {
          const roughPlan = plan as never as RoughCutAssemblyPlan;
          prepareSegments(roughPlan);
          const html = buildRoughCutHtml(roughPlan);
          writeRoughCutArtifacts(roughPlan, html);
          return html;
        },
        renderWithHyperframes: async (_plan, workDir) => {
          const plan = planByWorkDir.get(workDir);
          if (!plan) throw new Error(`Missing StoryReel assembly plan for ${workDir}`);
          await renderWithHyperframes({
            htmlPath: path.join(plan.hyperframesDir, "index.html"),
            projectDir: plan.hyperframesDir,
            outputPath: plan.videoPath,
            fps: plan.fps,
            quality: plan.quality,
          });
          return plan.videoPath;
        },
        getAudioDurationSec: (audioPath) => probeMediaDurationSec(audioPath),
        padVideoToDuration: async (videoPath, workDir, durationSec) => padVideoToDuration(videoPath, workDir, durationSec),
        mixVoiceAndMusic: async (voicePath, musicPath, workDir, durationSec, musicVolume) => {
          const plan = planByWorkDir.get(workDir);
          const outputPath = path.join(workDir, "rough-cut", "final-audio.m4a");
          mixVoiceAndMusic({ voicePath, musicPath, outputPath, durationSec: durationSec ?? plan?.totalDurationSec ?? 60, musicVolume });
          return outputPath;
        },
        mixMusicOnly: async (musicPath, workDir, durationSec, musicVolume) => {
          const outputPath = path.join(workDir, "rough-cut", "final-audio.m4a");
          mixMusicOnly({ musicPath, outputPath, durationSec, musicVolume });
          return outputPath;
        },
        muxVideoAndAudio: async (videoPath, audioPath, workDir) => {
          const outputPath = path.join(workDir, "rough-cut", "rough-cut-with-audio.mp4");
          muxVideoAndAudio({ videoPath, audioPath, outputPath });
          return outputPath;
        },
        updateStoryRun: async (storyId, data) => queries.updateStoryRun(storyId, data as never),
      }),
      new StoryStage4Publish({
        gcs: gcs as never,
        telegram: {
          sendPhoto: async (chatId, buffer, caption) => {
            await telegram.sendPhoto(chatId, buffer, caption);
          },
          sendPhotoWithButtons: async (chatId, buffer, caption, buttons) => {
            await telegram.sendPhotoWithButtons(chatId, buffer, caption, buttons);
          },
        },
        updateStoryRun,
        baseUrl: process.env.PIPELINE_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? "",
      }),
    ] as never,
    updateStoryRun: (storyId, data) => queries.updateStoryRun(storyId, data as never),
    createStoryRun: queries.createStoryRun,
    getStoryRunById: queries.getStoryRunById,
    getLatestStoryRunForChat: queries.getLatestStoryRunForChat,
    getStoryProfileById: queries.getStoryProfileById as never,
    getStoryIntakeSession: (chatId) => {
      const session = getStoryIntakeSession(chatId);
      if (!session) return null;
      return {
        clips: session.clips,
        totalSizeMb: session.totalSizeMb,
        totalDurationSec: session.totalDurationSec,
        pendingMusicOverride: session.pendingMusicOverride ?? undefined,
      } as never;
    },
    consumeStoryMusicOverride,
    clearStoryIntakeSession,
    copyClipsToWorkDir: (_chatId, workDir) => {
      const session = getStoryIntakeSession(_chatId);
      return session ? copyStoryIntakeClipsToWorkDir(session.clips, workDir) : [];
    },
    setStoryIntakeSession,
    probeClipMetadata: probeStoryClipMetadata,
    copyLocalClipToIntake: copyStoryLocalClipToIntake,
    computeStoryIntakeExpiry: () => new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    removeIntakeFiles: removeStoryIntakeFiles,
  });
}
