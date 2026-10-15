/**
 * test/runner.ts
 *
 * CLI script to run individual pipeline stages against test.db and compare
 * results to stored snapshots.
 *
 * Usage:
 *   npx tsx test/runner.ts --stage=<0|1|2|3|4|all> [--brand=<ds|ns>] [--update]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { RunContext, Services } from "../src/types.js";
import type { DiffResult } from "./compare.js";

// ---------------------------------------------------------------------------
// ESM __dirname shim
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function resolveFixturePath(fileName: string, baseDir = __dirname, cwd = process.cwd()): string {
  const baseProjectRoot = path.resolve(baseDir, "..");
  const candidates = [
    path.resolve(baseDir, "fixtures", fileName),
    path.resolve(baseProjectRoot, "test", "fixtures", fileName),
    path.resolve(cwd, "test", "fixtures", fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Fixture not found: ${fileName}. Looked in: ${candidates.join(", ")}`);
}

export function createStage1GeminiMockReply(): () => Record<string, unknown> {
  return () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                selectedIndex: 0,
                headline: "Test Story Title",
                source: "Reuters",
                theme: "Politics",
                selectionReason: "Important and timely event for readers.",
              }),
            },
          ],
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StageId = "1";
const VALID_STAGES: StageId[] = ["1"];

export interface AllStagesDiffResult {
  passed: boolean;
  stage: "all";
  results: DiffResult[];
}

// ---------------------------------------------------------------------------
// Core logic (shared by CLI and API)
// ---------------------------------------------------------------------------

async function buildRunContext(brand: "ds" | "ns"): Promise<RunContext> {
  const { createRunContext } = await import("../src/pipeline/context.js");
  const { getBrand } = await import("../src/brands/index.js");

  const dbPath = process.env.PIPELINE_DB_PATH!;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`test.db not found at ${dbPath} — run npm run test:seed first`);
  }

  const db = new Database(dbPath, { readonly: true });
  let runRow: Record<string, unknown> | undefined;
  try {
    runRow = db
      .prepare("SELECT * FROM runs WHERE brand = ? LIMIT 1")
      .get(brand) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }

  if (!runRow) {
    throw new Error(`No run found for brand "${brand}" in test.db`);
  }

  const brandConfig = getBrand(brand);
  const ctx = createRunContext(
    String(runRow["id"]),
    brandConfig,
    String(runRow["run_date"]),
    runRow["theme"] ? { theme: runRow["theme"] as any } : undefined
  );

  // Restore stored state from DB if present
  if (runRow["stories"]) {
    try {
      (ctx as any).stories = JSON.parse(String(runRow["stories"]));
    } catch {
      // ignore parse errors
    }
  }
  if (runRow["status"]) {
    (ctx as any).status = runRow["status"];
  }
  if (runRow["review_url"]) {
    (ctx as any).reviewUrl = runRow["review_url"];
  }

  return ctx;
}

async function buildServices(): Promise<Services> {
  const { createSearchService } = await import("../src/services/search.js");
  const { createBedrockService } = await import("../src/services/bedrock.js");
  const { createGeminiService } = await import("../src/services/gemini.js");
  const { createImageGenService } = await import("../src/services/image-gen.js");
  const { createGcsService } = await import("../src/services/gcs.js");
  const { createTelegramService } = await import("../src/services/telegram.js");
  const { createLineService } = await import("../src/services/line.js");
  const { createMetaService } = await import("../src/services/meta.js");
  const { createStockImageService } = await import("../src/services/stock-image.js");

  const search = createSearchService();
  const bedrock = createBedrockService();
  const gemini = createGeminiService();
  const imageGen = createImageGenService();
  const gcs = createGcsService();
  const telegram = createTelegramService();
  const line = (() => {
    try {
      return createLineService();
    } catch {
      return null;
    }
  })();
  const meta = createMetaService();
  const stockImage = createStockImageService();

  return { search, bedrock, gemini, imageGen, gcs, telegram, line, meta, stockImage };
}

async function setupStage1Nock(): Promise<void> {
  const nock = (await import("nock")).default;
  const tavilyFixture = JSON.parse(
    fs.readFileSync(resolveFixturePath("tavily-search.json"), "utf8")
  );
  const nextGeminiReply = createStage1GeminiMockReply();

  // Mock Google News RSS feed (only actual RSS feed URL with query string)
  nock("https://news.google.com")
    .get(/\/rss\?/)
    .reply(
      200,
      `<?xml version="1.0"?><rss><channel>
        <item>
          <title>Test Story Title - Reuters</title>
          <link>https://news.google.com/rss/articles/TEST123?oc=5</link>
          <pubDate>Tue, 19 May 2026 08:00:00 GMT</pubDate>
          <source url="https://reuters.com">Reuters</source>
        </item>
      </channel></rss>`,
      { "Content-Type": "application/rss+xml" }
    )
    .persist();

  // Mock Google News article redirect (302 redirect to real domain)
  nock("https://news.google.com")
    .get(/\/rss\/articles\//)
    .reply(302, "", { Location: "https://reuters.com/world/test-article" });

  // Mock redirect target (follow-up request after redirect)
  nock("https://reuters.com")
    .get("/world/test-article")
    .reply(200, "<html><body>Article content</body></html>");

  // Mock Tavily (snippet fetch + any fallback calls)
  nock("https://api.tavily.com")
    .post("/search")
    .reply(200, tavilyFixture)
    .persist();

  // Mock Gemini generate endpoint (non-agentic JSON response)
  nock("https://generativelanguage.googleapis.com")
    .post(/.*/)
    .reply(() => [200, nextGeminiReply()])
    .persist();
}

async function setupStage3Nock(): Promise<void> {
  const nock = (await import("nock")).default;
  const imagenFixture = JSON.parse(
    fs.readFileSync(resolveFixturePath("imagen-batch.json"), "utf8")
  );

  // Intercept Imagen (Vertex AI) endpoint
  nock(/https:\/\/.*\.googleapis\.com/)
    .post(/.*/)
    .reply(200, imagenFixture)
    .persist();
}

async function setupStage4Nock(): Promise<void> {
  const nock = (await import("nock")).default;

  // Intercept Telegram
  nock("https://api.telegram.org")
    .get(/.*/)
    .reply(200, { ok: true, result: [] })
    .persist();
  nock("https://api.telegram.org")
    .post(/.*/)
    .reply(200, { ok: true, result: [] })
    .persist();

  // Intercept LINE
  nock("https://api.line.me")
    .get(/.*/)
    .reply(200, { status: "ok" })
    .persist();
  nock("https://api.line.me")
    .post(/.*/)
    .reply(200, { status: "ok" })
    .persist();
}

async function setupReelNock(fromStage: string): Promise<void> {
  const nock = (await import("nock")).default;

  if (fromStage === "1") {
    await setupStage1Nock();
  }

  if (fromStage === "script") {
    nock(/bedrock.*amazonaws\.com/)
      .post(/.*/)
      .reply(200, {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{
          type: "text",
          text: JSON.stringify({
            category: "trending",
            title: "Test Reel",
            scenes: [
              { sceneNumber: 1, voiceover: "Test voiceover one.", caption: "Test Caption", imagePrompt: "Test image prompt one" },
              { sceneNumber: 2, voiceover: "Test voiceover two.", caption: "Scene Two", imagePrompt: "Test image prompt two" }
            ],
            hashtags: ["#TestReel"]
          })
        }],
        model: "us.anthropic.claude-sonnet-4-6",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 50 }
      })
      .persist();
  }

  if (fromStage === "voice") {
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/)
      .reply(200, {
        audio_base64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
        alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] },
        normalized_alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }
      })
      .persist();
  }

  if (fromStage === "images") {
    nock(/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/)
      .post(/.*/)
      .reply(200, {
        predictions: [{
          bytesBase64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          mimeType: "image/png"
        }]
      })
      .persist();
  }

  if (fromStage === "assembly") {
    nock(/storage\.googleapis\.com/)
      .put(/.*/)
      .reply(200, {})
      .persist();
  }
}

async function runSingleStage(stageId: StageId, ctx: RunContext, services: Services): Promise<RunContext> {
  const { mergeStageOutput } = await import("../src/pipeline/context.js");

  let stage: { run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> };

  switch (stageId) {
    case "1": {
      await setupStage1Nock();
      const { Stage1Discover } = await import("../src/stages/stage1-discover.js");
      stage = new Stage1Discover();
      break;
    }
    default:
      throw new Error(`Unknown stage: ${stageId}`);
  }

  console.log(`\nRunning stage ${stageId}...`);
  const partial = await stage.run(ctx, services);
  return mergeStageOutput(ctx, partial);
}

function printResult(stageId: string, result: DiffResult): void {
  if (result.passed) {
    console.log(`  [PASS] Stage ${stageId} — snapshot matches`);
  } else {
    console.log(`  [FAIL] Stage ${stageId} — snapshot differs`);
    if (result.added.length > 0) {
      console.log(`    Added rows:   ${result.added.length}`);
    }
    if (result.removed.length > 0) {
      console.log(`    Removed rows: ${result.removed.length}`);
    }
    if (result.changed.length > 0) {
      console.log(`    Changed rows: ${result.changed.length}`);
      for (const ch of result.changed) {
        console.log(`      id=${ch.id}: ${ch.fields.map((f) => f.field).join(", ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exported API function
// ---------------------------------------------------------------------------

export async function runStageForApi(
  stage: string,
  brand: string,
  update: boolean
): Promise<DiffResult | AllStagesDiffResult> {
  // Save and restore PIPELINE_DB_PATH so we don't permanently redirect
  // production DB queries while running inside a live server.
  const savedDbPath = process.env.PIPELINE_DB_PATH;
  process.env.PIPELINE_DB_PATH = path.resolve(projectRoot, "test.db");

  // Set dummy API keys only when not already present (??= preserves real values)
  process.env.TAVILY_API_KEY ??= "test-key";
  process.env.GEMINI_API_KEY ??= "test-key";
  process.env.GEMINI_IMAGE_API_KEY ??= "test-key";
  process.env.GCS_BUCKET ??= "test-bucket";
  process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
  process.env.AWS_ACCESS_KEY_ID ??= "test-key";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret";
  process.env.AWS_REGION ??= "us-east-1";

  try {
    const { compareStage } = await import("./compare.js");

    const brandId = (brand || "ds") as "ds" | "ns";
    if (brandId !== "ds" && brandId !== "ns") {
      throw new Error(`Invalid brand "${brand}". Must be "ds" or "ns"`);
    }

    const ctx = await buildRunContext(brandId);
    const services = await buildServices();

    if (stage === "all") {
      const stageResults: DiffResult[] = [];
      let allPassed = true;
      let runCtx = ctx;
      for (const stageId of VALID_STAGES) {
        runCtx = await runSingleStage(stageId, runCtx, services);
        const result = compareStage(stageId, { update });
        stageResults.push(result);
        if (!result.passed) allPassed = false;
      }
      return { passed: allPassed, stage: "all", results: stageResults };
    }

    if (!VALID_STAGES.includes(stage as StageId)) {
      throw new Error(`Unknown stage "${stage}". Valid: ${VALID_STAGES.join(", ")}, all`);
    }

    const runCtx = await runSingleStage(stage as StageId, ctx, services);
    const result = compareStage(stage, { update });
    return result;
  } finally {
    process.env.PIPELINE_DB_PATH = savedDbPath;
  }
}

// ---------------------------------------------------------------------------
// Reel stage runner
// ---------------------------------------------------------------------------

const REEL_STAGE_ORDER = ["0", "1", "script", "voice", "images", "assembly"] as const;
type ReelFromStage = typeof REEL_STAGE_ORDER[number];

const REEL_SNAPSHOT_KEYS: Record<string, string> = {
  "0": "0",
  "1": "1",
  script: "reel-script",
  voice: "reel-voice",
  images: "reel-images",
  assembly: "reel-assembly",
};

export interface ReelMultiDiffResult {
  passed: boolean;
  fromStage: string;
  sequential: boolean;
  results: DiffResult[];
}

export interface TestRunOverrides {
  theme?: string;
  category?: string;
  sourceUrl?: string;
  sceneCount?: number;
  voiceId?: string;
  voiceProvider?: "elevenlabs" | "uvoice";
  voiceSpeed?: number;
  voiceModel?: string;
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  useStockImages?: boolean;
  stockProvider?: string;
  imageModel?: string;
  musicTrack?: string;
  musicVolume?: number;
}

export async function runReelStage(
  fromStage: string,
  brand: string,
  update: boolean,
  sequential = false,
  reelId?: string,
  overrides?: TestRunOverrides,
): Promise<DiffResult | ReelMultiDiffResult> {
  if (!REEL_STAGE_ORDER.includes(fromStage as ReelFromStage)) {
    throw new Error(`Invalid fromStage: ${fromStage}. Must be one of: ${REEL_STAGE_ORDER.join(", ")}`);
  }

  const savedDbPath = process.env.PIPELINE_DB_PATH;
  let savedElModel: string | undefined = process.env.TEST_ELEVENLABS_MODEL;
  process.env.PIPELINE_DB_PATH = path.resolve(projectRoot, "test.db");
  process.env.TAVILY_API_KEY ??= "test-key";
  process.env.GEMINI_IMAGE_API_KEY ??= "test-key";
  process.env.GEMINI_API_KEY ??= "test-key";
  process.env.ELEVENLABS_API_KEY ??= "test-key";
  process.env.AWS_ACCESS_KEY_ID ??= "test-key";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret";
  process.env.AWS_REGION ??= "us-east-1";
  process.env.GCS_BUCKET ??= "test-bucket";
  process.env.TELEGRAM_BOT_TOKEN ??= "test-token";

  try {
    const startIdx = REEL_STAGE_ORDER.indexOf(fromStage as ReelFromStage);
    const stagesToRun = sequential
      ? REEL_STAGE_ORDER.slice(startIdx)
      : [fromStage as ReelFromStage];

    const { default: Db } = await import("better-sqlite3");
    const { getBrand } = await import("../src/brands/index.js");
    const { compareStage } = await import("./compare.js");

    const testDbPath = process.env.PIPELINE_DB_PATH!;
    if (!fs.existsSync(testDbPath)) {
      throw new Error("test.db not found — run npm run test:seed first");
    }

    const db = new Db(testDbPath, { readonly: true });
    let reelRow: Record<string, unknown> | undefined;
    try {
      reelRow = reelId
        ? db.prepare("SELECT * FROM reels WHERE id = ? AND brand = ? LIMIT 1").get(reelId, brand) as Record<string, unknown> | undefined
        : db.prepare("SELECT * FROM reels WHERE brand = ? LIMIT 1").get(brand) as Record<string, unknown> | undefined;
    } finally {
      db.close();
    }

    if (!reelRow) throw new Error(`No reel found for brand=${brand} in test.db — run npm run test:seed first`);

    const selectedReelId = String(reelRow["id"]);
    const testWorkDir = path.resolve(projectRoot, "test", "work", "reels", selectedReelId);
    const brandConfig = getBrand(brand as import("../src/types.js").BrandId);

    // Clone brand config and apply overrides (never mutate the global config)
    const clonedReels = brandConfig.reels ? { ...brandConfig.reels } : undefined;
    if (clonedReels && overrides) {
      if (overrides.voiceSpeed !== undefined) clonedReels.voiceSpeed = overrides.voiceSpeed;
      if (overrides.musicVolume !== undefined) clonedReels.musicVolume = overrides.musicVolume;
      if (overrides.voiceId) {
        const existingEntry = clonedReels.voices?.find(v => v.id === overrides.voiceId);
        const entry = existingEntry
          ? { ...existingEntry, ...(overrides.voiceSpeed !== undefined ? { speed: overrides.voiceSpeed } : {}) }
          : { id: overrides.voiceId, provider: (overrides.voiceProvider ?? "elevenlabs") as "elevenlabs" | "uvoice", ...(overrides.voiceSpeed !== undefined ? { speed: overrides.voiceSpeed } : {}) };
        clonedReels.voices = [entry];
      }
      if (overrides.sceneCount !== undefined) clonedReels.sceneCount = overrides.sceneCount;
    }
    const clonedBrand = { ...brandConfig, reels: clonedReels };

    // Apply env-level overrides temporarily
    if (overrides?.voiceModel) process.env.TEST_ELEVENLABS_MODEL = overrides.voiceModel;

    const reelCtx: import("../src/types.js").ReelContext = {
      runId: selectedReelId,
      brand: clonedBrand as import("../src/types.js").BrandConfig,
      runDate: String(reelRow["run_date"] ?? ""),
      workDir: testWorkDir,
      story: overrides?.sourceUrl
        ? {
            index: 0,
            headline: String(reelRow["headline"] ?? ""),
            sourceUrl: overrides.sourceUrl,
            snippet: String(reelRow["snippet"] ?? ""),
            source: "",
            selectionReason: "",
            compositeScore: 0,
            verified: true,
          }
        : {
            index: 0,
            headline: String(reelRow["headline"] ?? ""),
            sourceUrl: String(reelRow["source_url"] ?? ""),
            snippet: String(reelRow["snippet"] ?? ""),
            source: "",
            selectionReason: "",
            compositeScore: 0,
            verified: true,
          },
      script: reelRow["script"] ? JSON.parse(String(reelRow["script"])) : undefined,
      category: (overrides?.category as import("../src/types.js").ReelCategory | undefined) ?? reelRow["category"] as import("../src/types.js").ReelCategory | undefined,
      theme: overrides?.theme as import("../src/types.js").Theme | undefined,
      useStockImages: overrides?.useStockImages,
      musicTrackOverride: overrides?.musicTrack,
      status: "running" as import("../src/types.js").RunStatus,
      stageLogs: [],
    };

    fs.mkdirSync(testWorkDir, { recursive: true });

    const runCtx: import("../src/types.js").RunContext = {
      runId: selectedReelId,
      brand: clonedBrand as import("../src/types.js").BrandConfig,
      runDate: String(reelRow["run_date"] ?? ""),
      theme: overrides?.theme as import("../src/types.js").Theme | undefined,
      stories: [],
      posts: [],
      status: "running" as import("../src/types.js").RunStatus,
      stageLogs: [],
      useStockImages: overrides?.useStockImages,
    };

    const services = await buildServices();

    for (const stage of stagesToRun) {
      await setupReelNock(stage);

      if (stage === "1") {
        const { Stage1Discover } = await import("../src/stages/stage1-discover.js");
        const partial = await new Stage1Discover().run(runCtx, services);
        Object.assign(runCtx, partial);
        if (runCtx.stories?.[0]) reelCtx.story = runCtx.stories[0];
      } else if (stage === "script") {
        const { ReelStage2Script } = await import("../src/stages/reel-stage2-script.js");
        const partial = await new ReelStage2Script().run(reelCtx);
        Object.assign(reelCtx, partial);
      } else if (stage === "voice") {
        const { ReelStage3Voice } = await import("../src/stages/reel-stage3-voice.js");
        const partial = await new ReelStage3Voice().run(reelCtx);
        Object.assign(reelCtx, partial);
      } else if (stage === "images") {
        const { ReelStage4Images } = await import("../src/stages/reel-stage4-images.js");
        const partial = await new ReelStage4Images().run(reelCtx);
        Object.assign(reelCtx, partial);
      } else if (stage === "assembly") {
        const { ReelStage5Facade } = await import("../src/stages/reel-stage5-renderer.js");
        const partial = await new ReelStage5Facade().run(reelCtx);
        Object.assign(reelCtx, partial);
      }
    }

    if (sequential && stagesToRun.length > 1) {
      const results: DiffResult[] = [];
      let allPassed = true;
      for (const stage of stagesToRun) {
        const stageKey = REEL_SNAPSHOT_KEYS[stage];
        const r = compareStage(stageKey, { update });
        results.push(r);
        if (!r.passed) allPassed = false;
      }
      return { passed: allPassed, fromStage, sequential: true, results };
    }

    const stageKey = REEL_SNAPSHOT_KEYS[stagesToRun[0]];
    const diff = compareStage(stageKey, { update });
    return Object.assign(diff, { reelId: selectedReelId });
  } finally {
    process.env.PIPELINE_DB_PATH = savedDbPath;
    if (savedElModel === undefined) delete process.env.TEST_ELEVENLABS_MODEL;
    else process.env.TEST_ELEVENLABS_MODEL = savedElModel;
    const nock = (await import("nock")).default;
    nock.cleanAll();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Set ALL env vars immediately — before any service/context imports
  process.env.PIPELINE_DB_PATH = path.resolve(projectRoot, "test.db");
  process.env.TAVILY_API_KEY ??= "test-key";
  process.env.GEMINI_API_KEY ??= "test-key";
  process.env.GEMINI_IMAGE_API_KEY ??= "test-key";
  process.env.GCS_BUCKET ??= "test-bucket";
  process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
  process.env.AWS_ACCESS_KEY_ID ??= "test-key";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret";
  process.env.AWS_REGION ??= "us-east-1";

  const { parseArgs } = await import("node:util");
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      stage:  { type: "string" },
      brand:  { type: "string", default: "ds" },
      update: { type: "boolean", default: false },
    },
    strict: true,
  });

  const stageArg = values["stage"];
  const brandArg = (values["brand"] ?? "ds") as "ds" | "ns";
  const updateMode = values["update"] ?? false;

  if (!stageArg) {
    console.error("Error: --stage=<0|1|2|3|4|all> is required");
    process.exit(1);
  }

  if (brandArg !== "ds" && brandArg !== "ns") {
    console.error(`Error: --brand must be "ds" or "ns", got "${brandArg}"`);
    process.exit(1);
  }

  const { compareStage } = await import("./compare.js");

  async function main() {
    const ctx = await buildRunContext(brandArg);
    const services = await buildServices();

    if (stageArg === "all") {
      let allPassed = true;
      let runCtx = ctx;
      for (const stageId of VALID_STAGES) {
        runCtx = await runSingleStage(stageId, runCtx, services);
        const result = compareStage(stageId, { update: updateMode });
        printResult(stageId, result);
        if (!result.passed) allPassed = false;
      }
      console.log(`\nAll stages: ${allPassed ? "PASS" : "FAIL"}`);
    } else {
      if (!VALID_STAGES.includes(stageArg as StageId)) {
        console.error(`Error: unknown stage "${stageArg}". Valid: ${VALID_STAGES.join(", ")}, all`);
        process.exit(1);
      }
      const runCtx = await runSingleStage(stageArg as StageId, ctx, services);
      const result = compareStage(stageArg!, { update: updateMode });
      printResult(stageArg!, result);
      if (!result.passed) process.exit(1);
    }
  }

  main().catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
