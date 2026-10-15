import { eq, and, gte, desc, asc, isNull, isNotNull, or, gt, lt, lte, max, inArray } from "drizzle-orm";
import { db } from "./client.js";
import { runs, posts, stageLogs, lineEvents, reelIntakeSessions, reels, reelSchedule, reelStartLocks, reelScheduleLocks, batchRuns, batchRunReels, assemblyJobs, reelMetrics, performanceBenchmarks, performanceScores, followerSnapshots, voices, profiles, storyIntakeSessions, storySetupRequests, storyRuns } from "./schema.js";
import type { BrandId, RunStatus, Story, StageLog, ReelScript, ImageSource, Stage5RendererType, Stage5TemplateName } from "../types.js";
import { randomUUID } from "crypto";
import type { StoryReelAudienceLanguage, StoryReelClipMetadata, StoryReelDirectorDirection, StoryReelMusicGenre, StoryReelVoiceProvider, StoryReelVoiceStyle, StoryStageLog } from "../storyreel/types.js";

function now(): string {
  return new Date().toISOString();
}

function isExpired(timestamp: string): boolean {
  return Date.parse(timestamp) <= Date.now();
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export function createRun(params: {
  id: string;
  brand: BrandId;
  runDate: string;
  theme?: string;
}): void {
  db.insert(runs).values({
    id: params.id,
    brand: params.brand,
    runDate: params.runDate,
    theme: params.theme,
    status: "running",
    stagesCompleted: 0,
    createdAt: now(),
    updatedAt: now(),
  }).run();
}

export function updateRunStatus(runId: string, status: RunStatus, extras?: {
  stagesCompleted?: number;
  reviewUrl?: string;
  telegramOffset?: number;
}): void {
  db.update(runs)
    .set({
      status,
      ...(extras?.stagesCompleted !== undefined && { stagesCompleted: extras.stagesCompleted }),
      ...(extras?.reviewUrl !== undefined && { reviewUrl: extras.reviewUrl }),
      ...(extras?.telegramOffset !== undefined && { telegramOffset: extras.telegramOffset }),
      updatedAt: now(),
    })
    .where(eq(runs.id, runId))
    .run();
}

export function updateRunReviewUrl(runId: string, reviewUrl: string): void {
  db.update(runs)
    .set({ reviewUrl, updatedAt: now() })
    .where(eq(runs.id, runId))
    .run();
}

export function updateTelegramOffset(runId: string, offset: number): void {
  db.update(runs)
    .set({ telegramOffset: offset, updatedAt: now() })
    .where(eq(runs.id, runId))
    .run();
}

export function updateLineOffset(runId: string, offset: number): void {
  db.update(runs)
    .set({ lineOffset: offset, updatedAt: now() })
    .where(eq(runs.id, runId))
    .run();
}

// ─── LINE events ──────────────────────────────────────────────────────────────

export function insertLineEvent(groupId: string, text: string, userId: string | null, lineTimestamp: number): number {
  const result = db.insert(lineEvents).values({
    groupId,
    text,
    userId: userId ?? null,
    lineTimestamp,
    createdAt: now(),
  }).run();
  return Number(result.lastInsertRowid);
}

export function getLineEventsAfter(groupId: string, fromId: number) {
  // fromId is the next expected id (offset), so fetch id >= fromId
  return db.select().from(lineEvents)
    .where(and(eq(lineEvents.groupId, groupId), gt(lineEvents.id, fromId - 1)))
    .orderBy(lineEvents.id)
    .all();
}

export function clearLineEvents(): void {
  db.delete(lineEvents).run();
}

// ─── Reel intake sessions ─────────────────────────────────────────────────────

export function upsertReelIntakeSession(params: {
  brand: BrandId;
  chatId: string;
  mode: "text" | "hint";
  step: "awaiting_source" | "awaiting_content";
  sourceInput?: string;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  expiresAt: string;
}): void {
  const ts = now();
  db.insert(reelIntakeSessions)
    .values({
      brand: params.brand,
      chatId: params.chatId,
      mode: params.mode,
      step: params.step,
      sourceInput: params.sourceInput,
      stage5Renderer: params.stage5Renderer,
      stage5Template: params.stage5Template,
      expiresAt: params.expiresAt,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: [reelIntakeSessions.brand, reelIntakeSessions.chatId],
      set: {
        mode: params.mode,
        step: params.step,
        sourceInput: params.sourceInput,
        stage5Renderer: params.stage5Renderer,
        stage5Template: params.stage5Template,
        expiresAt: params.expiresAt,
        updatedAt: ts,
      },
    })
    .run();
}

export function getReelIntakeSession(brand: BrandId, chatId: string) {
  const row = db.select()
    .from(reelIntakeSessions)
    .where(and(eq(reelIntakeSessions.brand, brand), eq(reelIntakeSessions.chatId, chatId)))
    .get();
  if (!row) return null;
  if (isExpired(row.expiresAt)) {
    db.delete(reelIntakeSessions)
      .where(and(eq(reelIntakeSessions.brand, brand), eq(reelIntakeSessions.chatId, chatId)))
      .run();
    return null;
  }
  return row;
}

export function clearReelIntakeSession(brand: BrandId, chatId: string): void {
  db.delete(reelIntakeSessions)
    .where(and(eq(reelIntakeSessions.brand, brand), eq(reelIntakeSessions.chatId, chatId)))
    .run();
}

export function clearExpiredReelIntakeSessions(): number {
  const result = db.delete(reelIntakeSessions)
    .where(lte(reelIntakeSessions.expiresAt, now()))
    .run();
  return result.changes;
}

export function getLatestLineEventId(groupId: string): number {
  const row = db.select({ id: max(lineEvents.id) }).from(lineEvents)
    .where(eq(lineEvents.groupId, groupId))
    .get();
  return row?.id ?? 0;
}

export function getRunById(runId: string) {
  return db.select().from(runs).where(eq(runs.id, runId)).get();
}

export function getRecentRuns(brand: BrandId, limit = 20) {
  return db.select().from(runs)
    .where(eq(runs.brand, brand))
    .orderBy(desc(runs.createdAt))
    .limit(limit)
    .all();
}

export function saveStories(runId: string, stories: Story[]): void {
  db.update(runs)
    .set({ stories: JSON.stringify(stories), updatedAt: now() })
    .where(eq(runs.id, runId))
    .run();
}

export function saveRunContext(runId: string, context: object): void {
  db.update(runs)
    .set({ context: JSON.stringify(context), updatedAt: now() })
    .where(eq(runs.id, runId))
    .run();
}

export function getActiveRunForBrand(brand: BrandId, runDate: string) {
  return db.select().from(runs)
    .where(and(eq(runs.brand, brand), eq(runs.runDate, runDate), eq(runs.status, "running")))
    .get();
}

export function getAwaitingApprovalRuns() {
  // Resume awaiting_approval and approved runs from today or yesterday — older ones are abandoned
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db.select().from(runs)
    .where(and(
      or(eq(runs.status, "awaiting_approval"), eq(runs.status, "approved")),
      gte(runs.runDate, yesterday),
    ))
    .orderBy(desc(runs.createdAt))
    .all();
}

export function getLatestAwaitingRunForBrand(brand: BrandId) {
  return db.select({ id: runs.id, reviewUrl: runs.reviewUrl }).from(runs)
    .where(and(eq(runs.brand, brand), eq(runs.status, "awaiting_approval")))
    .orderBy(desc(runs.createdAt))
    .limit(1)
    .get() ?? null;
}

export function getLatestPendingRunForBrand(brand: BrandId) {
  // Returns the newest run still awaiting a decision (awaiting_approval or approved)
  return db.select({ id: runs.id }).from(runs)
    .where(and(
      eq(runs.brand, brand),
      or(eq(runs.status, "awaiting_approval"), eq(runs.status, "approved")),
    ))
    .orderBy(desc(runs.createdAt))
    .limit(1)
    .get() ?? null;
}

// ─── Stage logs ───────────────────────────────────────────────────────────────

export function getStageLogsForRun(runId: string) {
  return db.select().from(stageLogs).where(eq(stageLogs.runId, runId)).all();
}

export function createStageLog(runId: string, log: StageLog): void {
  db.insert(stageLogs).values({
    runId,
    stage: log.stage,
    status: log.status,
    durationMs: log.durationMs,
    error: log.error,
    createdAt: now(),
  }).run();
}

// ─── Reels ────────────────────────────────────────────────────────────────────

export function createReel(params: {
  id: string;
  brand: BrandId;
  runDate: string;
  headline: string;
  sourceUrl: string;
  snippet?: string;
  context?: string;
  scheduledTime?: string;
}): void {
  db.insert(reels).values({
    id: params.id,
    brand: params.brand,
    runDate: params.runDate,
    headline: params.headline,
    sourceUrl: params.sourceUrl,
    snippet: params.snippet,
    context: params.context,
    status: "generating",
    scheduledTime: params.scheduledTime,
    createdAt: now(),
    updatedAt: now(),
  }).run();
}

export function updateReel(id: string, fields: {
  headline?: string;
  snippet?: string;
  script?: ReelScript;
  category?: string;
  context?: object;
  videoGcsUrl?: string;
  reviewUrl?: string;
  status?: string;
  currentStage?: string | null;
  approved?: boolean;
  facebookPostId?: string;
  tikTokPostId?: string;
  sourceUrl?: string;
  scheduledTime?: string;
  publishedAt?: string;
}): void {
  db.update(reels).set({
    ...(fields.headline     !== undefined && { headline: fields.headline }),
    ...(fields.snippet      !== undefined && { snippet: fields.snippet }),
    ...(fields.script       !== undefined && { script: JSON.stringify(fields.script) }),
    ...(fields.category     !== undefined && { category: fields.category }),
    ...(fields.context      !== undefined && { context: JSON.stringify(fields.context) }),
    ...(fields.videoGcsUrl  !== undefined && { videoGcsUrl: fields.videoGcsUrl }),
    ...(fields.reviewUrl    !== undefined && { reviewUrl: fields.reviewUrl }),
    ...(fields.status       !== undefined && { status: fields.status }),
    ...(fields.currentStage !== undefined && { currentStage: fields.currentStage }),
    ...(fields.approved     !== undefined && { approved: fields.approved }),
    ...(fields.facebookPostId !== undefined && { facebookPostId: fields.facebookPostId }),
    ...(fields.tikTokPostId !== undefined && { tikTokPostId: fields.tikTokPostId }),
    ...(fields.sourceUrl    !== undefined && { sourceUrl: fields.sourceUrl }),
    ...(fields.scheduledTime !== undefined && { scheduledTime: fields.scheduledTime }),
    ...(fields.publishedAt  !== undefined && { publishedAt: fields.publishedAt }),
    updatedAt: now(),
  }).where(eq(reels.id, id)).run();
}

export function getReelById(id: string) {
  return db.select().from(reels).where(eq(reels.id, id)).get();
}

export function getRecentReels(brand: BrandId, limit = 10) {
  return db.select().from(reels)
    .where(eq(reels.brand, brand))
    .orderBy(desc(reels.createdAt))
    .limit(limit)
    .all();
}

// Reels stuck in "generating" with no DB update for more than staleMinutes
export function getStaleGeneratingReels(staleMinutes: number) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  return db.select().from(reels)
    .where(and(eq(reels.status, "generating"), isNotNull(reels.currentStage), lt(reels.updatedAt, cutoff)))
    .all();
}

export function getRecentGeneratingReelCount(brand: BrandId, withinMinutes: number): number {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  const rows = db.select({ id: reels.id }).from(reels)
    .where(and(eq(reels.brand, brand), eq(reels.status, "generating"), gte(reels.createdAt, cutoff)))
    .all();
  return rows.length;
}

export function getBlockingReelCount(brand: BrandId): number {
  const rows = db.select({ id: reels.id }).from(reels)
    .where(and(
      eq(reels.brand, brand),
      and(eq(reels.status, "generating"), isNotNull(reels.currentStage)),
    ))
    .all();
  return rows.length;
}

export function acquireReelStartLock(brand: BrandId, runId: string, staleMinutes: number): boolean {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  db.delete(reelStartLocks)
    .where(and(eq(reelStartLocks.brand, brand), lt(reelStartLocks.updatedAt, cutoff)))
    .run();

  const timestamp = now();
  try {
    db.insert(reelStartLocks).values({ brand, runId, createdAt: timestamp, updatedAt: timestamp }).run();
    return true;
  } catch {
    return false;
  }
}

export function releaseReelStartLock(brand: BrandId, runId: string): void {
  db.delete(reelStartLocks)
    .where(and(eq(reelStartLocks.brand, brand), eq(reelStartLocks.runId, runId)))
    .run();
}

export function acquireReelScheduleSlot(brand: BrandId, slotKey: string, runId: string): boolean {
  try {
    db.insert(reelScheduleLocks).values({ brand, slotKey, runId, createdAt: now() }).run();
    return true;
  } catch {
    return false;
  }
}

export function releaseReelScheduleSlot(brand: BrandId, slotKey: string, runId: string): void {
  db.delete(reelScheduleLocks)
    .where(and(eq(reelScheduleLocks.brand, brand), eq(reelScheduleLocks.slotKey, slotKey), eq(reelScheduleLocks.runId, runId)))
    .run();
}

export function getRecentReelHeadlines(brand: BrandId, limit = 30): string[] {
  const rows = db.select({ headline: reels.headline }).from(reels)
    .where(eq(reels.brand, brand))
    .orderBy(desc(reels.createdAt))
    .limit(limit)
    .all();
  return rows.map((r) => r.headline);
}

export function getRecentReelInfo(brand: BrandId, limit = 20): { headline: string; sourceUrl: string }[] {
  return db.select({ headline: reels.headline, sourceUrl: reels.sourceUrl }).from(reels)
    .where(eq(reels.brand, brand))
    .orderBy(desc(reels.createdAt))
    .limit(limit)
    .all();
}

export function getRecentPostHeadlines(brand: BrandId, limit = 20): string[] {
  const rows = db.select({ stories: runs.stories }).from(runs)
    .where(eq(runs.brand, brand))
    .orderBy(desc(runs.createdAt))
    .limit(limit)
    .all();
  const headlines: string[] = [];
  for (const row of rows) {
    if (!row.stories) continue;
    try {
      const parsed = JSON.parse(row.stories) as Array<{ headline?: string }>;
      for (const s of parsed) {
        if (s.headline) headlines.push(s.headline);
      }
    } catch { /* ignore malformed JSON */ }
  }
  return headlines;
}

export function getReelByShortId(brand: BrandId, shortId: string) {
  return db.select().from(reels)
    .where(eq(reels.brand, brand))
    .all()
    .find((r) => r.id.startsWith(shortId));
}

// Reels approved with a scheduled post time that hasn't been published yet
export function getDueScheduledReels(brandId: BrandId, currentTime: string) {
  return db.select().from(reels)
    .where(and(
      eq(reels.brand, brandId),
      eq(reels.status, "approved"),
      lte(reels.scheduledTime, currentTime),
    ))
    .all();
}

// ─── Assembly Jobs ─────────────────────────────────────────────────────────────

export function createAssemblyJob(params: {
  id: string;
  runId: string;
  brand: BrandId;
}): void {
  const ts = now();
  db.insert(assemblyJobs).values({
    id: params.id,
    runId: params.runId,
    brand: params.brand,
    status: "queued",
    attempts: 1,
    createdAt: ts,
    updatedAt: ts,
  }).run();
}

export function updateAssemblyJob(id: string, fields: Partial<{
  status: string;
  instanceId: string;
  error: string;
  startedAt: string;
  finishedAt: string;
}>): void {
  db.update(assemblyJobs)
    .set({
      ...(fields.status !== undefined && { status: fields.status }),
      ...(fields.instanceId !== undefined && { instanceId: fields.instanceId }),
      ...(fields.error !== undefined && { error: fields.error }),
      ...(fields.startedAt !== undefined && { startedAt: fields.startedAt }),
      ...(fields.finishedAt !== undefined && { finishedAt: fields.finishedAt }),
      updatedAt: now(),
    })
    .where(eq(assemblyJobs.id, id))
    .run();
}

export function getAssemblyJobById(id: string) {
  return db.select().from(assemblyJobs).where(eq(assemblyJobs.id, id)).get();
}

export function getRunningAssemblyJob() {
  return db.select().from(assemblyJobs)
    .where(eq(assemblyJobs.status, "running"))
    .orderBy(desc(assemblyJobs.updatedAt))
    .limit(1)
    .get();
}

export function getOldestQueuedAssemblyJob() {
  return db.select().from(assemblyJobs)
    .where(eq(assemblyJobs.status, "queued"))
    .orderBy(asc(assemblyJobs.createdAt))
    .limit(1)
    .get();
}

// ─── Batch Runs ────────────────────────────────────────────────────────────────

export function createBatchRun(params: {
  id: string;
  brand: BrandId;
  count: number;
  config?: Record<string, unknown>;
}): void {
  const ts = now();
  db.insert(batchRuns).values({
    id: params.id,
    brand: params.brand,
    count: params.count,
    status: "prepping",
    config: params.config ? JSON.stringify(params.config) : null,
    timing: null,
    error: null,
    createdAt: ts,
    updatedAt: ts,
  }).run();
}

export function updateBatchRunStatus(id: string, status: string, extras?: {
  timing?: Record<string, unknown>;
  error?: string;
}): void {
  const values: Record<string, unknown> = { status, updatedAt: now() };
  if (extras?.timing) values.timing = JSON.stringify(extras.timing);
  if (extras?.error !== undefined) values.error = extras.error;
  db.update(batchRuns).set(values).where(eq(batchRuns.id, id)).run();
}

export function getBatchRun(id: string) {
  return db.select().from(batchRuns).where(eq(batchRuns.id, id)).get();
}

export function linkBatchReel(batchRunId: string, reelId: string): void {
  db.insert(batchRunReels).values({ batchRunId, reelId }).run();
}

export function getBatchRunReels(batchRunId: string) {
  return db.select({ reelId: batchRunReels.reelId }).from(batchRunReels)
    .where(eq(batchRunReels.batchRunId, batchRunId))
    .all();
}

export function getRecentBatchRuns(brand: BrandId, limit = 5) {
  return db.select().from(batchRuns)
    .where(eq(batchRuns.brand, brand))
    .orderBy(desc(batchRuns.createdAt))
    .limit(limit)
    .all();
}

export function getStaleRunningRuns(maxMinutes: number) {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString();
  return db.select().from(runs)
    .where(and(
      eq(runs.status, "running"),
      lt(runs.updatedAt, cutoff),
    ))
    .all();
}

// ─── Performance Metrics Queries ──────────────────────────────────────────────

export function insertReelMetrics(params: {
  reelId: string;
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  watchTimeSec: number | null;
  totalWatchTimeSec: number | null;
  followersGained?: number | null;
}): void {
  db.insert(reelMetrics).values({
    reelId: params.reelId,
    fetchedAt: now(),
    platform: params.platform,
    views: params.views,
    likes: params.likes,
    comments: params.comments,
    shares: params.shares,
    saves: params.saves,
    reach: params.reach,
    watchTimeSec: params.watchTimeSec,
    totalWatchTimeSec: params.totalWatchTimeSec,
    followersGained: params.followersGained ?? null,
  }).run();
}

export function getMetricsCandidates(brand: string, since: string, until: string): Array<{
  id: string;
  facebookPostId: string | null;
  headline: string;
  context: string | null;
  scheduledTime: string | null;
  publishedAt: string | null;
  category: string | null;
}> {
  return db.select({
    id: reels.id,
    facebookPostId: reels.facebookPostId,
    headline: reels.headline,
    context: reels.context,
    scheduledTime: reels.scheduledTime,
    publishedAt: reels.publishedAt,
    category: reels.category,
  })
    .from(reels)
    .where(and(
      eq(reels.brand, brand),
      isNotNull(reels.facebookPostId),
      isNotNull(reels.publishedAt),
      gte(reels.publishedAt, since),
      lte(reels.publishedAt, until),
    ))
    .all();
}

export function getLatestMetrics(reelId: string) {
  // Prefer most recent row where views is not null; fall back to absolute latest
  const withViews = db.select()
    .from(reelMetrics)
    .where(and(eq(reelMetrics.reelId, reelId), isNotNull(reelMetrics.views)))
    .orderBy(desc(reelMetrics.fetchedAt))
    .limit(1)
    .get();
  if (withViews) return withViews;
  return db.select()
    .from(reelMetrics)
    .where(eq(reelMetrics.reelId, reelId))
    .orderBy(desc(reelMetrics.fetchedAt))
    .limit(1)
    .get();
}

export function getMetricsForPeriod(reelIds: string[], since: string) {
  if (reelIds.length === 0) return [];
  return db.select()
    .from(reelMetrics)
    .where(and(
      inArray(reelMetrics.reelId, reelIds),
      gte(reelMetrics.fetchedAt, since),
    ))
    .all();
}

export function upsertBenchmark(params: {
  brandId: string;
  dimension: string;
  dimensionValue: string;
  period: string;
  avgViews: number | null;
  avgEngagementRate: number | null;
  avgWatchTime: number | null;
  sampleCount: number;
}): void {
  db.insert(performanceBenchmarks)
    .values({
      brandId: params.brandId,
      dimension: params.dimension,
      dimensionValue: params.dimensionValue,
      period: params.period,
      avgViews: params.avgViews,
      avgEngagementRate: params.avgEngagementRate,
      avgWatchTime: params.avgWatchTime,
      sampleCount: params.sampleCount,
      computedAt: now(),
    })
    .onConflictDoUpdate({
      target: [performanceBenchmarks.brandId, performanceBenchmarks.dimension, performanceBenchmarks.dimensionValue, performanceBenchmarks.period],
      set: {
        avgViews: params.avgViews,
        avgEngagementRate: params.avgEngagementRate,
        avgWatchTime: params.avgWatchTime,
        sampleCount: params.sampleCount,
        computedAt: now(),
      },
    })
    .run();
}

export function getBenchmarks(brandId: string, period?: string) {
  const conditions = [eq(performanceBenchmarks.brandId, brandId)];
  if (period) conditions.push(eq(performanceBenchmarks.period, period));
  return db.select().from(performanceBenchmarks)
    .where(and(...conditions))
    .all();
}

export function upsertPerformanceScore(params: {
  reelId: string;
  viewsRatio: number | null;
  engagementRatio: number | null;
  overallScore: number | null;
}): void {
  db.insert(performanceScores)
    .values({
      reelId: params.reelId,
      viewsRatio: params.viewsRatio,
      engagementRatio: params.engagementRatio,
      overallScore: params.overallScore,
      computedAt: now(),
    })
    .onConflictDoUpdate({
      target: performanceScores.reelId,
      set: {
        viewsRatio: params.viewsRatio,
        engagementRatio: params.engagementRatio,
        overallScore: params.overallScore,
        computedAt: now(),
      },
    })
    .run();
}

export function getPublishedReelsWithMetrics(brand: string, since: string): Array<{
  reel: typeof reels.$inferSelect;
  latestMetrics: typeof reelMetrics.$inferSelect | null;
  score: typeof performanceScores.$inferSelect | null;
}> {
  const brandReels = db.select()
    .from(reels)
    .where(and(
      eq(reels.brand, brand),
      gte(reels.createdAt, since),
      isNotNull(reels.facebookPostId),
    ))
    .all();

  return brandReels.map(reel => {
    const score = db.select()
      .from(performanceScores)
      .where(eq(performanceScores.reelId, reel.id))
      .get();

    return { reel, latestMetrics: getLatestMetrics(reel.id) ?? null, score: score ?? null };
  });
}

// ─── Follower Snapshots ───────────────────────────────────────────────────────

export function upsertFollowerSnapshot(brand: BrandId, date: string, totalFollowers: number): void {
  db.insert(followerSnapshots)
    .values({ brand, date, totalFollowers, fetchedAt: now() })
    .onConflictDoUpdate({
      target: [followerSnapshots.brand, followerSnapshots.date],
      set: { totalFollowers, fetchedAt: now() },
    })
    .run();
}

export interface FollowerStats {
  totalFollowers: number | null;
  gained7d: number | null;
  gainedPrior7d: number | null;
}

export function getFollowerStats(brand: BrandId): FollowerStats {
  const today = new Date();
  const d7 = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const d14 = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);

  const snapshots = db.select()
    .from(followerSnapshots)
    .where(and(eq(followerSnapshots.brand, brand), gte(followerSnapshots.date, d14)))
    .orderBy(asc(followerSnapshots.date))
    .all();

  if (snapshots.length === 0) return { totalFollowers: null, gained7d: null, gainedPrior7d: null };

  const latest = snapshots[snapshots.length - 1];
  const totalFollowers = latest.totalFollowers;

  const snap7dAgo = snapshots.filter(s => s.date <= d7).at(-1);
  const snap14dAgo = snapshots.filter(s => s.date < d7).at(0);

  const gained7d = snap7dAgo != null ? totalFollowers - snap7dAgo.totalFollowers : null;
  const gainedPrior7d = (snap7dAgo != null && snap14dAgo != null)
    ? snap7dAgo.totalFollowers - snap14dAgo.totalFollowers
    : null;

  return { totalFollowers, gained7d, gainedPrior7d };
}

export function getFollowerSnapshotsByDate(brand: BrandId, since: string): Array<{ date: string; totalFollowers: number }> {
  return db.select({ date: followerSnapshots.date, totalFollowers: followerSnapshots.totalFollowers })
    .from(followerSnapshots)
    .where(and(eq(followerSnapshots.brand, brand), gte(followerSnapshots.date, since)))
    .orderBy(asc(followerSnapshots.date))
    .all();
}

export function getDashboardHealth(brand: BrandId): { latestMetricsFetchedAt: string | null; latestFollowerFetchedAt: string | null } {
  const latestMetrics = db.select({ fetchedAt: max(reelMetrics.fetchedAt) })
    .from(reelMetrics)
    .innerJoin(reels, eq(reelMetrics.reelId, reels.id))
    .where(eq(reels.brand, brand))
    .get();

  const latestFollowers = db.select({ fetchedAt: max(followerSnapshots.fetchedAt) })
    .from(followerSnapshots)
    .where(eq(followerSnapshots.brand, brand))
    .get();

  return {
    latestMetricsFetchedAt: latestMetrics?.fetchedAt ?? null,
    latestFollowerFetchedAt: latestFollowers?.fetchedAt ?? null,
  };
}

export function getTotalWatchMinutes60d(brand: BrandId): number {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();

  // Get all reels for this brand in the last 60 days with a facebook post
  const brandReelIds = db.select({ id: reels.id })
    .from(reels)
    .where(and(eq(reels.brand, brand), gte(reels.createdAt, since), isNotNull(reels.facebookPostId)))
    .all()
    .map(r => r.id);

  if (brandReelIds.length === 0) return 0;

  // Get all metrics for those reels in one query, then pick the latest per reel in memory
  const allMetrics = db.select({
    reelId: reelMetrics.reelId,
    fetchedAt: reelMetrics.fetchedAt,
    total: reelMetrics.totalWatchTimeSec,
  })
    .from(reelMetrics)
    .where(inArray(reelMetrics.reelId, brandReelIds))
    .orderBy(desc(reelMetrics.fetchedAt))
    .all();

  // Pick latest metric per reel
  const latestPerReel = new Map<string, number>();
  for (const m of allMetrics) {
    if (!latestPerReel.has(m.reelId) && m.total != null) {
      latestPerReel.set(m.reelId, m.total);
    }
  }

  const totalSec = Array.from(latestPerReel.values()).reduce((s, v) => s + v, 0);
  return totalSec / 60;
}

// ─── StoryReel ────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  return JSON.parse(raw) as T;
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

export function getAllStoryReelChatIds(): string[] {
  return db.select({ telegramChatId: profiles.telegramChatId }).from(profiles).all().map((r) => r.telegramChatId);
}

export function upsertStorySetupRequest(params: {
  chatId: string;
  chatTitle?: string | null;
  chatType?: string | null;
  chatUsername?: string | null;
  profileName: string;
  audienceLanguage: StoryReelAudienceLanguage;
  audienceDescription: string;
}) {
  const existing = getStorySetupRequestByChatId(params.chatId);
  const ts = now();
  db.insert(storySetupRequests).values({
    chatId: params.chatId,
    chatTitle: params.chatTitle ?? null,
    chatType: params.chatType ?? null,
    chatUsername: params.chatUsername ?? null,
    profileName: params.profileName,
    audienceLanguage: params.audienceLanguage,
    audienceDescription: params.audienceDescription,
    status: "pending",
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  }).onConflictDoUpdate({
    target: storySetupRequests.chatId,
    set: {
      chatTitle: params.chatTitle ?? null,
      chatType: params.chatType ?? null,
      chatUsername: params.chatUsername ?? null,
      profileName: params.profileName,
      audienceLanguage: params.audienceLanguage,
      audienceDescription: params.audienceDescription,
      status: "pending",
      updatedAt: ts,
    },
  }).run();
  return getStorySetupRequestByChatId(params.chatId)!;
}

export function getStorySetupRequestByChatId(chatId: string) {
  return db.select().from(storySetupRequests).where(eq(storySetupRequests.chatId, chatId)).get() ?? null;
}

export function getPendingStorySetupRequests() {
  return db.select().from(storySetupRequests).where(eq(storySetupRequests.status, "pending")).orderBy(asc(storySetupRequests.createdAt)).all();
}

export function resolveLatestPendingStorySetupRequest() {
  return db.select().from(storySetupRequests).where(eq(storySetupRequests.status, "pending")).orderBy(desc(storySetupRequests.createdAt)).limit(1).get() ?? null;
}

export function markStorySetupRequestRejected(chatId: string): void {
  db.update(storySetupRequests).set({ status: "rejected", updatedAt: now() }).where(eq(storySetupRequests.chatId, chatId)).run();
}

export function deleteStorySetupRequest(chatId: string): void {
  db.delete(storySetupRequests).where(eq(storySetupRequests.chatId, chatId)).run();
}

export function updateStoryProfileVoice(profileId: string, preferredVoiceId: string, preferredVoiceProvider: StoryReelVoiceProvider): void {
  db.update(profiles).set({ preferredVoiceId, preferredVoiceProvider, updatedAt: now() }).where(eq(profiles.id, profileId)).run();
}

export function clearStoryProfileVoice(profileId: string): void {
  db.update(profiles).set({ preferredVoiceId: null, preferredVoiceProvider: null, updatedAt: now() }).where(eq(profiles.id, profileId)).run();
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

export function getStoryRunByShortId(chatId: string, shortId: string) {
  return db.select().from(storyRuns)
    .where(eq(storyRuns.telegramChatId, chatId))
    .orderBy(desc(storyRuns.createdAt))
    .all()
    .find((r) => r.id.startsWith(shortId)) ?? null;
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
