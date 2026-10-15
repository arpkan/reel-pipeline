# Overnight Batch Reel Pipeline

**Date**: 2026-04-11
**Status**: Implemented
**Scope**: Batch orchestration layer on top of existing reel pipeline

## Problem

- Reel assembly (FFmpeg) is hardware-intensive and must run sequentially via `_assemblyLock`
- Running 6 DS + 4 NS reels per day through the standard pipeline creates contention with scheduled runs
- Image generation via standard Gemini API is the largest per-run cost ($0.045/image)
- Cannot parallelize reel runs due to server hardware limitations

## Solution

Batch pipeline that:
1. Preps N reels ahead of time (discover, script, voice)
2. Submits all image prompts as one Gemini Batch API job (50% cost reduction)
3. Assembles reels sequentially, queueing behind any scheduled runs

## How to Run

### CLI

```bash
npm run batch -- <brand> --count <N>
# Examples:
npm run batch -- ds --count 5
npm run batch -- ns --count 3
```

### Telegram Commands

| Command | Description |
|---|---|
| `!batch N` | Start batch run for N reels (detached background process) |
| `!batch status` | Show recent batch runs with timing + cost breakdown |

Batch runs are spawned as detached child processes — they don't block the Telegram listener or server.

## Pipeline Phases

```
Phase 1: Prep (per story, sequential, lightweight)
  Story 1: Discover → Script → Voice → collect image prompts (4 scenes)
  Story 2: Discover → Script → Voice → collect image prompts (4 scenes)
  ...
  Story N: Discover → Script → Voice → collect image prompts (4 scenes)
  State: save each reel to DB after voice stage
  Uses: existing reel stages (fetchStory, ReelStage1Script, ReelStage2Voice)

Phase 2: Batch image generation (one API call, runs on Google's servers)
  Collect N × 4 image prompts
  Build JSONL file → upload via File API → submit batch job
  Poll every 60s until JOB_STATE_SUCCEEDED
  Download results JSONL → extract base64 images → validate portrait orientation
  Images written to each reel's workDir as sceneN.png

Phase 3: Assembly (per reel, respects _assemblyLock)
  Reel 1: Assemble via FFmpeg (wait for lock if scheduled run is assembling)
  Reel 2: Assemble (wait for lock)
  ...
  Reel N: Assemble (wait for lock)
  Upload videos to GCS → build review HTML → notify via Telegram

Phase 4: Notify
  Each reel → status: awaiting_approval
  Telegram notification sent per reel as it completes assembly
```

## Concurrency

| Phase | Overlaps with scheduled run? | Mechanism |
|---|---|---|
| Prep (stages 0-2) | Yes — lightweight API calls, no server resources | No lock needed |
| Batch image job | Yes — runs entirely on Google servers | No lock needed |
| Assembly (FFmpeg) | Waits — queue-based | Existing `_assemblyLock` spin-wait (5s intervals) |
| Brand active check | Batch won't start if `_activeReelBrands` has the brand | Telegram `!batch` checks `isReelRunning()` first |

## Cost Comparison

| | Standard API | Batch API (50% off) |
|---|---|---|
| Per image (Flash 1K) | $0.045 | $0.023 |
| 5 reels × 4 scenes = 20 images | $0.90 | $0.45 |
| 10 reels/day (DS+NS) | $1.80 | $0.90 |
| Monthly (30 days) | $54 | $27 |

Model: `gemini-3.1-flash-image-preview` via Batch API.

## Database Schema

### `batch_runs`

```sql
CREATE TABLE batch_runs (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL,
  count       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'prepping',
  config      TEXT,
  timing      TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

Status flow: `prepping` → `submitting_images` → `waiting_images` → `assembling` → `done` | `failed`

### `batch_run_reels`

```sql
CREATE TABLE batch_run_reels (
  batch_run_id  TEXT NOT NULL REFERENCES batch_runs(id),
  reel_id       TEXT NOT NULL REFERENCES reels(id),
  PRIMARY KEY (batch_run_id, reel_id)
);
```

### Timing JSON (stored in `batch_runs.timing`)

```json
{
  "prepTotalMs": 1380000,
  "prepPerStoryMs": [276000, 264000, 282000, 276000, 282000],
  "imagePromptCount": 20,
  "imageSubmitMs": 0,
  "imageWaitMs": 2820000,
  "imagePerItemMs": [141000, 138000, 135000, 140000, ...],
  "assemblyTotalMs": 2520000,
  "assemblyPerReelMs": [504000, 498000, 510000, 504000, 504000],
  "assemblyLockWaitMs": 0,
  "totalWallMs": 6720000
}
```

### Query helpers (`src/db/queries.ts`)

- `createBatchRun()` — create batch run record
- `updateBatchRunStatus()` — update status + timing + error
- `getBatchRun()` — get by ID
- `linkBatchReel()` — associate reel with batch
- `getBatchRunReels()` — get all reels for a batch
- `getRecentBatchRuns()` — last N batch runs for a brand

## Timing & Logging

All timings recorded to `batch_runs.timing` JSON for decision making:

| Metric | Field | Why it matters |
|---|---|---|
| Phase 1 total | `prepTotalMs` | Baseline for prep phase |
| Phase 1 per story | `prepPerStoryMs[]` | Identify slow stories |
| Image prompt count | `imagePromptCount` | Total images submitted |
| Image wait time | `imageWaitMs` | **Critical** — determines batch reliability |
| Image per item | `imagePerItemMs[]` | Compare to standard API (~30s/image) |
| Phase 3 total | `assemblyTotalMs` | Plan assembly window |
| Phase 3 per reel | `assemblyPerReelMs[]` | Track FFmpeg performance over time |
| Lock wait time | `assemblyLockWaitMs` | Measure contention with scheduled runs |
| Total wall time | `totalWallMs` | End-to-end benchmark |

### Sample console output

```
[batch:ds] Starting batch: 5 reels for ds
[batch:ds] Phase 1: prepping 5 stories...
[batch:ds] Story 1/5: complete in 4.6m
[batch:ds] Story 2/5: complete in 4.4m
[batch:ds] Story 3/5: complete in 4.7m
[batch:ds] Story 4/5: complete in 4.6m
[batch:ds] Story 5/5: complete in 4.7m
[batch:ds] Phase 1 complete: 5 stories prepped in 23m (avg 4.6m/story)

[batch:ds] Phase 2: submitting 20 images (5 stories × 4 scenes) to batch API
[batch:ds] Phase 2: batch job BATCH_12345 submitted — waiting...
[batch:ds] Phase 2: polling... state=JOB_STATE_RUNNING (10m elapsed)
[batch:ds] Phase 2: batch complete after 47m (avg 2.4m/image)

[batch:ds] Phase 3: assembling 5 reels...
[assembly-lock] reel 1/5 waiting for slot...
[assembly-lock] acquired
[batch:ds] Reel 1/5: assembled in 8.4m
[assembly-lock] released
[batch:ds] Phase 3 complete: 5 reels assembled in 42m (avg 8.4m/reel, lock wait 0m)

✅ [batch:ds] COMPLETE: 5/5 reels
  Prep:      23m
  Images:    20/20 in 47m
  Assembly:  42m (lock wait 0m)
  Total:     112m
  Cost:      $0.46 (batch) vs $0.90 (standard) — saved $0.44
```

## Fallback Strategy

**No automatic fallback for v1.** If batch job is slow or fails:
- Check via `!batch status` in Telegram or query `batch_runs` table
- If not done: discard batch, run standard pipeline as normal (same as today)
- Batch wait times are logged for future decision making
- If data shows batch consistently finishes within 2-3 hours, add auto-scheduling later

## Implementation

### Files created

| File | Purpose |
|---|---|
| `scripts/batch-run.ts` | Batch orchestrator — phases 1-4, timing, DB updates, notifications |

### Files modified

| File | Change |
|---|---|
| `src/db/schema.ts` | Added `batchRuns` + `batchRunReels` table definitions |
| `src/db/client.ts` | Added `CREATE TABLE IF NOT EXISTS` for batch tables |
| `src/db/queries.ts` | Added `createBatchRun`, `updateBatchRunStatus`, `getBatchRun`, `linkBatchReel`, `getBatchRunReels`, `getRecentBatchRuns` |
| `src/services/image-gen.ts` | Added `generateBatch()` — JSONL build, File API upload, batch job submit, poll, download, parse |
| `src/pipeline/reel-runner.ts` | Exported `acquireAssemblyLock`, `releaseAssemblyLock`, `fetchStory`, `notifyReelReady` |
| `src/pipeline/command-listener.ts` | Added `!batch N` and `!batch status` Telegram commands |
| `package.json` | Added `"batch": "tsx scripts/batch-run.ts"` script |

### Key exports from reel-runner.ts

The batch script reuses existing reel infrastructure:
- `fetchStory()` — stage 0 (discover story from news)
- `ReelStage1Script` — generate script from story
- `ReelStage2Voice` — generate voiceover audio
- `ReelStage4Assemble` — FFmpeg assembly (acquires `_assemblyLock`)
- `notifyReelReady()` — sends Telegram notification
- `acquireAssemblyLock()` / `releaseAssemblyLock()` — global FFmpeg lock

## Open Questions

1. Should batch run be schedulable via cron (server config) or manual only?
2. Should failed batch images fall back to standard API automatically or skip the reel?
3. Should batch results be stored as a reusable cache (same prompt → reuse image)?
4. What's the max acceptable batch wait time before we add automatic fallback?

## Changelog

- 2026-04-11: Implemented (schema, queries, image-gen batch, orchestrator, Telegram commands)
- 2026-04-11: Initial plan
