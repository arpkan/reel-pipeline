import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBrand } from "../src/brands/index.js";
import { createSearchService } from "../src/services/search.js";
import { createBedrockService } from "../src/services/bedrock.js";
import { createGeminiService } from "../src/services/gemini.js";
import { createImageGenService } from "../src/services/image-gen.js";
import { createGcsService } from "../src/services/gcs.js";
import { createTelegramService } from "../src/services/telegram.js";
import { createMetaService } from "../src/services/meta.js";
import * as queries from "../src/db/queries.js";
import {
  createBatchRun,
  updateBatchRunStatus,
  linkBatchReel,
} from "../src/db/queries.js";
import type { BrandId, Services } from "../src/types.js";
import { ReelStage1Script } from "../src/stages/reel-stage1-script.js";
import { ReelStage2Voice } from "../src/stages/reel-stage2-voice.js";
import { ReelStage4Assemble } from "../src/stages/reel-stage4-assemble.js";
import { buildReelReviewHtml } from "../src/review/reel-html-builder.js";
import { acquireAssemblyLock, releaseAssemblyLock, fetchStory, notifyReelReady } from "../src/pipeline/reel-runner.js";

process.env.PIPELINE_DB_PATH = process.env.PIPELINE_DB_PATH || "./data/pipeline.db";

interface BatchTiming {
  prepTotalMs: number;
  prepPerStoryMs: number[];
  imagePromptCount: number;
  imageSubmitMs: number;
  imageWaitMs: number;
  imagePerItemMs: number[];
  assemblyTotalMs: number;
  assemblyPerReelMs: number[];
  assemblyLockWaitMs: number;
  totalWallMs: number;
}

function reelWorkDir(runId: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "reels", runId);
}

function parseArgs(): { brand: BrandId; count: number } {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: tsx scripts/batch-run.ts <brand> --count <N>");
    console.error("  brand: ds or ns");
    console.error("  count: number of reels to batch");
    process.exit(1);
  }
  const brand = args[0] as BrandId;
  if (brand !== "ds" && brand !== "ns") {
    console.error(`Invalid brand: ${brand}. Must be ds or ns.`);
    process.exit(1);
  }
  const countIdx = args.indexOf("--count");
  if (countIdx === -1 || !args[countIdx + 1]) {
    console.error("--count <N> is required");
    process.exit(1);
  }
  const count = parseInt(args[countIdx + 1], 10);
  if (isNaN(count) || count < 1) {
    console.error("--count must be a positive integer");
    process.exit(1);
  }
  return { brand, count };
}

async function main() {
  const { brand: brandId, count } = parseArgs();
  const brand = getBrand(brandId);
  if (!brand.reels?.enabled) {
    console.error(`Reels are not enabled for brand ${brandId}`);
    process.exit(1);
  }

  const batchId = `batch-${brandId}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  console.log(`\n[batch:${brandId}] Starting batch: ${count} reels (${batchId})`);

  createBatchRun({ id: batchId, brand: brandId, count });

  const services: Services = {
    search: createSearchService(),
    bedrock: createBedrockService(),
    gemini: createGeminiService(),
    imageGen: createImageGenService(),
    gcs: createGcsService(),
    telegram: createTelegramService(),
    meta: createMetaService(),
  };

  const timing: BatchTiming = {
    prepTotalMs: 0,
    prepPerStoryMs: [],
    imagePromptCount: 0,
    imageSubmitMs: 0,
    imageWaitMs: 0,
    imagePerItemMs: [],
    assemblyTotalMs: 0,
    assemblyPerReelMs: [],
    assemblyLockWaitMs: 0,
    totalWallMs: 0,
  };

  const wallStart = Date.now();

  interface PreppedReel {
    runId: string;
    runDate: string;
    story: import("../src/types.js").Story;
    ctx: import("../src/types.js").ReelContext;
  }

  const preppedReels: PreppedReel[] = [];

  // ── Phase 1: Prep stories (discover → script → voice) ──────────────────────
  updateBatchRunStatus(batchId, "prepping");
  const prepStart = Date.now();
  console.log(`\n[batch:${brandId}] Phase 1: prepping ${count} stories...`);

  for (let i = 0; i < count; i++) {
    const storyStart = Date.now();
    const runId = randomUUID();
    const runDate = new Date().toLocaleDateString("en-CA", { timeZone: brand.timezone });
    const workDir = reelWorkDir(runId);
    fs.mkdirSync(workDir, { recursive: true });

    let ctx: import("../src/types.js").ReelContext = {
      runId,
      brand,
      runDate,
      workDir,
      status: "running",
      stageLogs: [],
    };

    try {
      // Stage 0: Fetch story
      console.log(`\n[batch:${brandId}] Story ${i + 1}/${count}: discovering...`);
      const recentTopics = [
        ...queries.getRecentReelHeadlines(brandId, 30),
        ...queries.getRecentPostHeadlines(brandId, 20),
      ];
      const fetchResult = await fetchStory(ctx, {}, undefined, recentTopics);
      ctx = {
        ...ctx,
        story: fetchResult.story,
        themeSource: fetchResult.themeSource,
        pillarBalance: fetchResult.pillarBalance,
        trendingSignals: fetchResult.trendingSignals,
        recentTopics,
      };

      queries.createReel({
        id: runId,
        brand: brandId,
        runDate,
        headline: fetchResult.story.headline,
        sourceUrl: fetchResult.story.sourceUrl,
        snippet: fetchResult.story.snippet.slice(0, 2000),
      });

      // Stage 1: Script
      console.log(`  [reel-stage1-script]`);
      const scriptResult = await new ReelStage1Script().run(ctx);
      ctx = { ...ctx, ...scriptResult };
      queries.updateReel(runId, { script: ctx.script, category: ctx.category });

      // Stage 2: Voice
      console.log(`  [reel-stage2-voice]`);
      const voiceResult = await new ReelStage2Voice().run(ctx);
      ctx = { ...ctx, ...voiceResult };
      queries.updateReel(runId, { script: ctx.script });

      preppedReels.push({ runId, runDate, story: fetchResult.story, ctx });
      linkBatchReel(batchId, runId);

      const storyMs = Date.now() - storyStart;
      timing.prepPerStoryMs.push(storyMs);
      console.log(`[batch:${brandId}] Story ${i + 1}/${count}: complete in ${(storyMs / 60_000).toFixed(1)}m`);
    } catch (err) {
      console.error(`[batch:${brandId}] Story ${i + 1}/${count} FAILED: ${err instanceof Error ? err.message : err}`);
      queries.updateReel(runId, { status: "failed", currentStage: null });
    }
  }

  timing.prepTotalMs = Date.now() - prepStart;
  const avgPrep = timing.prepPerStoryMs.length > 0
    ? (timing.prepTotalMs / timing.prepPerStoryMs.length / 60_000).toFixed(1)
    : "?";
  console.log(`\n[batch:${brandId}] Phase 1 complete: ${preppedReels.length}/${count} stories prepped in ${(timing.prepTotalMs / 60_000).toFixed(0)}m (avg ${avgPrep}m/story)`);

  if (preppedReels.length === 0) {
    updateBatchRunStatus(batchId, "failed", { timing, error: "All stories failed in prep phase" });
    console.error(`[batch:${brandId}] ABORT: no stories prepped`);
    process.exit(1);
  }

  // ── Phase 2: Batch image generation ────────────────────────────────────────
  updateBatchRunStatus(batchId, "submitting_images");

  const imagePrompts: Array<{ key: string; prompt: string; reelId: string; sceneNumber: number }> = [];
  for (const reel of preppedReels) {
    if (!reel.ctx.script) continue;
    for (const scene of reel.ctx.script.scenes) {
      imagePrompts.push({
        key: `${reel.runId}-scene${scene.sceneNumber}`,
        prompt: scene.imagePrompt,
        reelId: reel.runId,
        sceneNumber: scene.sceneNumber,
      });
    }
  }

  timing.imagePromptCount = imagePrompts.length;
  console.log(`\n[batch:${brandId}] Phase 2: submitting ${imagePrompts.length} images (${preppedReels.length} stories × scenes) to batch API`);

  const imageSubmitStart = Date.now();
  const batchResult = await services.imageGen.generateBatch(imagePrompts);
  timing.imageSubmitMs = 0; // included in totalWaitMs
  timing.imageWaitMs = batchResult.totalWaitMs;
  timing.imagePerItemMs = batchResult.perItemMs;

  console.log(`[batch:${brandId}] Phase 2: ${batchResult.status} — ${batchResult.images.size}/${imagePrompts.length} images in ${(batchResult.totalWaitMs / 60_000).toFixed(0)}m`);

  if (batchResult.status !== "SUCCEEDED" || batchResult.images.size === 0) {
    updateBatchRunStatus(batchId, "failed", { timing, error: `Batch image job ${batchResult.status}` });
    console.error(`[batch:${brandId}] ABORT: batch image job ${batchResult.status}`);
    process.exit(1);
  }

  updateBatchRunStatus(batchId, "waiting_images");

  // Write batch images to work dirs
  for (const { key, reelId, sceneNumber } of imagePrompts) {
    const imgBuffer = batchResult.images.get(key);
    if (!imgBuffer) continue;
    const workDir = reelWorkDir(reelId);
    const outPath = path.join(workDir, `scene${sceneNumber}.png`);
    fs.writeFileSync(outPath, imgBuffer);

    // Validate portrait orientation
    const { spawnSync } = await import("child_process");
    const probeResult = spawnSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0", outPath,
    ], { encoding: "utf8" });
    const [w, h] = probeResult.stdout.trim().split(",").map(Number);
    if (w && h && w >= h) {
      const targetW = Math.floor(h * 9 / 16);
      const x = Math.floor((w - targetW) / 2);
      const croppedPath = outPath.replace(".png", "_portrait.png");
      spawnSync("ffmpeg", ["-i", outPath, "-vf", `crop=${targetW}:${h}:${x}:0`, "-y", croppedPath]);
      fs.renameSync(croppedPath, outPath);
    }
  }

  // Update reel contexts with image paths
  for (const reel of preppedReels) {
    if (!reel.ctx.script) continue;
    const imagePaths: string[] = [];
    for (const scene of reel.ctx.script.scenes) {
      const imgPath = path.join(reelWorkDir(reel.runId), `scene${scene.sceneNumber}.png`);
      if (fs.existsSync(imgPath)) imagePaths.push(imgPath);
    }
    reel.ctx = { ...reel.ctx, imagePaths };
  }

  // ── Phase 3: Assembly (queue-based, respects _assemblyLock) ────────────────
  updateBatchRunStatus(batchId, "assembling");
  const assemblyStart = Date.now();
  console.log(`\n[batch:${brandId}] Phase 3: assembling ${preppedReels.length} reels...`);

  for (let i = 0; i < preppedReels.length; i++) {
    const reel = preppedReels[i];
    if (!reel.ctx.imagePaths?.length) {
      console.warn(`[batch:${brandId}] Reel ${i + 1}: no images — skipping assembly`);
      continue;
    }

    const lockStart = Date.now();
    console.log(`\n[assembly-lock] reel ${i + 1}/${preppedReels.length} waiting for slot...`);
    await acquireAssemblyLock();
    const lockWait = Date.now() - lockStart;
    timing.assemblyLockWaitMs += lockWait;
    if (lockWait > 1000) {
      console.log(`[assembly-lock] waited ${(lockWait / 60_000).toFixed(1)}m`);
    }
    console.log(`[assembly-lock] acquired`);

    const reelAsmStart = Date.now();
    try {
      queries.updateReel(reel.runId, { currentStage: "reel-stage4-assemble" });
      const asmResult = await new ReelStage4Assemble().run(reel.ctx);
      reel.ctx = { ...reel.ctx, ...asmResult };

      queries.updateReel(reel.runId, {
        videoGcsUrl: reel.ctx.videoGcsUrl,
        context: {
          themeSource: reel.ctx.themeSource,
          pillarBalance: reel.ctx.pillarBalance,
          trendingSignals: reel.ctx.trendingSignals,
        },
        status: "awaiting_approval",
        currentStage: null,
      });

      // Build review page
      const html = buildReelReviewHtml(reel.ctx);
      const reviewUrl = await services.gcs.uploadHtml(brand.gcsPrefix, reel.runId, html);
      queries.updateReel(reel.runId, { reviewUrl });

      // Notify
      await notifyReelReady(brand, reel.ctx);

      const asmMs = Date.now() - reelAsmStart;
      timing.assemblyPerReelMs.push(asmMs);
      console.log(`[batch:${brandId}] Reel ${i + 1}/${preppedReels.length}: assembled in ${(asmMs / 60_000).toFixed(1)}m`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[batch:${brandId}] Reel ${i + 1} assembly FAILED: ${msg}`);
      queries.updateReel(reel.runId, { status: "failed", currentStage: null });
    } finally {
      releaseAssemblyLock();
      console.log(`[assembly-lock] released`);
    }
  }

  timing.assemblyTotalMs = Date.now() - assemblyStart;
  timing.totalWallMs = Date.now() - wallStart;

  const avgAsm = timing.assemblyPerReelMs.length > 0
    ? (timing.assemblyTotalMs / timing.assemblyPerReelMs.length / 60_000).toFixed(1)
    : "?";
  console.log(`\n[batch:${brandId}] Phase 3 complete: ${timing.assemblyPerReelMs.length} reels assembled in ${(timing.assemblyTotalMs / 60_000).toFixed(0)}m (avg ${avgAsm}m/reel, lock wait ${(timing.assemblyLockWaitMs / 60_000).toFixed(1)}m)`);

  // ── Done ───────────────────────────────────────────────────────────────────
  const successCount = timing.assemblyPerReelMs.length;
  const finalStatus = successCount > 0 ? "done" : "failed";
  updateBatchRunStatus(batchId, finalStatus, { timing });

  const costPerImage = 0.023;
  const totalCost = (batchResult.images.size * costPerImage).toFixed(2);
  const standardCost = (batchResult.images.size * 0.045).toFixed(2);

  console.log(`\n${finalStatus === "done" ? "✅" : "❌"} [batch:${brandId}] COMPLETE: ${successCount}/${count} reels`);
  console.log(`  Prep:      ${(timing.prepTotalMs / 60_000).toFixed(0)}m`);
  console.log(`  Images:    ${batchResult.images.size}/${imagePrompts.length} in ${(timing.imageWaitMs / 60_000).toFixed(0)}m`);
  console.log(`  Assembly:  ${(timing.assemblyTotalMs / 60_000).toFixed(0)}m (lock wait ${(timing.assemblyLockWaitMs / 60_000).toFixed(1)}m)`);
  console.log(`  Total:     ${(timing.totalWallMs / 60_000).toFixed(0)}m`);
  console.log(`  Cost:      $${totalCost} (batch) vs $${standardCost} (standard) — saved $${(parseFloat(standardCost) - parseFloat(totalCost)).toFixed(2)}`);
}

main().catch((err) => {
  console.error("[batch] fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
