/**
 * test/compare.ts
 *
 * Queries rows from test.db and compares them against stored JSON snapshots.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// ESM __dirname shim
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffResult {
  passed: boolean;
  stage: string;
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  changed: Array<{
    id: string;
    fields: Array<{ field: string; expected: unknown; actual: unknown }>;
  }>;
}

type Stage =
  | "0" | "1" | "2" | "3" | "4"
  | "reel-script" | "reel-voice" | "reel-images" | "reel-assembly";

// ---------------------------------------------------------------------------
// SQL per stage
// ---------------------------------------------------------------------------

const STAGE_QUERIES: Record<Stage, string> = {
  "0":  "SELECT id, brand, status, stages_completed FROM runs",
  "1":  "SELECT id, brand, status, stages_completed, stories FROM runs",
  "2":  "SELECT id, run_id, pillar, headline, caption, text_overlay FROM posts",
  "3":  "SELECT id, run_id, image_path, image_failed FROM posts",
  "4":  "SELECT id, brand, review_url, status FROM runs",
  "reel-script":   "SELECT id, brand, script, category FROM reels",
  "reel-voice":    "SELECT id, brand, script FROM reels",
  "reel-images":   "SELECT id, brand, status FROM reels",
  "reel-assembly": "SELECT id, brand, video_gcs_url, status FROM reels",
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DB_PATH = path.resolve(__dirname, "..", "test.db");

function snapshotPath(stage: string): string {
  return path.resolve(__dirname, "snapshots", `stage-${stage}-output.json`);
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function diffRows(
  actual: Record<string, unknown>[],
  snapshot: Record<string, unknown>[]
): Pick<DiffResult, "added" | "removed" | "changed"> {
  const snapshotById = new Map<string, Record<string, unknown>>();
  for (const row of snapshot) {
    snapshotById.set(String(row["id"]), row);
  }

  const actualById = new Map<string, Record<string, unknown>>();
  for (const row of actual) {
    actualById.set(String(row["id"]), row);
  }

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const changed: DiffResult["changed"] = [];

  // Rows in actual but not in snapshot
  for (const [id, row] of actualById) {
    if (!snapshotById.has(id)) {
      added.push(row);
    }
  }

  // Rows in snapshot but not in actual
  for (const [id, row] of snapshotById) {
    if (!actualById.has(id)) {
      removed.push(row);
    }
  }

  // Rows present in both — compare field by field
  for (const [id, actualRow] of actualById) {
    const snapshotRow = snapshotById.get(id);
    if (!snapshotRow) continue;

    const fields: DiffResult["changed"][number]["fields"] = [];
    const allKeys = new Set([
      ...Object.keys(actualRow),
      ...Object.keys(snapshotRow),
    ]);

    for (const field of allKeys) {
      // JSON serialise for a stable deep-equal that handles null/undefined
      const exp = JSON.stringify(snapshotRow[field] ?? null);
      const act = JSON.stringify(actualRow[field] ?? null);
      if (exp !== act) {
        fields.push({ field, expected: snapshotRow[field], actual: actualRow[field] });
      }
    }

    if (fields.length > 0) {
      changed.push({ id, fields });
    }
  }

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function compareStage(
  stage: string,
  options?: { update?: boolean }
): DiffResult {
  const query = STAGE_QUERIES[stage as Stage];
  if (!query) {
    throw new Error(
      `Unknown stage "${stage}". Valid stages: ${Object.keys(STAGE_QUERIES).join(", ")}`
    );
  }

  // Guard: require test.db to exist before opening (compare mode)
  if (!options?.update && !fs.existsSync(DB_PATH)) {
    throw new Error("test.db not found — run npm run test:seed first");
  }

  // Query test.db
  const db = new Database(DB_PATH, { readonly: true });
  let actual: Record<string, unknown>[];
  try {
    actual = db.prepare(query).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }

  // Guard: require each row to have an id field
  for (const row of actual) {
    if (row["id"] === undefined) {
      throw new Error(`Row missing "id" field in stage "${stage}"`);
    }
  }

  const snapPath = snapshotPath(stage);

  // Update mode: write snapshot and return passed
  if (options?.update) {
    const snapshotsDir = path.dirname(snapPath);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    fs.writeFileSync(snapPath, JSON.stringify(actual, null, 2) + "\n", "utf8");
    return { passed: true, stage, added: [], removed: [], changed: [] };
  }

  // Read mode: load snapshot
  if (!fs.existsSync(snapPath)) {
    throw new Error(
      `No snapshot found for stage "${stage}" — run with --update first`
    );
  }

  const snapshot = JSON.parse(
    fs.readFileSync(snapPath, "utf8")
  ) as Record<string, unknown>[];

  const { added, removed, changed } = diffRows(actual, snapshot);
  const passed = added.length === 0 && removed.length === 0 && changed.length === 0;

  return { passed, stage, added, removed, changed };
}
