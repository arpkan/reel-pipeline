import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBrand } from "../brands/index.js";
import {
  getAssemblyJobById,
  getOldestQueuedAssemblyJob,
  getReelById,
  updateAssemblyJob,
  updateReel,
} from "../db/queries.js";
import { createGcsService } from "../services/gcs.js";
import { canLaunchAssemblyWorker, launchAssemblyWorker } from "../services/assembly-launcher.js";
import { notifyReelReady } from "../pipeline/reel-runner.js";
import { ReelStage5Facade } from "../stages/reel-stage5-renderer.js";
import type { BrandId, ReelContext, ReelScript } from "../types.js";

const ROOT_DIR = process.env.PIPELINE_DB_PATH
  ? path.dirname(path.dirname(process.env.PIPELINE_DB_PATH))
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REEL_WORK_BASE = path.join(ROOT_DIR, "work", "reels");

function reelWorkDir(reelId: string): string {
  return path.join(REEL_WORK_BASE, reelId);
}

function parseStoredContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function buildPersistedReelContext(ctx: Partial<ReelContext>): Record<string, unknown> {
  return {
    ...(ctx.trendingSignals !== undefined && { trendingSignals: ctx.trendingSignals }),
    ...(ctx.categorySource !== undefined && { categorySource: ctx.categorySource }),
    ...(ctx.discoveryBias !== undefined && { discoveryBias: ctx.discoveryBias }),
    ...(ctx.recentTopics !== undefined && { recentTopics: ctx.recentTopics }),
    ...(ctx.imageSourceMap !== undefined && { imageSourceMap: ctx.imageSourceMap }),
    ...(ctx.useStockImages !== undefined && { useStockImages: ctx.useStockImages }),
    ...(ctx.apiSourceMap !== undefined && { apiSourceMap: ctx.apiSourceMap }),
    ...(ctx.musicFile !== undefined && { musicFile: ctx.musicFile }),
    ...(ctx.musicTrackOverride !== undefined && { musicTrackOverride: ctx.musicTrackOverride }),
    ...(ctx.stage5Renderer !== undefined && { stage5Renderer: ctx.stage5Renderer }),
    ...(ctx.stage5Template !== undefined && { stage5Template: ctx.stage5Template }),
    ...(ctx.stage5RenderSettings !== undefined && { stage5RenderSettings: ctx.stage5RenderSettings }),
    ...(ctx.stage5RenderTelemetry !== undefined && { stage5RenderTelemetry: ctx.stage5RenderTelemetry }),
  };
}

async function materializeStage5Inputs(params: {
  runId: string;
  gcsPrefix: string;
  audioPaths: string[];
  imagePaths: string[];
}): Promise<void> {
  const missingPaths = [...params.audioPaths, ...params.imagePaths].filter((filePath) => !fs.existsSync(filePath));
  if (missingPaths.length === 0) {
    return;
  }

  const gcs = createGcsService();
  for (const filePath of missingPaths) {
    await gcs.downloadFile(params.gcsPrefix, params.runId, path.basename(filePath), filePath);
  }
}

type TerminalStatus = "succeeded" | "failed";

interface SupervisorSignal {
  jobId: string;
  runId: string;
  status: TerminalStatus;
  error?: string;
  signal?: NodeJS.Signals;
}

interface RunAssemblyJobDeps {
  now?: () => string;
  runStage5?: (ctx: ReelContext) => Promise<Partial<ReelContext>>;
  signalSupervisor?: (payload: SupervisorSignal) => Promise<void>;
  registerTerminationSignals?: (handler: (signal: NodeJS.Signals) => void) => () => void;
  materializeStage5Inputs?: (params: {
    runId: string;
    gcsPrefix: string;
    audioPaths: string[];
    imagePaths: string[];
  }) => Promise<void>;
  triggerNextQueuedJob?: () => Promise<void>;
}

async function triggerNextQueuedJob(): Promise<void> {
  if (!canLaunchAssemblyWorker()) {
    return;
  }

  const nextQueuedJob = getOldestQueuedAssemblyJob();
  if (!nextQueuedJob) {
    return;
  }

  try {
    await launchAssemblyWorker({ jobId: nextQueuedJob.id });
  } catch {
    // Best-effort handoff to next queued job; worker completion should remain terminal.
  }
}

function registerTerminationSignals(handler: (signal: NodeJS.Signals) => void): () => void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  for (const signal of signals) {
    process.once(signal, handler);
  }

  return () => {
    for (const signal of signals) {
      process.off(signal, handler);
    }
  };
}

export async function runAssemblyJob(
  input: { jobId: string; runId?: string },
  deps: RunAssemblyJobDeps = {},
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const runStage5 = deps.runStage5 ?? (async (ctx: ReelContext) => new ReelStage5Facade().run(ctx));
  const signalSupervisor = deps.signalSupervisor ?? (async () => {});
  const registerSignals = deps.registerTerminationSignals ?? registerTerminationSignals;
  const ensureStage5Inputs = deps.materializeStage5Inputs ?? materializeStage5Inputs;
  const triggerNextJob = deps.triggerNextQueuedJob ?? triggerNextQueuedJob;

  const job = getAssemblyJobById(input.jobId);
  if (!job) {
    throw new Error(`Assembly job not found: ${input.jobId}`);
  }

  let reelIdForFailure: string | null = null;
  let storedContext: Record<string, unknown> = {};
  let ctx: ReelContext;

  let caughtSignal: NodeJS.Signals | undefined;
  const cleanupSignals = registerSignals((signal) => {
    caughtSignal = signal;
  });

  try {
    if (input.runId && input.runId !== job.runId) {
      throw new Error(`Assembly job runId mismatch for ${input.jobId}: expected ${job.runId}, got ${input.runId}`);
    }

    const reel = getReelById(job.runId);
    if (!reel) {
      throw new Error(`Reel run not found for assembly job ${input.jobId}: ${job.runId}`);
    }
    reelIdForFailure = job.runId;
    if (!reel.script) {
      throw new Error(`Reel ${job.runId} has no script for stage5 assembly`);
    }

    const script = JSON.parse(reel.script) as ReelScript;
    const workDir = reelWorkDir(reel.id);
    fs.mkdirSync(workDir, { recursive: true });
    const sceneCount = script.scenes.length;
    const audioPaths = Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.mp3`));
    const imagePaths = Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.png`));
    storedContext = parseStoredContext(reel.context);
    const brand = getBrand(reel.brand as BrandId);

    await ensureStage5Inputs({
      runId: reel.id,
      gcsPrefix: brand.gcsPrefix,
      audioPaths,
      imagePaths,
    });

    ctx = {
      runId: reel.id,
      brand,
      runDate: reel.runDate,
      workDir,
      script,
      category: reel.category as ReelContext["category"],
      audioPaths,
      imagePaths,
      status: "running",
      stageLogs: [],
      ...(storedContext.trendingSignals !== undefined && { trendingSignals: storedContext.trendingSignals as ReelContext["trendingSignals"] }),
      ...(storedContext.categorySource !== undefined && { categorySource: storedContext.categorySource as ReelContext["categorySource"] }),
      ...(storedContext.discoveryBias !== undefined && { discoveryBias: storedContext.discoveryBias as string }),
      ...(storedContext.recentTopics !== undefined && { recentTopics: storedContext.recentTopics as string[] }),
      ...(storedContext.imageSourceMap !== undefined && { imageSourceMap: storedContext.imageSourceMap as ReelContext["imageSourceMap"] }),
      ...(storedContext.useStockImages !== undefined && { useStockImages: storedContext.useStockImages as boolean }),
      ...(storedContext.apiSourceMap !== undefined && { apiSourceMap: storedContext.apiSourceMap as ReelContext["apiSourceMap"] }),
      ...(storedContext.musicFile !== undefined && { musicFile: storedContext.musicFile as string }),
      ...(storedContext.musicTrackOverride !== undefined && { musicTrackOverride: storedContext.musicTrackOverride as string }),
      ...(storedContext.stage5Renderer !== undefined && { stage5Renderer: storedContext.stage5Renderer as ReelContext["stage5Renderer"] }),
      ...(storedContext.stage5Template !== undefined && { stage5Template: storedContext.stage5Template as ReelContext["stage5Template"] }),
      ...(storedContext.stage5RenderSettings !== undefined && { stage5RenderSettings: storedContext.stage5RenderSettings as ReelContext["stage5RenderSettings"] }),
      ...(storedContext.stage5RenderTelemetry !== undefined && { stage5RenderTelemetry: storedContext.stage5RenderTelemetry as ReelContext["stage5RenderTelemetry"] }),
    };

    updateAssemblyJob(input.jobId, { status: "running", startedAt: now(), error: "" });
    updateReel(job.runId, { status: "generating", currentStage: "reel-stage5-assemble" });

    ctx = { ...ctx, stage5RenderTelemetry: undefined };
    const patch = await runStage5(ctx);
    if (patch.stage5RenderTelemetry) {
      patch.stage5RenderTelemetry = { ...patch.stage5RenderTelemetry, mode: "offloaded" };
    }
    if (caughtSignal) {
      throw new Error(`Worker received ${caughtSignal} during job ${input.jobId}`);
    }

    const currentContext = buildPersistedReelContext({
      ...ctx,
      ...patch,
      imageSourceMap: {
        ...(ctx.imageSourceMap ?? {}),
        ...(patch.imageSourceMap ?? {}),
      },
      apiSourceMap: {
        ...(ctx.apiSourceMap ?? {}),
        ...(patch.apiSourceMap ?? {}),
      },
    });
    const mergedContext: Record<string, unknown> = {
      ...storedContext,
      ...currentContext,
    };
    if (!("stage5RenderTelemetry" in currentContext)) {
      delete mergedContext.stage5RenderTelemetry;
    }
    const reviewUrl = reel.reviewUrl ?? `${process.env.PIPELINE_BASE_URL!}/review/reel/${job.runId}`;
    const shouldNotify = !(reel.reviewUrl && reel.status === "awaiting_approval");

    updateReel(job.runId, {
      videoGcsUrl: patch.videoGcsUrl,
      reviewUrl,
      context: mergedContext,
      status: "awaiting_approval",
      currentStage: null,
    });
    if (shouldNotify) {
      await notifyReelReady(brand, {
        ...ctx,
        ...patch,
        reviewUrl,
        status: "awaiting_approval",
      });
    }
    updateAssemblyJob(input.jobId, { status: "succeeded", finishedAt: now(), error: "" });
    await signalSupervisor({
      jobId: input.jobId,
      runId: job.runId,
      status: "succeeded",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reelIdForFailure) {
      updateReel(reelIdForFailure, { status: "failed", currentStage: null });
    }
    updateAssemblyJob(input.jobId, {
      status: "failed",
      error: message,
      finishedAt: now(),
    });
    await signalSupervisor({
      jobId: input.jobId,
      runId: job.runId,
      status: "failed",
      error: message,
      signal: caughtSignal,
    });
    throw error;
  } finally {
    cleanupSignals();
    await triggerNextJob();
  }
}
