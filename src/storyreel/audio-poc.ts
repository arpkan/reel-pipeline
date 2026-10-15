import fs from "fs";
import path from "path";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import type { WordTiming } from "../types.js";
import type { StoryReelMusicDirection, StoryReelVoiceDirection } from "./director-poc.js";

export interface SharedVoiceSearchQuery {
  search: string;
  gender?: "female" | "male";
}

export interface SharedVoiceSearchResult {
  voice_id: string;
  name: string;
  description?: string;
  preview_url?: string;
  cloned_by_count?: number;
  verified_languages?: Array<Record<string, unknown>>;
}

export interface SelectedSharedVoice {
  voiceId: string;
  name: string;
  searchQuery: string;
  verifiedLanguages: Array<Record<string, unknown>>;
  previewUrl?: string;
  reason: string;
}

export interface WriteVoiceArtifactsInput {
  outputDir: string;
  voiceoverAudio: Buffer;
  wordTimings: WordTiming[];
  selectedVoice: SelectedSharedVoice;
}

const TONE_SEARCH_TERMS: Record<StoryReelVoiceDirection["tone"], string> = {
  friendly: "friendly warm natural",
  enthusiastic: "energetic upbeat social media",
  calm: "calm clear soothing",
  authoritative: "professional authoritative clear",
  conversational: "natural conversational friendly",
  excited: "excited energetic upbeat",
};

export function buildSharedVoiceSearchQuery(direction: StoryReelVoiceDirection): SharedVoiceSearchQuery {
  const base = TONE_SEARCH_TERMS[direction.tone] ?? "friendly warm natural";
  // ElevenLabs shared-voice search only matches on single keywords — use the first term
  const keyword = base.split(" ")[0];
  return {
    search: keyword,
    gender: "female",
  };
}

export function writeVoiceArtifacts(input: WriteVoiceArtifactsInput): void {
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, "voiceover.mp3"), input.voiceoverAudio);
  fs.writeFileSync(path.join(input.outputDir, "word-timings.json"), `${JSON.stringify(input.wordTimings, null, 2)}\n`);
  fs.writeFileSync(path.join(input.outputDir, "voice-selection.json"), `${JSON.stringify(input.selectedVoice, null, 2)}\n`);
}

export interface FfmpegAudioResult {
  status: number | null;
  stderr?: Buffer;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

export type FfmpegAudioExecutor = (args: string[]) => FfmpegAudioResult;

export const defaultFfmpegAudioExecutor: FfmpegAudioExecutor = (args) => spawnSync("ffmpeg", args);

export interface BuildAudioMixArgsInput {
  voicePath: string;
  musicPath: string;
  outputPath: string;
  durationSec: number;
  musicVolume: number;
}

export interface BuildAudioMuxArgsInput {
  videoPath: string;
  audioPath: string;
  outputPath: string;
}

function stderrSnippet(stderr: Buffer | undefined): string {
  return stderr?.toString("utf8").slice(0, 500) ?? "";
}

function ffmpegFailureMessage(context: string, result: FfmpegAudioResult): string {
  const parts = [`status=${result.status}`, `signal=${result.signal ?? null}`];
  if (result.error) parts.push(`error=${result.error.message}`);
  const stderr = stderrSnippet(result.stderr);
  if (stderr) parts.push(`stderr=${stderr}`);
  return `${context} failed: ${parts.join(" ")}`;
}

function runAudioFfmpeg(args: string[], outputPath: string, context: string, executor: FfmpegAudioExecutor): void {
  const result = executor(args);
  if (result.status !== 0) throw new Error(ffmpegFailureMessage(context, result));
  if (!fs.existsSync(outputPath)) throw new Error(`${context} succeeded but output file missing: ${outputPath}`);
}

export function buildAudioMixArgs(input: BuildAudioMixArgsInput): string[] {
  const fadeOutStart = Math.max(0, Math.round((input.durationSec - 2) * 1000) / 1000);
  const filter = [
    `[1:a]volume=${input.musicVolume},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2[music]`,
    `[0:a][music]amix=inputs=2:duration=longest:dropout_transition=0,loudnorm=I=-14:TP=-1:LRA=9[aout]`,
  ].join(";");
  return [
    "-y",
    "-i", input.voicePath,
    "-stream_loop", "-1",
    "-i", input.musicPath,
    "-t", String(input.durationSec),
    "-filter_complex", filter,
    "-map", "[aout]",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", "192k",
    input.outputPath,
  ];
}

export function buildAudioMuxArgs(input: BuildAudioMuxArgsInput): string[] {
  return [
    "-y",
    "-i", input.videoPath,
    "-i", input.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-shortest",
    input.outputPath,
  ];
}

export function mixVoiceAndMusic(input: BuildAudioMixArgsInput, executor: FfmpegAudioExecutor = defaultFfmpegAudioExecutor): void {
  runAudioFfmpeg(buildAudioMixArgs(input), input.outputPath, "FFmpeg audio mix", executor);
}

export function buildMusicOnlyArgs(input: { musicPath: string; outputPath: string; durationSec: number; musicVolume: number }): string[] {
  const fadeOutStart = Math.max(0, Math.round((input.durationSec - 2) * 1000) / 1000);
  const filter = `[0:a]volume=${input.musicVolume},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2,atrim=0:${input.durationSec},loudnorm=I=-14:TP=-1:LRA=9[aout]`;
  return [
    "-y",
    "-stream_loop", "-1",
    "-i", input.musicPath,
    "-t", String(input.durationSec),
    "-filter_complex", filter,
    "-map", "[aout]",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", "192k",
    input.outputPath,
  ];
}

export function mixMusicOnly(input: { musicPath: string; outputPath: string; durationSec: number; musicVolume: number }, executor: FfmpegAudioExecutor = defaultFfmpegAudioExecutor): void {
  runAudioFfmpeg(buildMusicOnlyArgs(input), input.outputPath, "FFmpeg music-only", executor);
}

export function muxVideoAndAudio(input: BuildAudioMuxArgsInput, executor: FfmpegAudioExecutor = defaultFfmpegAudioExecutor): void {
  runAudioFfmpeg(buildAudioMuxArgs(input), input.outputPath, "FFmpeg audio mux", executor);
}

export type SharedVoiceSearchFn = (query: SharedVoiceSearchQuery) => Promise<SharedVoiceSearchResult[]>;

export interface ElevenLabsTtsInput {
  text: string;
  voiceId: string;
  modelId: string;
}

export type VoiceoverWordTiming = WordTiming & { source?: "elevenlabs_alignment" | "estimated" };

export type ElevenLabsTtsFn = (input: ElevenLabsTtsInput) => Promise<{ audio: Buffer; wordTimings: VoiceoverWordTiming[] }>;

export async function searchElevenLabsSharedVoices(
  query: SharedVoiceSearchQuery,
  apiKey = process.env.ELEVENLABS_API_KEY,
): Promise<SharedVoiceSearchResult[]> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const params = new URLSearchParams({
    search: query.search,
    page_size: "10",
    sort: "trending",
  });
  if (query.gender) params.set("gender", query.gender);
  const response = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`ElevenLabs shared voice search failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as { voices?: SharedVoiceSearchResult[] };
  return body.voices ?? [];
}

export async function selectSharedVoice(
  direction: StoryReelVoiceDirection,
  search: SharedVoiceSearchFn = searchElevenLabsSharedVoices,
): Promise<SelectedSharedVoice> {
  const query = buildSharedVoiceSearchQuery(direction);
  const voices = await search(query);
  if (voices.length === 0) throw new Error(`No ElevenLabs shared voices found for search query: ${query.search}`);
  const selected = [...voices].sort((a, b) => (b.cloned_by_count ?? 0) - (a.cloned_by_count ?? 0))[0];
  return {
    voiceId: selected.voice_id,
    name: selected.name,
    searchQuery: query.search,
    verifiedLanguages: selected.verified_languages ?? [],
    previewUrl: selected.preview_url,
    reason: "highest cloned_by_count among matching shared voices",
  };
}

interface ElevenLabsTimestampResponse {
  audio_base64?: unknown;
  alignment?: {
    characters?: string[];
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  };
}

function extractSimpleWordTimings(alignment: ElevenLabsTimestampResponse["alignment"], text: string): VoiceoverWordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chars = alignment?.characters;
  const charStarts = alignment?.character_start_times_seconds;
  const charEnds = alignment?.character_end_times_seconds;
  const hasUsableAlignment = Array.isArray(chars)
    && Array.isArray(charStarts)
    && Array.isArray(charEnds)
    && chars.length > 0
    && chars.length === charStarts.length
    && chars.length === charEnds.length
    && charStarts.every((start) => typeof start === "number" && Number.isFinite(start))
    && charEnds.every((end) => typeof end === "number" && Number.isFinite(end))
    && charEnds.length > 0
    && charEnds[charEnds.length - 1] > 0;
  const source = hasUsableAlignment ? "elevenlabs_alignment" : "estimated";
  const totalEnd = hasUsableAlignment ? charEnds[charEnds.length - 1] : words.length * 0.4;
  const step = totalEnd / words.length;
  return words.map((word, index) => ({
    word,
    start: Math.round(index * step * 1000) / 1000,
    end: Math.round((index + 1) * step * 1000) / 1000,
    source,
  }));
}

export async function elevenLabsTtsWithTimestamps(
  input: ElevenLabsTtsInput,
  apiKey = process.env.ELEVENLABS_API_KEY,
  fetchFn: typeof fetch = fetch,
): Promise<{ audio: Buffer; wordTimings: VoiceoverWordTiming[] }> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const response = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}/with-timestamps`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.modelId,
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
  let body: ElevenLabsTimestampResponse;
  try {
    body = await response.json() as ElevenLabsTimestampResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ElevenLabs TTS JSON response: ${message}`);
  }
  if (typeof body.audio_base64 !== "string") throw new Error("ElevenLabs TTS response did not include audio_base64");
  const audio = Buffer.from(body.audio_base64, "base64");
  if (audio.length === 0) throw new Error("ElevenLabs TTS response contained empty audio");
  return {
    audio,
    wordTimings: extractSimpleWordTimings(body.alignment, input.text),
  };
}

export interface GenerateVoiceoverInput {
  text: string;
  voice: SelectedSharedVoice;
  tts?: ElevenLabsTtsFn;
  modelId?: string;
}

export async function generateVoiceover(input: GenerateVoiceoverInput): Promise<{ audio: Buffer; wordTimings: VoiceoverWordTiming[] }> {
  const tts = input.tts ?? elevenLabsTtsWithTimestamps;
  return tts({
    text: input.text,
    voiceId: input.voice.voiceId,
    modelId: input.modelId ?? "eleven_v3",
  });
}

export type { WordTiming, StoryReelMusicDirection, StoryReelVoiceDirection };
