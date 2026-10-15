/**
 * EC2 assembly worker entry point.
 * Receives a job from SQS, fetches context from the pipeline API,
 * runs Stage 5 assembly, then self-terminates the instance.
 */
import "dotenv/config";
import { ReceiveMessageCommand, DeleteMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { EC2Client, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { ReelStage5Facade } from "../src/stages/reel-stage5-renderer.js";
import { createGcsService } from "../src/services/gcs.js";
import type { ReelContext, ReelScript } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const QUEUE_URL = process.env.REEL_ASSEMBLY_QUEUE_URL!;
const PIPELINE_URL = process.env.PIPELINE_BASE_URL!;
const WORKER_TOKEN = process.env.WORKER_API_TOKEN!;
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const WORK_BASE = process.env.WORKER_WORK_DIR ?? "/tmp/reel-work";

function parseStoredContext(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildWorkerPersistedReelContext(ctx: Partial<ReelContext>): Record<string, unknown> {
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

export function buildWorkerReelContext(params: {
  runId: string;
  reel: {
    runDate: string;
    category?: string | null;
    context?: string | null;
  };
  brand: ReelContext["brand"];
  workDir: string;
  script: ReelScript;
  audioPaths: string[];
  imagePaths: string[];
}): ReelContext {
  const storedContext = parseStoredContext(params.reel.context);
  return {
    runId: params.runId,
    brand: params.brand,
    runDate: params.reel.runDate,
    workDir: params.workDir,
    script: params.script,
    category: params.reel.category as ReelContext["category"],
    audioPaths: params.audioPaths,
    imagePaths: params.imagePaths,
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
}

function api(path: string, method = "GET", body?: unknown) {
  return fetch(`${PIPELINE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${WORKER_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`API ${method} ${path} → ${r.status}: ${await r.text()}`);
    return r.json();
  });
}

async function selfTerminate(instanceId: string): Promise<void> {
  try {
    const ec2 = new EC2Client({ region: AWS_REGION });
    await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    console.log(`[worker] self-terminating instance ${instanceId}`);
  } catch (err) {
    console.error("[worker] self-terminate failed:", err);
  }
}

async function run(): Promise<string | null> {
  const sqs = new SQSClient({ region: AWS_REGION });

  const recv = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20,
    VisibilityTimeout: 1800,
  }));

  const msg = recv.Messages?.[0];
  if (!msg?.Body) {
    console.log("[worker] no messages in queue — exiting");
    return null;
  }

  const { jobId, runId, instanceId: msgInstanceId } = JSON.parse(msg.Body) as { jobId: string; runId: string; brand: string; instanceId?: string };
  console.log(`[worker] received job ${jobId} runId=${runId} instanceId=${msgInstanceId ?? "(none)"}`);

  // Stale message guard: if job is already finished, discard and exit
  try {
    const { job } = await api(`/worker/jobs/${jobId}`) as { job: { status: string } | null; reel: unknown };
    if (job && (job.status === "succeeded" || job.status === "failed")) {
      console.log(`[worker] job ${jobId} already ${job.status} — discarding stale SQS message`);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle! })).catch(() => {});
      return msgInstanceId ?? null;
    }
  } catch {
    // If API call fails, proceed and let normal error handling deal with it
  }

  await api(`/worker/jobs/${jobId}`, "PUT", {
    status: "running",
    startedAt: new Date().toISOString(),
    error: "",
  });
  await api(`/worker/reels/${runId}`, "PUT", {
    status: "generating",
    currentStage: "reel-stage5-assemble",
  });

  let failed = false;
  let errorMsg = "";

  try {
    const { reel } = await api(`/worker/jobs/${jobId}`) as { job: unknown; reel: any };

    const script = JSON.parse(reel.script) as ReelScript;
    const brand = getBrand(reel.brand as "ds" | "ns");
    const workDir = path.join(WORK_BASE, runId);
    fs.mkdirSync(workDir, { recursive: true });

    const sceneCount = script.scenes.length;
    const audioPaths = Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.mp3`));
    const imagePaths = Array.from({ length: sceneCount }, (_, i) => path.join(workDir, `scene${i + 1}.png`));

    const gcs = createGcsService();
    for (const filePath of [...audioPaths, ...imagePaths]) {
      if (!fs.existsSync(filePath)) {
        await gcs.downloadFile(brand.gcsPrefix, runId, path.basename(filePath), filePath);
      }
    }

    // Download music file uploaded by studio before dispatch
    const musicLocalPath = path.join(workDir, "music.mp3");
    if (!fs.existsSync(musicLocalPath)) {
      await gcs.downloadFile(brand.gcsPrefix, runId, "music.mp3", musicLocalPath).catch(() => {
        console.log("[worker] no music.mp3 in GCS — will assemble without music");
      });
    }
    const localMusicList = fs.existsSync(musicLocalPath) ? [musicLocalPath] : [];
    const brandWithMusic = {
      ...brand,
      reels: brand.reels ? {
        ...brand.reels,
        musicFiles: localMusicList,
        musicByCategory: brand.reels.musicByCategory
          ? Object.fromEntries(Object.keys(brand.reels.musicByCategory).map((k) => [k, localMusicList]))
          : undefined,
      } : brand.reels,
    } as typeof brand;

    const storedContext = parseStoredContext(reel.context);

    let ctx: ReelContext = buildWorkerReelContext({
      runId,
      reel,
      brand: brandWithMusic,
      workDir,
      script,
      audioPaths,
      imagePaths,
    });

    const assemblyStart = Date.now();
    ctx = { ...ctx, stage5RenderTelemetry: undefined };
    const patch = await new ReelStage5Facade().run(ctx);
    if (patch.stage5RenderTelemetry) {
      patch.stage5RenderTelemetry = { ...patch.stage5RenderTelemetry, mode: "offloaded" };
    }
    const assemblyDurationMs = Date.now() - assemblyStart;

    const reviewUrl = reel.reviewUrl ?? `${PIPELINE_URL}/review/reel/${runId}`;
    const currentContext = buildWorkerPersistedReelContext({ ...ctx, ...patch });
    const mergedContext = { ...storedContext, ...currentContext };
    if (!("stage5RenderTelemetry" in currentContext)) {
      delete mergedContext.stage5RenderTelemetry;
    }

    await api(`/worker/reels/${runId}`, "PUT", {
      videoGcsUrl: patch.videoGcsUrl,
      reviewUrl,
      context: mergedContext,
      status: "awaiting_approval",
      currentStage: null,
    });

    const shouldNotify = !(reel.reviewUrl && reel.status === "awaiting_approval");
    if (shouldNotify) {
      await api(`/worker/reels/${runId}/notify`, "POST", { reviewUrl, assemblyDurationMs });
    }

    await api(`/worker/jobs/${jobId}`, "PUT", {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      error: "",
    });

    console.log(`[worker] job ${jobId} succeeded`);
  } catch (err) {
    failed = true;
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${jobId} failed:`, errorMsg);
    await api(`/worker/reels/${runId}`, "PUT", { status: "failed", currentStage: null }).catch(() => {});
    await api(`/worker/jobs/${jobId}`, "PUT", {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: errorMsg,
    }).catch(() => {});
  } finally {
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: msg.ReceiptHandle!,
    })).catch(() => {});
  }

  if (failed) process.exitCode = 1;
  return msgInstanceId ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then((instanceId) => {
      if (instanceId) return selfTerminate(instanceId);
    })
    .catch((err) => {
      console.error("[worker] fatal:", err);
      process.exitCode = 1;
    });
}
