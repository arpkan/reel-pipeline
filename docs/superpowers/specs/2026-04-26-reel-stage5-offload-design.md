# Reel Stage 5 Offload Design (Plan 2)

**Date:** 2026-04-26  
**Status:** Implemented and production-verified (2026-04-27)

## Implementation Notes

Planned design was correct at the architectural level. The following gaps were discovered and resolved during live implementation:

### Gap 1 — IMDS v1 unusable for instanceId

**Problem:** The worker attempted to fetch its EC2 `instanceId` from the Instance Metadata Service (`169.254.169.254`) at runtime. Ubuntu 24.04 with the Clio IAM profile returns an empty body for IMDS v1 GET requests.

**Fix:** The control plane fetches `instanceId` from the `RunInstances` API response (the launcher), embeds it in the SQS message as `instanceId?: string`, and the worker reads it from `JSON.parse(msg.Body)`. IMDS is never called on the worker.

**Ordering implication:** EC2 must be launched *before* SQS enqueue (reversed from original plan) so `instanceId` is available when building the message.

### Gap 2 — Scene artifacts never uploaded to GCS during earlier stages

**Problem:** The design assumed workers could load scene audio (`.mp3`) and image (`.png`) files from GCS by `runId`. In the actual pipeline, those files are written to local disk during stages 3 and 4 and were never uploaded to GCS — GCS was only used for the final video output.

**Fix:** `runReelStage5Boundary` uploads all `scene{N}.mp3` and `scene{N}.png` files to `gs://{brand.gcsPrefix}/{runId}/` before dispatch. A new `GcsService.uploadFile(prefix, runId, filename, buffer, contentType)` method was added to `src/services/gcs.ts`.

### Gap 3 — Music files not in git

**Problem:** Brand music files (`.mp3`) live under `assets/music/` locally and are not committed to the repo. The worker's `git clone` + `npm ci` + `npm run build` bootstrap does not include them.

**Fix:** The control plane picks a music file using the existing `pickMusicFile` logic, uploads it to GCS as `music.mp3` under the reel prefix (alongside the scene files), and `bin/worker.ts` downloads it to the work directory. Before constructing the `ReelContext`, the worker overrides `brand.reels.musicFiles` and `brand.reels.musicByCategory` to point at the local downloaded copy, so `ReelStage5Assemble` picks it up transparently.

### Gap 4 — ImageMagick not present on base AMI

**Problem:** `ReelStage5Assemble` calls ImageMagick's `identify` command to probe image dimensions. The base Ubuntu 24.04 AMI (`ami-0123456789abcdef0`) does not include it.

**Fix:** Added `imagemagick` to the `apt-get install` line in the EC2 launch template UserData. This is launch template version 5 (`lt-0123456789abcdef0`, v5, default).

### Gap 5 — Stale SQS messages from failed boots

**Problem:** When an EC2 instance boot failed before `node dist/bin/worker.js` reached the SQS receive call, the message remained in the queue with its original visibility timeout. The next worker boot would dequeue and attempt to process an already-terminal job.

**Fix:** On startup the worker calls `GET /worker/jobs/:jobId` and checks status. If `succeeded` or `failed`, it deletes the SQS message and exits cleanly without doing any assembly work.

### Gap 6 — Worker uses HTTP API, not direct DB access

**Planned:** Worker resolves reel context by `runId` from DB + GCS.

**Actual:** The SQLite DB is local to the studio EC2 instance and is not accessible from the ephemeral worker. Worker communicates with the pipeline via a bearer-token-authenticated HTTP API on `api/routes/worker.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/worker/jobs/:jobId` | Fetch job + reel row |
| `PUT` | `/worker/jobs/:jobId` | Update job status/timestamps |
| `PUT` | `/worker/reels/:runId` | Update reel status/video/context |
| `POST` | `/worker/reels/:runId/notify` | Trigger Telegram notification |

Token is `WORKER_API_TOKEN` injected via launch template UserData `.env` block.

### Gap 7 — Worker entrypoint is `bin/worker.ts`, not `src/workers/`

The worker runs as `node dist/bin/worker.ts` (compiled to `dist/bin/worker.js`). The planned `src/workers/reel-assembly-worker.ts` module does not exist; all logic is in `bin/worker.ts`.

### Gap 8 — Telegram progress message loses timing when offloaded

**Problem:** The `ReelProgress` object (which tracks stage timings and holds the Telegram message ID for edits) lives in-memory on studio and is garbage-collected when `runReelStage5Boundary` returns "offloaded". The original notify path sent a new plain "Reel ready" message with no stage timings shown.

**Fix (commit `1bf3933`):**
- Added `ReelProgressState` interface (exported) — serializable snapshot of chatId, msgId, startTime, and all stage statuses/durations
- Added `getState(): ReelProgressState | null` to `ReelProgress`
- Added `renderCompletedProgressMessage(state, assemblyDurationMs, reviewUrl?)` exported helper that re-renders the progress format for a completed reel
- `runReelStage5Boundary` accepts `progressState?: ReelProgressState` and stores it in the reel context under `_progressState` when offloading
- All 5 callers of `runReelStage5Boundary` pass `progressState: chatId ? progress.getState() ?? undefined : undefined`
- `bin/worker.ts` wraps `ReelStage5Assemble().run()` with a `Date.now()` timer → `assemblyDurationMs`, passed to `/notify`
- `POST /worker/reels/:runId/notify` reads `_progressState` from the reel DB context, calls `telegram.editMessage` on the original in-progress message with the rendered completion text

**Result:** The original "⏳ Reel in progress" Telegram message is edited in-place to show:
```
✅ Reel ready — WorldBrief
ID: f8a97ffb  ⏱ 388s
✅ Assemble (263s)
```

---

## Overview

Plan 2 offloads Reel Stage 5 assembly (`reel-stage5-assemble`) from the main pipeline instance to one-job-per-worker EC2 using SQS-based dispatch.

This design follows Plan 1 optimizations and adds an operationally safe global switch to enable or disable offload.

## Decisions Confirmed

- Dispatch model: **SQS queue + worker flow**
- Concurrency mode: **single consumer behavior globally (1 at a time)**
- Retry policy: **no auto-retry; dead-letter on failure**
- Artifact source: **worker loads by `runId` from pipeline HTTP API + GCS**
- Toggle scope: **global only**
- instanceId source: **SQS message body (not IMDS)**

## Goals

- Reduce load on main app instance during Stage 5 assembly.
- Preserve existing reel command/operator workflow.
- Keep rollback simple with one global switch.
- Make failures visible and diagnosable via job states and logs.

## Non-Goals

- No worker pool in v1.
- No per-brand offload toggle in v1.
- No multi-worker parallel assembly in v1.
- No GPU encode path in this phase.

## Architecture

### Control Plane (existing app)

The current pipeline service remains the orchestrator for discovery, script, voice, image generation, approvals, and publishing.

At Stage 5 boundary, behavior branches by one global env flag:

- `REEL_ASSEMBLY_OFFLOAD_ENABLED=false`: run local Stage 5 (current behavior)
- `REEL_ASSEMBLY_OFFLOAD_ENABLED=true`: dispatch offload job

### Offload Data Plane (new)

- SQS queue for Stage 5 offload jobs
- EC2 launcher flow (single active launch behavior)
- One ephemeral EC2 worker per job
- Worker self-terminates on completion/failure

### Persistence and Job Tracking

`assembly_jobs` table tracks job lifecycle independent from `reels` status:

- `id`, `runId`, `brand`, `status`
- `attempts` (v1 expected 1)
- `instanceId`
- `error`
- `createdAt`, `startedAt`, `finishedAt`, `updatedAt`

## Message Contract

SQS payload:

```json
{
  "jobId": "<uuid>",
  "runId": "<reel run id>",
  "brand": "ds|ns",
  "instanceId": "<ec2-instance-id>",
  "requestedAt": "<iso timestamp>"
}
```

`instanceId` is populated by the launcher from the `RunInstances` response so the worker can self-terminate without IMDS.

## Data Flow

1. Runner reaches Stage 5 in `reel-runner`.
2. If offload disabled: run local `ReelStage5Assemble`.
3. If offload enabled:
   - create `assembly_jobs` row with `queued`
   - upload all scene audio/images + music to GCS under `{gcsPrefix}/{runId}/`
   - launch EC2 worker via `RunInstances` → capture `instanceId`
   - enqueue SQS message with `instanceId` embedded
   - store `_progressState` (Telegram message state) in reel context
   - update reel `currentStage` to `reel-stage5-dispatched`
4. Worker boots (~3m40s), pulls git, builds, starts
5. Worker dequeues message, checks job not stale
6. Worker fetches reel data from `GET /worker/jobs/:jobId`
7. Worker downloads scene files + music from GCS
8. Worker reconstructs `ReelContext` with overridden music paths
9. Worker runs `ReelStage5Assemble` (assembly duration tracked)
10. Worker uploads result via `PUT /worker/reels/:runId`
11. Worker calls `POST /worker/reels/:runId/notify` with `assemblyDurationMs`
12. Pipeline edits original Telegram progress message with assembly timing
13. Worker self-terminates

## Failure Handling

- No in-app automatic retries for offload jobs.
- Queue redrive sends failed job to DLQ directly.
- Reel status is updated to failed with concise error context.
- `assembly_jobs.status` transitions to `failed`.
- Stale job guard prevents double-processing on retry boots.

## Operational Controls

### Global Toggle

- `REEL_ASSEMBLY_OFFLOAD_ENABLED` controls path globally.
- Toggle OFF is immediate rollback path (after service restart/reload).

## Performance

- EC2 boot time: ~3m40s (git clone + npm ci + npm run build + imagemagick install)
- FFmpeg assembly time: ~4–5 minutes (same instance type as studio: c5.large)
- Total wall clock per job: ~8–9 minutes
- Studio instance: freed for other work during the entire window

## Interfaces and Components

- `src/services/assembly-queue.ts` — enqueue helpers and payload schema (includes `instanceId`)
- `src/services/assembly-launcher.ts` — launch EC2 worker, return `instanceId`
- `bin/worker.ts` — worker entrypoint on EC2 instance
- `api/routes/worker.ts` — HTTP API for worker ↔ pipeline communication
- `src/pipeline/reel-runner.ts` — Stage 5 branch logic, `runReelStage5Boundary`, `ReelProgressState`, `renderCompletedProgressMessage`
- `src/services/gcs.ts` — `uploadFile`, `downloadFile` methods
- `src/db/schema.ts`, `src/db/queries.ts` — `assembly_jobs` schema + read/write helpers

## Security and Access

- Worker IAM role (Clio) scoped to required GCS/SQS/EC2 access.
- Worker API uses bearer token (`WORKER_API_TOKEN`) injected via UserData.
- No broad wildcard permissions.

## Observability

Logged per offloaded run:

- `jobId`, `runId`, `brand`
- `instanceId`
- stage start/end timestamps
- `assemblyDurationMs` (pure FFmpeg/stage time, excludes boot and GCS setup)
- terminal status and error summary

## Testing Strategy

- Unit tests for queue payload and state transitions.
- Unit tests for runner branch behavior under toggle ON/OFF.
- Live end-to-end: multiple `!reel re-effect` runs validated in production.

## Rollout Plan

1. ✅ Shipped with toggle default OFF.
2. ✅ Internal smoke tests with toggle ON.
3. ✅ Validated metrics/logging and failure recovery.
4. ✅ Enabled for production usage on re-effect and full reel runs.

## Risks and Mitigations

- **Risk:** orphaned worker instances. **Mitigation:** worker self-termination + `InstanceInitiatedShutdownBehavior: terminate` on launch template.
- **Risk:** stale SQS messages. **Mitigation:** stale-job guard on worker startup.
- **Risk:** music missing on worker. **Mitigation:** control plane uploads music to GCS before dispatch.
- **Risk:** queue/job state divergence. **Mitigation:** explicit state machine in `assembly_jobs` and idempotent updates.
- **Risk:** rollout regressions. **Mitigation:** global toggle rollback to local path.

## Out of Scope

- Multi-worker parallel offload.
- Spot bidding strategy optimization.
- Per-brand toggle policy.
- Full autoscaling orchestration platform.
