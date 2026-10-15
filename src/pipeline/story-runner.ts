import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  StoryReelClipMetadata,
  StoryReelDirectorDirection,
  StoryReelMusicGenre,
  StoryReelRunStatus,
  StoryStageLog,
} from "../storyreel/types.js";

export interface StoryProfileRow {
  id: string;
  telegramChatId: string;
  profileName: string;
  audienceLanguage: string;
  audienceDescription: string;
  preferredVoiceId: string | null;
  preferredVoiceProvider: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryContext {
  storyId: string;
  telegramChatId: string;
  profile: StoryProfileRow;
  clips: StoryReelClipMetadata[];
  userNote?: string;
  pendingMusicOverride?: StoryReelMusicGenre;
  voiceEnabled?: boolean;
  musicEnabled?: boolean;
  captionsEnabled?: boolean;
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

const STORY_STAGE_TIMEOUTS_MS: Record<string, number> = {
  "story-stage1-direction": 10 * 60_000,
  "story-stage2-voice": 5 * 60_000,
  "story-stage3-assembly": 15 * 60_000,
  "story-stage4-publish": 3 * 60_000,
};

export function resolveStoryResumeStage(checkpoints: {
  directionJson: string | null;
  voiceoverPath: string | null;
  videoGcsUrl: string | null;
}): number {
  if (checkpoints.videoGcsUrl) return 4;
  if (checkpoints.voiceoverPath) return 3;
  if (checkpoints.directionJson) return 2;
  return 1;
}

const ROOT_DIR = process.env.PIPELINE_DB_PATH
  ? path.dirname(path.dirname(process.env.PIPELINE_DB_PATH))
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function storyIntakeDir(chatId: string): string {
  return path.join(ROOT_DIR, "work", "stories", "intake", chatId);
}

function removeIntakeFiles(chatId: string): void {
  fs.rmSync(storyIntakeDir(chatId), { recursive: true, force: true });
}

export { removeIntakeFiles };

const _activeStoryChats = new Set<string>();
export { _activeStoryChats };

export function isStoryRunning(chatId: string): boolean {
  return _activeStoryChats.has(chatId);
}

const _cancelRequestedChats = new Set<string>();

export function requestCancelStory(chatId: string): void {
  _cancelRequestedChats.add(chatId);
}

export async function acquireStoryAssemblyLock(): Promise<void> {
  const { acquireAssemblyLock } = await import("./reel-runner.js");
  return acquireAssemblyLock();
}

export async function releaseStoryAssemblyLock(): Promise<void> {
  const { releaseAssemblyLock } = await import("./reel-runner.js");
  releaseAssemblyLock();
}

export interface StoryRunnerDeps {
  stages?: StoryStage[];
  updateStoryRun: (id: string, fields: Record<string, unknown>) => void;
  createStoryRun?: (params: {
    id: string;
    profileId: string;
    telegramChatId: string;
    sourceClipsMetadata: StoryReelClipMetadata[];
    clipCount: number;
    totalClipsSizeMb: number;
    totalSourceDurationSec: number;
    userNote?: string;
    workDir: string;
  }) => void;
  getStoryRunById?: (id: string) => Record<string, unknown> | null;
  getLatestStoryRunForChat?: (chatId: string) => Record<string, unknown> | null;
  getStoryProfileById?: (profileId: string) => StoryProfileRow | null;
  getStoryIntakeSession?: (chatId: string) => {
    clips: StoryReelClipMetadata[];
    totalSizeMb: number;
    totalDurationSec: number;
    pendingMusicOverride?: StoryReelMusicGenre;
  } | null;
  consumeStoryMusicOverride?: (chatId: string) => StoryReelMusicGenre | undefined;
  clearStoryIntakeSession?: (chatId: string) => void;
  copyClipsToWorkDir?: (chatId: string, workDir: string) => StoryReelClipMetadata[];
  setStoryIntakeSession?: (params: {
    chatId: string;
    clips: StoryReelClipMetadata[];
    totalSizeMb: number;
    totalDurationSec: number;
    expiresAt: string;
  }) => void;
  probeClipMetadata?: (clipPath: string) => StoryReelClipMetadata;
  copyLocalClipToIntake?: (localPath: string, chatId: string, index: number) => string;
  computeStoryIntakeExpiry?: () => string;
  run?: (chatId: string, options: { profile: StoryProfileRow; note?: string; storyId?: string; voiceEnabled?: boolean; musicEnabled?: boolean; captionsEnabled?: boolean }) => Promise<Partial<StoryContext>>;
  runFromContext?: (ctx: StoryContext, options?: { fromStage?: number }) => Promise<Partial<StoryContext>>;
  removeIntakeFiles?: (chatId: string) => void;
}

export class StoryRunner {
  private deps: StoryRunnerDeps;

  constructor(deps: StoryRunnerDeps) {
    this.deps = deps;
  }

  async runFromContext(
    ctx: StoryContext,
    options?: { fromStage?: number },
  ): Promise<StoryContext> {
    const stages = this.deps.stages ?? [];
    const fromStage = options?.fromStage ?? 1;
    let current = { ...ctx };
    _activeStoryChats.add(ctx.telegramChatId);

    try {
      for (let i = fromStage - 1; i < stages.length; i++) {
        if (_cancelRequestedChats.delete(current.telegramChatId)) {
          throw new Error("Story cancelled by user");
        }
        const stage = stages[i];
        if (stage.name === "story-stage2-voice" && current.voiceEnabled === false) {
          current.stageLogs = [...current.stageLogs, { stage: stage.name, status: "ok", durationMs: 0 }];
          continue;
        }
        this.deps.updateStoryRun(current.storyId, { currentStage: stage.name });
        const patch = await stage.run(current);
        current = { ...current, ...patch };
        current.stageLogs = [...current.stageLogs, { stage: stage.name, status: "ok", durationMs: 0 }];
        if ((patch as { direction?: unknown }).direction) {
          this.deps.updateStoryRun(current.storyId, { directionJson: (patch as { direction: unknown }).direction });
        }
      }
      return current;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "Story cancelled by user") {
        this.deps.updateStoryRun(current.storyId, {
          status: "cancelled",
          currentStage: null,
          error: msg,
        });
        current.status = "cancelled";
        throw err;
      }
      this.deps.updateStoryRun(current.storyId, {
        status: "failed",
        currentStage: null,
        error: msg,
      });
      throw err;
    } finally {
      _activeStoryChats.delete(ctx.telegramChatId);
    }
  }

  async run(
    chatId: string,
    options: { profile: StoryProfileRow; note?: string; storyId?: string; voiceEnabled?: boolean; musicEnabled?: boolean; captionsEnabled?: boolean },
  ): Promise<StoryContext> {
    const storyId = options.storyId ?? randomUUID();
    const intake = this.deps.getStoryIntakeSession?.(chatId);
    const clips = intake?.clips ?? [];

    const pendingMusicOverride = this.deps.consumeStoryMusicOverride?.(chatId);

    const workDir = path.join(ROOT_DIR, "work", "stories", storyId);

    const copiedClips = this.deps.copyClipsToWorkDir?.(chatId, workDir) ?? [];

    this.deps.createStoryRun?.({
      id: storyId,
      profileId: options.profile.id,
      telegramChatId: chatId,
      sourceClipsMetadata: copiedClips.length > 0 ? copiedClips : clips,
      clipCount: copiedClips.length > 0 ? copiedClips.length : clips.length,
      totalClipsSizeMb: (copiedClips.length > 0 ? copiedClips : clips).reduce((sum, c) => sum + c.sizeMb, 0),
      totalSourceDurationSec: (copiedClips.length > 0 ? copiedClips : clips).reduce((sum, c) => sum + c.durationSec, 0),
      userNote: options.note,
      workDir,
    });

    this.deps.clearStoryIntakeSession?.(chatId);
    (this.deps.removeIntakeFiles ?? removeIntakeFiles)(chatId);

    const ctx: StoryContext = {
      storyId,
      telegramChatId: chatId,
      profile: options.profile,
      clips: copiedClips.length > 0 ? copiedClips : clips,
      userNote: options.note,
      pendingMusicOverride,
      voiceEnabled: options.voiceEnabled ?? true,
      musicEnabled: options.musicEnabled ?? true,
      captionsEnabled: options.captionsEnabled ?? true,
      workDir,
      stageLogs: [],
      status: "generating",
    };

    return this.runFromContext(ctx);
  }

  async resume(storyId: string): Promise<StoryContext> {
    const row = this.deps.getStoryRunById?.(storyId);
    if (!row) throw new Error(`Story run ${storyId} not found`);

    let directionJson = (row.directionJson as string | null) ?? null;
    const voiceoverPath = (row.voiceoverPath as string | null) ?? null;
    const videoGcsUrl = (row.videoGcsUrl as string | null) ?? null;
    const workDir = (row.workDir as string) ?? "";
    const sourceClipsMetadata = JSON.parse((row.sourceClipsMetadata as string) ?? "[]") as StoryReelClipMetadata[];
    // Fall back to reading direction.json from disk if DB column was never populated
    if (!directionJson && workDir) {
      const directionFile = path.join(workDir, "director", "direction.json");
      if (fs.existsSync(directionFile)) {
        directionJson = fs.readFileSync(directionFile, "utf8");
        this.deps.updateStoryRun(storyId, { directionJson: JSON.parse(directionJson) });
      }
    }
    const direction = directionJson ? JSON.parse(directionJson) as StoryReelDirectorDirection : undefined;
    const stageLogs = JSON.parse((row.stageLogs as string) ?? "[]") as StoryStageLog[];

    const fromStage = resolveStoryResumeStage({ directionJson, voiceoverPath, videoGcsUrl });

    const profileId = row.profileId as string;
    const profile = this.deps.getStoryProfileById?.(profileId) ?? ({} as StoryProfileRow);

    const ctx: StoryContext = {
      storyId,
      telegramChatId: (row.telegramChatId as string) ?? "",
      profile,
      clips: sourceClipsMetadata,
      direction,
      voiceoverPath: voiceoverPath ?? undefined,
      videoGcsUrl: videoGcsUrl ?? undefined,
      workDir,
      stageLogs,
      status: "generating",
    };

    return this.runFromContext(ctx, { fromStage });
  }

  async rebuild(storyId: string, fromStage: number): Promise<StoryContext> {
    const row = this.deps.getStoryRunById?.(storyId);
    if (!row) throw new Error(`Story run ${storyId} not found`);

    const clearFields: Record<string, unknown> = {
      status: "generating",
      currentStage: null,
      error: null,
    };

    if (fromStage <= 1) {
      Object.assign(clearFields, {
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
      });
    } else if (fromStage === 2) {
      Object.assign(clearFields, {
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
      });
    } else if (fromStage === 3) {
      Object.assign(clearFields, {
        musicGenreUsed: null,
        musicPath: null,
        musicTitle: null,
        musicArtist: null,
        durationUsedSec: null,
        videoGcsUrl: null,
        reviewUrl: null,
      });
    } else if (fromStage === 4) {
      Object.assign(clearFields, {
        videoGcsUrl: null,
        reviewUrl: null,
      });
    }

    this.deps.updateStoryRun(storyId, clearFields);

    const directionJson = (row.directionJson as string | null) ?? null;
    const voiceoverPath = (row.voiceoverPath as string | null) ?? null;
    const sourceClipsMetadata = JSON.parse((row.sourceClipsMetadata as string) ?? "[]") as StoryReelClipMetadata[];
    const workDir = (row.workDir as string) ?? "";

    let direction: StoryReelDirectorDirection | undefined;
    if (fromStage <= 1) {
      direction = undefined;
    } else {
      direction = directionJson ? JSON.parse(directionJson) as StoryReelDirectorDirection : undefined;
    }

    const profileId = row.profileId as string;
    const profile = this.deps.getStoryProfileById?.(profileId) ?? ({} as StoryProfileRow);

    const ctx: StoryContext = {
      storyId,
      telegramChatId: (row.telegramChatId as string) ?? "",
      profile,
      clips: sourceClipsMetadata,
      direction,
      voiceoverPath: fromStage <= 2 ? undefined : (voiceoverPath ?? undefined),
      workDir,
      stageLogs: [],
      status: "generating",
    };

    if (this.deps.runFromContext) {
      const result = await this.deps.runFromContext(ctx, { fromStage });
      return { ...ctx, ...result };
    }

    return this.runFromContext(ctx, { fromStage });
  }

  async tweak(chatId: string, note: string): Promise<StoryContext> {
    const prev = this.deps.getLatestStoryRunForChat?.(chatId);
    if (!prev) throw new Error(`No previous story run found for chat ${chatId}`);

    const prevMetadata = JSON.parse((prev.sourceClipsMetadata as string) ?? "[]") as StoryReelClipMetadata[];
    const profileId = (prev.profileId as string) ?? "";
    const profile = this.deps.getStoryProfileById?.(profileId) ?? ({} as StoryProfileRow);

    const pendingMusicOverride = this.deps.consumeStoryMusicOverride?.(chatId);

    const storyId = randomUUID();
    const workDir = path.join(ROOT_DIR, "work", "stories", storyId);

    const clipCount = prevMetadata.length;
    const totalClipsSizeMb = prevMetadata.reduce((sum, c) => sum + c.sizeMb, 0);
    const totalSourceDurationSec = prevMetadata.reduce((sum, c) => sum + c.durationSec, 0);

    this.deps.createStoryRun?.({
      id: storyId,
      profileId,
      telegramChatId: chatId,
      sourceClipsMetadata: prevMetadata,
      clipCount,
      totalClipsSizeMb,
      totalSourceDurationSec,
      userNote: note,
      workDir,
    });

    const ctx: StoryContext = {
      storyId,
      telegramChatId: chatId,
      profile,
      clips: prevMetadata,
      userNote: note,
      pendingMusicOverride,
      workDir,
      stageLogs: [],
      status: "generating",
    };

    return this.runFromContext(ctx);
  }

  async runFromLocalClips(params: {
    chatId: string;
    clipPaths: string[];
    note?: string;
    profile: StoryProfileRow;
  }): Promise<Partial<StoryContext>> {
    const clips: StoryReelClipMetadata[] = [];

    for (let i = 0; i < params.clipPaths.length; i++) {
      const localPath = params.clipPaths[i];
      const intakePath = this.deps.copyLocalClipToIntake?.(localPath, params.chatId, i) ?? localPath;
      const meta = this.deps.probeClipMetadata?.(intakePath) ?? { path: intakePath, sizeMb: 0, durationSec: 0, orientation: "vertical" as const, width: 1080, height: 1920 };
      clips.push({ ...meta, path: intakePath });
    }

    const totalSizeMb = clips.reduce((sum, c) => sum + c.sizeMb, 0);
    const totalDurationSec = clips.reduce((sum, c) => sum + c.durationSec, 0);

    this.deps.setStoryIntakeSession?.({
      chatId: params.chatId,
      clips,
      totalSizeMb,
      totalDurationSec,
      expiresAt: this.deps.computeStoryIntakeExpiry?.() ?? new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    });

    return this.deps.run?.(params.chatId, { profile: params.profile, note: params.note })
      ?? this.run(params.chatId, { profile: params.profile, note: params.note });
  }
}
