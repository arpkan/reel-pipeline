# StoryReel Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote StoryReel into a production Telegram-driven personal video pipeline with channel profiles, clip intake, four resumable stages, GCS delivery, and Phase 1 validation data.

**Architecture:** Add StoryReel as a third pipeline family without changing post or reel contracts. Keep POC media primitives under `src/storyreel/`, add StoryReel-specific DB tables and queries, then orchestrate the four stages through a dedicated `StoryRunner` and Telegram intake handler gated by `STORYREEL_ENABLED`.

**Tech Stack:** Node 22, TypeScript ESM, Drizzle ORM, better-sqlite3, Vitest, Telegram Bot API, Google Gemini via `@google/genai`, ElevenLabs/Botnoi voice providers, FFmpeg/ffprobe, Hyperframes, Google Cloud Storage.

---

## Scope Check

This is one vertical product slice. The DB, stages, runner, Telegram intake, CLI, and music library are coupled enough that a single plan is more useful than separate subsystem plans. The work is split into independently testable tasks so each commit leaves the codebase compiling or with a small, named failing test only while that task is in progress.

Important discovery: the StoryReel POC exists in `<repo>/.worktrees/storyreel-director-poc`. Task 2 promotes those files into the main worktree before production stages depend on them, then adds only the production deltas required by the spec.

## File Structure

- Create `src/storyreel/types.ts`: StoryReel production domain types shared by stages, runner, intake, DB helpers, and tests.
- Copy then adapt `src/storyreel/director-poc.ts` from `.worktrees/storyreel-director-poc/src/storyreel/director-poc.ts`: Gemini upload/generate wrapper, prompt builder, JSON parser, validation, raw artifact writer.
- Copy then adapt `src/storyreel/audio-poc.ts` from `.worktrees/storyreel-director-poc/src/storyreel/audio-poc.ts`: ElevenLabs shared-voice search, TTS, voice artifact writing, audio mixing, and muxing helpers.
- Copy then adapt `src/storyreel/rough-cut-poc.ts` from `.worktrees/storyreel-director-poc/src/storyreel/rough-cut-poc.ts`: rough-cut assembly plan, FFmpeg segment prep, Hyperframes HTML generation, Hyperframes rendering.
- Copy then adapt `src/storyreel/audio-rough-cut-poc.ts` from `.worktrees/storyreel-director-poc/src/storyreel/audio-rough-cut-poc.ts`: end-to-end POC wrapper for director output plus voice/music/rough-cut assembly.
- Create `src/storyreel/music.ts`: loads `music/storyreel/index.json`, validates genres, selects a random track by genre, returns attribution metadata.
- Create `src/storyreel/cost.ts`: computes Gemini cost from `usageMetadata` token counts.
- Create `src/stages/story-stage1-direction.ts`: production stage wrapper over director POC with retry, usage/cost persistence, and validation failure code.
- Create `src/stages/story-stage2-voice.ts`: production voice stage with profile preferred voice and DB voice pool lookup.
- Create `src/stages/story-stage3-assembly.ts`: production assembly stage with global lock, music selection/override, and final duration persistence.
- Create `src/stages/story-stage4-publish.ts`: thumbnail extraction, GCS upload, Telegram notification.
- Create `src/pipeline/story-runner.ts`: stage orchestration, status/currentStage updates, checkpoints, `run`, `resume`, `rebuild`, and `tweak` support.
- Create `src/pipeline/story-intake.ts`: pure helpers for setup wizard state, command parsing, clip metadata, limits, and user-facing messages.
- Create `src/pipeline/story-intake-session-store.ts`: thin DB-backed wrapper around `queries.ts` for StoryReel intake session public API (`getStoryIntakeSession`, `setStoryIntakeSession`, `clearStoryIntakeSession`, `consumeStoryMusicOverride`).
- Modify `src/db/schema.ts`: add `voices`, `profiles`, `story_intake_sessions`, `story_runs` tables.
- Modify `src/db/client.ts`: create new tables and `story_runs_validation` view through inline migrations.
- Modify `src/db/queries.ts`: add voices/profiles/story intake/story run query functions.
- Modify `src/types.ts`: add StoryReel config/types only where needed by existing app entrypoints.
- Modify `src/config.ts`: add `STORYREEL_ENABLED` boolean, `STORYREEL_BOT_TOKEN` getter, and conditional required env checks.
- Modify `src/services/telegram.ts`: parse video messages, download video files, send photo/thumbnail messages, add `createTelegramServiceWithToken()` for multi-bot support.
- Modify `src/pipeline/command-listener.ts`: route `!setup`, `!profile`, `!music`, `!story`, `!run`, `!cancel`, `!tweak`, `!story resume`, `!story rebuild`, and video uploads to StoryReel only when enabled. When `STORYREEL_BOT_TOKEN` is set, StoryReel polls via a dedicated `startStoryReelListener()` instead of the shared command listener.
- Modify `bin/run.ts`: add `--story` admin CLI path gated by `STORYREEL_ENABLED`.
- Modify `bin/server.ts`: register StoryReel Telegram handling only when `STORYREEL_ENABLED` is true; call `startStoryReelListener()` when `STORYREEL_BOT_TOKEN` is set.
- Create `scripts/story-runner.ts`: direct admin script for a StoryReel run from local clips.
- Create tests in `tests/storyreel-*.test.ts`: unit tests for every new module plus integration-style DB/runner tests with injected services.
- Create `music/storyreel/index.json` and `music/storyreel/<genre>/.gitkeep`: committed library structure; licensed MP3 files are added in the asset task once filenames and license URLs are final.

## Task 1: StoryReel Types And DB Schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/queries.ts`
- Create: `src/storyreel/types.ts`
- Create: `tests/storyreel-db.test.ts`

- [ ] **Step 1: Write failing DB tests**

Create `tests/storyreel-db.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "fs";

const TEST_DB_PATH = `/tmp/test-storyreel-db-${process.pid}-${Date.now()}.db`;
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
process.env.PIPELINE_DB_PATH = TEST_DB_PATH;

const q = await import("../src/db/queries.js");

describe("StoryReel DB", () => {
  beforeEach(() => {
    q.clearStoryIntakeSession("chat-1");
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it("creates and updates a channel profile by Telegram chat id", () => {
    const profile = q.upsertStoryProfile({
      telegramChatId: "chat-1",
      profileName: "Dog Walking",
      audienceLanguage: "german",
      audienceDescription: "German dog owners who want practical walking tips.",
    });

    expect(profile.telegramChatId).toBe("chat-1");
    expect(q.getStoryProfileByChatId("chat-1")?.audienceLanguage).toBe("german");

    q.updateStoryProfileVoice(profile.id, "eleven-1", "elevenlabs");
    expect(q.getStoryProfileByChatId("chat-1")?.preferredVoiceId).toBe("eleven-1");
  });

  it("persists StoryReel intake sessions with clips and one-shot music override", () => {
    q.upsertStoryIntakeSession({
      chatId: "chat-1",
      clips: [{ path: "/tmp/a.mp4", sizeMb: 12, durationSec: 30, orientation: "vertical", width: 1080, height: 1920 }],
      totalSizeMb: 12,
      totalDurationSec: 30,
      pendingMusicOverride: "calm",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const session = q.getStoryIntakeSession("chat-1");
    expect(session?.clips).toHaveLength(1);
    expect(session?.pendingMusicOverride).toBe("calm");
  });

  it("expires StoryReel intake sessions", () => {
    q.upsertStoryIntakeSession({
      chatId: "chat-1",
      clips: [{ path: "/tmp/old.mp4", sizeMb: 1, durationSec: 2, orientation: "vertical", width: 1080, height: 1920 }],
      totalSizeMb: 1,
      totalDurationSec: 2,
      pendingMusicOverride: null,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    expect(q.getStoryIntakeSession("chat-1")).toBeNull();
  });

  it("finds seeded voices by language and inferred voice style", () => {
    q.createStoryVoice({
      id: "voice-row-1",
      voiceId: "eleven-voice-1",
      name: "Warm Guide",
      provider: "elevenlabs",
      language: "english",
      styles: ["storytelling", "conversational"],
      description: "Warm natural voice",
    });

    expect(q.getStoryVoices("english", "storytelling")).toEqual([
      expect.objectContaining({ voiceId: "eleven-voice-1", provider: "elevenlabs" }),
    ]);
    expect(q.getStoryVoices("german", "storytelling")).toEqual([]);
  });

  it("creates story runs and updates checkpoints", () => {
    const profile = q.upsertStoryProfile({
      telegramChatId: "chat-1",
      profileName: "Travel Clips",
      audienceLanguage: "english",
      audienceDescription: "English speaking viewers who like honest travel clips.",
    });

    q.createStoryRun({
      id: "story-1",
      profileId: profile.id,
      telegramChatId: "chat-1",
      sourceClipsMetadata: [{ path: "/tmp/a.mp4", sizeMb: 10, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 }],
      clipCount: 1,
      totalClipsSizeMb: 10,
      totalSourceDurationSec: 20,
      userNote: "make it practical",
      workDir: "/tmp/story-1",
    });

    q.updateStoryRun("story-1", {
      currentStage: "story-stage1-direction",
      directionJson: { inferred_voice_style: "tutorial", inferred_content_type: "travel" },
      geminiInputTokens: 100,
      geminiOutputTokens: 40,
      geminiCostUsd: 0.00003,
    });

    const run = q.getStoryRunById("story-1");
    expect(run?.status).toBe("generating");
    expect(JSON.parse(run!.directionJson!).inferred_voice_style).toBe("tutorial");
  });
});
```

- [ ] **Step 2: Run the DB test to verify it fails**

Run: `npm test -- tests/storyreel-db.test.ts`

Expected: FAIL with missing StoryReel query exports.

- [ ] **Step 3: Add StoryReel shared types**

Create `src/storyreel/types.ts`:

```ts
export type StoryReelVoiceStyle = "informative" | "storytelling" | "tutorial" | "review" | "conversational" | "lifestyle";
export type StoryReelContentType = "lifestyle" | "tutorial" | "review" | "travel" | "food" | "story" | "opinion" | "other";
export type StoryReelAudienceLanguage = "thai" | "english" | "german";
export type StoryReelVoiceProvider = "elevenlabs" | "botnoi";
export type StoryReelMusicGenre = "upbeat" | "calm" | "neutral" | "playful" | "dramatic" | "inspirational";
export type StoryReelMusicEnergy = "low" | "medium" | "high";
export type StoryReelMusicTempo = "slow" | "medium" | "fast";
export type StoryReelClipOrientation = "vertical" | "horizontal" | "square" | "other";
export type StoryReelRunStatus = "pending" | "generating" | "delivered" | "failed" | "cancelled";

export interface StoryReelClipMetadata {
  path: string;
  sizeMb: number;
  durationSec: number;
  orientation: StoryReelClipOrientation;
  width: number;
  height: number;
}

export interface StoryReelDirectorDirection {
  inferred_voice_style: StoryReelVoiceStyle;
  inferred_content_type: StoryReelContentType;
  hook_clip: { clip_index: number; start_sec: number; end_sec: number; reason: string };
  clips: Array<{ clip_index: number; start_sec: number; end_sec: number; order: number; role: string }>;
  voiceover_script: { full_text: string; segments?: Array<{ order: number; text: string; duration_sec: number }> };
  voice_direction: { tone: string; pace: string; style?: StoryReelVoiceStyle };
  music_direction: { genre: StoryReelMusicGenre; energy: StoryReelMusicEnergy; tempo: StoryReelMusicTempo; reason: string };
  hook_text_overlay: string;
  caption_lines: string[];
  cta_text: string;
  facebook_caption: string;
  hashtags: string[];
  total_duration_sec: number;
  director_notes: string;
}

export interface StoryStageLog {
  stage: string;
  status: "ok" | "error" | "skipped";
  durationMs: number;
  error?: string;
  meta?: Record<string, unknown>;
}
```

- [ ] **Step 4: Add Drizzle tables**

Modify `src/db/schema.ts` by importing no new Drizzle helpers and adding these tables after `reelIntakeSessions`:

```ts
export const voices = sqliteTable("voices", {
  id: text("id").primaryKey(),
  voiceId: text("voice_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  language: text("language").notNull(),
  styles: text("styles").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  telegramChatId: text("telegram_chat_id").notNull(),
  profileName: text("profile_name").notNull(),
  audienceLanguage: text("audience_language").notNull(),
  audienceDescription: text("audience_description").notNull(),
  preferredVoiceId: text("preferred_voice_id"),
  preferredVoiceProvider: text("preferred_voice_provider"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  telegramChatIdIdx: uniqueIndex("profiles_telegram_chat_id_uniq").on(t.telegramChatId),
}));

export const storyIntakeSessions = sqliteTable("story_intake_sessions", {
  chatId: text("chat_id").primaryKey(),
  clips: text("clips").notNull(),
  totalSizeMb: real("total_size_mb").notNull(),
  totalDurationSec: real("total_duration_sec").notNull(),
  pendingMusicOverride: text("pending_music_override"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storyRuns = sqliteTable("story_runs", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id),
  telegramChatId: text("telegram_chat_id").notNull(),
  sourceClipsMetadata: text("source_clips_metadata").notNull(),
  clipCount: integer("clip_count").notNull(),
  totalClipsSizeMb: real("total_clips_size_mb").notNull(),
  totalSourceDurationSec: real("total_source_duration_sec").notNull(),
  userNote: text("user_note"),
  musicPath: text("music_path"),
  musicTitle: text("music_title"),
  musicArtist: text("music_artist"),
  musicGenreUsed: text("music_genre_used"),
  voiceIdUsed: text("voice_id_used"),
  voiceProviderUsed: text("voice_provider_used"),
  durationUsedSec: real("duration_used_sec"),
  directionJson: text("direction_json"),
  workDir: text("work_dir"),
  voiceoverPath: text("voiceover_path"),
  geminiInputTokens: integer("gemini_input_tokens"),
  geminiOutputTokens: integer("gemini_output_tokens"),
  geminiCostUsd: real("gemini_cost_usd"),
  videoGcsUrl: text("video_gcs_url"),
  reviewUrl: text("review_url"),
  status: text("status").notNull().default("pending"),
  currentStage: text("current_stage"),
  stageLogs: text("stage_logs"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 5: Add inline SQLite migrations and validation view**

Modify `src/db/client.ts` after the reel intake table creation:

```ts
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    language TEXT NOT NULL,
    styles TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    telegram_chat_id TEXT NOT NULL UNIQUE,
    profile_name TEXT NOT NULL,
    audience_language TEXT NOT NULL,
    audience_description TEXT NOT NULL,
    preferred_voice_id TEXT,
    preferred_voice_provider TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS story_intake_sessions (
    chat_id TEXT PRIMARY KEY,
    clips TEXT NOT NULL,
    total_size_mb REAL NOT NULL,
    total_duration_sec REAL NOT NULL,
    pending_music_override TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS story_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT REFERENCES profiles(id),
    telegram_chat_id TEXT NOT NULL,
    source_clips_metadata TEXT NOT NULL,
    clip_count INTEGER NOT NULL,
    total_clips_size_mb REAL NOT NULL,
    total_source_duration_sec REAL NOT NULL,
    user_note TEXT,
    music_path TEXT,
    music_title TEXT,
    music_artist TEXT,
    music_genre_used TEXT,
    voice_id_used TEXT,
    voice_provider_used TEXT,
    duration_used_sec REAL,
    direction_json TEXT,
    work_dir TEXT,
    voiceover_path TEXT,
    gemini_input_tokens INTEGER,
    gemini_output_tokens INTEGER,
    gemini_cost_usd REAL,
    video_gcs_url TEXT,
    review_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    current_stage TEXT,
    stage_logs TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE VIEW IF NOT EXISTS story_runs_validation AS
  SELECT
    r.id,
    r.telegram_chat_id AS telegramChatId,
    p.audience_language AS language,
    r.user_note AS userNote,
    r.clip_count AS clipCount,
    r.total_source_duration_sec AS totalSourceDurationSec,
    json_extract(r.direction_json, '$.inferred_content_type') AS gemini_inferred_content_type,
    json_extract(r.direction_json, '$.inferred_voice_style') AS gemini_inferred_voice_style,
    r.voice_id_used AS voiceIdUsed,
    r.voice_provider_used AS voiceProviderUsed,
    r.music_genre_used AS musicGenreUsed,
    r.duration_used_sec AS durationUsedSec,
    r.gemini_cost_usd AS geminiCostUsd,
    r.status,
    r.error,
    r.created_at AS createdAt
  FROM story_runs r
  LEFT JOIN profiles p ON p.id = r.profile_id;
`);
```

- [ ] **Step 6: Add query functions**

Modify `src/db/queries.ts` imports to include `voices`, `profiles`, `storyIntakeSessions`, `storyRuns` and add these functions near the reel intake section:

```ts
import { randomUUID } from "crypto";
import type { StoryReelAudienceLanguage, StoryReelClipMetadata, StoryReelDirectorDirection, StoryReelMusicGenre, StoryReelVoiceProvider, StoryReelVoiceStyle, StoryStageLog } from "../storyreel/types.js";

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

function isExpired(timestamp: string): boolean {
  return Date.parse(timestamp) <= Date.now();
}

export function createStoryVoice(params: {
  id: string;
  voiceId: string;
  name: string;
  provider: StoryReelVoiceProvider;
  language: StoryReelAudienceLanguage;
  styles: StoryReelVoiceStyle[];
  description?: string;
}): void {
  db.insert(voices).values({
    id: params.id,
    voiceId: params.voiceId,
    name: params.name,
    provider: params.provider,
    language: params.language,
    styles: JSON.stringify(params.styles),
    description: params.description,
    createdAt: now(),
  }).run();
}

export function upsertStoryProfile(params: {
  telegramChatId: string;
  profileName: string;
  audienceLanguage: StoryReelAudienceLanguage;
  audienceDescription: string;
}) {
  const existing = getStoryProfileByChatId(params.telegramChatId);
  const ts = now();
  const id = existing?.id ?? randomUUID();
  db.insert(profiles).values({
    id,
    telegramChatId: params.telegramChatId,
    profileName: params.profileName,
    audienceLanguage: params.audienceLanguage,
    audienceDescription: params.audienceDescription,
    preferredVoiceId: existing?.preferredVoiceId ?? null,
    preferredVoiceProvider: existing?.preferredVoiceProvider ?? null,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  }).onConflictDoUpdate({
    target: profiles.telegramChatId,
    set: {
      profileName: params.profileName,
      audienceLanguage: params.audienceLanguage,
      audienceDescription: params.audienceDescription,
      updatedAt: ts,
    },
  }).run();
  return getStoryProfileByChatId(params.telegramChatId)!;
}

export function getStoryProfileByChatId(chatId: string) {
  return db.select().from(profiles).where(eq(profiles.telegramChatId, chatId)).get() ?? null;
}

export function getStoryProfileById(profileId: string) {
  return db.select().from(profiles).where(eq(profiles.id, profileId)).get() ?? null;
}

export function updateStoryProfileVoice(profileId: string, preferredVoiceId: string, preferredVoiceProvider: StoryReelVoiceProvider): void {
  db.update(profiles).set({ preferredVoiceId, preferredVoiceProvider, updatedAt: now() }).where(eq(profiles.id, profileId)).run();
}

export function getStoryVoices(language: StoryReelAudienceLanguage, style: StoryReelVoiceStyle, provider?: StoryReelVoiceProvider) {
  const rows = db.select().from(voices).where(provider ? and(eq(voices.language, language), eq(voices.provider, provider)) : eq(voices.language, language)).all();
  return rows.filter((row) => (JSON.parse(row.styles) as string[]).includes(style));
}

export function upsertStoryIntakeSession(params: {
  chatId: string;
  clips: StoryReelClipMetadata[];
  totalSizeMb: number;
  totalDurationSec: number;
  pendingMusicOverride?: StoryReelMusicGenre | null;
  expiresAt: string;
}): void {
  const ts = now();
  db.insert(storyIntakeSessions).values({
    chatId: params.chatId,
    clips: JSON.stringify(params.clips),
    totalSizeMb: params.totalSizeMb,
    totalDurationSec: params.totalDurationSec,
    pendingMusicOverride: params.pendingMusicOverride ?? null,
    expiresAt: params.expiresAt,
    createdAt: ts,
    updatedAt: ts,
  }).onConflictDoUpdate({
    target: storyIntakeSessions.chatId,
    set: {
      clips: JSON.stringify(params.clips),
      totalSizeMb: params.totalSizeMb,
      totalDurationSec: params.totalDurationSec,
      pendingMusicOverride: params.pendingMusicOverride ?? null,
      expiresAt: params.expiresAt,
      updatedAt: ts,
    },
  }).run();
}

export function getStoryIntakeSession(chatId: string) {
  const row = db.select().from(storyIntakeSessions).where(eq(storyIntakeSessions.chatId, chatId)).get();
  if (!row) return null;
  if (isExpired(row.expiresAt)) {
    clearStoryIntakeSession(chatId);
    return null;
  }
  return { ...row, clips: parseJson<StoryReelClipMetadata[]>(row.clips) ?? [] };
}

export function clearStoryIntakeSession(chatId: string): void {
  db.delete(storyIntakeSessions).where(eq(storyIntakeSessions.chatId, chatId)).run();
}

export function createStoryRun(params: {
  id: string;
  profileId: string;
  telegramChatId: string;
  sourceClipsMetadata: StoryReelClipMetadata[];
  clipCount: number;
  totalClipsSizeMb: number;
  totalSourceDurationSec: number;
  userNote?: string;
  workDir: string;
}): void {
  const ts = now();
  db.insert(storyRuns).values({
    id: params.id,
    profileId: params.profileId,
    telegramChatId: params.telegramChatId,
    sourceClipsMetadata: JSON.stringify(params.sourceClipsMetadata),
    clipCount: params.clipCount,
    totalClipsSizeMb: params.totalClipsSizeMb,
    totalSourceDurationSec: params.totalSourceDurationSec,
    userNote: params.userNote,
    workDir: params.workDir,
    status: "generating",
    stageLogs: JSON.stringify([]),
    createdAt: ts,
    updatedAt: ts,
  }).run();
}

export function getStoryRunById(id: string) {
  return db.select().from(storyRuns).where(eq(storyRuns.id, id)).get() ?? null;
}

export function getLatestStoryRunForChat(chatId: string) {
  return db.select().from(storyRuns).where(eq(storyRuns.telegramChatId, chatId)).orderBy(desc(storyRuns.createdAt)).limit(1).get() ?? null;
}

export function getCompletedStoryRunCountForProfile(profileId: string): number {
  return db.select({ id: storyRuns.id }).from(storyRuns).where(and(eq(storyRuns.profileId, profileId), eq(storyRuns.status, "delivered"))).all().length;
}

export function getRecentGeneratingStoryCount(chatId: string, withinMinutes: number): number {
  const cutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();
  return db.select({ id: storyRuns.id }).from(storyRuns).where(and(eq(storyRuns.telegramChatId, chatId), eq(storyRuns.status, "generating"), gte(storyRuns.createdAt, cutoff))).all().length;
}

export function updateStoryRun(id: string, fields: {
  directionJson?: Partial<StoryReelDirectorDirection> | StoryReelDirectorDirection;
  musicPath?: string | null;
  musicTitle?: string | null;
  musicArtist?: string | null;
  musicGenreUsed?: string | null;
  voiceIdUsed?: string | null;
  voiceProviderUsed?: string | null;
  durationUsedSec?: number | null;
  workDir?: string;
  voiceoverPath?: string | null;
  geminiInputTokens?: number | null;
  geminiOutputTokens?: number | null;
  geminiCostUsd?: number | null;
  videoGcsUrl?: string | null;
  reviewUrl?: string | null;
  status?: string;
  currentStage?: string | null;
  stageLogs?: StoryStageLog[];
  error?: string | null;
}): void {
  db.update(storyRuns).set({
    ...(fields.directionJson !== undefined && { directionJson: JSON.stringify(fields.directionJson) }),
    ...(fields.musicPath !== undefined && { musicPath: fields.musicPath }),
    ...(fields.musicTitle !== undefined && { musicTitle: fields.musicTitle }),
    ...(fields.musicArtist !== undefined && { musicArtist: fields.musicArtist }),
    ...(fields.musicGenreUsed !== undefined && { musicGenreUsed: fields.musicGenreUsed }),
    ...(fields.voiceIdUsed !== undefined && { voiceIdUsed: fields.voiceIdUsed }),
    ...(fields.voiceProviderUsed !== undefined && { voiceProviderUsed: fields.voiceProviderUsed }),
    ...(fields.durationUsedSec !== undefined && { durationUsedSec: fields.durationUsedSec }),
    ...(fields.workDir !== undefined && { workDir: fields.workDir }),
    ...(fields.voiceoverPath !== undefined && { voiceoverPath: fields.voiceoverPath }),
    ...(fields.geminiInputTokens !== undefined && { geminiInputTokens: fields.geminiInputTokens }),
    ...(fields.geminiOutputTokens !== undefined && { geminiOutputTokens: fields.geminiOutputTokens }),
    ...(fields.geminiCostUsd !== undefined && { geminiCostUsd: fields.geminiCostUsd }),
    ...(fields.videoGcsUrl !== undefined && { videoGcsUrl: fields.videoGcsUrl }),
    ...(fields.reviewUrl !== undefined && { reviewUrl: fields.reviewUrl }),
    ...(fields.status !== undefined && { status: fields.status }),
    ...(fields.currentStage !== undefined && { currentStage: fields.currentStage }),
    ...(fields.stageLogs !== undefined && { stageLogs: JSON.stringify(fields.stageLogs) }),
    ...(fields.error !== undefined && { error: fields.error }),
    updatedAt: now(),
  }).where(eq(storyRuns.id, id)).run();
}
```

- [ ] **Step 7: Run the DB test and build**

Run: `npm test -- tests/storyreel-db.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

Run: `git add src/db/schema.ts src/db/client.ts src/db/queries.ts src/storyreel/types.ts tests/storyreel-db.test.ts && git commit -m "feat: add StoryReel persistence model"`

## Task 2: Promote StoryReel POC Library

**Files:**
- Copy: `.worktrees/storyreel-director-poc/src/storyreel/director-poc.ts` → `src/storyreel/director-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/src/storyreel/audio-poc.ts` → `src/storyreel/audio-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/src/storyreel/rough-cut-poc.ts` → `src/storyreel/rough-cut-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/src/storyreel/audio-rough-cut-poc.ts` → `src/storyreel/audio-rough-cut-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/tests/storyreel-director-poc.test.ts` → `tests/storyreel-director-poc.test.ts`
- Copy: `.worktrees/storyreel-director-poc/tests/storyreel-audio-poc.test.ts` → `tests/storyreel-audio-poc.test.ts`
- Copy: `.worktrees/storyreel-director-poc/tests/storyreel-rough-cut-poc.test.ts` → `tests/storyreel-rough-cut-poc.test.ts`
- Copy: `.worktrees/storyreel-director-poc/tests/storyreel-audio-rough-cut-poc.test.ts` → `tests/storyreel-audio-rough-cut-poc.test.ts`
- Copy: `.worktrees/storyreel-director-poc/scripts/storyreel-director-poc.ts` → `scripts/storyreel-director-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/scripts/storyreel-rough-cut-poc.ts` → `scripts/storyreel-rough-cut-poc.ts`
- Copy: `.worktrees/storyreel-director-poc/scripts/storyreel-audio-rough-cut-poc.ts` → `scripts/storyreel-audio-rough-cut-poc.ts`
- Create: `src/storyreel/cost.ts`
- Modify: `tests/storyreel-director-poc.test.ts`
- Modify: `tests/storyreel-rough-cut-poc.test.ts`

- [ ] **Step 1: Copy POC files from the StoryReel worktree**

Run:

```bash
cp .worktrees/storyreel-director-poc/src/storyreel/director-poc.ts src/storyreel/director-poc.ts
cp .worktrees/storyreel-director-poc/src/storyreel/audio-poc.ts src/storyreel/audio-poc.ts
cp .worktrees/storyreel-director-poc/src/storyreel/rough-cut-poc.ts src/storyreel/rough-cut-poc.ts
cp .worktrees/storyreel-director-poc/src/storyreel/audio-rough-cut-poc.ts src/storyreel/audio-rough-cut-poc.ts
cp .worktrees/storyreel-director-poc/tests/storyreel-director-poc.test.ts tests/storyreel-director-poc.test.ts
cp .worktrees/storyreel-director-poc/tests/storyreel-audio-poc.test.ts tests/storyreel-audio-poc.test.ts
cp .worktrees/storyreel-director-poc/tests/storyreel-rough-cut-poc.test.ts tests/storyreel-rough-cut-poc.test.ts
cp .worktrees/storyreel-director-poc/tests/storyreel-audio-rough-cut-poc.test.ts tests/storyreel-audio-rough-cut-poc.test.ts
cp .worktrees/storyreel-director-poc/scripts/storyreel-director-poc.ts scripts/storyreel-director-poc.ts
cp .worktrees/storyreel-director-poc/scripts/storyreel-rough-cut-poc.ts scripts/storyreel-rough-cut-poc.ts
cp .worktrees/storyreel-director-poc/scripts/storyreel-audio-rough-cut-poc.ts scripts/storyreel-audio-rough-cut-poc.ts
```

Expected: the main worktree now has the four POC modules, three scripts, and four POC test files.

- [ ] **Step 2: Run copied POC tests before changing behavior**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts tests/storyreel-audio-poc.test.ts tests/storyreel-rough-cut-poc.test.ts tests/storyreel-audio-rough-cut-poc.test.ts
```

Expected: PASS. If this fails, stop and reconcile import paths or missing dependencies before adding production deltas.

- [ ] **Step 3: Add failing director tests for production spec deltas**

Append these tests inside the existing `describe("StoryReel director POC", ...)` block in `tests/storyreel-director-poc.test.ts`:

```ts
  it("builds a production prompt with precedence, profile context, and source-audio stripping", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 2,
      product: "Personal clips",
      note: "make this formal for a vet clinic",
      language: "english",
      profile: {
        audienceLanguage: "english",
        audienceDescription: "Dog owners who want practical veterinary advice.",
      },
      clipsMetadata: [
        { path: "/tmp/a.mp4", sizeMb: 10, durationSec: 30, orientation: "horizontal", width: 1920, height: 1080 },
        { path: "/tmp/b.mp4", sizeMb: 8, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 },
      ],
    });

    expect(prompt).toContain("If a user note is provided, it takes priority over all profile preferences for this video only. Treat the profile as permanent context and the user note as a per-video override.");
    expect(prompt).toContain("Source clip audio will be removed in Phase 1. Do not plan segments around dialogue, reactions, ambient sound, or any source audio being heard.");
    expect(prompt).toContain("Audience description: Dog owners who want practical veterinary advice.");
    expect(prompt).toContain("Clip 1: horizontal 1920x1080, 30s, 10MB");
  });

  it("requires independent inferred voice style and content type fields", () => {
    const direction = sampleDirection();
    direction.inferred_voice_style = "tutorial" as never;
    direction.inferred_content_type = "travel" as never;

    expect(validateDirection(direction, 2)).toEqual([]);

    delete (direction as unknown as Record<string, unknown>).inferred_content_type;
    expect(validateDirection(direction, 2)).toContain("inferred_content_type must be one of lifestyle, tutorial, review, travel, food, story, opinion, other");
  });
```

Also update the `sampleDirection()` helper in that test file to include these fields at the root:

```ts
inferred_voice_style: "storytelling",
inferred_content_type: "review",
```

- [ ] **Step 4: Run director test to verify production delta failure**

Run: `npm test -- tests/storyreel-director-poc.test.ts`

Expected: FAIL because the copied POC prompt does not yet include profile/clip metadata/source-audio instructions and validation does not require `inferred_content_type`.

- [ ] **Step 5: Adapt `director-poc.ts` for production direction schema**

Modify `src/storyreel/director-poc.ts`:

```ts
export type StoryReelVoiceStyle = "informative" | "storytelling" | "tutorial" | "review" | "conversational" | "lifestyle";
export type StoryReelContentType = "lifestyle" | "tutorial" | "review" | "travel" | "food" | "story" | "opinion" | "other";

export interface StoryReelClipPromptMetadata {
  path: string;
  sizeMb: number;
  durationSec: number;
  orientation: "vertical" | "horizontal" | "square" | "other";
  width: number;
  height: number;
}

export interface BuildDirectorPromptInput {
  clipCount: number;
  product: string;
  note: string;
  language: StoryReelLanguage;
  profile?: { audienceLanguage: StoryReelLanguage; audienceDescription: string };
  clipsMetadata?: StoryReelClipPromptMetadata[];
}
```

Add these root fields to `StoryReelDirectorDirection`:

```ts
inferred_voice_style: StoryReelVoiceStyle;
inferred_content_type: StoryReelContentType;
```

Update the JSON schema in `buildDirectorPrompt` so the returned JSON example includes:

```json
"inferred_voice_style": "informative|storytelling|tutorial|review|conversational|lifestyle",
"inferred_content_type": "lifestyle|tutorial|review|travel|food|story|opinion|other"
```

`buildDirectorPrompt` must include these exact sentences:

```ts
"If a user note is provided, it takes priority over all profile preferences for this video only. Treat the profile as permanent context and the user note as a per-video override."
"Source clip audio will be removed in Phase 1. Do not plan segments around dialogue, reactions, ambient sound, or any source audio being heard."
```

Also update `validateDirection` to validate both root classification fields. `inferred_voice_style` is later used for voice selection; `inferred_content_type` is logged only and must not drive behavior.

- [ ] **Step 6: Add Gemini usage metadata contract and cost helper**

Modify `StoryReelGeminiClient` in `src/storyreel/director-poc.ts`:

```ts
export interface StoryReelGeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface StoryReelGeminiClient {
  uploadFile(filePath: string, mimeType: string): Promise<{ uri: string; mimeType: string; name?: string }>;
  generateDirection(parts: Array<{ uri: string; mimeType: string }>, prompt: string): Promise<{ text: string; usageMetadata?: StoryReelGeminiUsage }>;
}
```

Update `GoogleStoryReelGeminiClient.generateDirection` so it returns `{ text, usageMetadata: response.usageMetadata }`. Update `runStoryReelDirectorPoc` to read `rawResult.text`.

Create `src/storyreel/cost.ts`:

```ts
export function calculateGeminiFlashCostUsd(inputTokens = 0, outputTokens = 0): number {
  const inputCost = inputTokens / 1_000_000 * 0.30;
  const outputCost = outputTokens / 1_000_000 * 2.50;
  return Number((inputCost + outputCost).toFixed(8));
}
```

Append to `tests/storyreel-director-poc.test.ts`:

```ts
import { calculateGeminiFlashCostUsd } from "../src/storyreel/cost.js";

it("calculates Gemini Flash cost from token counts", () => {
  expect(calculateGeminiFlashCostUsd(1000, 2000)).toBe(0.0053);
});
```

- [ ] **Step 7: Add failing rough-cut crop tests for production orientation rules**

Append to `tests/storyreel-rough-cut-poc.test.ts`:

```ts
import { buildStoryReelCropFilter } from "../src/storyreel/rough-cut-poc.js";

it("uses production 9:16 crop filters from the pipeline spec", () => {
  expect(buildStoryReelCropFilter({ width: 1080, height: 1920 })).toBe("scale=1080:1920");
  expect(buildStoryReelCropFilter({ width: 1920, height: 1080 })).toBe("crop=608:1080:656:0,scale=1080:1920");
  expect(buildStoryReelCropFilter({ width: 1080, height: 1080 })).toBe("crop=607:1080:236:0,scale=1080:1920");
});
```

- [ ] **Step 8: Implement production crop helper in rough-cut POC**

Modify `src/storyreel/rough-cut-poc.ts` to export:

```ts
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
```

Then update the FFmpeg segment preparation in `prepareSegments` so its video filter uses `buildStoryReelCropFilter(probed dimensions)` instead of generic letterboxing or unconstrained scaling. If `prepareSegments` does not yet probe width/height, add `probeClipDimensions(sourceClip)` using `ffprobe -v quiet -print_format json -show_streams` and select the first video stream.

- [ ] **Step 9: Run POC tests and build**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts tests/storyreel-audio-poc.test.ts tests/storyreel-rough-cut-poc.test.ts tests/storyreel-audio-rough-cut-poc.test.ts
```

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/storyreel scripts/storyreel-director-poc.ts scripts/storyreel-rough-cut-poc.ts scripts/storyreel-audio-rough-cut-poc.ts tests/storyreel-director-poc.test.ts tests/storyreel-audio-poc.test.ts tests/storyreel-rough-cut-poc.test.ts tests/storyreel-audio-rough-cut-poc.test.ts
git commit -m "feat: promote StoryReel POC helpers"
```

## Task 3: Story Stage 1 Direction

**Files:**
- Create: `src/stages/story-stage1-direction.ts`
- Create: `tests/story-stage1-direction.test.ts`

- [ ] **Step 1: Write failing stage tests**

Create `tests/story-stage1-direction.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StoryStage1Direction } from "../src/stages/story-stage1-direction.js";
import type { StoryContext } from "../src/pipeline/story-runner.js";

function makeCtx(): StoryContext {
  return {
    storyId: "story-1",
    telegramChatId: "chat-1",
    profile: { id: "profile-1", telegramChatId: "chat-1", profileName: "Test", audienceLanguage: "english", audienceDescription: "People who want useful clips.", preferredVoiceId: null, preferredVoiceProvider: null, createdAt: "now", updatedAt: "now" },
    clips: [{ path: "/tmp/a.mp4", sizeMb: 10, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 }],
    userNote: "make it practical",
    workDir: "/tmp/story-1",
    stageLogs: [],
    status: "generating",
  };
}

describe("StoryStage1Direction", () => {
  it("saves raw response before validation and retries once on validation failure", async () => {
    const updateStoryRun = vi.fn();
    const writeFileSync = vi.fn();
    let calls = 0;
    const stage = new StoryStage1Direction({
      updateStoryRun,
      writeFileSync,
      mkdirSync: vi.fn(),
      client: {
        async uploadFile() { return { uri: "gemini://a", mimeType: "video/mp4" }; },
        async generateDirection() {
          calls++;
          if (calls === 1) return { text: "{}", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } };
          return { text: JSON.stringify({
            inferred_voice_style: "tutorial",
            inferred_content_type: "travel",
            hook_clip: { clip_index: 0, start_sec: 0, end_sec: 3, reason: "motion" },
            clips: [{ clip_index: 0, start_sec: 0, end_sec: 7, order: 1, role: "hook" }],
            voiceover_script: { full_text: "A practical tip." },
            voice_direction: { tone: "warm", pace: "medium", style: "tutorial" },
            music_direction: { genre: "calm", energy: "medium", tempo: "medium", reason: "soft" },
            hook_text_overlay: "Tip",
            caption_lines: ["Tip"],
            cta_text: "Follow",
            facebook_caption: "Tip.",
            hashtags: ["#Tip"],
            total_duration_sec: 7,
            director_notes: "Use first clip.",
          }), usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 50 } };
        },
      },
    });

    const result = await stage.run(makeCtx());
    expect(result.direction?.inferred_voice_style).toBe("tutorial");
    expect(calls).toBe(2);
    expect(writeFileSync).toHaveBeenCalledWith("/tmp/story-1/director/summary.txt", expect.stringContaining("StoryReel Director"));
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ geminiInputTokens: 120, geminiOutputTokens: 50 }));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/story-stage1-direction.test.ts`

Expected: FAIL because the stage file is missing.

- [ ] **Step 3: Implement stage with retry and cost checkpoint**

Create `src/stages/story-stage1-direction.ts` with constructor-injected dependencies. The stage must write `prompt.txt`, `raw-direction.json`, `direction.json`, and `summary.txt` under `${ctx.workDir}/director/`, call `updateStoryRun` immediately after each Gemini response with token/cost fields, retry validation failure once, and on final validation failure throw `DIRECTION_VALIDATION_FAILED: <errors>`.

Stage 1 must read the Gemini model from `getStoryReelGeminiModel()` in `src/config.ts` and pass it to `GoogleStoryReelGeminiClient`. The default remains `gemini-2.5-flash`, but production can override with `STORYREEL_GEMINI_MODEL`.

The production `buildDirectorPrompt` call must map `StoryContext` to the POC prompt fields exactly like this:

```ts
const prompt = buildDirectorPrompt({
  clipCount: ctx.clips.length,
  product: ctx.userNote?.trim() || "Personal story from uploaded clips",
  note: ctx.userNote ?? "",
  language: ctx.profile.audienceLanguage,
  profile: {
    audienceLanguage: ctx.profile.audienceLanguage,
    audienceDescription: ctx.profile.audienceDescription,
  },
  clipsMetadata: ctx.clips,
});
```

Do not pass `profile.profileName` as `product`; profile name is channel identity, while the user note is per-video context and already has the highest precedence in the prompt.

Use this class shape:

```ts
export class StoryStage1Direction implements StoryStage {
  name = "story-stage1-direction";
  constructor(private readonly deps: StoryStage1Deps = {}) {}
  async run(ctx: StoryContext): Promise<Partial<StoryContext>> {
    // Build prompt, upload clips, call Gemini, persist usage/cost, validate, retry once, return { direction }.
  }
}
```

Replace the comment with explicit code; do not leave a comment-only body in the implementation.

- [ ] **Step 4: Run stage test and build**

Run: `npm test -- tests/story-stage1-direction.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/stages/story-stage1-direction.ts tests/story-stage1-direction.test.ts && git commit -m "feat: add StoryReel direction stage"`

## Task 4: Story Stage 2 Voice

**Files:**
- Create: `src/stages/story-stage2-voice.ts`
- Create: `tests/story-stage2-voice.test.ts`

- [ ] **Step 1: Write failing voice selection tests**

Create `tests/story-stage2-voice.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StoryStage2Voice } from "../src/stages/story-stage2-voice.js";
import type { StoryContext } from "../src/pipeline/story-runner.js";

function ctx(overrides: Partial<StoryContext> = {}): StoryContext {
  return {
    storyId: "story-1",
    telegramChatId: "chat-1",
    profile: { id: "profile-1", telegramChatId: "chat-1", profileName: "Test", audienceLanguage: "english", audienceDescription: "Useful clips for travellers.", preferredVoiceId: null, preferredVoiceProvider: null, createdAt: "now", updatedAt: "now" },
    clips: [],
    direction: {
      inferred_voice_style: "conversational",
      inferred_content_type: "travel",
      hook_clip: { clip_index: 0, start_sec: 0, end_sec: 3, reason: "motion" },
      clips: [],
      voiceover_script: { full_text: "Hello story" },
      voice_direction: { tone: "warm", pace: "medium", style: "conversational" },
      music_direction: { genre: "calm", energy: "medium", tempo: "medium", reason: "soft" },
      hook_text_overlay: "Hello",
      caption_lines: ["Hello"],
      cta_text: "Follow",
      facebook_caption: "Hello.",
      hashtags: ["#Hello"],
      total_duration_sec: 8,
      director_notes: "Warm tone.",
    },
    userNote: undefined,
    workDir: "/tmp/story-1",
    stageLogs: [],
    status: "generating",
    ...overrides,
  };
}

describe("StoryStage2Voice", () => {
  it("uses preferred profile voice before querying DB", async () => {
    const generateVoiceover = vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" });
    const stage = new StoryStage2Voice({ generateVoiceover, updateStoryRun: vi.fn(), getStoryVoices: vi.fn() });
    const result = await stage.run(ctx({ profile: { ...ctx().profile, preferredVoiceId: "preferred-1", preferredVoiceProvider: "elevenlabs" } }));
    expect(generateVoiceover).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "preferred-1" }));
    expect(result.voiceoverPath).toBe("/tmp/voice.mp3");
  });

  it("stores first DB voice as sticky profile preference", async () => {
    const updateStoryProfileVoice = vi.fn();
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice,
      getStoryVoices: vi.fn().mockReturnValue([{ voiceId: "db-voice", provider: "elevenlabs" }]),
    });
    await stage.run(ctx());
    expect(updateStoryProfileVoice).toHaveBeenCalledWith("profile-1", "db-voice", "elevenlabs");
  });

  it("drops the language filter for Thai ElevenLabs shared voice fallback", async () => {
    const selectSharedVoice = vi.fn().mockResolvedValue({ voiceId: "shared-th", provider: "elevenlabs", name: "Shared Thai" });
    const getStoryVoices = vi.fn().mockReturnValue([]);
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice: vi.fn(),
      getStoryVoices,
      selectSharedVoice,
    });

    await stage.run(ctx({ profile: { ...ctx().profile, audienceLanguage: "thai" } }));

    expect(getStoryVoices).toHaveBeenCalledWith("thai", "conversational");
    expect(selectSharedVoice).toHaveBeenCalledWith(expect.objectContaining({ language: undefined, style: "conversational" }));
  });

  it("passes English language filter to ElevenLabs shared voice fallback", async () => {
    const selectSharedVoice = vi.fn().mockResolvedValue({ voiceId: "shared-en", provider: "elevenlabs", name: "Shared English" });
    const getStoryVoices = vi.fn().mockReturnValue([]);
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice: vi.fn(),
      getStoryVoices,
      selectSharedVoice,
    });

    await stage.run(ctx({ profile: { ...ctx().profile, audienceLanguage: "english" } }));

    expect(getStoryVoices).toHaveBeenCalledWith("english", "conversational");
    expect(selectSharedVoice).toHaveBeenCalledWith(expect.objectContaining({ language: "english", style: "conversational" }));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/story-stage2-voice.test.ts`

Expected: FAIL because the stage file is missing.

- [ ] **Step 3: Implement voice priority order**

Create `src/stages/story-stage2-voice.ts`. It must implement this exact priority order: preferred profile voice, DB voices filtered by `audienceLanguage` plus `direction.inferred_voice_style`, ElevenLabs shared fallback for any language, Botnoi hard error when no DB voice exists. It must write `voice-selection.json`, update `voiceIdUsed`, `voiceProviderUsed`, and `voiceoverPath` in `story_runs`.

Use `createElevenLabsService` for provider `elevenlabs`; use `createBotnoiService` for provider `botnoi`. For ElevenLabs shared fallback, add a constructor dependency `selectSharedVoice`. When `profile.audienceLanguage === "thai"`, call `selectSharedVoice` with no language filter because ElevenLabs shared voices are multilingual and can handle Thai even when not labeled Thai. For English and German, pass the language. The default implementation may throw `No shared ElevenLabs voice matched style "<style>"` if the shared-voice API search returns no match.

- [ ] **Step 4: Run test and build**

Run: `npm test -- tests/story-stage2-voice.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/stages/story-stage2-voice.ts tests/story-stage2-voice.test.ts && git commit -m "feat: add StoryReel voice stage"`

## Task 5: Story Music Library And Stage 3 Assembly

**Files:**
- Create: `src/storyreel/music.ts`
- Create: `src/stages/story-stage3-assembly.ts`
- Create: `tests/storyreel-music.test.ts`
- Create: `tests/story-stage3-assembly.test.ts`
- Create: `music/storyreel/index.json`
- Create: `music/storyreel/upbeat/.gitkeep`
- Create: `music/storyreel/calm/.gitkeep`
- Create: `music/storyreel/neutral/.gitkeep`
- Create: `music/storyreel/playful/.gitkeep`
- Create: `music/storyreel/dramatic/.gitkeep`
- Create: `music/storyreel/inspirational/.gitkeep`

- [ ] **Step 1: Write failing music tests**

Create `tests/storyreel-music.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickStoryMusicTrack, validateMusicGenre } from "../src/storyreel/music.js";

describe("StoryReel music", () => {
  it("validates genres", () => {
    expect(validateMusicGenre("calm")).toBe("calm");
    expect(() => validateMusicGenre("ambient")).toThrow("Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational");
  });

  it("selects a track from the requested genre", () => {
    const track = pickStoryMusicTrack({
      genre: "calm",
      baseDir: "/repo/music/storyreel",
      index: [
        { genre: "calm", filename: "calm/wanderlust.mp3", title: "Wanderlust", artist: "Scott Buckley", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
      ],
      randomFn: () => 0,
    });
    expect(track.path).toBe("/repo/music/storyreel/calm/wanderlust.mp3");
    expect(track.attribution).toBe("Music: Wanderlust by Scott Buckley (CC BY 4.0)");
  });
});
```

- [ ] **Step 2: Implement music helper and skeleton index**

Create `src/storyreel/music.ts` with `STORY_MUSIC_GENRES`, `validateMusicGenre`, `loadStoryMusicIndex`, and `pickStoryMusicTrack`.

Create `music/storyreel/index.json`:

```json
[
  {
    "genre": "calm",
    "filename": "calm/scott-buckley-wanderlust.mp3",
    "title": "Wanderlust",
    "artist": "Scott Buckley",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"
  }
]
```

Create `.gitkeep` files in all six genre directories. The asset commit later must add 17 additional licensed MP3 entries and files before production enablement.

- [ ] **Step 3: Write failing stage 3 test**

Create `tests/story-stage3-assembly.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StoryStage3Assembly } from "../src/stages/story-stage3-assembly.js";

describe("StoryStage3Assembly", () => {
  it("uses one-shot music override before director genre and persists final outputs", async () => {
    const updateStoryRun = vi.fn();
    const stage = new StoryStage3Assembly({
      acquireAssemblyLock: vi.fn().mockResolvedValue(undefined),
      releaseAssemblyLock: vi.fn(),
      pickMusicTrack: vi.fn().mockReturnValue({ path: "/music/calm/a.mp3", title: "A", artist: "Artist", genre: "calm", attribution: "Music: A by Artist (CC BY 4.0)" }),
      buildAssemblyPlan: vi.fn().mockReturnValue({ segments: [], totalDurationSec: 12 }),
      buildRoughCutHtml: vi.fn().mockReturnValue("<html></html>"),
      renderWithHyperframes: vi.fn().mockResolvedValue("/tmp/video-only.mp4"),
      mixVoiceAndMusic: vi.fn().mockResolvedValue("/tmp/audio.m4a"),
      muxVideoAndAudio: vi.fn().mockResolvedValue("/tmp/final.mp4"),
      updateStoryRun,
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: { audienceLanguage: "english" } as any,
      clips: [],
      direction: { music_direction: { genre: "dramatic" }, total_duration_sec: 12 } as any,
      voiceoverPath: "/tmp/voice.mp3",
      pendingMusicOverride: "calm",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.videoPath).toBe("/tmp/final.mp4");
    expect(result.musicAttribution).toBe("Music: A by Artist (CC BY 4.0)");
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ musicGenreUsed: "calm", durationUsedSec: 12 }));
  });
});
```

- [ ] **Step 4: Implement stage 3**

Create `src/stages/story-stage3-assembly.ts`. It must require `ctx.direction` and `ctx.voiceoverPath`, acquire/release the global assembly lock, select `ctx.pendingMusicOverride ?? ctx.direction.music_direction.genre`, write `assembly-plan.json` and `index.html`, render video-only rough cut, mix voiceover + music, mux final video, and update `musicPath`, `musicTitle`, `musicArtist`, `musicGenreUsed`, and `durationUsedSec`.

The stage output must include both `videoPath` and `musicAttribution`. `musicAttribution` must be the exact string from `pickStoryMusicTrack().attribution` so Stage 4 can include Creative Commons attribution in the delivery message.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- tests/storyreel-music.test.ts tests/story-stage3-assembly.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add src/storyreel/music.ts src/stages/story-stage3-assembly.ts tests/storyreel-music.test.ts tests/story-stage3-assembly.test.ts music/storyreel && git commit -m "feat: add StoryReel assembly stage"`

## Task 6: Story Stage 4 Publish

**Files:**
- Create: `src/stages/story-stage4-publish.ts`
- Create: `tests/story-stage4-publish.test.ts`
- Modify: `src/services/telegram.ts`

- [ ] **Step 1: Write failing publish tests**

Create `tests/story-stage4-publish.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StoryStage4Publish } from "../src/stages/story-stage4-publish.js";

describe("StoryStage4Publish", () => {
  it("extracts thumbnail, uploads video and thumbnail, and notifies Telegram", async () => {
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const updateStoryRun = vi.fn();
    const extractThumbnail = vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg");
    const stage = new StoryStage4Publish({
      extractThumbnail,
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn().mockResolvedValue("https://gcs/video.mp4"), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto },
      updateStoryRun,
      baseUrl: "https://pipeline.example.com",
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoPath: "/tmp/final.mp4",
      musicAttribution: "Music: A by Artist (CC BY 4.0)",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.videoGcsUrl).toBe("https://gcs/video.mp4");
    expect(extractThumbnail).toHaveBeenCalledWith("/tmp/final.mp4", "/tmp/story-1/rough-cut/thumbnail.jpg");
    expect(sendPhoto).toHaveBeenCalledWith("chat-1", Buffer.from("/tmp/story-1/rough-cut/thumbnail.jpg"), expect.stringContaining("/tweak <note>"));
    expect(sendPhoto).toHaveBeenCalledWith("chat-1", Buffer.from("/tmp/story-1/rough-cut/thumbnail.jpg"), expect.stringContaining("Music: A by Artist (CC BY 4.0)"));
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ status: "delivered", videoGcsUrl: "https://gcs/video.mp4" }));
  });

  it("skips video upload and reuses existing thumbnail on notification retry", async () => {
    const uploadVideo = vi.fn();
    const extractThumbnail = vi.fn();
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const stage = new StoryStage4Publish({
      extractThumbnail,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo, uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto },
      updateStoryRun: vi.fn(),
      baseUrl: "https://pipeline.example.com",
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoGcsUrl: "https://gcs/existing-video.mp4",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(uploadVideo).not.toHaveBeenCalled();
    expect(extractThumbnail).not.toHaveBeenCalled();
    expect(result.videoGcsUrl).toBe("https://gcs/existing-video.mp4");
    expect(sendPhoto).toHaveBeenCalledWith("chat-1", expect.anything(), expect.stringContaining("/tweak"));
  });

  it("re-extracts thumbnail in notification retry when thumbnail file is missing", async () => {
    const extractThumbnail = vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg");
    const stage = new StoryStage4Publish({
      extractThumbnail,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn(), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto: vi.fn().mockResolvedValue(undefined) },
      updateStoryRun: vi.fn(),
      baseUrl: "https://pipeline.example.com",
    });

    await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoGcsUrl: "https://gcs/existing-video.mp4",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(extractThumbnail).toHaveBeenCalledWith(
      "/tmp/story-1/rough-cut/rough-cut-with-audio.mp4",
      "/tmp/story-1/rough-cut/thumbnail.jpg",
    );
  });
});
```

- [ ] **Step 2: Add Telegram `sendPhoto` support**

Modify `src/services/telegram.ts`:

```ts
async sendPhoto(chatId: string, photo: Buffer, caption: string): Promise<void> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("photo", new Blob([photo], { type: "image/jpeg" }), "thumbnail.jpg");
  const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Telegram sendPhoto failed: ${response.status}`);
}
```

Also add `sendPhoto` to the `Sender` interface used by StoryReel intake tests.

- [ ] **Step 3: Implement publish stage**

Create `src/stages/story-stage4-publish.ts`. Use `ffmpeg -ss 00:00:03 -i <video> -frames:v 1 <thumbnail>` for thumbnail extraction. The thumbnail destination must be `path.join(ctx.workDir, "rough-cut", "thumbnail.jpg")`, matching the spec work directory layout. Upload video with prefix `storyreel` and filename `storyreel.mp4`; upload thumbnail with filename `thumbnail.jpg`; build `reviewUrl` as `${PIPELINE_BASE_URL}/story/${storyId}` for now, even before a review route exists. The Telegram caption must include the GCS URL, music attribution if present, and `/tweak <note>`.

If `ctx.videoGcsUrl` is already set, Stage 4 is running as a notification retry. It must skip `gcs.uploadVideo` and reuse `ctx.videoGcsUrl`. For the thumbnail in retry mode, first check `path.join(ctx.workDir, "rough-cut", "thumbnail.jpg")`; if that file exists, read and upload it directly without calling `extractThumbnail`. If it does not exist, re-derive the assembled local video path as `ctx.videoPath ?? path.join(ctx.workDir, "rough-cut", "rough-cut-with-audio.mp4")`, call `extractThumbnail(localVideoPath, thumbnailPath)`, then upload/send the thumbnail. After notification, update `status: "delivered"` and return the existing video URL.

- [ ] **Step 4: Run test and build**

Run: `npm test -- tests/story-stage4-publish.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/stages/story-stage4-publish.ts src/services/telegram.ts tests/story-stage4-publish.test.ts && git commit -m "feat: add StoryReel publish stage"`

## Task 7: Story Runner With Resume, Rebuild, And Tweak

**Files:**
- Create: `src/pipeline/story-runner.ts`
- Create: `tests/story-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `tests/story-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StoryRunner, resolveStoryResumeStage } from "../src/pipeline/story-runner.js";

describe("StoryRunner", () => {
  it("resolves resume stage from checkpoints", () => {
    expect(resolveStoryResumeStage({ directionJson: null, voiceoverPath: null, videoGcsUrl: null })).toBe(1);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: null, videoGcsUrl: null })).toBe(2);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: "/tmp/voice.mp3", videoGcsUrl: null })).toBe(3);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: "/tmp/voice.mp3", videoGcsUrl: "https://gcs/video.mp4" })).toBe(4);
  });

  it("runs stages in order and persists stage logs", async () => {
    const updateStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [
        { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: { ok: true } }) },
        { name: "story-stage2-voice", run: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3" }) },
      ] as any,
      updateStoryRun,
      createStoryRun: vi.fn(),
      getStoryRunById: vi.fn(),
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.runFromContext({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.voiceoverPath).toBe("/tmp/voice.mp3");
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ currentStage: "story-stage1-direction" }));
  });

  it("carries one-shot music override from intake into the run context and clears it", async () => {
    const consumeStoryMusicOverride = vi.fn().mockReturnValue("calm");
    const runner = new StoryRunner({
      stages: [{ name: "story-stage3-assembly", run: vi.fn().mockResolvedValue({ videoPath: "/tmp/final.mp4" }) }] as any,
      updateStoryRun: vi.fn(),
      createStoryRun: vi.fn(),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [], totalSizeMb: 0, totalDurationSec: 0, pendingMusicOverride: "calm" }),
      consumeStoryMusicOverride,
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.run("chat-1", { profile: {} as any });

    expect(result.pendingMusicOverride).toBe("calm");
    expect(consumeStoryMusicOverride).toHaveBeenCalledWith("chat-1");
  });

  it("consumes one-shot music override for tweak runs too", async () => {
    const consumeStoryMusicOverride = vi.fn().mockReturnValue("dramatic");
    const createStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [{ name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) }] as any,
      updateStoryRun: vi.fn(),
      createStoryRun,
      getLatestStoryRunForChat: vi.fn().mockReturnValue({
        id: "old",
        profileId: "profile-1",
        sourceClipsMetadata: JSON.stringify([
          { path: "/work/stories/old/clips/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 },
          { path: "/work/stories/old/clips/clip-2.mp4", sizeMb: 6, durationSec: 12, orientation: "vertical", width: 1080, height: 1920 },
        ]),
      }),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [], totalSizeMb: 0, totalDurationSec: 0, pendingMusicOverride: "dramatic" }),
      consumeStoryMusicOverride,
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.tweak("chat-1", "make it warmer");

    expect(result.pendingMusicOverride).toBe("dramatic");
    expect(consumeStoryMusicOverride).toHaveBeenCalledWith("chat-1");
    expect(createStoryRun).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "profile-1",
      clipCount: 2,
      totalClipsSizeMb: 10,
      totalSourceDurationSec: 22,
      sourceClipsMetadata: [
        expect.objectContaining({ path: "/work/stories/old/clips/clip-1.mp4" }),
        expect.objectContaining({ path: "/work/stories/old/clips/clip-2.mp4" }),
      ],
      userNote: "make it warmer",
    }));
  });

  it("resumes from stage 2 when direction exists but voice is missing", async () => {
    const stage1 = { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) };
    const stage2 = { name: "story-stage2-voice", run: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3" }) };
    const runner = new StoryRunner({
      stages: [stage1, stage2] as any,
      updateStoryRun: vi.fn(),
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: null,
        videoGcsUrl: null,
        workDir: "/tmp/story-1",
        userNote: "resume me",
        status: "failed",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    });

    await runner.resume("story-1");

    expect(stage1.run).not.toHaveBeenCalled();
    expect(stage2.run).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1", direction: expect.objectContaining({ inferred_voice_style: "tutorial" }) }));
  });

  it("runs local clips through a temporary intake session for the admin CLI", async () => {
    const setStoryIntakeSession = vi.fn();
    const run = vi.fn().mockResolvedValue({ storyId: "story-local" });
    const runner = new StoryRunner({
      setStoryIntakeSession,
      run,
      probeClipMetadata: vi.fn().mockReturnValue({ path: "/clips/a.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }),
      copyLocalClipToIntake: vi.fn().mockReturnValue("/work/stories/intake/chat-1/clip-1.mp4"),
      computeStoryIntakeExpiry: vi.fn().mockReturnValue("2099-01-01T00:00:00.000Z"),
    } as any);

    const result = await runner.runFromLocalClips({ chatId: "chat-1", clipPaths: ["/clips/a.mp4"], note: "formal", profile: {} as any });

    expect(setStoryIntakeSession).toHaveBeenCalledWith(expect.objectContaining({ chatId: "chat-1", clips: [expect.objectContaining({ path: "/work/stories/intake/chat-1/clip-1.mp4" })] }));
    expect(run).toHaveBeenCalledWith("chat-1", expect.objectContaining({ note: "formal" }));
    expect(result.storyId).toBe("story-local");
  });

  it("deletes the intake temp directory after clips are copied into the story work dir", async () => {
    const removeIntakeFiles = vi.fn();
    const runner = new StoryRunner({
      stages: [] as any,
      updateStoryRun: vi.fn(),
      createStoryRun: vi.fn(),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [{ path: "/work/stories/intake/chat-1/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }], totalSizeMb: 4, totalDurationSec: 10 }),
      consumeStoryMusicOverride: vi.fn(),
      copyClipsToWorkDir: vi.fn().mockReturnValue([{ path: "/work/stories/story-1/clips/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }]),
      clearStoryIntakeSession: vi.fn(),
      removeIntakeFiles,
    });

    await runner.run("chat-1", { profile: {} as any, storyId: "story-1" });

    expect(removeIntakeFiles).toHaveBeenCalledWith("chat-1");
  });

  it("rebuilds from stage 2 by clearing voice and later checkpoints before rerunning", async () => {
    const updateStoryRun = vi.fn();
    const runFromContext = vi.fn().mockResolvedValue({ storyId: "story-1" });
    const runner = new StoryRunner({
      updateStoryRun,
      runFromContext,
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: "/work/stories/story-1/voice/voiceover.mp3",
        videoGcsUrl: "https://gcs/video.mp4",
        reviewUrl: "https://pipeline/story/story-1",
        workDir: "/work/stories/story-1",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    } as any);

    await runner.rebuild("story-1", 2);

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      voiceoverPath: null,
      voiceIdUsed: null,
      voiceProviderUsed: null,
      musicGenreUsed: null,
      musicPath: null,
      musicTitle: null,
      musicArtist: null,
      durationUsedSec: null,
      videoGcsUrl: null,
      reviewUrl: null,
      error: null,
      status: "generating",
    }));
    expect(runFromContext).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1" }), { fromStage: 2 });
  });

  it("rebuilds from stage 1 by clearing direction and all later checkpoints before rerunning", async () => {
    const updateStoryRun = vi.fn();
    const runFromContext = vi.fn().mockResolvedValue({ storyId: "story-1" });
    const runner = new StoryRunner({
      updateStoryRun,
      runFromContext,
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: "/work/stories/story-1/voice/voiceover.mp3",
        videoGcsUrl: "https://gcs/video.mp4",
        reviewUrl: "https://pipeline/story/story-1",
        workDir: "/work/stories/story-1",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    } as any);

    await runner.rebuild("story-1", 1);

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      directionJson: null,
      voiceoverPath: null,
      voiceIdUsed: null,
      voiceProviderUsed: null,
      musicGenreUsed: null,
      musicPath: null,
      musicTitle: null,
      musicArtist: null,
      durationUsedSec: null,
      videoGcsUrl: null,
      reviewUrl: null,
      error: null,
      status: "generating",
    }));
    expect(runFromContext).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1" }), { fromStage: 1 });
  });

  it("marks story run failed when any stage throws", async () => {
    const updateStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [
        { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) },
        { name: "story-stage2-voice", run: vi.fn().mockRejectedValue(new Error("voice quota exceeded")) },
      ] as any,
      updateStoryRun,
    });

    await expect(runner.runFromContext({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    })).rejects.toThrow("voice quota exceeded");

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      status: "failed",
      currentStage: null,
      error: "voice quota exceeded",
    }));
  });
});
```

- [ ] **Step 2: Implement runner context and orchestration**

Create `src/pipeline/story-runner.ts` exporting `StoryContext`, `StoryStage`, `StoryRunner`, `_activeStoryChats`, `isStoryRunning`, `requestCancelStory`, `acquireStoryAssemblyLock` re-exporting the reel assembly lock, and `resolveStoryResumeStage`.

Define `StoryContext` in this file as the canonical production contract:

```ts
export interface StoryContext {
  storyId: string;
  telegramChatId: string;
  profile: StoryProfileRow;
  clips: StoryReelClipMetadata[];
  userNote?: string;
  pendingMusicOverride?: StoryReelMusicGenre;
  direction?: StoryReelDirectorDirection;
  voiceoverPath?: string;
  wordTimingsPath?: string;
  videoPath?: string;
  videoGcsUrl?: string;
  reviewUrl?: string;
  musicAttribution?: string;
  workDir: string;
  stageLogs: StoryStageLog[];
  status: StoryReelRunStatus;
}

export interface StoryStage {
  name: string;
  run(ctx: StoryContext): Promise<Partial<StoryContext>>;
}
```

`StoryProfileRow` can be a local alias for `NonNullable<ReturnType<typeof queries.getStoryProfileByChatId>>` if that is convenient, or an exported interface with the profile table fields. Do not leave StoryContext inferred from tests.

Stage timeouts:

```ts
const STORY_STAGE_TIMEOUTS_MS: Record<string, number> = {
  "story-stage1-direction": 10 * 60_000,
  "story-stage2-voice": 5 * 60_000,
  "story-stage3-assembly": 15 * 60_000,
  "story-stage4-publish": 3 * 60_000,
};
```

`StoryRunner.run(chatId, options)` must copy intake files from `work/stories/intake/<chatId>/` to `work/stories/<storyId>/clips/`, call `consumeStoryMusicOverride(chatId)` and set the result on `StoryContext.pendingMusicOverride`, create a `story_runs` row, clear the intake DB session after files are copied, delete `work/stories/intake/<chatId>/` from disk, and run all four stages.

`StoryRunner.tweak(chatId, note)` must create a new `story_run` that points to the original run's `sourceClipsMetadata` paths, call `consumeStoryMusicOverride(chatId)` the same way `/run` does, and run from stage 1. For a tweak run, parse the previous run's `sourceClipsMetadata` JSON to derive `clipCount`, `totalClipsSizeMb` as the sum of `sizeMb`, and `totalSourceDurationSec` as the sum of `durationSec`. Take `profileId` from the previous run row's `profileId`; do not do a fresh `getStoryProfileByChatId(chatId)` lookup for this value. Chained tweaks keep pointing to the same original clip directory.

`rebuild(storyId, fromStage)` must null DB fields from the requested stage onward before running. Rebuild does not consume `pendingMusicOverride`; overrides are only consumed by `/run` and `/tweak`.

`StoryRunner.resume(storyId)` must load the row with `getStoryRunById`, reconstruct `StoryContext` from `sourceClipsMetadata`, `directionJson`, `voiceoverPath`, `workDir`, and `stageLogs`, call `resolveStoryResumeStage`, and call `runFromContext(ctx, { fromStage })`. A run with `directionJson` set and `voiceoverPath` missing must skip stage 1 and resume at stage 2. If `videoGcsUrl` is already set on a failed run, `resolveStoryResumeStage` returns 4 and Stage 4 must treat this as a notification retry: skip video upload, reuse the existing `videoGcsUrl`, regenerate/upload thumbnail if needed, and resend the Telegram delivery message.

`StoryRunner.runFromLocalClips({ chatId, clipPaths, note, profile })` is the admin CLI bridge. It must copy each local clip into `work/stories/intake/<chatId>/clip-N.<ext>`, probe metadata, create or replace a 24-hour intake session with `setStoryIntakeSession`, then delegate to `run(chatId, { profile, note })`. It must not bypass the normal run path because music override consumption, DB row creation, work-dir copy, and temp-file deletion must behave the same as Telegram-triggered runs.

Default intake file cleanup must be explicit and recursive:

```ts
function storyIntakeDir(chatId: string): string {
  return path.join(ROOT_DIR, "work", "stories", "intake", chatId);
}

function removeIntakeFiles(chatId: string): void {
  fs.rmSync(storyIntakeDir(chatId), { recursive: true, force: true });
}
```

Use the same `ROOT_DIR` convention as `reel-runner.ts`: if `PIPELINE_DB_PATH` is set, root is `path.dirname(path.dirname(process.env.PIPELINE_DB_PATH))`; otherwise root is the repository root from the module path. Do not use `/tmp` for intake cleanup.

`StoryRunner.rebuild(storyId, fromStage)` must reset DB checkpoints before rerunning. For `fromStage <= 1`, clear `directionJson`, `voiceoverPath`, voice fields, music fields, `durationUsedSec`, `videoGcsUrl`, and `reviewUrl`. For `fromStage === 2`, keep `directionJson` and clear `voiceoverPath`, voice fields, music fields, `durationUsedSec`, `videoGcsUrl`, and `reviewUrl`. For `fromStage === 3`, keep direction and voice fields, clear music fields, `durationUsedSec`, `videoGcsUrl`, and `reviewUrl`. For `fromStage === 4`, keep assembled local outputs and clear only `videoGcsUrl` and `reviewUrl`. Every rebuild reset must also set `status: "generating"`, `currentStage: null`, and `error: null`.

`runFromContext` must wrap the stage loop in `try/catch`. On any thrown error, it must update `story_runs` with `{ status: "failed", currentStage: null, error: err.message }`, append an error stage log, then rethrow the original error so CLI/Telegram callers can notify the user.

- [ ] **Step 3: Run runner test and build**

Run: `npm test -- tests/story-runner.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

Run: `git add src/pipeline/story-runner.ts tests/story-runner.test.ts && git commit -m "feat: add StoryReel runner"`

## Task 8: Telegram Story Intake And Commands

**Files:**
- Create: `src/pipeline/story-intake.ts`
- Create: `src/pipeline/story-intake-session-store.ts`
- Modify: `src/services/telegram.ts`
- Modify: `src/pipeline/command-listener.ts`
- Create: `tests/story-intake.test.ts`
- Create: `tests/story-telegram-commands.test.ts`

- [ ] **Step 1: Write failing pure intake tests**

Create `tests/story-intake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeStoryIntakeExpiry, formatClipAcceptedMessage, formatClipLimitError, parseStoryCommand, validateAudienceDescription, validateMusicGenreInput } from "../src/pipeline/story-intake.js";

describe("StoryReel intake helpers", () => {
  it("validates setup audience description length", () => {
    expect(validateAudienceDescription("too short")).toBe("Please describe your audience in a bit more detail (at least 20 characters). This helps Gemini understand who the video is for.");
    expect(validateAudienceDescription("People who want practical and honest short videos.")).toBeNull();
  });

  it("formats clip intake messages", () => {
    expect(formatClipAcceptedMessage(1, 5, 134, 38)).toBe("Clip 1/5 received (2m14s, 38MB). Send more or !run to start.");
    expect(formatClipLimitError("count", { count: 5 })).toBe("You've already sent 5 clips. Use !run to start or !cancel to clear.");
  });

  it("parses StoryReel commands", () => {
    expect(parseStoryCommand("!run make it formal")).toEqual({ type: "run", note: "make it formal" });
    expect(parseStoryCommand("!story")).toEqual({ type: "story" });
    expect(parseStoryCommand("!story rebuild abc123 3")).toEqual({ type: "rebuild", id: "abc123", stage: 3 });
    expect(validateMusicGenreInput("ambient")).toBe("Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational");
  });

  it("computes a 24-hour intake session expiry", () => {
    expect(computeStoryIntakeExpiry(new Date("2026-05-17T12:00:00.000Z"))).toBe("2026-05-18T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Implement intake helpers and Telegram video parsing**

Create `src/pipeline/story-intake.ts` with setup command parsing, `!story` buffer command parsing, music genre validation, limit messages, orientation warning text, `computeStoryIntakeExpiry(now = new Date())`, and `probeUploadedClip` using ffprobe.

`computeStoryIntakeExpiry` must implement the spec's 24-hour TTL exactly:

```ts
export function computeStoryIntakeExpiry(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
```

Create `src/pipeline/story-intake-session-store.ts` as a thin wrapper over the StoryReel query functions from Task 1:

```ts
import * as queries from "../db/queries.js";
import type { StoryReelClipMetadata, StoryReelMusicGenre } from "../storyreel/types.js";

export interface SetStoryIntakeSessionInput {
  chatId: string;
  clips: StoryReelClipMetadata[];
  totalSizeMb: number;
  totalDurationSec: number;
  pendingMusicOverride?: StoryReelMusicGenre | null;
  expiresAt: string;
}

export function setStoryIntakeSession(input: SetStoryIntakeSessionInput): void {
  queries.upsertStoryIntakeSession(input);
}

export function getStoryIntakeSession(chatId: string) {
  return queries.getStoryIntakeSession(chatId);
}

export function clearStoryIntakeSession(chatId: string): void {
  queries.clearStoryIntakeSession(chatId);
}

export function consumeStoryMusicOverride(chatId: string): StoryReelMusicGenre | undefined {
  const session = queries.getStoryIntakeSession(chatId);
  const override = session?.pendingMusicOverride ?? undefined;
  if (session) {
    queries.upsertStoryIntakeSession({
      chatId,
      clips: session.clips,
      totalSizeMb: session.totalSizeMb,
      totalDurationSec: session.totalDurationSec,
      pendingMusicOverride: null,
      expiresAt: session.expiresAt,
    });
  }
  return override;
}
```

This file exists so Telegram command handling and `StoryRunner` do not reach directly into lower-level query details. It must not duplicate JSON parsing logic from `queries.ts`.

Modify `src/services/telegram.ts`:

```ts
export interface TelegramMessage {
  updateId: number;
  messageId: number;
  text: string;
  date: number;
  document?: { fileId: string; fileName?: string; mimeType?: string };
  video?: { fileId: string; fileName?: string; mimeType?: string; duration?: number; fileSize?: number; width?: number; height?: number };
}
```

Add `downloadFile(fileId: string, destination: string): Promise<void>` that uses `getFile` then streams the Telegram file to disk.

- [ ] **Step 3: Write failing command-listener tests**

Create `tests/story-telegram-commands.test.ts` with mocked `StoryRunner`, `queries`, and Telegram sender. Cover `!setup` missing profile welcome, `!profile`, `!music calm`, `!story` buffer display, `!run` blocked when a story is active, `!run` blocked by the DB recent-generating guard, `!run` blocked when the intake session is empty, `!cancel`, `!tweak <note>`, `!story resume <id>`, `!story rebuild <id> <stage>`, invalid `!music ambient`, and video upload to an unprovisioned channel.

The `!story` buffer display test must mock `getStoryIntakeSession` with two clips and assert the response includes clip count, total size, and total duration:

```ts
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("2/5 clips"));
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("46MB"));
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("3m04s"));
```

The `!cancel` test must assert both DB and disk cleanup:

```ts
expect(clearStoryIntakeSession).toHaveBeenCalledWith("chat-1");
expect(removeIntakeFiles).toHaveBeenCalledWith("chat-1");
```

The `!tweak` no-previous-run test must mock `getLatestStoryRunForChat(chatId)` to return `null` and assert the bot sends:

```text
No previous story found for this channel. Send clips and use !run to start one.
```

The DB guard test must mock `isStoryRunning(chatId)` as false and `getRecentGeneratingStoryCount(chatId, 5)` as `1`, then assert `!run` sends:

```text
A story is already being generated for this channel. Wait for it to finish or check its status.
```

The empty-intake `!run` test must mock `isStoryRunning(chatId)` as false, `getRecentGeneratingStoryCount(chatId, 5)` as `0`, and `getStoryIntakeSession(chatId)` as either `null` or `{ clips: [], totalSizeMb: 0, totalDurationSec: 0 }`. It must assert `StoryRunner.run` is not called and the bot sends:

```text
No clips in buffer. Send clips before using !run.
```

The `!profile` test must assert the response includes profile name, language, audience description, preferred voice when set, and completed run count:

```ts
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Profile: Dog Walking"));
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Language: german"));
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Preferred voice: elevenlabs/voice-1"));
expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Runs completed: 3"));
```

The video-upload-without-profile test must pass a `TelegramMessage` with `video.fileId` and no text, mock `getStoryProfileByChatId` to return `null`, and assert the bot sends:

```text
Welcome! This channel has no profile yet. Run !setup to configure it before sending clips.
```

- [ ] **Step 4: Wire StoryReel commands in command listener**

Modify `src/pipeline/command-listener.ts` so StoryReel routes are checked before the existing `!post`/`!reel` namespace only when `STORYREEL_ENABLED` is true. StoryReel commands use `!` prefix, consistent with the main pipeline. When `STORYREEL_BOT_TOKEN` is set, StoryReel is handled by a dedicated `startStoryReelListener()` that creates its own Telegram service instance via `createTelegramServiceWithToken()` and polls all known StoryReel chat IDs (from `getAllStoryReelChatIds()`). When the token is not set, StoryReel falls through to the shared command listener (backward compatible). Video uploads with no profile must send the welcome/setup message. Video uploads with a profile must download to `work/stories/intake/<chatId>/clip-N.mp4`, validate limits, update the DB intake session, and send any horizontal/square crop warning.

Before starting `!run`, check both `isStoryRunning(chatId)` and `queries.getRecentGeneratingStoryCount(chatId, 5) > 0`. If either is true, send the spec's concurrent-run message and do not call `StoryRunner.run`. This is the intended use of `getRecentGeneratingStoryCount`; it protects against process restarts losing the in-memory active-run set.

After the concurrent-run guards and before calling `StoryRunner.run`, load `queries.getStoryIntakeSession(chatId)`. If the session is missing or `session.clips.length === 0`, send `No clips in buffer. Send clips before using !run.` and do not call `StoryRunner.run`. This guard belongs in the command listener so users get an immediate Telegram response instead of creating an empty StoryReel run.

`!cancel` must call both `clearStoryIntakeSession(chatId)` and `removeIntakeFiles(chatId)` so cancelled buffered clips do not remain on disk.

Before calling `StoryRunner.tweak(chatId, note)`, `!tweak <note>` must check `queries.getLatestStoryRunForChat(chatId)`. If there is no previous story, send `No previous story found for this channel. Send clips and use !run to start one.` and do not call `StoryRunner.tweak`.

- [ ] **Step 5: Run intake tests and build**

Run: `npm test -- tests/story-intake.test.ts tests/story-telegram-commands.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add src/pipeline/story-intake.ts src/pipeline/story-intake-session-store.ts src/services/telegram.ts src/pipeline/command-listener.ts tests/story-intake.test.ts tests/story-telegram-commands.test.ts && git commit -m "feat: add StoryReel Telegram intake"`

## Task 9: Feature Flag, CLI, And Server Registration

**Files:**
- Modify: `src/config.ts`
- Modify: `bin/run.ts`
- Modify: `bin/server.ts`
- Create: `scripts/story-runner.ts`
- Create: `tests/story-feature-flag.test.ts`
- Create: `tests/story-cli.test.ts`

- [ ] **Step 1: Write failing flag and CLI tests**

Create `tests/story-feature-flag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getStoryReelGeminiModel, isStoryReelEnabled } from "../src/config.js";

describe("StoryReel feature flag", () => {
  it("defaults to disabled", () => {
    delete process.env.STORYREEL_ENABLED;
    expect(isStoryReelEnabled()).toBe(false);
  });

  it("enables on true", () => {
    process.env.STORYREEL_ENABLED = "true";
    expect(isStoryReelEnabled()).toBe(true);
  });

  it("uses configurable StoryReel Gemini model with production default", () => {
    delete process.env.STORYREEL_GEMINI_MODEL;
    expect(getStoryReelGeminiModel()).toBe("gemini-2.5-flash");
    process.env.STORYREEL_GEMINI_MODEL = "gemini-test-model";
    expect(getStoryReelGeminiModel()).toBe("gemini-test-model");
  });
});
```

Create `tests/story-cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseArgs } from "../bin/run.js";

describe("StoryReel CLI args", () => {
  it("parses --story local clip run", () => {
    expect(parseArgs(["ds", "--story", "--chat", "chat-1", "--clip", "/tmp/a.mp4", "--note", "formal"])).toMatchObject({
      story: true,
      storyChatId: "chat-1",
      storyClips: ["/tmp/a.mp4"],
      storyNote: "formal",
    });
  });
});
```

- [ ] **Step 2: Implement flag and CLI**

Modify `src/config.ts`:

```ts
export function isStoryReelEnabled(): boolean {
  return (process.env.STORYREEL_ENABLED ?? "false").toLowerCase() === "true";
}

export function getStoryReelGeminiModel(): string {
  return process.env.STORYREEL_GEMINI_MODEL ?? "gemini-2.5-flash";
}

export function getStoryReelBotToken(): string | undefined {
  return process.env.STORYREEL_BOT_TOKEN;
}
```

`validateEnv` must require `ELEVENLABS_API_KEY` only when `isStoryReelEnabled()` is true. Botnoi remains seed-dependent and does not become required by env validation. `STORYREEL_GEMINI_MODEL` is optional and must not be required by `validateEnv`; Stage 1 reads it through `getStoryReelGeminiModel()`.

Modify `bin/run.ts` to parse `--story`, `--chat <chatId>`, repeated `--clip <path>`, and `--note <text>`. If `--story` is present and `STORYREEL_ENABLED` is not true, print `StoryReel is disabled. Set STORYREEL_ENABLED=true to run this command.` and exit 1.

Create `scripts/story-runner.ts` as a tiny entrypoint that imports dotenv, resolves the channel profile by `chatId`, and calls:

```ts
await StoryRunner.runFromLocalClips({ chatId, clipPaths, note, profile });
```

If no profile exists for `chatId`, the script must throw `No StoryReel profile found for chat <chatId>. Run !setup in Telegram first.` rather than creating an implicit profile.

- [ ] **Step 3: Register server handling behind flag**

Modify `bin/server.ts` so StoryReel command/video handling is registered only when `isStoryReelEnabled()` returns true. When `STORYREEL_BOT_TOKEN` is set, call `startStoryReelListener()` which creates a dedicated Telegram service and polls all known StoryReel chat IDs independently. When not set, StoryReel commands fall through to the shared command listener. Existing reel cron and command listeners must behave exactly as before when the flag is false.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/story-feature-flag.test.ts tests/story-cli.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/config.ts bin/run.ts bin/server.ts scripts/story-runner.ts tests/story-feature-flag.test.ts tests/story-cli.test.ts && git commit -m "feat: gate StoryReel pipeline"`

## Task 10: Operational Asset Completion

**Files:**
- Modify: `music/storyreel/index.json`
- Add: `music/storyreel/*/*.mp3`
- Modify: `.env.example`
- Create: `tests/storyreel-music-library.test.ts`

- [ ] **Step 1: Add library completeness test**

Create `tests/storyreel-music-library.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { STORY_MUSIC_GENRES, loadStoryMusicIndex } from "../src/storyreel/music.js";

describe("StoryReel committed music library", () => {
  it("has at least three indexed tracks per genre and every file exists", () => {
    const baseDir = path.resolve("music/storyreel");
    const index = loadStoryMusicIndex(baseDir);
    for (const genre of STORY_MUSIC_GENRES) {
      const tracks = index.filter((track) => track.genre === genre);
      expect(tracks.length, genre).toBeGreaterThanOrEqual(3);
      for (const track of tracks) {
        expect(fs.existsSync(path.join(baseDir, track.filename)), track.filename).toBe(true);
        expect(track.title.length).toBeGreaterThan(0);
        expect(track.artist.length).toBeGreaterThan(0);
        expect(track.licenseUrl).toMatch(/^https?:\/\//);
      }
    }
  });
});
```

- [ ] **Step 2: Add licensed MP3 assets and index entries**

Add three tracks per genre under:

```text
music/storyreel/upbeat/
music/storyreel/calm/
music/storyreel/neutral/
music/storyreel/playful/
music/storyreel/dramatic/
music/storyreel/inspirational/
```

Update `music/storyreel/index.json` so every entry has `genre`, `filename`, `title`, `artist`, and `licenseUrl`. Keep `calm/scott-buckley-wanderlust.mp3` in the calm group if that file is available locally; otherwise replace the index entry and file together with a different CC BY 4.0 calm track.

- [ ] **Step 3: Document env flag**

Modify `.env.example`:

```text
# StoryReel personal video pipeline
STORYREEL_ENABLED=false
STORYREEL_GEMINI_MODEL=gemini-2.5-flash
STORYREEL_BOT_TOKEN=
ELEVENLABS_API_KEY=
```

- [ ] **Step 4: Run library test**

Run: `npm test -- tests/storyreel-music-library.test.ts`

Expected: PASS after all 18 MP3 files are present.

- [ ] **Step 5: Commit**

Run: `git add music/storyreel .env.example tests/storyreel-music-library.test.ts && git commit -m "chore: add StoryReel music library"`

## Task 11: End-To-End Verification

**Files:**
- Modify only files required by failures discovered in this task.

- [ ] **Step 1: Run focused StoryReel tests**

Run:

```bash
npm test -- tests/storyreel-db.test.ts tests/storyreel-director-poc.test.ts tests/storyreel-audio-poc.test.ts tests/storyreel-rough-cut-poc.test.ts tests/storyreel-audio-rough-cut-poc.test.ts tests/story-stage1-direction.test.ts tests/story-stage2-voice.test.ts tests/storyreel-music.test.ts tests/story-stage3-assembly.test.ts tests/story-stage4-publish.test.ts tests/story-runner.test.ts tests/story-intake.test.ts tests/story-telegram-commands.test.ts tests/story-feature-flag.test.ts tests/story-cli.test.ts tests/storyreel-music-library.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run manual dry admin command with local clips**

With `STORYREEL_ENABLED=true` and real env credentials, run:

```bash
npm run cli -- ds --story --chat manual-test --clip /absolute/path/clip1.mp4 --clip /absolute/path/clip2.mp4 --note "German language manual smoke test"
```

Expected: a `story_runs` row reaches `delivered`, final video is uploaded to GCS, and the console prints the StoryReel run id.

- [ ] **Step 5: Commit final fixes**

If Step 1-4 required edits, commit them:

```bash
git add <changed-files>
git commit -m "fix: complete StoryReel verification"
```

If no edits were required, do not create an empty commit.

## Self-Review

Spec coverage:
- Channel profile setup is covered by Tasks 1 and 8.
- File limits, orientation metadata, and user warnings are covered by Task 8 and assembly crop filters in Task 2.
- `!setup`, `!profile`, `!music`, `!story`, `!run`, `!cancel`, `!tweak`, `!story resume`, and `!story rebuild` are covered by Task 8 plus runner methods in Task 7.
- Four production stages are covered by Tasks 3 through 6.
- Direction precedence, inferred content fields, source audio stripping, raw JSON, token/cost logging, `summary.txt`, configurable Gemini model, and validation retry are covered by Task 3.
- Voice selection priority and the Thai ElevenLabs shared-voice language-filter exception are covered by Task 4.
- Music override consumption for `!run` and `!tweak`, plus attribution handoff through `musicAttribution`, are covered by Tasks 5, 6, 7, and 8.
- Resume/rebuild/tweak behavior is covered by Task 7.
- Concurrent run limiting is covered by Task 7 and command blocking in Task 8.
- Database tables and validation view are covered by Task 1.
- Feature flag, CLI gating, `STORYREEL_GEMINI_MODEL` config, separate bot support (`STORYREEL_BOT_TOKEN`), and `startStoryReelListener()` are covered by Task 9.
- Music assets are covered by Task 10.
- Full verification and graph update are covered by Task 11.

Placeholder scan:
- The plan contains no placeholder markers from the forbidden list.
- The only external dependency is licensed MP3 asset acquisition in Task 10, with exact folder/index requirements and an automated completeness test.
- Code steps name concrete files, functions, exports, commands, and expected results.

Type consistency:
- `StoryReelAudienceLanguage`, `StoryReelVoiceStyle`, `StoryReelContentType`, `StoryReelMusicGenre`, `StoryReelClipMetadata`, and `StoryReelDirectorDirection` are introduced in Task 1 and reused consistently.
- Stage context uses a canonical `StoryContext` from `src/pipeline/story-runner.ts`, explicitly including `direction`, `pendingMusicOverride`, `voiceoverPath`, `videoPath`, and `musicAttribution`.
- DB query names used by later tasks are introduced in Task 1.
- `story-intake-session-store.ts` has a defined wrapper API and does not duplicate JSON parsing.
- `!profile` and video upload to an unprovisioned channel have explicit command-listener tests.
