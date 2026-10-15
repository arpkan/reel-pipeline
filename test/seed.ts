/**
 * test/seed.ts
 *
 * Copies runs + posts records for a given brand + run-id from the production
 * database into a fresh test.db at the project root.
 *
 * Usage:
 *   npx tsx test/seed.ts --brand=<ds|ns> --run-id=<id>
 */

import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

// __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root = directory containing package.json (one level up from test/)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Schema DDL (raw SQL — no drizzle import)
// ---------------------------------------------------------------------------

const REEL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reels (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  run_date TEXT NOT NULL,
  headline TEXT NOT NULL,
  source_url TEXT NOT NULL,
  script TEXT,
  category TEXT,
  snippet TEXT,
  context TEXT,
  video_gcs_url TEXT,
  review_url TEXT,
  status TEXT NOT NULL DEFAULT 'generating',
  current_stage TEXT,
  scheduled_time TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  facebook_post_id TEXT,
  tik_tok_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    run_date TEXT NOT NULL,
    theme TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    stages_completed INTEGER NOT NULL DEFAULT 0,
    review_url TEXT,
    telegram_offset INTEGER,
    line_offset INTEGER,
    stories TEXT,
    context TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    "index" INTEGER NOT NULL,
    pillar TEXT NOT NULL,
    headline TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    caption TEXT,
    text_overlay TEXT,
    image_prompt TEXT,
    image_path TEXT,
    image_failed INTEGER NOT NULL DEFAULT 0,
    scheduled_time TEXT,
    facebook_post_id TEXT,
    published_at TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`;

// ---------------------------------------------------------------------------
// Exported seed function (used by API and CLI)
// ---------------------------------------------------------------------------

export async function seed(brand: string, runId: string): Promise<{ runs: number; posts: number }> {
  // Open source DB (read-only)
  const srcPath = process.env.PIPELINE_DB_PATH ?? "./data/pipeline.db";
  const srcDb = new Database(srcPath, { readonly: true });

  // Fetch the runs row
  const run = srcDb
    .prepare("SELECT * FROM runs WHERE id = ? AND brand = ?")
    .get(runId, brand) as Record<string, unknown> | undefined;

  if (!run) {
    srcDb.close();
    throw new Error(
      `No run found with id="${runId}" and brand="${brand}" in ${srcPath}`
    );
  }

  // Fetch all posts for this run
  const posts = srcDb
    .prepare("SELECT * FROM posts WHERE run_id = ?")
    .all(runId) as Record<string, unknown>[];

  srcDb.close();

  // Ensure test/ directory exists (it contains this file, but be safe)
  const testDir = path.join(PROJECT_ROOT, "test");
  fs.mkdirSync(testDir, { recursive: true });

  // Create / overwrite test.db at project root
  const testDbPath = path.join(PROJECT_ROOT, "test.db");

  // Remove existing file so we start fresh
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const testDb = new Database(testDbPath);
  testDb.pragma("journal_mode = WAL");

  // Apply schema (FK is off by default — no need to enable then immediately disable)
  testDb.exec(SCHEMA_SQL);

  // Disable FK constraints so insert order doesn't matter
  testDb.pragma("foreign_keys = OFF");

  // Prepare and run the runs INSERT once
  const runCols = Object.keys(run);
  const runStmt = testDb.prepare(
    `INSERT OR REPLACE INTO runs (${runCols.map((c) => `"${c}"`).join(", ")}) VALUES (${runCols.map(() => "?").join(", ")})`
  );
  runStmt.run(...runCols.map((c) => run[c]));

  // Prepare the posts INSERT once, then reuse it for every row
  if (posts.length > 0) {
    const postCols = Object.keys(posts[0]);
    const postStmt = testDb.prepare(
      `INSERT OR REPLACE INTO posts (${postCols.map((c) => `"${c}"`).join(", ")}) VALUES (${postCols.map(() => "?").join(", ")})`
    );
    for (const post of posts) {
      postStmt.run(...postCols.map((c) => post[c]));
    }
  }

  // Re-enable FK constraints
  testDb.pragma("foreign_keys = ON");

  testDb.close();

  return { runs: 1, posts: posts.length };
}

export async function seedReel(brand: string, reelId: string): Promise<{ reels: number; files: number }> {
  const srcPath = process.env.PIPELINE_DB_PATH ?? "./data/pipeline.db";
  if (!fs.existsSync(srcPath)) throw new Error(`Source DB not found: ${srcPath}`);

  const srcDb = new Database(srcPath, { readonly: true });
  const reelRow = srcDb
    .prepare("SELECT * FROM reels WHERE id = ? AND brand = ?")
    .get(reelId, brand) as Record<string, unknown> | undefined;

  if (!reelRow) {
    srcDb.close();
    throw new Error(`Reel not found: id=${reelId} brand=${brand}`);
  }
  srcDb.close();

  // Create test.db if needed and ensure reels table exists (do NOT wipe existing data)
  const testDbPath = path.join(PROJECT_ROOT, "test.db");
  const testDb = new Database(testDbPath);
  testDb.pragma("journal_mode = WAL");
  testDb.exec(REEL_SCHEMA_SQL);

  testDb.pragma("foreign_keys = OFF");
  const cols = Object.keys(reelRow);
  const reelStmt = testDb.prepare(
    `INSERT OR REPLACE INTO reels (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
  );
  reelStmt.run(...cols.map((c) => reelRow[c]));
  testDb.pragma("foreign_keys = ON");
  testDb.close();

  // Copy work dir files
  const srcWorkDir = path.join(PROJECT_ROOT, "work", "reels", reelId);
  const dstWorkDir = path.join(PROJECT_ROOT, "test", "work", "reels", reelId);
  let fileCount = 0;

  if (fs.existsSync(srcWorkDir)) {
    fs.mkdirSync(dstWorkDir, { recursive: true });
    for (const file of fs.readdirSync(srcWorkDir)) {
      fs.copyFileSync(path.join(srcWorkDir, file), path.join(dstWorkDir, file));
      fileCount++;
    }
  }

  console.log(`  reels  copied: 1`);
  console.log(`  work files copied: ${fileCount}`);
  return { reels: 1, files: fileCount };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run CLI logic when executed directly (not imported as a module)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      brand:    { type: "string" },
      "run-id": { type: "string" },
      "reel-id": { type: "string" },
    },
    strict: true,
  });

  const brandArg = values["brand"];
  if (!brandArg) {
    console.error("Error: --brand=<ds|ns> is required");
    process.exit(1);
  }
  if (brandArg !== "ds" && brandArg !== "ns") {
    console.error(`Error: --brand must be "ds" or "ns", got "${brandArg}"`);
    process.exit(1);
  }

  if (values["reel-id"]) {
    seedReel(brandArg, values["reel-id"])
      .then(({ reels, files }) => {
        const testDbPath = path.join(PROJECT_ROOT, "test.db");
        console.log("Reel seed complete.");
        console.log(`  test.db written to: ${testDbPath}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error("Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  } else {
    const runIdArg = values["run-id"];
    if (!runIdArg) {
      console.error("Error: --run-id=<id> or --reel-id=<id> is required");
      process.exit(1);
    }
    seed(brandArg, runIdArg)
      .then(({ runs, posts }) => {
        const testDbPath = path.join(PROJECT_ROOT, "test.db");
        console.log("Seed complete.");
        console.log(`  runs  copied: ${runs}`);
        console.log(`  posts copied: ${posts}`);
        console.log(`  test.db written to: ${testDbPath}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error("Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  }
}
