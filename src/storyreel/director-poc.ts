import fs from "fs";
import path from "path";
import { GoogleGenAI, createPartFromText, createPartFromUri, type File } from "@google/genai";

export type StoryReelLanguage = "thai" | "english" | "german";

export interface StoryReelCliArgs {
  clips: string[];
  product: string;
  note: string;
  language: StoryReelLanguage;
  outputBaseDir: string;
}

export interface BuildDirectorPromptInput {
  clipCount: number;
  product: string;
  note: string;
  language: StoryReelLanguage;
  profile?: { audienceLanguage: string; audienceDescription: string };
  clipsMetadata?: Array<{ path: string; sizeMb: number; durationSec: number; orientation: string; width: number; height: number }>;
}

export interface StoryReelMusicDirection {
  genre: "upbeat" | "calm" | "neutral" | "playful" | "dramatic" | "inspirational";
  energy: "low" | "medium" | "high";
  tempo: "slow" | "medium" | "fast";
  suggested_search_terms: string[];
  volume: number;
  reason: string;
}

export interface StoryReelVoiceDirection {
  tone: "friendly" | "enthusiastic" | "calm" | "authoritative" | "conversational" | "excited";
  pace: "slow" | "medium" | "fast";
  style: "informative" | "storytelling" | "tutorial" | "review";
  language_code: string;
  reason: string;
}

export interface StoryReelDirectorDirection {
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
  voiceover_script: {
    full_text: string;
    segments?: Array<{
      order: number;
      text: string;
      duration_sec: number;
    }>;
  };
  music_direction: StoryReelMusicDirection;
  voice_direction: StoryReelVoiceDirection;
  hook_text_overlay: string;
  caption_lines: string[];
  cta_text: string;
  facebook_caption: string;
  hashtags: string[];
  total_duration_sec: number;
  director_notes: string;
  inferred_voice_style: "informative" | "storytelling" | "tutorial" | "review" | "conversational" | "lifestyle";
  inferred_content_type: "lifestyle" | "tutorial" | "review" | "travel" | "food" | "story" | "opinion" | "other";
}

export interface StoryReelGeminiClient {
  uploadFile(filePath: string, mimeType: string): Promise<{ uri: string; mimeType: string; name?: string }>;
  generateDirection(parts: Array<{ uri: string; mimeType: string }>, prompt: string): Promise<{ text: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }>;
}

type GeminiFileState = "STATE_UNSPECIFIED" | "PROCESSING" | "ACTIVE" | "FAILED";

interface GeminiFileLike {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: GeminiFileState | string;
  error?: { message?: string };
}

export interface WaitForActiveFileOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_OUTPUT_BASE_DIR = "work/storyreel-poc";
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv"]);
const MUSIC_GENRES = ["upbeat", "calm", "neutral", "playful", "dramatic", "inspirational"] as const;
const MUSIC_ENERGIES = ["low", "medium", "high"] as const;
const MUSIC_TEMPOS = ["slow", "medium", "fast"] as const;
const VOICE_TONES = ["friendly", "enthusiastic", "calm", "authoritative", "conversational", "excited"] as const;
const VOICE_PACES = ["slow", "medium", "fast"] as const;
const VOICE_STYLES = ["informative", "storytelling", "tutorial", "review", "conversational", "lifestyle"] as const;
const INFERRED_VOICE_STYLES = ["informative", "storytelling", "tutorial", "review", "conversational", "lifestyle"] as const;
const INFERRED_CONTENT_TYPES = ["lifestyle", "tutorial", "review", "travel", "food", "story", "opinion", "other"] as const;

function usage(): string {
  return `Usage: tsx scripts/storyreel-director-poc.ts --clips <clip...> [--product <name>] [--note <text>] [--language thai|english|german] [--output-dir <dir>]`;
}

export function parseArgs(argv: string[]): StoryReelCliArgs {
  const clips: string[] = [];
  let product = "Testing story";
  let note = "";
  let language: StoryReelLanguage = "thai";
  let outputBaseDir = DEFAULT_OUTPUT_BASE_DIR;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clips") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        clips.push(argv[++i]);
      }
    } else if (arg === "--product") {
      product = argv[++i] ?? "";
    } else if (arg === "--note") {
      note = argv[++i] ?? "";
    } else if (arg === "--language") {
      const value = argv[++i];
      if (value !== "thai" && value !== "english" && value !== "german") throw new Error(`${usage()}\nInvalid --language: ${value}`);
      language = value;
    } else if (arg === "--output-dir") {
      outputBaseDir = argv[++i] ?? "";
    } else {
      throw new Error(`${usage()}\nUnknown argument: ${arg}`);
    }
  }

  if (clips.length === 0) throw new Error(`${usage()}\nMissing --clips`);
  if (!product.trim()) throw new Error(`${usage()}\n--product cannot be empty`);
  if (!outputBaseDir.trim()) throw new Error(`${usage()}\n--output-dir cannot be empty`);

  return { clips, product, note, language, outputBaseDir };
}

export function buildDirectorPrompt(input: BuildDirectorPromptInput): string {
  const langLabelByLanguage: Record<StoryReelLanguage, string> = {
    thai: "Thai",
    english: "English",
    german: "German",
  };
  const ctaExampleByLanguage: Record<StoryReelLanguage, string> = {
    thai: "ติดตามสำหรับเทคนิคดีๆ แบบนี้",
    english: "Follow for more practical tips like this",
    german: "Folge für mehr persönliche Momente wie diesen",
  };
  const voiceLanguageCodeByLanguage: Record<StoryReelLanguage, string> = {
    thai: "th",
    english: "en",
    german: "de",
  };
  const langLabel = langLabelByLanguage[input.language];
  const ctaExample = ctaExampleByLanguage[input.language];
  const voiceLanguageCode = voiceLanguageCodeByLanguage[input.language];
  const noteSection = input.note.trim()
    ? `\nCREATOR'S NOTE: ${input.note.trim()}\n`
    : "";

  const profileSection = input.profile?.audienceDescription?.trim()
    ? `\nAudience description: ${input.profile.audienceDescription}\n`
    : "";

  const clipsMetadataSection = input.clipsMetadata
    ? "\n" + input.clipsMetadata.map((clip, i) => `Clip ${i + 1}: ${clip.orientation} ${clip.width}x${clip.height}, ${clip.durationSec}s, ${clip.sizeMb}MB`).join("\n") + "\n"
    : "";

  return `You are an expert social media video director for vertical Facebook Reels, Instagram Reels, and TikTok.

TARGET AUDIENCE: Thai people aged 25-45 who enjoy honest product, travel, or experience stories from Europe.
${profileSection}FORMAT: 9:16 portrait short video.
LANGUAGE: ${langLabel} voiceover, captions, hook, CTA, and Facebook caption.
CONTENT: ${input.clipCount} raw clip(s) of: ${input.product}
${clipsMetadataSection}${noteSection}
YOUR JOB:
- Watch every clip fully.
- Select only the strongest visual moments.
- Put the best hook first, even if it was filmed later.
- Create a coherent story arc from the selected moments.
- Write natural ${langLabel}, not translationese.
- Keep overlay text short enough for a phone screen.

Return ONLY valid JSON with this exact shape and no markdown fences:
{
  "hook_clip": { "clip_index": 0, "start_sec": 0, "end_sec": 3, "reason": "why this works as the hook" },
  "clips": [
    { "clip_index": 0, "start_sec": 0, "end_sec": 3, "order": 0, "role": "hook" },
    { "clip_index": 0, "start_sec": 3, "end_sec": 8, "order": 1, "role": "setup|demo|detail|verdict" }
  ],
  "voiceover_script": {
    "full_text": "complete spoken script",
    "segments": [
      { "order": 0, "text": "script for this selected clip", "duration_sec": 3 },
      { "order": 1, "text": "script for this selected clip", "duration_sec": 5 }
    ]
  },
  "music_direction": {
    "genre": "upbeat|calm|neutral|playful|dramatic|inspirational",
    "energy": "low|medium|high",
    "tempo": "slow|medium|fast",
    "suggested_search_terms": ["music search phrase 1", "music search phrase 2"],
    "volume": 0.35,
    "reason": "why this music supports the story"
  },
  "voice_direction": {
    "tone": "friendly|enthusiastic|calm|authoritative|conversational|excited",
    "pace": "slow|medium|fast",
    "style": "informative|storytelling|tutorial|review|conversational|lifestyle",
    "language_code": "${voiceLanguageCode}",
    "reason": "why this voice direction fits the content"
  },
  "hook_text_overlay": "short hook text, max 8 words",
  "caption_lines": ["short caption 1", "short caption 2", "short caption 3", "short caption 4"],
  "cta_text": "${ctaExample}",
  "facebook_caption": "2-3 sentence post caption",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "total_duration_sec": 45,
  "director_notes": "brief explanation of creative choices",
  "inferred_voice_style": "informative|storytelling|tutorial|review|conversational|lifestyle",
  "inferred_content_type": "lifestyle|tutorial|review|travel|food|story|opinion|other"
}

RULES:
- Use zero-based clip_index values matching the uploaded clip order.
- start_sec and end_sec must be seconds within the source clip.
- end_sec must be greater than start_sec.
- Prefer 3-10 second selections per clip.
- You may skip weak clips.
- IMPORTANT: Include hook_clip as order=0 in clips array too
- CTA must match content context
- voiceover_script.segments[].order must match clips[].order
- Use the CTA style: ${ctaExample}
- Source clip audio will be removed in Phase 1. Do not plan segments around dialogue, reactions, ambient sound, or any source audio being heard.
- If a user note is provided, it takes priority over all profile preferences for this video only. Treat the profile as permanent context and the user note as a per-video override.`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripMarkdownJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function parseDirectorJson(raw: string): StoryReelDirectorDirection {
  const cleaned = stripMarkdownJson(raw);
  try {
    return JSON.parse(cleaned) as StoryReelDirectorDirection;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Gemini director JSON: ${message}\n${raw.slice(0, 500)}`);
  }
}

function hasNumber(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "number" && Number.isFinite(obj[key]);
}

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string" && obj[key].trim().length > 0;
}

function hasStringArray(obj: Record<string, unknown>, key: string): boolean {
  return Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0 && (obj[key] as unknown[]).every((item) => typeof item === "string" && item.trim().length > 0);
}

function hasAllowedString(obj: Record<string, unknown>, key: string, allowed: readonly string[]): boolean {
  return typeof obj[key] === "string" && allowed.includes(obj[key]);
}

function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function validateDirection(direction: StoryReelDirectorDirection, clipCount: number): string[] {
  const errors: string[] = [];
  const root = direction as unknown;
  if (!isObject(root)) return ["direction must be an object"];

  if (!isObject(root.hook_clip)) {
    errors.push("hook_clip must be an object");
  } else {
    const hook = root.hook_clip;
    if (!hasNumber(hook, "clip_index")) errors.push("hook_clip.clip_index must be numeric");
    if (!hasNumber(hook, "start_sec")) errors.push("hook_clip.start_sec must be numeric");
    if (!hasNumber(hook, "end_sec")) errors.push("hook_clip.end_sec must be numeric");
    if (!hasString(hook, "reason")) errors.push("hook_clip.reason must be non-empty");
    const clipIndex = getNumber(hook, "clip_index");
    const startSec = getNumber(hook, "start_sec");
    const endSec = getNumber(hook, "end_sec");
    if (clipIndex !== undefined && (clipIndex < 0 || clipIndex >= clipCount)) {
      errors.push(`hook_clip.clip_index ${clipIndex} is outside uploaded clip range 0-${clipCount - 1}`);
    }
    if (startSec !== undefined && endSec !== undefined && endSec <= startSec) {
      errors.push("hook_clip.end_sec must be greater than start_sec");
    }
  }

  if (!Array.isArray(root.clips) || root.clips.length === 0) {
    errors.push("clips must be a non-empty array");
  } else {
    root.clips.forEach((clip, index) => {
      if (!isObject(clip)) {
        errors.push(`clips[${index}] must be an object`);
        return;
      }
      if (!hasNumber(clip, "clip_index")) errors.push(`clips[${index}].clip_index must be numeric`);
      if (!hasNumber(clip, "start_sec")) errors.push(`clips[${index}].start_sec must be numeric`);
      if (!hasNumber(clip, "end_sec")) errors.push(`clips[${index}].end_sec must be numeric`);
      if (!hasNumber(clip, "order")) errors.push(`clips[${index}].order must be numeric`);
      if (!hasString(clip, "role")) errors.push(`clips[${index}].role must be non-empty`);
      const clipIndex = getNumber(clip, "clip_index");
      const startSec = getNumber(clip, "start_sec");
      const endSec = getNumber(clip, "end_sec");
      if (clipIndex !== undefined && (clipIndex < 0 || clipIndex >= clipCount)) {
        errors.push(`clips[${index}].clip_index ${clipIndex} is outside uploaded clip range 0-${clipCount - 1}`);
      }
      if (startSec !== undefined && endSec !== undefined && endSec <= startSec) {
        errors.push(`clips[${index}].end_sec must be greater than start_sec`);
      }
    });
  }

  if (!isObject(root.voiceover_script) || !hasString(root.voiceover_script, "full_text")) {
    errors.push("voiceover_script.full_text must be non-empty");
  }
  if (!isObject(root.music_direction)) {
    errors.push("music_direction must be an object");
  } else {
    const musicDirection = root.music_direction;
    if (!hasString(musicDirection, "genre")) errors.push("music_direction.genre must be non-empty");
    else if (!hasAllowedString(musicDirection, "genre", MUSIC_GENRES)) errors.push(`music_direction.genre must be one of: ${MUSIC_GENRES.join(", ")}`);
    if (!hasString(musicDirection, "energy")) errors.push("music_direction.energy must be non-empty");
    else if (!hasAllowedString(musicDirection, "energy", MUSIC_ENERGIES)) errors.push(`music_direction.energy must be one of: ${MUSIC_ENERGIES.join(", ")}`);
    if (!hasString(musicDirection, "tempo")) errors.push("music_direction.tempo must be non-empty");
    else if (!hasAllowedString(musicDirection, "tempo", MUSIC_TEMPOS)) errors.push(`music_direction.tempo must be one of: ${MUSIC_TEMPOS.join(", ")}`);
    if (!hasStringArray(musicDirection, "suggested_search_terms")) errors.push("music_direction.suggested_search_terms must be an array of strings");
    if (!hasNumber(musicDirection, "volume")) errors.push("music_direction.volume must be numeric");
    if (!hasString(musicDirection, "reason")) errors.push("music_direction.reason must be non-empty");
  }
  if (!isObject(root.voice_direction)) {
    errors.push("voice_direction must be an object");
  } else {
    const voiceDirection = root.voice_direction;
    if (!hasString(voiceDirection, "tone")) errors.push("voice_direction.tone must be non-empty");
    else if (!hasAllowedString(voiceDirection, "tone", VOICE_TONES)) errors.push(`voice_direction.tone must be one of: ${VOICE_TONES.join(", ")}`);
    if (!hasString(voiceDirection, "pace")) errors.push("voice_direction.pace must be non-empty");
    else if (!hasAllowedString(voiceDirection, "pace", VOICE_PACES)) errors.push(`voice_direction.pace must be one of: ${VOICE_PACES.join(", ")}`);
    if (!hasString(voiceDirection, "style")) errors.push("voice_direction.style must be non-empty");
    else if (!hasAllowedString(voiceDirection, "style", VOICE_STYLES)) errors.push(`voice_direction.style must be one of: ${VOICE_STYLES.join(", ")}`);
    if (!hasString(voiceDirection, "language_code")) errors.push("voice_direction.language_code must be non-empty");
    if (!hasString(voiceDirection, "reason")) errors.push("voice_direction.reason must be non-empty");
  }
  if (!hasString(root, "hook_text_overlay")) errors.push("hook_text_overlay must be non-empty");
  if (!Array.isArray(root.caption_lines)) errors.push("caption_lines must be an array");
  if (!hasString(root, "cta_text")) errors.push("cta_text must be non-empty");
  if (!hasString(root, "facebook_caption")) errors.push("facebook_caption must be non-empty");
  if (!Array.isArray(root.hashtags)) errors.push("hashtags must be an array");
  if (!hasNumber(root, "total_duration_sec")) errors.push("total_duration_sec must be numeric");
  if (!hasString(root, "director_notes")) errors.push("director_notes must be non-empty");
  if (!hasAllowedString(root, "inferred_voice_style", INFERRED_VOICE_STYLES)) errors.push("inferred_voice_style must be one of informative, storytelling, tutorial, review, conversational, lifestyle");
  if (!hasAllowedString(root, "inferred_content_type", INFERRED_CONTENT_TYPES)) errors.push("inferred_content_type must be one of lifestyle, tutorial, review, travel, food, story, opinion, other");

  return errors;
}

function formatRange(start: number, end: number): string {
  return `${start.toFixed(2)}s-${end.toFixed(2)}s`;
}

export function buildSummary(direction: StoryReelDirectorDirection, clipPaths: string[]): string {
  const ordered = [...direction.clips].sort((a, b) => a.order - b.order);
  const lines = [
    "StoryReel Director POC Summary",
    "================================",
    "",
    `Hook: clip ${direction.hook_clip.clip_index + 1} ${formatRange(direction.hook_clip.start_sec, direction.hook_clip.end_sec)}`,
    `Reason: ${direction.hook_clip.reason}`,
    `Hook Overlay: ${direction.hook_text_overlay}`,
    "",
    "Selected Clips:",
    ...ordered.map((clip) => `${clip.order}. clip ${clip.clip_index + 1} ${formatRange(clip.start_sec, clip.end_sec)} [${clip.role}] ${path.basename(clipPaths[clip.clip_index] ?? "unknown")}`),
    "",
    "Voiceover Script:",
    direction.voiceover_script.full_text,
    "",
    `Music Direction: ${direction.music_direction.genre}, ${direction.music_direction.energy} energy, ${direction.music_direction.tempo} tempo`,
    `Music Search Terms: ${direction.music_direction.suggested_search_terms.join(", ")}`,
    `Voice Direction: ${direction.voice_direction.tone}, ${direction.voice_direction.pace} pace, ${direction.voice_direction.style}`,
    "",
    "Caption Lines:",
    ...direction.caption_lines.map((line, index) => `${index + 1}. ${line}`),
    "",
    `CTA: ${direction.cta_text}`,
    "",
    "Facebook Caption:",
    direction.facebook_caption,
    "",
    `Hashtags: ${direction.hashtags.join(" ")}`,
    `Total Duration: ${direction.total_duration_sec}s`,
    "",
    "Director Notes:",
    direction.director_notes,
    "",
  ];
  return lines.join("\n");
}

export function createRunId(now = new Date()): string {
  const stamp = now.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `storyreel-${stamp}`;
}

export function mimeTypeForClip(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

export function validateClipPaths(clipPaths: string[]): string[] {
  return clipPaths.map((clipPath) => {
    const resolved = path.resolve(clipPath);
    const ext = path.extname(resolved).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported clip extension for ${clipPath}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
    }
    if (!fs.existsSync(resolved)) throw new Error(`Clip not found: ${clipPath}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Clip path is not a file: ${clipPath}`);
    return resolved;
  });
}

export interface WriteArtifactsInput {
  outputBaseDir: string;
  runId: string;
  prompt: string;
  direction: StoryReelDirectorDirection;
  summary: string;
}

export function writeArtifacts(input: WriteArtifactsInput): { runDir: string } {
  const runDir = path.join(input.outputBaseDir, input.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "prompt.txt"), input.prompt);
  fs.writeFileSync(path.join(runDir, "direction.json"), `${JSON.stringify(input.direction, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "summary.txt"), input.summary);
  return { runDir };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForActiveFile<T extends GeminiFileLike>(
  file: T,
  getFile: (name: string) => Promise<T>,
  options: WaitForActiveFileOptions = {},
): Promise<T> {
  if (!file.name || file.state === "ACTIVE") return file;

  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  let current = file;

  while (Date.now() <= deadline) {
    if (current.state === "ACTIVE") return current;
    if (current.state === "FAILED") {
      const message = current.error?.message ?? "unknown error";
      throw new Error(`Gemini file processing failed for ${file.name}: ${message}`);
    }
    await sleep(intervalMs);
    current = await getFile(file.name);
  }

  throw new Error(`Timed out waiting for Gemini file to become ACTIVE: ${file.name}`);
}

export class GoogleStoryReelGeminiClient implements StoryReelGeminiClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.STORYREEL_GEMINI_MODEL ?? "gemini-2.5-flash") {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async uploadFile(filePath: string, mimeType: string): Promise<{ uri: string; mimeType: string; name?: string }> {
    const uploaded: File = await this.ai.files.upload({
      file: filePath,
      config: { mimeType, displayName: path.basename(filePath) },
    });
    const active = await waitForActiveFile(uploaded, (name) => this.ai.files.get({ name }));
    const uri = active.uri;
    if (!uri) throw new Error(`Gemini upload did not return a URI for ${filePath}`);
    return { uri, mimeType: active.mimeType ?? mimeType, name: active.name };
  }

  async generateDirection(parts: Array<{ uri: string; mimeType: string }>, prompt: string): Promise<{ text: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{
        role: "user",
        parts: [
          ...parts.map((part) => createPartFromUri(part.uri, part.mimeType)),
          createPartFromText(prompt),
        ],
      }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });
    const text = response.text?.trim();
    if (!text) throw new Error("Gemini returned an empty director response");
    return {
      text,
      usageMetadata: response.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined,
    };
  }
}

export interface RunStoryReelDirectorPocOptions {
  client?: StoryReelGeminiClient;
  now?: Date;
}

export async function runStoryReelDirectorPoc(argv: string[], options: RunStoryReelDirectorPocOptions = {}): Promise<{ runDir: string; direction: StoryReelDirectorDirection; summary: string }> {
  const args = parseArgs(argv);
  const clipPaths = validateClipPaths(args.clips);
  const prompt = buildDirectorPrompt({
    clipCount: clipPaths.length,
    product: args.product,
    note: args.note,
    language: args.language,
  });

  const client = options.client ?? new GoogleStoryReelGeminiClient();
  const uploadedParts = [];
  for (const clipPath of clipPaths) {
    uploadedParts.push(await client.uploadFile(clipPath, mimeTypeForClip(clipPath)));
  }

  const genResult = await client.generateDirection(uploadedParts, prompt);
  const raw = genResult.text;
  const runId = createRunId(options.now ?? new Date());
  const runDir = path.join(args.outputBaseDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "raw-direction.json"), raw);

  const direction = parseDirectorJson(raw);
  const errors = validateDirection(direction, clipPaths.length);
  if (errors.length > 0) {
    throw new Error(`Gemini director response failed validation (see ${path.join(runDir, "raw-direction.json")}):\n${errors.map((err) => `- ${err}`).join("\n")}`);
  }

  const summary = buildSummary(direction, clipPaths);
  const { runDir: finalRunDir } = writeArtifacts({
    outputBaseDir: args.outputBaseDir,
    runId,
    prompt,
    direction,
    summary,
  });

  return { runDir: finalRunDir, direction, summary };
}
