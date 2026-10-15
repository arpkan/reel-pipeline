# Architecture

## Overview

Content Pipeline is a multi-brand social media content automation system. It discovers trending news stories, generates AI-written captions and images, routes them through a human approval step, and publishes to Facebook, Instagram, and TikTok on a cron schedule. A parallel "Reels" track produces short-form video (voiceover + AI images + Hyperframes-rendered video).

Two brands are currently configured:
- **DS (ThaiDaily)** — Thai-language news, audience: Thailand, timezone Asia/Bangkok
- **NS (WorldBrief)** — English-language news, timezone configurable

---

## High-Level Data Flow

```
                         ┌──────────────────────────────────────────┐
                         │                 Server (Hono)            │
                         │  Port 3100  ·  REST API  ·  Cron jobs    │
                         └───────────┬──────────────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
   ┌──────────▼──────────┐                      ┌───────────▼──────────┐
   │   PipelineRunner    │                      │     ReelRunner       │
   │  (static posts)     │                      │  (short-form video)  │
   └──────────┬──────────┘                      └───────────┬──────────┘
              │                                              │
   ┌──────────▼──────────────────────────────┐  ┌───────────▼──────────────────────────────────┐
   │  Stage 0: Pillar Balance / From URL     │  │  Stage 0: Story Discovery (Gemini + Tavily)  │
   │  Stage 1: Discover (Tavily + Gemini)    │  │  Stage 2: Script (Bedrock Claude)            │
   │  Stage 1b: Viral Check (DS only)        │  │  Stage 3: Voice (ElevenLabs / Botnoi / etc.) │
   │  Stage 2: Captions (Bedrock Claude)     │  │  Stage 4: Images (Gemini Imagen / Azure)     │
   │  Stage 3: Image Prompts (Gemini)        │  │  Stage 5: Assemble (Hyperframes)             │
   │  Stage 3b: Image Gen (Gemini Imagen)    │  └──────────────────────────────────────────────┘
   │  Stage 4a: Review HTML → GCS            │           │ (offload path)
   │  Stage 4b: Notify (Telegram / LINE)     │  ┌────────▼──────────────────────┐
   │  [Approval Poller]                      │  │  SQS Queue + EC2 Worker       │
   │  Stage 5: Publish (Meta API)            │  │  (optional — stage5 only)     │
   └─────────────────────────────────────────┘  └───────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │   SQLite (Drizzle)  │  pipeline.db
   └─────────────────────┘
```

---

## Core Components

### `bin/server.ts` — Entry Point
- Starts Hono HTTP server on `PIPELINE_PORT` (default 3100)
- Mounts all API routers
- Registers node-cron jobs for pipeline and reel scheduling
- Starts always-on Telegram/LINE command listeners
- Resumes approval pollers for any runs that were `awaiting_approval` before restart

### `bin/worker.ts` — EC2 Assembly Worker Entry Point
- Runs on a short-lived EC2 instance spawned for stage5 offload
- Polls an SQS queue, fetches reel context from the pipeline API, runs `ReelStage5Facade`
- Uploads video to GCS, notifies the pipeline server, then terminates the EC2 instance
- Only used when `REEL_ASSEMBLY_OFFLOAD_ENABLED=true`

### `src/pipeline/runner.ts` — PipelineRunner
The main static-post pipeline. Executes stages sequentially, persisting state to SQLite after each stage for crash recovery. Key behaviors:
- **Concurrent run guard** — one active run per brand per day
- **Resume** — can restart from any completed stage using `--resume <runId>`
- **Approval poller** — async loop that waits for Telegram/LINE commands (`!approve`, `!reject`, etc.)
- **Skip-next-run flag** — in-memory flag to skip the next cron firing

### `src/pipeline/reel-runner.ts` — ReelRunner
Video pipeline. Key differences from PipelineRunner:
- Per-brand in-progress guard (`_activeReelBrands`)
- **Assembly lock** — global single-slot mutex because rendering is memory-heavy; only one reel assembles at a time when running locally
- **Assembly offload** — when `REEL_ASSEMBLY_OFFLOAD_ENABLED=true`, stage5 is enqueued to SQS and an EC2 instance is launched via `assembly-launcher.ts`
- Skip flags are **persisted to disk** (`data/reel-skip-flags.json`) so they survive restarts
- Supports `rerescript` (re-run from stage 2), `resume` (smart skip of completed stages), and `rebuild` (force re-run stages 3–5)
- Supports `rebuildPart` — selectively re-run just voice, images, or assembly
- Per-stage timeouts: discover 5m, script 3m, voice 4m, images 10m, assemble 15m

### `src/pipeline/reel-intake.ts` + `reel-intake-session-store.ts` — Reel Intake
Interactive multi-step session for operator-provided content. Supports two modes:
- **text** — operator pastes full article text, bypassing discovery
- **hint** — operator provides a topic hint string that biases Gemini discovery
Sessions are stored in the `reel_intake_sessions` DB table (15-minute TTL).

### `src/pipeline/progress.ts` — Reel Progress Tracker
Tracks the current live stage of a reel generation and maintains a Telegram progress message that is edited in-place as stages advance. Used by both local and offloaded assembly.

### `src/pipeline/command-listener.ts` — Command Listeners
Long-polling loops on Telegram and LINE that parse `!`-prefixed commands and dispatch to pipeline/reel operations. Commands are brand-scoped by chat ID / LINE group ID mapping.

### `src/db/` — SQLite via Drizzle ORM
Schema tables:
- `runs` — pipeline run state (status, reviewUrl, telegram/line offset for resume)
- `posts` — per-run post content (caption, image, scheduled time, approval)
- `reels` — reel metadata (script JSON, video URL, category, stage progress)
- `reel_intake_sessions` — active multi-step reel intake sessions
- `reel_schedule` — user-managed post times for reels
- `stage_logs` — per-stage execution log (duration, error)
- `theme_weights` — adjustable weights for theme selection
- `line_events` — incoming LINE webhook messages stored for polling
- `batch_runs` / `batch_run_reels` — overnight batch generation tracking
- `assembly_jobs` — EC2 offload job tracking (queued → running → done/failed)
- `reel_metrics` — per-reel engagement stats fetched from Meta API (views, likes, shares, etc.)
- `performance_benchmarks` — aggregated average performance by dimension (pillar, theme, voice, music, posting_time)
- `performance_scores` — composite per-reel performance score (views_ratio, engagement_ratio)
- `follower_snapshots` — daily follower count snapshots per brand (unique on brand+date); used to compute daily follower gain for the dashboard

### `src/services/` — External Service Clients
| Service | File | Purpose |
|---------|------|---------|
| Tavily | `search.ts` | News discovery and story verification |
| Bedrock (Claude) | `bedrock.ts` | Caption + script generation |
| Gemini | `gemini.ts` | Story selection, image prompts, viral scoring |
| Gemini Imagen | `image-gen.ts` | AI image generation |
| Azure Image Gen | `azure-image-gen.ts` | Azure Foundry GPT-Image-2 generation (alternative to Gemini Imagen) |
| Stock Image | `stock-image.ts` | Unsplash / Pexels / Pixabay fallback images |
| ElevenLabs | `elevenlabs.ts` | TTS voiceover (primary EN provider) |
| Botnoi | `botnoi.ts` | TTS voiceover (Thai language provider) |
| UVoice | `uvoice.ts` | TTS voiceover (multi-language provider) |
| MiniMax | `minimax.ts` | TTS voiceover (multi-language provider) |
| Voice Provider | `voice-provider.ts` | Unified `VoiceProvider` interface + `VoiceEntry` type |
| Whisper | `whisper.ts` | Speech-to-text for word-level timestamp extraction from TTS audio |
| C2PA Signer | `c2pa-signer.ts` | Embeds C2PA content credentials provenance manifest in reel videos |
| GCS | `gcs.ts` | Image/HTML/video cloud storage |
| Telegram | `telegram.ts` | Notifications + command polling |
| LINE | `line.ts` | Notifications + command polling |
| Meta (Graph API) | `meta.ts` | Facebook + Instagram publishing |
| TikTok | `tiktok.ts` | TikTok video publishing |
| Trending | `trending.ts` | Google Trends + YouTube + Google News signals |
| Metrics Collector | `metrics-collector.ts` | Post-publish analytics fetcher (runs on cron); computes benchmarks across pillar, theme, voice, music, and posting_time dimensions |
| Follower Fetch | `follower-fetch.ts` | `collectFollowerSnapshot(brandId)` — fetches daily Facebook `fan_count` and upserts into `follower_snapshots`; runs daily at 01:00 UTC via cron in `bin/server.ts` |
| Assembly Queue | `assembly-queue.ts` | SQS client — enqueues stage5 offload jobs |
| Assembly Launcher | `assembly-launcher.ts` | EC2 client — spawns worker instances for offloaded assembly |
| Messaging | `messaging.ts` | Abstraction over Telegram + LINE for broadcast notifications |

### `src/effects/` — Visual Effects
- `camera-effects.ts` — Ken Burns and pan/zoom effect parameters for individual reel scenes
- `hyperframes-presets.ts` — Camera motion presets mapped to reel categories:
  - `cinematic_drift` (trending, open), `urgent_push` (breaking), `slow_reveal` (business)
  - `documentary_slide` (human_interest), `portrait_float`, `locked_frame`
  - Each preset varies scale and translate values per scene to prevent repetition

### `src/brands/` — Brand Configuration
`ds.ts` and `ns.ts` export `BrandConfig` objects with pillars, post times, caption rules, theme weights, reel schedules, and channel config. Brand-specific env vars (page tokens, chat IDs) are read from `process.env` at import time.

`voice-pool.ts` contains shared voice pool utilities for building multi-provider voice lists.

### `src/review/` — HTML Builder Utilities
- `dashboard-html-builder.ts` — builds the `/dashboard` HTML page (CMP bars, hero chart, reel list, breakdown panels)
- `reel-html-builder.ts` — builds the reel review HTML (per-reel video preview, script, stage log)
- `utils.ts` — shared utilities: `brandThemeCss(brandId)` (injects per-brand CSS custom properties), `brandLogoHtml(brandId, cls)` (base64-embeds brand logo from `assets/brands/`), `escapeHtml()`, `statusBadgeHtml()`, `stageLogsHtml()`

Brand theming: both the dashboard and reel review pages call `brandThemeCss()` to set CSS vars (`--c-accent`, `--c-bar`, `--c-accent-dim`, `--c-accent-text`, `--c-accent2`, etc.). Neutral background vars are shared across brands; accent vars differ per brand (NS: crimson `#B21526`, DS: royal blue `#1550C4`).

---

### `src/stages/reel-stage5-*` — Reel Assembly (Stage 5)
Stage 5 uses `@hyperframes/producer` to render HTML → MP4 video:
- `reel-stage5-renderer.ts` — `ReelStage5Facade` + renderer selection; `HyperframesStage5Renderer` is the only production renderer
- `reel-stage5-hyperframes-renderer.ts` — full Hyperframes implementation: copies assets, builds HTML, pre-mixes audio via ffmpeg, calls `@hyperframes/producer`, optionally embeds C2PA manifest
- `reel-stage5-templates/enhanced-default.ts` — the HTML template rendered by Hyperframes (caption overlays, word-level subtitle sync, animated scene transitions, watermark)
- `reel-stage5-performance.ts` — quality/FPS/worker config profiles
- `reel-stage5-ffmpeg-builder.ts` — legacy ffmpeg command builder (kept for reference, no longer used in production)

### `src/workers/reel-assembly-worker.ts` — Offload Worker Runner
Thin wrapper that runs inside the EC2 worker process: receives the job payload, constructs a `ReelContext`, invokes `ReelStage5Facade`, and reports results back to the pipeline server.

### `api/routes/` — HTTP API
- `runs.ts` — pipeline and reel trigger/list/detail endpoints
- `approval.ts` — approve/reject/edit post endpoints
- `review.ts` — redirect to GCS review HTML
- `line-webhook.ts` — LINE webhook receiver (stores command events)
- `studio.ts` — TikTok OAuth flow + NS reel publishing UI
- `dashboard.ts` — analytics dashboard (`/dashboard`) — CMP progress bars (followers + watch minutes toward monetization eligibility), daily views + daily follower gain charts, reel performance cards (sortable by score/views/engagement/watch time/followers gained, linked to `/review/reel/:id`), collapsible engagement breakdowns by pillar/theme/voice/music/posting_time. Protected by `DASHBOARD_SECRET` cookie
- `worker.ts` — EC2 worker callback API (`/worker/*`) — authenticated by `WORKER_API_TOKEN`; allows the remote worker to read job/reel data, update job status, and trigger completion notifications

---

## Approval Flow

```
Pipeline stages complete
        ↓
Status → awaiting_approval
        ↓
Review HTML uploaded to GCS, link sent via Telegram/LINE
        ↓
RacingPoller loops: polls Telegram + LINE simultaneously
        ↓
User sends !approve / !reject / !new image / !new text / !reschedule
        ↓
Posts marked approved with scheduled time
        ↓
1-minute cron publishes due posts → Meta API → status = published
```

---

## Reel Review + Publish Flow

```
ReelRunner stages complete (local or EC2 worker)
        ↓
Review HTML uploaded to GCS
        ↓
Telegram progress message updated → "Review" link shown
        ↓
User sends !reel approve [id] [HH:MM] [tmr]
        ↓
Reel marked approved + scheduledTime set
        ↓
1-minute cron publishes due reels → Facebook Reels + Instagram + TikTok (if enabled)
```

---

## Reel Stage5 — Hyperframes Rendering

Stage 5 replaced a raw ffmpeg pipeline with `@hyperframes/producer` (browser-based HTML-to-video rendering):

1. Scene images + audio files are copied into a Hyperframes project directory
2. `preMixAudio()` pre-mixes all scene voices + background music into a single MP3 using ffmpeg
3. An HTML file (`enhanced-default` template) is generated with per-scene CSS animations and word-level subtitle sync derived from Whisper word timings
4. `@hyperframes/producer` renders the HTML at 24/30/60 fps to MP4
5. The pre-mixed audio is muxed into the video using ffmpeg (`muxPremixedAudioIntoVideo`)
6. If AI-generated images are present, a C2PA provenance manifest is embedded in the video
7. The signed video is uploaded to GCS

Camera motion is controlled by the resolved `HyperframesCameraPreset` (category-default or operator override).

---

## Scheduling

- **Pipeline cron** — fires 15 minutes before each brand `postTime`
- **Reel cron** — fires 30 minutes before each `reelTime` slot; weekday and weekend slots are configured separately
- **Publisher cron** — every minute, publishes all approved posts/reels whose `scheduledTime ≤ now`
- **Heartbeat cron** — every minute, marks reels stuck in "generating" for 25+ minutes as failed
- **Metrics cron** — periodic fetch of engagement stats for published reels (views, likes, shares) via Meta API; results stored in `reel_metrics` and aggregated into `performance_benchmarks`
