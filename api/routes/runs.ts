import { Hono } from "hono";
import { ReelRunner } from "../../src/pipeline/reel-runner.js";
import { getRecentRuns, getRunById, getReelById, getRecentReels, createReel, updateReel } from "../../src/db/queries.js";
import type { BrandId, Theme, ReelCategory, ReelScript } from "../../src/types.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_BRANDS: BrandId[] = ["ds", "ns"];

export const runsRouter = new Hono();

// GET /runs/:brand — list recent runs
runsRouter.get("/runs/:brand", (c) => {
  const brand = c.req.param("brand") as BrandId;
  if (!VALID_BRANDS.includes(brand)) {
    return c.json({ error: `Unknown brand: ${brand}` }, 400);
  }
  const limit = parseInt(c.req.query("limit") ?? "20");
  const runs = getRecentRuns(brand, limit);
  return c.json(runs);
});

// GET /runs/:brand/:runId — run detail
runsRouter.get("/runs/:brand/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = getRunById(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json(run);
});

// ─── Reel routes ──────────────────────────────────────────────────────────────

// POST /reels/:brand — trigger a new reel
runsRouter.post("/reels/:brand", async (c) => {
  const brand = c.req.param("brand") as BrandId;
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);
  const body = await c.req.json().catch(() => ({})) as { category?: ReelCategory; theme?: string };
  ReelRunner.run(brand, { category: body.category, theme: body.theme as Theme }).catch((err: unknown) => {
    console.error(`[api] reel run failed for ${brand}:`, err instanceof Error ? err.message : err);
  });
  return c.json({ status: "started", brand });
});

// GET /reels/:brand — list recent reels
runsRouter.get("/reels/:brand", (c) => {
  const brand = c.req.param("brand") as BrandId;
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);
  const limit = parseInt(c.req.query("limit") ?? "10");
  return c.json(getRecentReels(brand, limit));
});

// GET /reels/:brand/:reelId — reel detail
runsRouter.get("/reels/:brand/:reelId", (c) => {
  const reel = getReelById(c.req.param("reelId"));
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  return c.json(reel);
});

// POST /reels/:brand/:reelId/resume — resume from last completed stage
runsRouter.post("/reels/:brand/:reelId/resume", async (c) => {
  const brand = c.req.param("brand") as BrandId;
  const reelId = c.req.param("reelId");
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);
  const reel = getReelById(reelId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  ReelRunner.resume(reelId, brand).catch((err: unknown) => {
    console.error(`[api] reel resume failed:`, err instanceof Error ? err.message : err);
  });
  return c.json({ status: "resuming", reelId });
});

// POST /reels/:brand/:reelId/rebuild — force re-run stages 2-4 from scratch
runsRouter.post("/reels/:brand/:reelId/rebuild", async (c) => {
  const brand = c.req.param("brand") as BrandId;
  const reelId = c.req.param("reelId");
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);
  const reel = getReelById(reelId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  ReelRunner.rebuild(reelId, brand).catch((err: unknown) => {
    console.error(`[api] reel rebuild failed:`, err instanceof Error ? err.message : err);
  });
  return c.json({ status: "rebuilding", reelId });
});

// POST /reels/:brand/:reelId/rerescript — re-run stages 1-4
runsRouter.post("/reels/:brand/:reelId/rerescript", async (c) => {
  const brand = c.req.param("brand") as BrandId;
  const reelId = c.req.param("reelId");
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);
  const reel = getReelById(reelId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as { category?: ReelCategory };
  ReelRunner.rerescript(reelId, brand, body.category).catch((err: unknown) => {
    console.error(`[api] reel rerescript failed:`, err instanceof Error ? err.message : err);
  });
  return c.json({ status: "rescripting", reelId });
});

// POST /reels/:brand/:reelId/fork — create new reel inheriting assets from source
runsRouter.post("/reels/:brand/:reelId/fork", async (c) => {
  const brand = c.req.param("brand") as BrandId;
  const sourceReelId = c.req.param("reelId");
  if (!VALID_BRANDS.includes(brand)) return c.json({ error: `Unknown brand: ${brand}` }, 400);

  const body = await c.req.json().catch(() => ({})) as { fromStage?: string };
  const fromStage = body.fromStage;
  const validFromStages = ["script", "voice", "images", "assembly"];
  if (!fromStage || !validFromStages.includes(fromStage)) {
    return c.json({ error: `fromStage must be one of: ${validFromStages.join(", ")}` }, 400);
  }

  const sourceReel = getReelById(sourceReelId);
  if (!sourceReel) return c.json({ error: "Source reel not found" }, 404);

  const newReelId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  createReel({
    id: newReelId,
    brand,
    runDate: today,
    headline: sourceReel.headline,
    sourceUrl: sourceReel.sourceUrl,
    snippet: sourceReel.snippet ?? undefined,
  });

  // Copy script + category for non-script forks (resume requires script in DB)
  if (fromStage !== "script" && sourceReel.script) {
    updateReel(newReelId, {
      script: JSON.parse(sourceReel.script) as ReelScript,
      category: sourceReel.category ?? undefined,
    });
  }

  // Copy work dir assets based on fromStage
  const srcWorkDir = path.join(process.cwd(), "work", "reels", sourceReelId);
  const dstWorkDir = path.join(process.cwd(), "work", "reels", newReelId);

  if (fs.existsSync(srcWorkDir)) {
    fs.mkdirSync(dstWorkDir, { recursive: true });
    for (const file of fs.readdirSync(srcWorkDir)) {
      const shouldCopy =
        (fromStage === "assembly" && (file.endsWith(".mp3") || file.endsWith(".png"))) ||
        (fromStage === "images"   && file.endsWith(".mp3"));
      if (shouldCopy) {
        fs.copyFileSync(path.join(srcWorkDir, file), path.join(dstWorkDir, file));
      }
    }
  }

  // Run the forked reel — fire and forget
  if (fromStage === "script") {
    ReelRunner.rerescript(newReelId, brand).catch((err: unknown) => {
      console.error(`[api] fork rerescript failed for ${newReelId}:`, err instanceof Error ? err.message : err);
    });
  } else {
    ReelRunner.resume(newReelId, brand).catch((err: unknown) => {
      console.error(`[api] fork resume failed for ${newReelId}:`, err instanceof Error ? err.message : err);
    });
  }

  return c.json({ reelId: newReelId, fromStage, sourceReelId });
});
