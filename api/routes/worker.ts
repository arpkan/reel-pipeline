import { Hono } from "hono";
import { getAssemblyJobById, getReelById, updateAssemblyJob, updateReel } from "../../src/db/queries.js";
import { notifyReelReady, renderCompletedProgressMessage } from "../../src/pipeline/reel-runner.js";
import type { ReelProgressState } from "../../src/pipeline/reel-runner.js";
import { createTelegramService } from "../../src/services/telegram.js";
import { getBrand } from "../../src/brands/index.js";
import type { BrandId } from "../../src/types.js";

// Shared secret so only trusted worker instances can call these endpoints.
// Worker passes it as Authorization: Bearer <token>.
const WORKER_TOKEN = process.env.WORKER_API_TOKEN;

export const workerRouter = new Hono();

workerRouter.use("/worker/*", async (c, next) => {
  if (!WORKER_TOKEN) return c.json({ error: "Worker API not configured" }, 503);
  const auth = c.req.header("Authorization") ?? "";
  if (auth !== `Bearer ${WORKER_TOKEN}`) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// GET /worker/jobs/:jobId — return job + reel data for the worker
workerRouter.get("/worker/jobs/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = getAssemblyJobById(jobId);
  if (!job) return c.json({ error: "Job not found" }, 404);
  const reel = getReelById(job.runId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  return c.json({ job, reel });
});

// PUT /worker/jobs/:jobId — update job status
workerRouter.put("/worker/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = getAssemblyJobById(jobId);
  if (!job) return c.json({ error: "Job not found" }, 404);
  const body = await c.req.json() as Partial<{
    status: string;
    instanceId: string;
    startedAt: string;
    finishedAt: string;
    error: string;
  }>;
  updateAssemblyJob(jobId, body);
  return c.json({ ok: true });
});

// PUT /worker/reels/:runId — update reel status/video/context
workerRouter.put("/worker/reels/:runId", async (c) => {
  const runId = c.req.param("runId");
  const reel = getReelById(runId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  const body = await c.req.json() as Partial<{
    status: string;
    currentStage: string | null;
    videoGcsUrl: string;
    reviewUrl: string;
    context: Record<string, unknown>;
  }>;
  updateReel(runId, body);
  return c.json({ ok: true });
});

// POST /worker/reels/:runId/notify — send completion notification
workerRouter.post("/worker/reels/:runId/notify", async (c) => {
  const runId = c.req.param("runId");
  const reel = getReelById(runId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  const brand = getBrand(reel.brand as BrandId);
  const body = await c.req.json() as { reviewUrl: string; assemblyDurationMs?: number };

  const storedContext: Record<string, unknown> = reel.context ? JSON.parse(reel.context) : {};
  const progressState = storedContext._progressState as ReelProgressState | undefined;

  if (progressState && body.assemblyDurationMs !== undefined) {
    const text = renderCompletedProgressMessage(progressState, body.assemblyDurationMs, body.reviewUrl);
    const telegram = createTelegramService();
    await telegram.editMessage(progressState.chatId, progressState.msgId, text).catch(() => {});
  } else {
    await notifyReelReady(brand, {
      runId,
      brand,
      status: "awaiting_approval",
      reviewUrl: body.reviewUrl,
      stageLogs: [],
    } as any);
  }
  return c.json({ ok: true });
});
