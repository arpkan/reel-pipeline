# Onboarding

How to set up and run the content pipeline locally.

---

## Prerequisites

- **Node.js 22+** (`node --version`)
- **ffmpeg** — must be on `PATH` (used for reel audio pre-mixing and mux steps)
- AWS account with Bedrock access (Claude models enabled in your region)
- Google Cloud project with:
  - Vertex AI API enabled
  - Cloud Storage bucket
  - Service account key JSON
- API keys for: Tavily, Gemini (two keys), ElevenLabs (or another voice provider)
- Telegram bot token + chat ID(s)
- Meta (Facebook) developer app with a page token

---

## Install

```bash
cd content-pipeline
npm install
```

---

## Environment Setup

Copy or create a `.env` file in the project root. The server will validate all required vars at startup and exit with a descriptive list of anything missing.

```bash
# ── Always required ───────────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1          # must have Bedrock Claude enabled

GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_CLOUD_PROJECT=your-gcp-project-id

GCS_BUCKET=your-bucket-name

GEMINI_API_KEY=               # for story discovery / scoring
GEMINI_IMAGE_API_KEY=         # for Imagen image generation

TAVILY_API_KEY=

TELEGRAM_BOT_TOKEN=
PIPELINE_DB_PATH=./data/pipeline.db
PIPELINE_BASE_URL=https://your-pipeline-host.com  # used to build review page URLs

# ── DS brand (ThaiDaily — Thai) ─────────────────────────────────────────────────
TELEGRAM_DS_CHAT_ID=
DS_META_PAGE_ID=
DS_META_PAGE_TOKEN=

# ── NS brand (WorldBrief — English) ────────────────────────────────────────────
TELEGRAM_NS_CHAT_ID=
NS_META_PAGE_ID=
NS_META_PAGE_TOKEN=

# ── Optional ──────────────────────────────────────────────────────────────────
PIPELINE_PORT=3100            # default 3100
ELEVENLABS_API_KEY=           # required for reels using ElevenLabs voices
DS_REEL_VOICE_ID=             # ElevenLabs voice ID for DS reels

# TikTok (only needed if tikTokEnabled in brand config)
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://your-domain.com/auth/tiktok/callback
DS_TIKTOK_ACCESS_TOKEN=
NS_TIKTOK_ACCESS_TOKEN=

# LINE (only needed if line channel enabled in brand config)
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
LINE_DS_GROUP_ID=
LINE_NS_GROUP_ID=

# ── Dashboard ──────────────────────────────────────────────────────────────────
DASHBOARD_SECRET=             # protects /dashboard — pass as ?token= or cookie

# ── Additional voice providers ────────────────────────────────────────────────
BOTNOI_API_KEY=               # Thai TTS (botnoi.ai)
UVOICE_API_KEY=               # UVoice TTS
MINIMAX_API_KEY=              # MiniMax TTS
MINIMAX_GROUP_ID=             # MiniMax group ID

# ── Azure image generation ────────────────────────────────────────────────────
AZURE_FOUNDRY_ENDPOINT=       # e.g. https://<resource>.openai.azure.com
AZURE_FOUNDRY_API_KEY=
AZURE_FOUNDRY_DEPLOYMENT=gpt-image-2   # default
AZURE_IMAGE_QUALITY=medium             # low | medium | high

# Azure OpenAI for GPT-5.5 discovery / URL classification
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
DISCOVERY_PROVIDER=gemini              # gemini | azure_gpt55
URL_CLASSIFIER_PROVIDER=gemini         # gemini | azure_gpt55

# ── EC2 assembly offload ──────────────────────────────────────────────────────
REEL_ASSEMBLY_OFFLOAD_ENABLED=false
REEL_ASSEMBLY_QUEUE_URL=      # SQS queue URL
REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID=  # EC2 launch template ID
WORKER_API_TOKEN=             # shared secret for /worker/* endpoints
WORKER_WORK_DIR=/tmp/reel-work  # work dir on EC2 worker (default /tmp/reel-work)

# ── C2PA provenance signing ───────────────────────────────────────────────────
# c2pa-rs rejects self-signed certs, so we use a CA + leaf pair. Regenerate
# with: bash scripts/regen-c2pa-certs.sh
C2PA_SIGN_CERT=               # path to leaf+CA chain PEM (c2pa-signer-chain.pem)
C2PA_SIGN_KEY=                # path to leaf ES-256 private key PEM
```

---

## Running the Server

**Development (auto-restart on file change):**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

The server starts on `http://localhost:3100`. On startup it:
1. Validates all env vars
2. Seeds theme weights in the DB from brand defaults
3. Registers reel cron schedules
4. Resumes approval pollers for any runs left `awaiting_approval`
5. Starts Telegram + LINE long-poll command listeners

---

## Running a Pipeline Run (CLI)

```bash
npm run cli -- ds                    # run DS pipeline, auto theme
npm run cli -- ds --theme Economy    # specific theme
npm run cli -- ds --url https://...  # from URL
npm run cli -- ds --dry-run          # skip all stages (no API calls)
npm run cli -- ds --stage 2          # stop after stage 2 (debug)
npm run cli -- ds --resume <runId>   # resume a failed run
```

---

## Triggering via API

```bash
# Start a pipeline run
curl -X POST http://localhost:3100/run/ds \
  -H "Content-Type: application/json" \
  -d '{"theme": "Economy"}'

# Check status
curl http://localhost:3100/runs/ds?limit=5

# Approve all posts
curl -X POST http://localhost:3100/runs/ds/<runId>/approve

# Start a reel
curl -X POST http://localhost:3100/reels/ns \
  -H "Content-Type: application/json" \
  -d '{"category": "breaking"}'
```

---

## Triggering via Telegram

Add your Telegram bot to a group or DM it. The bot listens on the chat IDs configured in `TELEGRAM_DS_CHAT_ID` / `TELEGRAM_NS_CHAT_ID`.

```
!help              — see all commands
!run               — start pipeline
!reel              — generate reel
!status            — check status
```

---

## Database

The pipeline uses a local SQLite file at `PIPELINE_DB_PATH`. The schema is managed by Drizzle ORM.

To inspect the database directly:
```bash
sqlite3 data/pipeline.db ".tables"
sqlite3 data/pipeline.db "SELECT id, brand, status, run_date FROM runs ORDER BY created_at DESC LIMIT 10;"
```

To regenerate the schema (after modifying `src/db/schema.ts`):
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

---

## Testing

```bash
npm test           # run all tests once
npm run test:watch # watch mode
```

---

## Project Structure Quick Reference

```
bin/
  server.ts         Main server entry point
  run.ts            CLI runner
  worker.ts         EC2 assembly worker entry point

api/routes/         HTTP route handlers
src/
  brands/           Brand configs (ds.ts, ns.ts, index.ts, voice-pool.ts)
  db/               SQLite schema, queries, client
  effects/          Camera effects + Hyperframes presets
  pipeline/         PipelineRunner, ReelRunner, reel-intake, progress, command listener
  review/           HTML builder utilities (posts, reels, dashboard)
  services/         External API clients
  stages/           Pipeline stage implementations
  types.ts          All shared types
  config.ts         Env validation + feature flags
  workers/          Reel assembly worker runner

assets/music/       Background music files for reels
assets/brands/      Brand logo images (worldbrief_logo.png, thaidaily_logo.png) — embedded base64 in dashboard and reel review pages; also used as watermarks in reel video
data/               Persistent runtime data (reel skip flags)
work/reels/         Per-reel working directories (audio, images, video)
logs/               Server and publisher log files
ref-docs/           This documentation
```

---

## Adding a New Brand

1. Create `src/brands/<id>.ts` following the `BrandConfig` interface in `src/types.ts`
2. Export it from `src/brands/index.ts` and add to `ALL_BRANDS`
3. Add brand-specific env vars to `.env` and to the validation list in `src/config.ts`
4. Add the brand ID to `VALID_BRANDS` in `api/routes/runs.ts`
5. Add `initThemeWeights` and `scheduleBrand` / `scheduleReels` calls in `bin/server.ts`

---

## Common Issues

**"A run for ds is already in progress"**
A previous run is stuck in `running` status. Either resume it (`!resume` or `--resume <runId>`) or update the DB directly:
```bash
sqlite3 data/pipeline.db "UPDATE runs SET status='failed' WHERE id='<runId>';"
```

**Reel stuck in "generating"**
The heartbeat cron marks reels stuck for 25+ minutes as failed automatically. To force it:
```bash
sqlite3 data/pipeline.db "UPDATE reels SET status='failed', current_stage=NULL WHERE id='<reelId>';"
```

**Image generation fails**
`imageFailed` is set to `true` on the post but the run continues. Use `!new image N` in Telegram to retry.

**Approval session disconnected after restart**
The server resumes pollers on startup. If it doesn't pick up automatically, send `!resume` in Telegram.

**Reel stage5 timeout**
The Hyperframes renderer has a 15-minute default timeout. If it consistently times out, try reducing `stage5Performance` in the brand config or enabling EC2 assembly offload (`REEL_ASSEMBLY_OFFLOAD_ENABLED=true`).
