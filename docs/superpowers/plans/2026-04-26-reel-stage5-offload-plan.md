# Reel Stage 5 Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offload `reel-stage5-assemble` to one-job-per-worker EC2 via SQS, with a global ON/OFF switch and no auto-retry.

**Architecture:** Keep the existing pipeline service as control plane and branch at Stage 5 by `REEL_ASSEMBLY_OFFLOAD_ENABLED`. When enabled, create an `assembly_jobs` record, enqueue a minimal SQS message, launch one worker, and let worker run Stage 5 by `runId` using DB+GCS state. Failures go to DLQ/failure state with explicit reel/job status updates.

**Tech Stack:** TypeScript, AWS SDK v3 (SQS + EC2), Drizzle/SQLite, existing ReelRunner pipeline, Vitest

---

## File Structure (as implemented)

- Created: `src/services/assembly-queue.ts` — queue payload schema and enqueue helpers
- Created: `src/services/assembly-launcher.ts` — single-flight EC2 launch logic
- Created: `bin/worker.ts` — worker entrypoint (not `src/workers/reel-assembly-worker.ts` as originally planned)
- Created: `api/routes/worker.ts` — HTTP API endpoints for worker ↔ pipeline communication
- Modified: `src/db/schema.ts` — added `assembly_jobs` table
- Modified: `src/db/queries.ts` — added assembly job CRUD
- Modified: `src/pipeline/reel-runner.ts` — Stage 5 offload branch, `runReelStage5Boundary`, `ReelProgress`, `ReelProgressState`, `renderCompletedProgressMessage`
- Modified: `src/services/gcs.ts` — added `uploadFile` and `downloadFile` methods

---

### Task 1: Add offload configuration surface — ✅ DONE

- [x] **Step 1: Write failing config test**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement config helpers** (`isReelAssemblyOffloadEnabled`, `canLaunchAssemblyWorker`)
- [x] **Step 4: Re-run test**
- [x] **Step 5: Commit**

---

### Task 2: Add `assembly_jobs` persistence model — ✅ DONE

- [x] **Step 1: Write failing DB query test for job lifecycle**
- [x] **Step 2: Run test to verify failure**
- [x] **Step 3: Add schema and query helpers**
- [x] **Step 4: Re-run test**
- [x] **Step 5: Commit**

---

### Task 3: Implement queue producer — ✅ DONE

- [x] **Step 1–5** — `buildAssemblyMessage`, `enqueueAssemblyJob` implemented

**Gap filled:** `AssemblyMessage` extended with optional `instanceId?: string` field so the worker receives its own EC2 instance ID from the SQS message body. IMDS v1 (`169.254.169.254`) returned an empty response on Ubuntu 24.04 with the Clio IAM profile, so the control plane fetches `instanceId` from the `RunInstances` response and injects it into the message before enqueueing.

---

### Task 4: Implement EC2 launcher single-flight behavior — ✅ DONE

- [x] **Step 1–5** — `launchAssemblyWorker` returns `{ instanceId }` from `RunInstances` response

**Gap filled — EC2 launch ordering:** Originally planned to enqueue SQS first, then launch EC2. Reversed: launch EC2 first to capture `instanceId`, then enqueue with `instanceId` embedded in the message body. This avoids a second IMDS lookup on the worker.

**Gap filled — ImageMagick missing on worker AMI:** The base Ubuntu 24.04 AMI (`ami-0123456789abcdef0`) does not include `imagemagick`. Added `imagemagick` to the `apt-get install` line in the launch template UserData (v5). `ReelStage5Assemble` uses ImageMagick's `identify` command to probe image dimensions; without it, assembly fails immediately.

---

### Task 5: Add offload branch in ReelRunner stage 5 — ✅ DONE

- [x] **Step 1–5** — `runReelStage5Boundary` implemented as exported function

**Gap filled — GCS artifact upload before dispatch:** The original design assumed the worker would load all scene artifacts (audio `.mp3`, images `.png`) from GCS. In reality those files only existed on disk on the studio instance — they had never been uploaded to GCS during earlier stages. `runReelStage5Boundary` now uploads all scene audio and image files to `gcs.uploadFile(brand.gcsPrefix, runId, filename, ...)` before enqueueing. A new generic `GcsService.uploadFile()` method was added to `src/services/gcs.ts`.

**Gap filled — Music files not in git:** Brand music files (`.mp3`) live under `assets/music/` and are not committed to the repo. The worker cannot clone them. Fix: the control plane picks a music file using `pickMusicFile` (same logic as the local path), uploads it to GCS as `music.mp3` under the reel prefix, and the worker downloads it and overrides `brand.reels.musicFiles` and `brand.reels.musicByCategory` to point at the local copy before running assembly.

**Gap filled — Stale SQS messages:** When an EC2 boot failed before `worker.js` started, the SQS message remained in the queue and was picked up by the next worker boot, causing it to process an already-failed job. Added a stale-job guard in `bin/worker.ts`: on startup the worker fetches the job status via `GET /worker/jobs/:jobId`; if the job is already `succeeded` or `failed`, it deletes the SQS message and exits cleanly.

---

### Task 6: Implement worker execution path — ✅ DONE

**Note:** Implemented as `bin/worker.ts` (not `src/workers/reel-assembly-worker.ts`). The worker communicates with the pipeline via HTTP API rather than direct DB access, using three endpoints on `api/routes/worker.ts`:
- `GET /worker/jobs/:jobId` — fetch job + reel data
- `PUT /worker/jobs/:jobId` — update job status
- `PUT /worker/reels/:runId` — update reel status/video/context
- `POST /worker/reels/:runId/notify` — trigger completion notification

- [x] **Step 1–5** — worker downloads scene files from GCS, runs `ReelStage5Assemble`, uploads video, calls back pipeline API, self-terminates

---

### Task 7: End-to-end verification and docs update — ✅ DONE

- [x] **Step 1–3** — build passes, end-to-end tested with multiple live jobs
- [x] **Step 4–5** — spec and plan updated

**Gap filled — Telegram progress message timing:** When stage5 is offloaded, the `ReelProgress` object lives only in-process on studio and is lost after `runReelStage5Boundary` returns. The original notify path sent a plain "Reel ready" message with no timing. Fix (commit `1bf3933`):
- Added `ReelProgressState` interface and `getState()` to `ReelProgress` — snapshots chatId, msgId, startTime, and all stage statuses/durations
- Added `renderCompletedProgressMessage()` exported helper for re-rendering the progress format with assembly duration
- `runReelStage5Boundary` accepts `progressState?` and persists it in the reel context under `_progressState`
- `bin/worker.ts` wraps `ReelStage5Assemble().run()` with a timer → `assemblyDurationMs`
- `POST /worker/reels/:runId/notify` reads `_progressState`, calls `telegram.editMessage` on the original message with the rendered completion text including assembly seconds

---

## Post-Implementation Summary

Total wall-clock time for offloaded assembly: ~8–9 minutes (3m40s EC2 boot + ~4–5m FFmpeg assembly). The studio instance is completely free during this window.

All gaps between the original plan and live production behavior have been documented above and in the design spec.
