import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { BrandId, ReelCategory, ReelContext, ReelRunOptions, RunContext, Story, ImageSource, CategorySource, Stage5RendererType, Stage5TemplateName } from "../types.js";
import type { TrendingSignals } from "../services/trending.js";
import { getBrand } from "../brands/index.js";

// Persistent work dir — survives crashes and reboots (unlike /tmp)
const ROOT_DIR = process.env.PIPELINE_DB_PATH 
  ? path.dirname(path.dirname(process.env.PIPELINE_DB_PATH)) 
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REEL_WORK_BASE = path.join(ROOT_DIR, "work", "reels");

function reelWorkDir(reelId: string): string {
  return path.join(REEL_WORK_BASE, reelId);
}

function reelSceneArtifactPaths(workDir: string, sceneCount: number): { audioPaths: string[]; imagePaths: string[] } {
  return {
    audioPaths: Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.mp3`)),
    imagePaths: Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.png`)),
  };
}

export function buildReelCaption(
  headline: string,
  hashtags: string[],
  sourceUrl: string,
  postSourceAsComment: boolean
): { caption: string; sourceComment: string | null } {
  const sourceLine = /^https?:\/\//i.test(sourceUrl) ? `🔗 ${sourceUrl}` : `Source: ${sourceUrl}`;
  const caption = postSourceAsComment
    ? `${headline}\n\n${hashtags.join(" ")}`.trim().slice(0, 2200)
    : `${headline}\n\n${hashtags.join(" ")}\n${sourceLine}`.trim().slice(0, 2200);
  return { caption, sourceComment: postSourceAsComment ? sourceLine : null };
}

export function formatRecentDuplicateStoryError(story: Pick<Story, "sourceUrl" | "headline">): string {
  const headline = story.headline?.trim();
  if (headline) {
    return `Reel story already covered recently: ${story.sourceUrl} — ${headline}`;
  }
  return `Reel story already covered recently: ${story.sourceUrl}`;
}

export function getRebuildPartArtifacts(
  workDir: string,
  sceneCount: number,
  part: "voice" | "images" | "music" | "video",
  existsFn: (filePath: string) => boolean = fs.existsSync,
): { audioPaths?: string[]; imagePaths?: string[] } {
  const { audioPaths, imagePaths } = reelSceneArtifactPaths(workDir, sceneCount);
  const missingAudio = audioPaths.filter((p) => !existsFn(p)).map((p) => path.basename(p));
  const missingImages = imagePaths.filter((p) => !existsFn(p)).map((p) => path.basename(p));

  if (part === "voice") {
    if (missingImages.length > 0) {
      throw new Error(`rebuildPart(voice) requires existing scene images: ${missingImages.join(", ")}`);
    }
    return { imagePaths };
  }

  if (part === "images") {
    if (missingAudio.length > 0) {
      throw new Error(`rebuildPart(images) requires existing scene audio: ${missingAudio.join(", ")}`);
    }
    return { audioPaths };
  }

  // Both "music" and "video" require all scene artifacts present
  if (missingAudio.length > 0 || missingImages.length > 0) {
    const parts: string[] = [];
    if (missingAudio.length > 0) parts.push(`audio (${missingAudio.join(", ")})`);
    if (missingImages.length > 0) parts.push(`images (${missingImages.join(", ")})`);
    throw new Error(`rebuildPart(music) requires existing scene artifacts: ${parts.join("; ")}`);
  }
  return { audioPaths, imagePaths };
}

export function resolveStage5MusicUploadPath(
  ctx: Pick<ReelContext, "brand" | "category" | "script" | "musicTrackOverride">,
  existsFn: (filePath: string) => boolean = fs.existsSync,
): string | undefined {
  return resolveReelMusicFile({
    brand: ctx.brand,
    category: ctx.category ?? ctx.script?.category,
    selector: ctx.musicTrackOverride,
    existsFn,
  })?.path;
}

import * as queries from "../db/queries.js";
import { createTelegramService } from "../services/telegram.js";
import { createLineService } from "../services/line.js";
import { getEnabledChannels } from "../services/messaging.js";
import { createGcsService } from "../services/gcs.js";
import { createStockImageService } from "../services/stock-image.js";
import { createSearchService } from "../services/search.js";
import { createGeminiService } from "../services/gemini.js";
import { createBedrockService } from "../services/bedrock.js";
import { createImageGenService } from "../services/image-gen.js";
import { createMetaService } from "../services/meta.js";
import { buildAssemblyMessage, enqueueAssemblyJob } from "../services/assembly-queue.js";
import { resolveReelMusicFile } from "../stages/reel-music-selector.js";
import { canLaunchAssemblyWorker, launchAssemblyWorker } from "../services/assembly-launcher.js";
import { isReelAssemblyOffloadEnabled } from "../config.js";
import { ReelStage5Facade, resolveStage5RendererSelection, resolveStage5RenderSettings } from "../stages/reel-stage5-renderer.js";

interface FetchStoryResult {
  story: Story;
  trendingSignals?: TrendingSignals;
}

// In-memory set of brand IDs that have a reel generation in progress
const _activeReelBrands = new Set<string>();
export function getActiveReelBrands(): string[] { return [..._activeReelBrands]; }
export function isReelRunning(brandId: string): boolean { return _activeReelBrands.has(brandId); }

// Skip-next-run counter per brand — persisted to disk so it survives restarts
const DATA_DIR = process.env.PIPELINE_DB_PATH 
  ? path.dirname(process.env.PIPELINE_DB_PATH) 
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const SKIP_FLAG_PATH = path.join(DATA_DIR, "reel-skip-flags.json");

function _loadSkipFlags(): Map<string, number> {
  try {
    if (!fs.existsSync(SKIP_FLAG_PATH)) return new Map();
    const raw = fs.readFileSync(SKIP_FLAG_PATH, "utf8");
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
  } catch (err) { 
    console.error(`[reel-runner] failed to load skip flags from ${SKIP_FLAG_PATH}:`, err);
    return new Map(); 
  }
}

function _saveSkipFlags(flags: Map<string, number>): void {
  try { 
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SKIP_FLAG_PATH, JSON.stringify(Object.fromEntries(flags))); 
  } catch (err) { 
    console.error(`[reel-runner] failed to save skip flags to ${SKIP_FLAG_PATH}:`, err);
  }
}

const _skipNextReel = _loadSkipFlags();

export function setSkipNextReel(brandId: string): void {
  _skipNextReel.set(brandId, (_skipNextReel.get(brandId) ?? 0) + 1);
  _saveSkipFlags(_skipNextReel);
}
export function cancelSkipNextReel(brandId: string, all = true): void {
  if (all) {
    _skipNextReel.delete(brandId);
  } else {
    const cur = _skipNextReel.get(brandId) ?? 0;
    if (cur <= 1) _skipNextReel.delete(brandId);
    else _skipNextReel.set(brandId, cur - 1);
  }
  _saveSkipFlags(_skipNextReel);
}
export function isSkipNextReel(brandId: string): number {
  return _skipNextReel.get(brandId) ?? 0;
}
export function consumeSkipNextReel(brandId: string): boolean {
  const count = _skipNextReel.get(brandId) ?? 0;
  if (count <= 0) return false;
  if (count === 1) _skipNextReel.delete(brandId);
  else _skipNextReel.set(brandId, count - 1);
  _saveSkipFlags(_skipNextReel);
  return true;
}

// Cancel flag per brand — checked between stages
const _cancelRequestedBrands = new Set<string>();
export function requestCancelReel(brandId: string): void { _cancelRequestedBrands.add(brandId); }
export function isCancelRequested(brandId: string): boolean { return _cancelRequestedBrands.has(brandId); }

// Global single-slot assembly lock — only one reel assembles at a time (ffmpeg is memory-heavy)
let _assemblyLock = false;
export async function acquireAssemblyLock(): Promise<void> {
  while (_assemblyLock) {
    await new Promise((r) => setTimeout(r, 5000));
  }
  _assemblyLock = true;
}
export function releaseAssemblyLock(): void { _assemblyLock = false; }

// ─── Stage timeouts ────────────────────────────────────────────────────────────
const STAGE_TIMEOUTS_MS: Record<string, number> = {
  "reel-stage0-discover": 5 * 60_000,
  "reel-stage2-script":   3 * 60_000,
  "reel-stage3-voice":    4 * 60_000,
  "reel-stage4-images":  10 * 60_000,
  "reel-stage5-assemble":15 * 60_000,  // 4 segments × ~2min + concat
};

export function resolveStageTimeoutMs(
  name: string,
  ctx?: Pick<ReelContext, "stage5RenderSettings">,
): number {
  if (name === "reel-stage5-assemble" && ctx?.stage5RenderSettings?.timeoutMs) {
    return ctx.stage5RenderSettings.timeoutMs;
  }
  return STAGE_TIMEOUTS_MS[name] ?? 5 * 60_000;
}

async function withTimeout<T>(name: string, ctx: ReelContext, promise: Promise<T>): Promise<T> {
  const ms = resolveStageTimeoutMs(name, ctx);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      const note = ctx.progressNote ? ` (last activity: ${ctx.progressNote})` : "";
      reject(new Error(`Stage "${name}" timed out after ${ms / 1000}s${note}`));
    }, ms)
  );
  return Promise.race([promise, timeout]);
}

export function buildPersistedReelContext(ctx: ReelContext): Record<string, unknown> {
  const inputMode = ctx.manualSourceMode === "text"
    ? "manual_text"
    : ctx.manualSourceMode === "hint"
      ? "manual_hint"
      : ctx.story?.sourceReadMode
        ? "url"
        : "discovery";

  return {
    theme: ctx.theme,
    trendingSignals: ctx.trendingSignals,
    categorySource: ctx.categorySource,
    discoveryBias: ctx.discoveryBias,
    recentTopics: ctx.recentTopics,
    imageSourceMap: ctx.imageSourceMap,
    useStockImages: ctx.useStockImages,
    apiSourceMap: ctx.apiSourceMap,
    musicFile: ctx.musicFile,
    cameraEffect: ctx.cameraEffect,
    cameraPreset: ctx.cameraPreset,
    usedVoiceId: ctx.usedVoiceId,
    usedVoiceProvider: ctx.usedVoiceProvider,
    usedVoiceSpeed: ctx.usedVoiceSpeed,
    usedCameraEffect: ctx.usedCameraEffect,
    usedCameraPreset: ctx.usedCameraPreset,
    stage5Performance: ctx.stage5Performance,
    stage5Renderer: ctx.stage5Renderer,
    stage5Template: ctx.stage5Template,
    stage5RenderSettings: ctx.stage5RenderSettings,
    stage5RenderTelemetry: ctx.stage5RenderTelemetry,
    manualSourceMode: ctx.manualSourceMode,
    manualSourceInput: ctx.manualSourceInput,
    manualSourceTextInputType: ctx.manualSourceTextInputType,
    inputMode,
    manualSourceLabel: ctx.manualSourceInput?.startsWith("http") ? undefined : ctx.manualSourceInput,
    manualTextProvided: Boolean(ctx.manualSourceText),
    sourceReadMode: ctx.story?.sourceReadMode,
    sourceExtractAvailable: ctx.story?.sourceExtractAvailable,
    sourceExtractChars: ctx.story?.sourceExtractChars,
    sourceExtractDownloadUrl: ctx.story?.sourceExtractDownloadUrl,
  };
}

export interface Stage5OverrideOptions {
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
}

export function applyStage5Overrides<T extends Pick<ReelContext, "stage5Renderer" | "stage5Template">>(
  ctx: T,
  overrides: Stage5OverrideOptions,
): T {
  return {
    ...ctx,
    stage5Renderer: overrides.stage5Renderer ?? ctx.stage5Renderer,
    stage5Template: overrides.stage5Template ?? ctx.stage5Template,
  };
}

export function resolveStoredStage5Selection(
  stored: Pick<ReelContext, "stage5Renderer" | "stage5Template">,
  brandConfig: Pick<NonNullable<import("../types.js").ReelConfig>, "stage5Renderer" | "stage5Template"> | undefined,
  overrides: Stage5OverrideOptions,
): Pick<ReelContext, "stage5Renderer" | "stage5Template"> {
  return {
    stage5Renderer: overrides.stage5Renderer ?? brandConfig?.stage5Renderer ?? stored.stage5Renderer,
    stage5Template: overrides.stage5Template ?? brandConfig?.stage5Template ?? stored.stage5Template,
  };
}

export function prepareStage5RenderContext(ctx: ReelContext): ReelContext {
  const stage5Selection = resolveStage5RendererSelection(ctx);
  const selectedCtx = {
    ...ctx,
    stage5Renderer: stage5Selection.renderer,
    stage5Template: stage5Selection.template,
    stage5RenderTelemetry: undefined,
  };
  return { ...selectedCtx, stage5RenderSettings: resolveStage5RenderSettings(selectedCtx) };
}

export async function runReelStage5Boundary(params: {
  runId: string;
  brandId: BrandId;
  persistedContext: Record<string, unknown>;
  runLocalStage5: () => Promise<void>;
  workDir?: string;
  sceneCount?: number;
  gcsPrefix?: string;
  musicFilePath?: string;
  progressState?: ReelProgressState;
}): Promise<"offloaded" | "local"> {
  if (!isReelAssemblyOffloadEnabled()) {
    await params.runLocalStage5();
    return "local";
  }

  const jobId = randomUUID();
  queries.createAssemblyJob({
    id: jobId,
    runId: params.runId,
    brand: params.brandId,
  });

  // Upload scene audio + images + music to GCS so the EC2 worker can download them
  if (params.workDir && params.sceneCount && params.gcsPrefix) {
    const { audioPaths, imagePaths } = reelSceneArtifactPaths(params.workDir, params.sceneCount);
    const gcs = createGcsService();
    for (const filePath of [...audioPaths, ...imagePaths]) {
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        const contentType = filename.endsWith(".mp3") ? "audio/mpeg" : "image/png";
        await gcs.uploadFile(params.gcsPrefix, params.runId, filename, buffer, contentType);
      }
    }
    if (params.musicFilePath && fs.existsSync(params.musicFilePath)) {
      const buffer = fs.readFileSync(params.musicFilePath);
      await gcs.uploadFile(params.gcsPrefix, params.runId, "music.mp3", buffer, "audio/mpeg");
    }
  }

  // Launch EC2 first to capture instanceId, then enqueue so worker knows its own ID
  let instanceId: string | undefined;
  if (canLaunchAssemblyWorker()) {
    const result = await launchAssemblyWorker({ jobId });
    instanceId = result.instanceId;
  }
  queries.updateReel(params.runId, {
    status: "generating",
    currentStage: "reel-stage5-dispatched",
    context: {
      ...params.persistedContext,
      ...(params.progressState ? { _progressState: params.progressState } : {}),
    },
  });

  await enqueueAssemblyJob(buildAssemblyMessage(jobId, params.runId, params.brandId, instanceId));

  return "offloaded";
}

export function markReelStage5Dispatched(ctx: ReelContext): ReelContext {
  return {
    ...ctx,
    status: "running",
    stageLogs: [...ctx.stageLogs, { stage: "reel-stage5-dispatched", status: "ok", durationMs: 0 }],
  };
}

// ─── Telegram progress tracker ────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  "reel-stage0-discover": "Discover story",
  "reel-stage2-script":   "Script",
  "reel-stage3-voice":    "Voice",
  "reel-stage4-images":   "Images",
  "reel-stage5-assemble": "Assemble",
};

export interface ReelProgressState {
  chatId: string;
  msgId: number;
  startTime: number;
  brandName: string;
  reelId: string;
  headline: string;
  stages: Array<{ name: string; label: string; status: string; durationMs?: number }>;
}

export function renderCompletedProgressMessage(
  state: ReelProgressState,
  assemblyDurationMs: number,
  reviewUrl?: string,
): string {
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);
  const lines = [
    `✅ <b>Reel ready — ${state.brandName}</b>`,
    `ID: <code>${state.reelId.slice(0, 8)}</code>  ⏱ ${elapsed}s`,
    ...(state.headline ? [`📰 ${state.headline}`] : []),
    "",
  ];
  for (const s of state.stages) {
    const dot = s.name === "reel-stage5-assemble" ? "✅" : s.status === "ok" ? "✅" : "❌";
    const dur = s.name === "reel-stage5-assemble"
      ? ` (${Math.round(assemblyDurationMs / 1000)}s)`
      : s.durationMs !== undefined ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
    lines.push(`${dot} ${s.label}${dur}`);
  }
  if (reviewUrl) { lines.push(""); lines.push(`🔗 <a href="${reviewUrl}">Review</a>`); }
  return lines.join("\n");
}

class ReelProgress {
  private chatId: string | null = null;
  private msgId: number | null = null;
  private brandName: string;
  private reelId: string;
  private headline: string;
  private stages: Array<{ name: string; label: string; status: "pending" | "running" | "ok" | "error"; durationMs?: number }>;
  private startTime = Date.now();

  constructor(brandName: string, reelId: string, stageNames: string[], headline = "") {
    this.brandName = brandName;
    this.reelId = reelId;
    this.headline = headline;
    this.stages = stageNames.map((name) => ({
      name,
      label: STAGE_LABELS[name] ?? name,
      status: "pending",
    }));
  }

  async init(chatId: string): Promise<void> {
    this.chatId = chatId;
    const telegram = createTelegramService();
    this.msgId = await telegram.sendMessageWithId(chatId, this.render("running"));
  }

  stageStart(name: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) s.status = "running";
    this.pushUpdate("running");
  }

  stageEnd(name: string, durationMs: number, error?: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) { s.status = error ? "error" : "ok"; s.durationMs = durationMs; }
    this.pushUpdate(error ? "running" : "running");
  }

  async finish(reviewUrl?: string): Promise<void> {
    await this.pushUpdateAsync("done", reviewUrl);
  }

  async fail(stageName: string, error: string): Promise<void> {
    const s = this.stages.find((s) => s.name === stageName);
    if (s) s.status = "error";
    await this.pushUpdateAsync("failed", undefined, error);
  }

  getState(): ReelProgressState | null {
    if (!this.chatId || this.msgId === null) return null;
    return {
      chatId: this.chatId,
      msgId: this.msgId,
      startTime: this.startTime,
      brandName: this.brandName,
      reelId: this.reelId,
      headline: this.headline,
      stages: this.stages.map(s => ({ name: s.name, label: s.label, status: s.status, durationMs: s.durationMs })),
    };
  }

  private render(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): string {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const icon = state === "done" ? "✅" : state === "failed" ? "❌" : "⏳";
    const lines = [
      `${icon} <b>Reel ${state === "done" ? "ready" : state === "failed" ? "failed" : "in progress"} — ${this.brandName}</b>`,
      `ID: <code>${this.reelId.slice(0, 8)}</code>  ⏱ ${elapsed}s`,
      ...(this.headline ? [`📰 ${this.headline}`] : []),
      "",
    ];
    for (const s of this.stages) {
      const dot = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : s.status === "running" ? "⏳" : "◻️";
      const dur = s.durationMs !== undefined ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
      lines.push(`${dot} ${s.label}${dur}`);
    }
    if (reviewUrl) { lines.push(""); lines.push(`🔗 <a href="${reviewUrl}">Review</a>`); }
    if (errorMsg) { lines.push(""); lines.push(`⚠️ <code>${errorMsg.slice(0, 200)}</code>`); }
    return lines.join("\n");
  }

  private pushUpdate(state: "running" | "done" | "failed"): void {
    this.pushUpdateAsync(state).catch(() => {});
  }

  private async pushUpdateAsync(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): Promise<void> {
    if (!this.chatId || !this.msgId) return;
    const telegram = createTelegramService();
    await telegram.editMessage(this.chatId, this.msgId, this.render(state, reviewUrl, errorMsg));
  }
}

export async function notifyReelReady(brand: ReturnType<typeof getBrand>, ctx: ReelContext): Promise<void> {
  const shortId = ctx.runId.slice(0, 8);
  const headline = ctx.story?.headline ?? "";
  const catEmoji: Record<string, string> = {
    breaking: "🔴", trending: "📈", human_interest: "❤️", business: "💼", open: "🎯",
  };
  const emoji = ctx.category ? (catEmoji[ctx.category] ?? "🎬") : "🎬";
  const lines = [
    `✅ Reel ready for review — ${brand.name}`,
    `${emoji} ${headline}`,
    `🆔 <code>${shortId}</code>`,
    ...(ctx.reviewUrl ? [`🔗 <a href="${ctx.reviewUrl}">Review</a>`] : []),
  ];
  const msg = lines.join("\n");
  const telegram = createTelegramService();
  const line = createLineService();
  const channels = getEnabledChannels(brand, telegram, line);
  await Promise.all(channels.map((ch) => ch.send(msg).catch(() => {})));
}

export async function notifyReelAwaitingScriptConfirmation(brand: ReturnType<typeof getBrand>, ctx: ReelContext): Promise<void> {
  const shortId = ctx.runId.slice(0, 8);
  const headline = ctx.story?.headline ?? "";
  const sourceUrl = ctx.story?.sourceUrl ?? "";
  const lines = [
    `🛑 Reel paused before script stage — ${brand.name}`,
    `📰 ${headline}`,
    `🆔 <code>${shortId}</code>`,
    ...(sourceUrl ? [`🔗 <a href="${sourceUrl}">Source link</a>`] : []),
    "",
    `Reply <code>!reel confirm ${shortId}</code> to continue`,
    `or <code>!reel confirm ${shortId} &lt;category&gt;</code> to set category`,
    `or <code>!reel reject ${shortId}</code> to cancel`,
  ];
  const msg = lines.join("\n");
  const telegram = createTelegramService();
  const line = createLineService();
  const channels = getEnabledChannels(brand, telegram, line);
  await Promise.all(channels.map((ch) => ch.send(msg).catch(() => {})));
}

export async function fetchStory(
  ctx: ReelContext,
  options: ReelRunOptions,
  categoryBias?: string,
  recentTopics?: string[],
  reelRecentUrls?: string[],
): Promise<FetchStoryResult> {
  const services = {
    search: createSearchService(),
    bedrock: createBedrockService(),
    gemini: createGeminiService(),
    imageGen: createImageGenService(),
    stockImage: createStockImageService(),
    gcs: createGcsService(),
    telegram: createTelegramService(),
    line: createLineService(),
    meta: createMetaService(),
  };

  if (options.manualSourceMode === "text") {
    const sourceInput = options.manualSourceInput?.trim();
    const sourceText = options.manualSourceText?.trim();
    if (!sourceInput) throw new Error("Manual text mode requires source input");
    if (!sourceText) throw new Error("Manual text mode requires source text");

    const source = (() => {
      if (!sourceInput.startsWith("http")) return sourceInput;
      try { return new URL(sourceInput).hostname.replace("www.", ""); } catch { return sourceInput; }
    })();

    return {
      story: {
        index: 0,
        headline: sourceText.slice(0, 120),
        source,
        sourceUrl: sourceInput,
        snippet: sourceText,
        selectionReason: "Operator-provided manual text source",
        compositeScore: 0,
        verified: false,
      },
    };
  }

  if (options.sourceUrls?.length) {
    // URL source — reuse Stage0FromUrl to get a story from the URL
    const { Stage0FromUrl } = await import("../stages/stage0-from-url.js");
    const stage = new Stage0FromUrl(options.sourceUrls);

    const runCtx: RunContext = {
      runId: ctx.runId,
      brand: ctx.brand,
      runDate: ctx.runDate,
      theme: ctx.theme,
      stories: [],
      posts: [],
      stageLogs: [],
      status: "running",
    };

    const result = await stage.run(runCtx, services);
    const story = result.stories?.[0];
    if (!story) throw new Error("Stage0FromUrl returned no stories");

    if (story.sourceExtractText && story.sourceReadMode === "tavily_extract") {
      try {
        const downloadUrl = await services.gcs.uploadFile(
          ctx.brand.gcsPrefix,
          ctx.runId,
          "source-extract.txt",
          Buffer.from(story.sourceExtractText, "utf8"),
          "text/plain; charset=utf-8",
        );
        story.sourceExtractDownloadUrl = downloadUrl;
      } catch (err) {
        console.warn(`  [stage0-from-url] failed to upload source extract: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { story };
  }

  // Discovery — run Stage1Discover
  const { Stage1Discover } = await import("../stages/stage1-discover.js");

  let runCtx: RunContext = {
    runId: ctx.runId,
    brand: ctx.brand,
    runDate: ctx.runDate,
    theme: ctx.theme,
    reelCategoryBias: categoryBias,
    manualSourceHintText: options.manualSourceMode === "hint" ? options.manualSourceText : undefined,
    excludedTopics: recentTopics,
    reelRecentUrls,
    stories: [],
    posts: [],
    stageLogs: [],
    status: "running",
  };

  const discoverResult = await new Stage1Discover().run(runCtx, services);
  runCtx = { ...runCtx, ...discoverResult } as RunContext;

  const story = runCtx.stories[0];
  if (!story) throw new Error("Discovery returned no stories");
  return {
    story,
    trendingSignals: runCtx.trendingSignals,
  };
}

export class ReelRunner {
  static async run(brandId: BrandId, options: ReelRunOptions = {}): Promise<ReelContext> {
    const brand = getBrand(brandId);

    if (!brand.reels?.enabled) {
      throw new Error(`Reels are not enabled for brand ${brandId}. Add reels config to brand.`);
    }

    const runDate = new Date().toLocaleDateString("en-CA", { timeZone: brand.timezone });
    const runId = randomUUID();

    if (_activeReelBrands.has(brandId)) {
      throw new Error(`A reel is already being generated for ${brandId}`);
    }
    if (queries.getBlockingReelCount(brandId) > 0) {
      throw new Error(`A reel for ${brandId} is already active or awaiting script confirmation (DB guard)`);
    }
    if (!queries.acquireReelStartLock(brandId, runId, 30)) {
      throw new Error(`A reel for ${brandId} is already starting (DB lock)`);
    }
    let releaseStartLock = true;
    _activeReelBrands.add(brandId);

    const workDir = reelWorkDir(runId);
    try {
      fs.mkdirSync(workDir, { recursive: true });
    } catch (err) {
      queries.releaseReelStartLock(brandId, runId);
      _activeReelBrands.delete(brandId);
      throw err;
    }

    let ctx: ReelContext = {
      runId,
      brand,
      runDate,
      workDir,
      theme: options.theme,
      category: options.category,
      cameraEffect: options.cameraEffect,
      cameraPreset: options.cameraPreset,
      manualSourceMode: options.manualSourceMode,
      manualSourceInput: options.manualSourceInput,
      manualSourceText: options.manualSourceText,
      manualSourceTextInputType: options.manualSourceTextInputType,
      status: "running",
      stageLogs: [],
      useStockImages: options.useStockImages ?? brand.useStockImages,
      stage5Performance: brand.reels?.stage5Performance,
      stage5Renderer: options.stage5Renderer,
      stage5Template: options.stage5Template,
    };
    let reelRecordCreated = false;

    if (options.sourceUrls?.length) {
      queries.createReel({
        id: runId,
        brand: brandId,
        runDate,
        headline: "Starting URL reel",
        sourceUrl: options.sourceUrls[0],
        snippet: "",
        context: JSON.stringify({
          useStockImages: ctx.useStockImages,
          stage5Performance: ctx.stage5Performance,
          stage5Renderer: ctx.stage5Renderer,
          stage5Template: ctx.stage5Template,
          inputMode: "url",
        }),
      });
      reelRecordCreated = true;
    }

    console.log(`\n[ReelRunner] brand=${brandId} runId=${runId} date=${runDate} workDir=${workDir}`);

    try {
      // ── Stage 0: Fetch story ────────────────────────────────────────────────
      console.log("\n[reel-stage0-fetch] Fetching story...");
      const { CATEGORY_RULES } = await import("../stages/reel-stage2-script.js");
      const categoryBias = options.category ? CATEGORY_RULES[options.category].discoveryBias : undefined;
      const recentReelInfo = queries.getRecentReelInfo(brandId, 20);
      const recentReelUrls = new Set(recentReelInfo.map((r) => r.sourceUrl));
      const recentTopics = [
        ...recentReelInfo.map((r) => r.headline),
        ...queries.getRecentPostHeadlines(brandId, 20),
      ];
      if (recentTopics.length) {
        console.log(`  Recent reel topics (avoiding): ${recentTopics.slice(0, 3).map((h) => h.slice(0, 50)).join(" | ")}`);
      }
      const fetchResult = await fetchStory(ctx, options, categoryBias, recentTopics, Array.from(recentReelUrls));

      // Hard server-side URL dedup check — skip for manual runs (text input or explicit URL)
      const isManualRun = !!options.manualSourceMode || !!options.sourceUrls?.length;
      if (!isManualRun && recentReelUrls.has(fetchResult.story.sourceUrl)) {
        throw new Error(formatRecentDuplicateStoryError(fetchResult.story));
      }

      ctx = {
        ...ctx,
        story:           fetchResult.story,
        theme:           ctx.theme ?? (fetchResult.story.theme ? (fetchResult.story.theme as import("../types.js").Theme) : undefined),
        trendingSignals: fetchResult.trendingSignals,
        categorySource:  options.categorySource,
        discoveryBias:   categoryBias,
        recentTopics,
      };
      console.log(`  Story: "${fetchResult.story.headline}" (${fetchResult.story.source})`);

      const reelRecord = {
        headline: fetchResult.story.headline,
        sourceUrl: fetchResult.story.sourceUrl,
        snippet: fetchResult.story.snippet.slice(0, 4000),
        context: JSON.stringify({
          theme:           ctx.theme,
          trendingSignals: fetchResult.trendingSignals,
          categorySource:  options.categorySource,
          discoveryBias:   categoryBias,
          recentTopics:    recentTopics,
          useStockImages:  ctx.useStockImages,
          stage5Performance: ctx.stage5Performance,
          stage5Renderer: ctx.stage5Renderer,
          stage5Template: ctx.stage5Template,
          inputMode: options.manualSourceMode === "text" ? "manual_text" : options.manualSourceMode === "hint" ? "manual_hint" : options.sourceUrls?.length ? "url" : "discovery",
          manualSourceLabel: options.manualSourceInput?.startsWith("http") ? undefined : options.manualSourceInput,
          manualTextProvided: Boolean(options.manualSourceText),
          manualTextInputType: options.manualSourceTextInputType,
          sourceReadMode: fetchResult.story.sourceReadMode,
          sourceExtractAvailable: fetchResult.story.sourceExtractAvailable,
          sourceExtractChars: fetchResult.story.sourceExtractChars,
          sourceExtractDownloadUrl: fetchResult.story.sourceExtractDownloadUrl,
        }),
      };

      if (reelRecordCreated) {
        queries.updateReel(runId, {
          headline: reelRecord.headline,
          sourceUrl: reelRecord.sourceUrl,
          snippet: reelRecord.snippet,
          context: JSON.parse(reelRecord.context),
        });
      } else {
        queries.createReel({
          id: runId,
          brand: brandId,
          runDate,
          ...reelRecord,
        });
      }

      if (options.dryRun) {
        console.log("\n[ReelRunner] dry-run — stopping after story fetch");
        if (releaseStartLock) queries.releaseReelStartLock(brandId, runId);
        _activeReelBrands.delete(brandId);
        return ctx;
      }

      const needsScriptConfirmation = !(options.sourceUrls?.length);
      if (needsScriptConfirmation) {
        queries.updateReel(runId, { status: "awaiting_script_confirmation", currentStage: null });
        await notifyReelAwaitingScriptConfirmation(brand, ctx);
        if (releaseStartLock) queries.releaseReelStartLock(brandId, runId);
        releaseStartLock = false;
        _activeReelBrands.delete(brandId);
        console.log(`\n⏸ ReelRunner paused — awaiting script confirmation`);
        return ctx;
      }

      // ── Reel stages ─────────────────────────────────────────────────────────
      const { ReelStage2Script } = await import("../stages/reel-stage2-script.js");
      const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
      const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");

      const stageNames = ["reel-stage2-script", "reel-stage3-voice", "reel-stage4-images", "reel-stage5-assemble"];
      const progress = new ReelProgress(brand.name, runId, stageNames, fetchResult.story.headline);

      // Initialise progress message in Telegram
      const tgConfig = brand.channels.telegram;
      let tgChatIdEnvVar: string | undefined;
      if (tgConfig?.enabled) tgChatIdEnvVar = tgConfig?.chatIdEnvVar;
      const chatId = tgChatIdEnvVar ? process.env[String(tgChatIdEnvVar)] : undefined;
      if (chatId) await progress.init(chatId as string);

      const lightStages = [new ReelStage2Script(), new ReelStage3Voice()];
      const stage4 = new ReelStage4Images();
      const stage5 = new ReelStage5Facade();

      const runStage = async (stage: import("../types.js").ReelStage) => {
        if (isCancelRequested(brandId)) {
          _cancelRequestedBrands.delete(brandId);
          queries.updateReel(runId, { status: "cancelled", currentStage: null });
          await progress.fail(stage.name, "Cancelled by user");
          throw new Error("Reel cancelled by user");
        }
        console.log(`\n[${stage.name}]`);
        const t0 = Date.now();
        queries.updateReel(runId, { currentStage: stage.name });
        progress.stageStart(stage.name);
        try {
          const patch = await withTimeout(stage.name, ctx, stage.run(ctx));
          ctx = { ...ctx, ...patch };
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "ok", durationMs });
          progress.stageEnd(stage.name, durationMs);
          if (stage.name === "reel-stage2-script" && ctx.script) {
            queries.updateReel(runId, { script: ctx.script, category: ctx.category });
          }
          // Save after stage2 so wordTimings + durationSeconds are persisted for future resumes
          if (stage.name === "reel-stage3-voice" && ctx.script) {
            queries.updateReel(runId, { script: ctx.script, context: buildPersistedReelContext(ctx) });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "error", durationMs, error: msg });
          await progress.fail(stage.name, msg);
          throw err;
        }
      };

      // Stages 1-2: run freely (API calls, low memory)
      for (const stage of lightStages) await runStage(stage);

      // Stages 3-4: acquire global lock — only one reel does image gen + ffmpeg at a time
      console.log(`\n[assembly-lock] waiting for slot...`);
      await acquireAssemblyLock();
      let stage5Mode: "offloaded" | "local" = "local";
      console.log(`[assembly-lock] acquired`);
      try {
        await runStage(stage4);
        ctx = prepareStage5RenderContext(ctx);
        stage5Mode = await runReelStage5Boundary({
          runId,
          brandId,
          persistedContext: buildPersistedReelContext(ctx),
          runLocalStage5: async () => {
            await runStage(stage5);
          },
          workDir: ctx.workDir,
          sceneCount: ctx.script?.scenes.length ?? 0,
          gcsPrefix: ctx.brand.gcsPrefix,
          musicFilePath: resolveStage5MusicUploadPath(ctx),
          progressState: chatId ? progress.getState() ?? undefined : undefined,
        });
      } finally {
        releaseAssemblyLock();
        console.log(`[assembly-lock] released`);
      }

      if (stage5Mode === "offloaded") {
        console.log("\n[ReelRunner] stage5 assembly dispatched to offload worker");
        ctx = markReelStage5Dispatched(ctx);
        if (releaseStartLock) queries.releaseReelStartLock(brandId, runId);
        _activeReelBrands.delete(brandId);
        return ctx;
      }

      // Persist script, category, video URL, and discovery context to DB
      queries.updateReel(runId, {
        script: ctx.script,
        category: ctx.category,
        videoGcsUrl: ctx.videoGcsUrl,
        context: buildPersistedReelContext(ctx),
        status: "awaiting_approval",
        currentStage: null,
      });

      // ── Review URL ──────────────────────────────────────────────────────────
      const reviewUrl = `${process.env.PIPELINE_BASE_URL!}/review/reel/${runId}`;
      ctx = { ...ctx, reviewUrl };
      queries.updateReel(runId, { reviewUrl, status: "awaiting_approval" });
      console.log(`  Review: ${reviewUrl}`);

      // ── Finish progress + start approval watcher ────────────────────────────
      if (chatId) await progress.finish(reviewUrl);
      await notifyReelReady(brand, ctx);

      ctx.status = "awaiting_approval";
      console.log(`\n✅ ReelRunner done — status=${ctx.status}`);
      if (releaseStartLock) queries.releaseReelStartLock(brandId, runId);
      _activeReelBrands.delete(brandId);
      return ctx;

    } catch (err) {
      if (releaseStartLock) queries.releaseReelStartLock(brandId, runId);
      _activeReelBrands.delete(brandId);
      _cancelRequestedBrands.delete(brandId);
      const isCancelled = err instanceof Error && err.message === "Reel cancelled by user";
      if (!isCancelled) queries.updateReel(runId, { status: "failed", currentStage: null });
      console.error("[ReelRunner] failed:", err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  static async confirm(reelId: string, brandId: BrandId, useStockImagesOverride?: boolean, stage5Overrides: Stage5OverrideOptions = {}, categoryOverride?: ReelCategory): Promise<void> {
    const reel = queries.getReelById(reelId);
    if (!reel) throw new Error(`Reel ${reelId} not found`);
    if (reel.brand !== brandId) throw new Error(`Reel ${reelId} does not belong to brand ${brandId}`);
    if (reel.status !== "awaiting_script_confirmation") {
      throw new Error(`Reel ${reel.id.slice(0, 8)} is not awaiting confirmation (status=${reel.status})`);
    }
    await ReelRunner.rerescript(reelId, brandId, categoryOverride, useStockImagesOverride, undefined, stage5Overrides);
  }

  // Re-run stages 1-4 for an existing reel (e.g. to change category)
  static async rerescript(reelId: string, brandId: BrandId, forcedCategory?: ReelCategory, useStockImagesOverride?: boolean, cameraEffectOverride?: import("../types.js").CameraEffectType, stage5Overrides: Stage5OverrideOptions = {}): Promise<void> {
    const brand = getBrand(brandId);
    const reel = queries.getReelById(reelId);
    if (!reel) throw new Error(`Reel ${reelId} not found`);
    if (reel.brand !== brandId) throw new Error(`Reel ${reelId} does not belong to brand ${brandId}`);

    if (_activeReelBrands.has(brandId)) throw new Error(`A reel is already running for ${brandId}`);
    _activeReelBrands.add(brandId);

    console.log(`\n[ReelRunner.rerescript] reelId=${reelId} brand=${brandId} category=${forcedCategory ?? "auto"} effect=${cameraEffectOverride ?? "auto"}`);

    // Reconstruct context from stored DB data
    const workDir = reelWorkDir(reelId);
    fs.mkdirSync(workDir, { recursive: true });
    let ctx: ReelContext = {
      runId: reel.id,
      brand,
      runDate: reel.runDate,
      workDir,
      category: forcedCategory ?? (reel.category as ReelCategory | undefined),
      categorySource: "rerescript" as const,
      cameraEffect: cameraEffectOverride,
      cameraPreset: undefined,
      story: {
        index: 0,
        headline: reel.headline,
        source: (() => { try { return new URL(reel.sourceUrl).hostname; } catch { return reel.sourceUrl; } })(),
        sourceUrl: reel.sourceUrl,
        snippet: reel.snippet ?? "",
        selectionReason: "",
        compositeScore: 0,
        verified: false,
      },
      status: "running",
      stageLogs: [],
    };

    // Restore discovery context if present
    if (reel.context) {
      try {
        const stored = JSON.parse(reel.context) as {
          trendingSignals?: TrendingSignals;
          categorySource?: string;
          discoveryBias?: string;
          recentTopics?: string[];
          imageSourceMap?: Record<number, ImageSource>;
          useStockImages?: boolean;
          apiSourceMap?: import("../types.js").ApiSourceMap;
          cameraEffect?: import("../types.js").CameraEffectType;
          cameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedCameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedVoiceId?: string;
          usedVoiceProvider?: string;
          usedVoiceSpeed?: number;
          stage5Performance?: import("../stages/reel-stage5-performance.js").Stage5PerformanceConfig;
          stage5Renderer?: ReelContext["stage5Renderer"];
          stage5Template?: ReelContext["stage5Template"];
          stage5RenderSettings?: ReelContext["stage5RenderSettings"];
          stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
        };
        ctx = {
          ...ctx,
          trendingSignals: stored.trendingSignals,
          discoveryBias: stored.discoveryBias,
          recentTopics: stored.recentTopics,
          imageSourceMap: stored.imageSourceMap,
          useStockImages: useStockImagesOverride ?? stored.useStockImages,
          apiSourceMap: stored.apiSourceMap,
          cameraEffect: stored.cameraEffect,
          cameraPreset: stored.cameraPreset,
          usedCameraPreset: stored.usedCameraPreset,
          usedVoiceId: stored.usedVoiceId,
          usedVoiceProvider: stored.usedVoiceProvider,
          usedVoiceSpeed: stored.usedVoiceSpeed,
          stage5Performance: stored.stage5Performance,
          ...resolveStoredStage5Selection(stored, brand.reels, stage5Overrides),
          stage5RenderSettings: stored.stage5RenderSettings,
          stage5RenderTelemetry: stored.stage5RenderTelemetry,
        };
      } catch { /* ignore */ }
    }

    ctx = applyStage5Overrides(ctx, stage5Overrides);

    if (cameraEffectOverride) ctx.cameraEffect = cameraEffectOverride;
    if (reel.script) {
      try { ctx.previousScript = JSON.parse(reel.script) as import("../types.js").ReelScript; } catch { /* ignore */ }
    }

    queries.updateReel(reelId, { status: "generating", currentStage: "reel-stage2-script" });

    const tgConfig = brand.channels.telegram;
    const chatId = tgConfig && tgConfig.enabled ? (process.env[tgConfig.chatIdEnvVar] ?? null) : null;
    const stageNames = ["reel-stage2-script", "reel-stage3-voice", "reel-stage4-images", "reel-stage5-assemble"];
    const progress = new ReelProgress(brand.name, reelId, stageNames);
    if (chatId) await progress.init(chatId);

    try {
      const { ReelStage2Script } = await import("../stages/reel-stage2-script.js");
      const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
      const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");

      const lightStages = [new ReelStage2Script(), new ReelStage3Voice()];
      const stage4 = new ReelStage4Images();
      const stage5 = new ReelStage5Facade();

      const runStage = async (stage: import("../types.js").ReelStage) => {
        console.log(`\n[${stage.name}]`);
        const t0 = Date.now();
        queries.updateReel(reelId, { currentStage: stage.name });
        progress.stageStart(stage.name);
        try {
          const patch = await withTimeout(stage.name, ctx, stage.run(ctx));
          ctx = { ...ctx, ...patch };
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "ok", durationMs });
          progress.stageEnd(stage.name, durationMs);
          if (stage.name === "reel-stage3-voice" && ctx.script) {
            queries.updateReel(reelId, { script: ctx.script, context: buildPersistedReelContext(ctx) });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.stageLogs.push({ stage: stage.name, status: "error", durationMs: Date.now() - t0, error: msg });
          await progress.fail(stage.name, msg);
          throw err;
        }
      };

      for (const stage of lightStages) await runStage(stage);

      console.log(`\n[assembly-lock:rerescript] waiting for slot...`);
      await acquireAssemblyLock();
      let stage5Mode: "offloaded" | "local" = "local";
      console.log(`[assembly-lock:rerescript] acquired`);
      try {
        await runStage(stage4);
        ctx = prepareStage5RenderContext(ctx);
        stage5Mode = await runReelStage5Boundary({
          runId: reelId,
          brandId,
          persistedContext: buildPersistedReelContext(ctx),
          runLocalStage5: async () => {
            await runStage(stage5);
          },
          workDir: ctx.workDir,
          sceneCount: ctx.script?.scenes.length ?? 0,
          gcsPrefix: ctx.brand.gcsPrefix,
          musicFilePath: resolveStage5MusicUploadPath(ctx),
          progressState: chatId ? progress.getState() ?? undefined : undefined,
        });
      } finally {
        releaseAssemblyLock();
        console.log(`[assembly-lock:rerescript] released`);
      }

      if (stage5Mode === "offloaded") {
        console.log("\n[ReelRunner.rerescript] stage5 assembly dispatched to offload worker");
        _activeReelBrands.delete(brandId);
        return;
      }

      queries.updateReel(reelId, {
        script: ctx.script,
        category: ctx.category,
        videoGcsUrl: ctx.videoGcsUrl,
        context: buildPersistedReelContext(ctx),
        status: "awaiting_approval",
        currentStage: null,
      });

      const reviewUrl = `${process.env.PIPELINE_BASE_URL!}/review/reel/${reelId}`;
      ctx = { ...ctx, reviewUrl };
      queries.updateReel(reelId, { reviewUrl, status: "awaiting_approval" });
      console.log(`  Review: ${reviewUrl}`);

      if (chatId) await progress.finish(reviewUrl);
      await notifyReelReady(brand, ctx);
      _activeReelBrands.delete(brandId);
      console.log(`\n✅ ReelRunner.rerescript done`);

    } catch (err) {
      _activeReelBrands.delete(brandId);
      queries.updateReel(reelId, { status: "failed", currentStage: null });
      console.error("[ReelRunner.rerescript] failed:", err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  // Smart resume — detects completed stages from work dir and skips them.
  // Checks in order: script (DB) → audio files → image files → video (GCS).
  // Only runs stages whose output is missing.
  static async resume(reelId: string, brandId: BrandId, useStockImagesOverride?: boolean, stage5Overrides: Stage5OverrideOptions = {}): Promise<void> {
    const brand = getBrand(brandId);
    const reel = queries.getReelById(reelId);
    if (!reel) throw new Error(`Reel ${reelId} not found`);
    if (reel.brand !== brandId) throw new Error(`Reel ${reelId} does not belong to brand ${brandId}`);
    if (!reel.script) throw new Error(`Reel ${reelId} has no script — cannot resume (use rerescript)`);

    if (_activeReelBrands.has(brandId)) throw new Error(`A reel is already running for ${brandId}`);
    _activeReelBrands.add(brandId);

    const workDir = reelWorkDir(reelId);
    fs.mkdirSync(workDir, { recursive: true });

    const sceneCount = brand.reels?.sceneCount ?? 4;
    const audioFiles = Array.from({ length: sceneCount }, (_, i) =>
      path.join(workDir, `scene${i + 1}.mp3`));
    const imageFiles = Array.from({ length: sceneCount }, (_, i) =>
      path.join(workDir, `scene${i + 1}.png`));

    const hasAudio  = audioFiles.every((f) => fs.existsSync(f));
    const hasImages = imageFiles.every((f) => fs.existsSync(f));
    const hasVideo  = Boolean(reel.videoGcsUrl);

    if (hasVideo) {
      _activeReelBrands.delete(brandId);
      throw new Error(`Reel ${reelId.slice(0, 8)} already has a video — use !reel rebuild to re-generate`);
    }

    const skipStages = new Set<string>();
    if (hasAudio)  { skipStages.add("reel-stage3-voice");  console.log(`  ✓ Skipping stage 2 — audio found (${sceneCount} files)`); }
    if (hasImages) { skipStages.add("reel-stage4-images"); console.log(`  ✓ Skipping stage 3 — images found (${sceneCount} files)`); }

    console.log(`\n[ReelRunner.resume] reelId=${reelId.slice(0, 8)} brand=${brandId} skip=[${[...skipStages].join(",")}]`);

    let ctx: ReelContext = {
      runId: reel.id,
      brand,
      runDate: reel.runDate,
      workDir,
      category: reel.category as ReelCategory | undefined,
      story: {
        index: 0,
        headline: reel.headline,
        source: (() => { try { return new URL(reel.sourceUrl).hostname; } catch { return reel.sourceUrl; } })(),
        sourceUrl: reel.sourceUrl,
        snippet: reel.snippet ?? "",
        selectionReason: "",
        compositeScore: 0,
        verified: false,
      },
      script: JSON.parse(reel.script) as import("../types.js").ReelScript,
      // Pre-populate paths for any stages we're skipping
      audioPaths: hasAudio  ? audioFiles : undefined,
      imagePaths: hasImages ? imageFiles : undefined,
      status: "running",
      stageLogs: [],
    };

    // Restore discovery context if present
    if (reel.context) {
      try {
        const stored = JSON.parse(reel.context) as {
          trendingSignals?: TrendingSignals;
          categorySource?: CategorySource;
          discoveryBias?: string;
          recentTopics?: string[];
          imageSourceMap?: Record<number, ImageSource>;
          useStockImages?: boolean;
          apiSourceMap?: import("../types.js").ApiSourceMap;
          cameraEffect?: import("../types.js").CameraEffectType;
          cameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedCameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedVoiceId?: string;
          usedVoiceProvider?: string;
          usedVoiceSpeed?: number;
          usedCameraEffect?: import("../types.js").CameraEffectType;
          stage5Performance?: import("../stages/reel-stage5-performance.js").Stage5PerformanceConfig;
          stage5Renderer?: ReelContext["stage5Renderer"];
          stage5Template?: ReelContext["stage5Template"];
          stage5RenderSettings?: ReelContext["stage5RenderSettings"];
          stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
        };
        ctx = {
          ...ctx,
          trendingSignals: stored.trendingSignals,
          categorySource: stored.categorySource,
          discoveryBias: stored.discoveryBias,
          recentTopics: stored.recentTopics,
          imageSourceMap: stored.imageSourceMap,
          useStockImages: useStockImagesOverride ?? stored.useStockImages,
          apiSourceMap: stored.apiSourceMap,
          cameraEffect: stored.cameraEffect,
          cameraPreset: stored.cameraPreset,
          usedCameraPreset: stored.usedCameraPreset,
          usedVoiceId: stored.usedVoiceId,
          usedVoiceProvider: stored.usedVoiceProvider,
          usedVoiceSpeed: stored.usedVoiceSpeed,
          usedCameraEffect: stored.usedCameraEffect,
          stage5Performance: stored.stage5Performance,
          ...resolveStoredStage5Selection(stored, brand.reels, stage5Overrides),
          stage5RenderSettings: stored.stage5RenderSettings,
          stage5RenderTelemetry: stored.stage5RenderTelemetry,
        };
      } catch {
        /* ignore malformed context */
      }
    }

    ctx = applyStage5Overrides(ctx, stage5Overrides);

    const allStageNames = ["reel-stage3-voice", "reel-stage4-images", "reel-stage5-assemble"];
    const pendingStageNames = allStageNames.filter((s) => !skipStages.has(s));
    queries.updateReel(reelId, { status: "generating", currentStage: pendingStageNames[0] ?? "reel-stage3-voice" });

    const tgConfig = brand.channels.telegram;
    const chatId = tgConfig && tgConfig.enabled ? (process.env[tgConfig.chatIdEnvVar] ?? null) : null;
    const progress = new ReelProgress(brand.name, reelId, pendingStageNames);
    if (chatId) await progress.init(chatId);

    try {
      const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
      const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");

      const runStage = async (stage: import("../types.js").ReelStage) => {
        if (skipStages.has(stage.name)) return;
        console.log(`\n[${stage.name}]`);
        const t0 = Date.now();
        queries.updateReel(reelId, { currentStage: stage.name });
        progress.stageStart(stage.name);
        try {
          const patch = await withTimeout(stage.name, ctx, stage.run(ctx));
          ctx = { ...ctx, ...patch };
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "ok", durationMs });
          progress.stageEnd(stage.name, durationMs);
          if (stage.name === "reel-stage3-voice" && ctx.script) {
            queries.updateReel(reelId, { script: ctx.script, context: buildPersistedReelContext(ctx) });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.stageLogs.push({ stage: stage.name, status: "error", durationMs: Date.now() - t0, error: msg });
          await progress.fail(stage.name, msg);
          throw err;
        }
      };

      await runStage(new ReelStage3Voice());

      console.log(`\n[assembly-lock:resume] waiting for slot...`);
      await acquireAssemblyLock();
      let stage5Mode: "offloaded" | "local" = "local";
      console.log(`[assembly-lock:resume] acquired`);
      try {
        await runStage(new ReelStage4Images());
        ctx = prepareStage5RenderContext(ctx);
        stage5Mode = await runReelStage5Boundary({
          runId: reelId,
          brandId,
          persistedContext: buildPersistedReelContext(ctx),
          runLocalStage5: async () => {
            await runStage(new ReelStage5Facade());
          },
          workDir: ctx.workDir,
          sceneCount: ctx.script?.scenes.length ?? 0,
          gcsPrefix: ctx.brand.gcsPrefix,
          musicFilePath: resolveStage5MusicUploadPath(ctx),
          progressState: chatId ? progress.getState() ?? undefined : undefined,
        });
      } finally {
        releaseAssemblyLock();
        console.log(`[assembly-lock:resume] released`);
      }

      if (stage5Mode === "offloaded") {
        console.log("\n[ReelRunner.resume] stage5 assembly dispatched to offload worker");
        _activeReelBrands.delete(brandId);
        return;
      }

      queries.updateReel(reelId, {
        script: ctx.script,
        videoGcsUrl: ctx.videoGcsUrl,
        context: buildPersistedReelContext(ctx),
        status: "awaiting_approval",
        currentStage: null,
      });

      const reviewUrl = `${process.env.PIPELINE_BASE_URL!}/review/reel/${reelId}`;
      ctx = { ...ctx, reviewUrl };
      queries.updateReel(reelId, { reviewUrl });
      console.log(`  Review: ${reviewUrl}`);

      if (chatId) await progress.finish(reviewUrl);
      await notifyReelReady(brand, ctx);
      _activeReelBrands.delete(brandId);
      console.log(`\n✅ ReelRunner.resume done`);

    } catch (err) {
      _activeReelBrands.delete(brandId);
      queries.updateReel(reelId, { status: "failed", currentStage: null });
      console.error("[ReelRunner.resume] failed:", err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  // rebuild — always re-run stages 2-4 from scratch, ignoring any cached files
  static async rebuild(reelId: string, brandId: BrandId, useStockImagesOverride?: boolean, stage5Overrides: Stage5OverrideOptions = {}): Promise<void> {
    const brand = getBrand(brandId);
    const reel = queries.getReelById(reelId);
    if (!reel) throw new Error(`Reel ${reelId} not found`);
    if (reel.brand !== brandId) throw new Error(`Reel ${reelId} does not belong to brand ${brandId}`);
    if (!reel.script) throw new Error(`Reel ${reelId} has no stored script`);

    if (_activeReelBrands.has(brandId)) throw new Error(`A reel is already running for ${brandId}`);
    _activeReelBrands.add(brandId);

    const workDir = reelWorkDir(reelId);
    fs.mkdirSync(workDir, { recursive: true });

    console.log(`\n[ReelRunner.rebuild] reelId=${reelId.slice(0, 8)} brand=${brandId} (force re-run stages 2-4)`);

    let ctx: ReelContext = {
      runId: reel.id,
      brand,
      runDate: reel.runDate,
      workDir,
      category: reel.category as ReelCategory | undefined,
      story: {
        index: 0,
        headline: reel.headline,
        source: (() => { try { return new URL(reel.sourceUrl).hostname; } catch { return reel.sourceUrl; } })(),
        sourceUrl: reel.sourceUrl,
        snippet: reel.snippet ?? "",
        selectionReason: "",
        compositeScore: 0,
        verified: false,
      },
      script: JSON.parse(reel.script) as import("../types.js").ReelScript,
      status: "running",
      stageLogs: [],
    };

    // Restore discovery context if present
    if (reel.context) {
      try {
        const stored = JSON.parse(reel.context) as {
          trendingSignals?: TrendingSignals;
          categorySource?: CategorySource;
          discoveryBias?: string;
          recentTopics?: string[];
          imageSourceMap?: Record<number, ImageSource>;
          useStockImages?: boolean;
          apiSourceMap?: import("../types.js").ApiSourceMap;
          cameraEffect?: import("../types.js").CameraEffectType;
          cameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedCameraPreset?: import("../types.js").HyperframesCameraPreset;
          stage5Performance?: import("../stages/reel-stage5-performance.js").Stage5PerformanceConfig;
          stage5Renderer?: ReelContext["stage5Renderer"];
          stage5Template?: ReelContext["stage5Template"];
          stage5RenderSettings?: ReelContext["stage5RenderSettings"];
          stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
        };
        ctx = {
          ...ctx,
          trendingSignals: stored.trendingSignals,
          categorySource: stored.categorySource,
          discoveryBias: stored.discoveryBias,
          recentTopics: stored.recentTopics,
          imageSourceMap: stored.imageSourceMap,
          useStockImages: useStockImagesOverride ?? stored.useStockImages,
          apiSourceMap: stored.apiSourceMap,
          cameraEffect: stored.cameraEffect,
          cameraPreset: stored.cameraPreset,
          usedCameraPreset: stored.usedCameraPreset,
          stage5Performance: stored.stage5Performance,
          ...resolveStoredStage5Selection(stored, brand.reels, stage5Overrides),
          stage5RenderSettings: stored.stage5RenderSettings,
          stage5RenderTelemetry: stored.stage5RenderTelemetry,
        };
      } catch { /* ignore */ }
    }

    ctx = applyStage5Overrides(ctx, stage5Overrides);

    queries.updateReel(reelId, { status: "generating", currentStage: "reel-stage3-voice" });

    const tgConfig = brand.channels.telegram;
    const chatId = tgConfig && tgConfig.enabled ? (process.env[tgConfig.chatIdEnvVar] ?? null) : null;
    const stageNames = ["reel-stage3-voice", "reel-stage4-images", "reel-stage5-assemble"];
    const progress = new ReelProgress(brand.name, reelId, stageNames);
    if (chatId) await progress.init(chatId);

    try {
      const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
      const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");

      const runStage = async (stage: import("../types.js").ReelStage) => {
        console.log(`\n[${stage.name}]`);
        const t0 = Date.now();
        queries.updateReel(reelId, { currentStage: stage.name });
        progress.stageStart(stage.name);
        try {
          const patch = await withTimeout(stage.name, ctx, stage.run(ctx));
          ctx = { ...ctx, ...patch };
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "ok", durationMs });
          progress.stageEnd(stage.name, durationMs);
          if (stage.name === "reel-stage3-voice" && ctx.script) {
            queries.updateReel(reelId, { script: ctx.script, context: buildPersistedReelContext(ctx) });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.stageLogs.push({ stage: stage.name, status: "error", durationMs: Date.now() - t0, error: msg });
          await progress.fail(stage.name, msg);
          throw err;
        }
      };

      await runStage(new ReelStage3Voice());

      console.log(`\n[assembly-lock:rebuild] waiting for slot...`);
      await acquireAssemblyLock();
      let stage5Mode: "offloaded" | "local" = "local";
      console.log(`[assembly-lock:rebuild] acquired`);
      try {
        await runStage(new ReelStage4Images());
        ctx = prepareStage5RenderContext(ctx);
        stage5Mode = await runReelStage5Boundary({
          runId: reelId,
          brandId,
          persistedContext: buildPersistedReelContext(ctx),
          runLocalStage5: async () => {
            await runStage(new ReelStage5Facade());
          },
          workDir: ctx.workDir,
          sceneCount: ctx.script?.scenes.length ?? 0,
          gcsPrefix: ctx.brand.gcsPrefix,
          musicFilePath: resolveStage5MusicUploadPath(ctx),
          progressState: chatId ? progress.getState() ?? undefined : undefined,
        });
      } finally {
        releaseAssemblyLock();
        console.log(`[assembly-lock:rebuild] released`);
      }

      if (stage5Mode === "offloaded") {
        console.log("\n[ReelRunner.rebuild] stage5 assembly dispatched to offload worker");
        _activeReelBrands.delete(brandId);
        return;
      }

      queries.updateReel(reelId, {
        script: ctx.script,
        videoGcsUrl: ctx.videoGcsUrl,
        context: buildPersistedReelContext(ctx),
        status: "awaiting_approval",
        currentStage: null,
      });

      const reviewUrl = `${process.env.PIPELINE_BASE_URL!}/review/reel/${reelId}`;
      ctx = { ...ctx, reviewUrl };
      queries.updateReel(reelId, { reviewUrl });
      console.log(`  Review: ${reviewUrl}`);

      if (chatId) await progress.finish(reviewUrl);
      await notifyReelReady(brand, ctx);
      _activeReelBrands.delete(brandId);
      console.log(`\n✅ ReelRunner.rebuild done`);

    } catch (err) {
      _activeReelBrands.delete(brandId);
      queries.updateReel(reelId, { status: "failed", currentStage: null });
      console.error("[ReelRunner.rebuild] failed:", err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  static async rebuildPart(
    reelId: string,
    brandId: BrandId,
    part: "voice" | "images" | "music" | "video",
    options?: { useStockImagesOverride?: boolean; musicTrackSelector?: string; cameraEffectOverride?: import("../types.js").CameraEffectType; cameraPresetOverride?: import("../types.js").HyperframesCameraPreset; voiceSpeedOverride?: number; voiceIdOverride?: string; stage5Renderer?: Stage5RendererType; stage5Template?: Stage5TemplateName },
  ): Promise<void> {
    const brand = getBrand(brandId);
    const reel = queries.getReelById(reelId);
    if (!reel) throw new Error(`Reel ${reelId} not found`);
    if (reel.brand !== brandId) throw new Error(`Reel ${reelId} does not belong to brand ${brandId}`);
    if (!reel.script) throw new Error(`Reel ${reelId} has no stored script`);

    if (_activeReelBrands.has(brandId)) throw new Error(`A reel is already running for ${brandId}`);
    _activeReelBrands.add(brandId);

    const workDir = reelWorkDir(reelId);
    fs.mkdirSync(workDir, { recursive: true });
    const sceneCount = brand.reels?.sceneCount ?? 4;
    const preloadedArtifacts = getRebuildPartArtifacts(workDir, sceneCount, part);

    console.log(`\n[ReelRunner.rebuildPart] reelId=${reelId.slice(0, 8)} brand=${brandId} part=${part}`);

    let ctx: ReelContext = {
      runId: reel.id,
      brand,
      runDate: reel.runDate,
      workDir,
      category: reel.category as ReelCategory | undefined,
      story: {
        index: 0,
        headline: reel.headline,
        source: (() => { try { return new URL(reel.sourceUrl).hostname; } catch { return reel.sourceUrl; } })(),
        sourceUrl: reel.sourceUrl,
        snippet: reel.snippet ?? "",
        selectionReason: "",
        compositeScore: 0,
        verified: false,
      },
      script: JSON.parse(reel.script) as import("../types.js").ReelScript,
      ...preloadedArtifacts,
      status: "running",
      stageLogs: [],
    };

    // Restore discovery context if present
    if (reel.context) {
      try {
        const stored = JSON.parse(reel.context) as {
          trendingSignals?: TrendingSignals;
          categorySource?: CategorySource;
          discoveryBias?: string;
          recentTopics?: string[];
          imageSourceMap?: Record<number, ImageSource>;
          useStockImages?: boolean;
          apiSourceMap?: import("../types.js").ApiSourceMap;
          cameraEffect?: import("../types.js").CameraEffectType;
          usedCameraEffect?: import("../types.js").CameraEffectType;
          cameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedCameraPreset?: import("../types.js").HyperframesCameraPreset;
          usedVoiceId?: string;
          usedVoiceProvider?: string;
          usedVoiceSpeed?: number;
          stage5Performance?: import("../stages/reel-stage5-performance.js").Stage5PerformanceConfig;
          stage5Renderer?: ReelContext["stage5Renderer"];
          stage5Template?: ReelContext["stage5Template"];
          stage5RenderSettings?: ReelContext["stage5RenderSettings"];
          stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
          musicFile?: string;
        };
        ctx = {
          ...ctx,
          trendingSignals: stored.trendingSignals,
          categorySource: stored.categorySource,
          discoveryBias: stored.discoveryBias,
          recentTopics: stored.recentTopics,
          imageSourceMap: stored.imageSourceMap,
          useStockImages: options?.useStockImagesOverride ?? stored.useStockImages,
          apiSourceMap: stored.apiSourceMap,
          cameraEffect: stored.cameraEffect,
          usedCameraEffect: stored.usedCameraEffect,
          cameraPreset: stored.cameraPreset,
          usedCameraPreset: stored.usedCameraPreset,
          usedVoiceId: stored.usedVoiceId,
          usedVoiceProvider: stored.usedVoiceProvider,
          usedVoiceSpeed: stored.usedVoiceSpeed,
          stage5Performance: stored.stage5Performance,
          ...resolveStoredStage5Selection(stored, brand.reels, options ?? {}),
          stage5RenderSettings: stored.stage5RenderSettings,
          stage5RenderTelemetry: stored.stage5RenderTelemetry,
          musicFile: stored.musicFile,
        };
      } catch {
        /* ignore */
      }
    }

    ctx = applyStage5Overrides(ctx, {
      stage5Renderer: options?.stage5Renderer,
      stage5Template: options?.stage5Template,
    });

    if (part === "images") ctx.isImageRebuild = true;

    ctx.musicTrackOverride = part === "music" ? options?.musicTrackSelector : ctx.musicFile;
    if (options?.cameraEffectOverride) ctx.cameraEffect = options.cameraEffectOverride;
    if (options?.cameraPresetOverride) ctx.cameraPreset = options.cameraPresetOverride;
    if (options?.voiceSpeedOverride) ctx.voiceSpeed = options.voiceSpeedOverride;
    if (options?.voiceIdOverride) ctx.voiceId = options.voiceIdOverride;

    const tgConfig = brand.channels.telegram;
    const chatId = tgConfig && tgConfig.enabled ? (process.env[tgConfig.chatIdEnvVar] ?? null) : null;
    const stageNamesByPart: Record<typeof part, string[]> = {
      voice: ["reel-stage3-voice", "reel-stage5-assemble"],
      images: ["reel-stage4-images", "reel-stage5-assemble"],
      music: ["reel-stage5-assemble"],
      video: ["reel-stage5-assemble"],
    };
    const stageNames = stageNamesByPart[part];
    queries.updateReel(reelId, { status: "generating", currentStage: stageNames[0] });
    const progress = new ReelProgress(brand.name, reelId, stageNames);

    try {
      if (chatId) await progress.init(chatId);

      const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
      const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");

      const runStage = async (stage: import("../types.js").ReelStage) => {
        if (isCancelRequested(brandId)) {
          _cancelRequestedBrands.delete(brandId);
          queries.updateReel(reelId, { status: "cancelled", currentStage: null });
          await progress.fail(stage.name, "Cancelled by user");
          throw new Error("Reel cancelled by user");
        }
        console.log(`\n[${stage.name}]`);
        const t0 = Date.now();
        queries.updateReel(reelId, { currentStage: stage.name });
        progress.stageStart(stage.name);
        try {
          const patch = await withTimeout(stage.name, ctx, stage.run(ctx));
          ctx = { ...ctx, ...patch };
          const durationMs = Date.now() - t0;
          ctx.stageLogs.push({ stage: stage.name, status: "ok", durationMs });
          progress.stageEnd(stage.name, durationMs);
          if (stage.name === "reel-stage3-voice" && ctx.script) {
            queries.updateReel(reelId, { script: ctx.script, context: buildPersistedReelContext(ctx) });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.stageLogs.push({ stage: stage.name, status: "error", durationMs: Date.now() - t0, error: msg });
          await progress.fail(stage.name, msg);
          throw err;
        }
      };

      const runVoice = part === "voice";
      const runImages = part === "images";
      const runAssemble = true;

      if (runVoice) await runStage(new ReelStage3Voice());

      if (runImages || runAssemble) {
        console.log(`\n[assembly-lock:rebuild-part] waiting for slot...`);
        await acquireAssemblyLock();
        let stage5Mode: "offloaded" | "local" = "local";
        console.log(`[assembly-lock:rebuild-part] acquired`);
        try {
          if (runImages) await runStage(new ReelStage4Images());
          if (runAssemble) {
            ctx = prepareStage5RenderContext(ctx);
            stage5Mode = await runReelStage5Boundary({
              runId: reelId,
              brandId,
              persistedContext: buildPersistedReelContext(ctx),
              runLocalStage5: async () => {
                await runStage(new ReelStage5Facade());
              },
              workDir: ctx.workDir,
              sceneCount: ctx.script?.scenes.length ?? 0,
              gcsPrefix: ctx.brand.gcsPrefix,
              musicFilePath: resolveStage5MusicUploadPath(ctx),
              progressState: chatId ? progress.getState() ?? undefined : undefined,
            });
          }
        } finally {
          releaseAssemblyLock();
          console.log(`[assembly-lock:rebuild-part] released`);
        }

        if (stage5Mode === "offloaded") {
          console.log("\n[ReelRunner.rebuildPart] stage5 assembly dispatched to offload worker");
          _activeReelBrands.delete(brandId);
          return;
        }
      }

      queries.updateReel(reelId, {
        script: ctx.script,
        videoGcsUrl: ctx.videoGcsUrl,
        context: buildPersistedReelContext(ctx),
        status: "awaiting_approval",
        currentStage: null,
      });

      const reviewUrl = `${process.env.PIPELINE_BASE_URL!}/review/reel/${reelId}`;
      ctx = { ...ctx, reviewUrl };
      queries.updateReel(reelId, { reviewUrl });
      console.log(`  Review: ${reviewUrl}`);

      if (chatId) await progress.finish(reviewUrl);
      await notifyReelReady(brand, ctx);
      _activeReelBrands.delete(brandId);
      console.log(`\n✅ ReelRunner.rebuildPart done`);

    } catch (err) {
      _activeReelBrands.delete(brandId);
      _cancelRequestedBrands.delete(brandId);
      const isCancelled = err instanceof Error && err.message === "Reel cancelled by user";
      if (!isCancelled) queries.updateReel(reelId, { status: "failed", currentStage: null });
      console.error("[ReelRunner.rebuildPart] failed:", err instanceof Error ? err.stack : err);
      throw err;
    }
  }
}
