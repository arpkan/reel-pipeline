# API Reference

Base URL: `http://localhost:3100` (or `PIPELINE_PORT`)

All request bodies are JSON. All responses are JSON unless noted. Brand IDs are `"ds"` or `"ns"`.

---

## Pipeline Runs

### `POST /run/:brand`
Trigger a new pipeline run (fire-and-forget — returns immediately, runs in background).

**Path params:** `brand` — `ds` | `ns`

**Body** (optional):
```json
{ "theme": "Economy" }
```
Valid themes: any key from the brand's `themeWeights` config (e.g. `"Tech"`, `"Economy"`, `"ข่าวด่วน"`).

**Response:**
```json
{ "status": "started", "brand": "ds", "theme": "Economy" }
```

---

### `GET /runs/:brand`
List recent pipeline runs.

**Path params:** `brand`
**Query params:** `limit` (default 20)

**Response:** Array of run rows from the `runs` table.

---

### `GET /runs/:brand/:runId`
Run detail including posts.

**Response:**
```json
{
  "id": "uuid",
  "brand": "ds",
  "runDate": "2026-04-15",
  "theme": "Economy",
  "status": "awaiting_approval",
  "stagesCompleted": 6,
  "reviewUrl": "https://storage.googleapis.com/...",
  "createdAt": "...",
  "updatedAt": "...",
  "posts": [
    {
      "id": "uuid",
      "runId": "uuid",
      "index": 0,
      "pillar": "ข่าวด่วน",
      "headline": "...",
      "source": "thairath.co.th",
      "sourceUrl": "https://...",
      "caption": "...",
      "textOverlay": "...",
      "imagePrompt": "...",
      "imagePath": "https://storage.googleapis.com/...",
      "imageFailed": false,
      "scheduledTime": "2026-04-15 08:00",
      "facebookPostId": null,
      "publishedAt": null,
      "approved": false,
      "createdAt": "..."
    }
  ]
}
```

---

### `POST /runs/:brand/:runId/resume-poller`
Restart the approval poller for a stuck run (status must be `awaiting_approval` or `approved`).

**Response:**
```json
{ "status": "resumed", "runId": "uuid" }
```

---

### `GET /runs/:brand/:runId/logs`
Returns a message directing to the run detail endpoint (stage logs are embedded in the DB directly).

---

## Approval

### `POST /runs/:brand/:runId/approve`
Approve all posts or a single post.

**Body** (approve all — omit postIndex):
```json
{}
```

**Body** (approve single post):
```json
{
  "postIndex": 0,
  "scheduledTime": "2026-04-15 08:00"
}
```

**Response:**
```json
{ "ok": true, "approved": "all" }
// or
{ "ok": true, "approved": 0 }
```

**Errors:**
- `404` — run not found
- `409` — run is not awaiting approval

---

### `POST /runs/:brand/:runId/reject`
Reject a run.

**Response:**
```json
{ "ok": true, "status": "rejected" }
```

---

### `POST /runs/:brand/:runId/edit`
Edit a post's caption, text overlay, or scheduled time.

**Body:**
```json
{
  "postIndex": 0,
  "caption": "New caption text",
  "textOverlay": "NEW HEADLINE",
  "scheduledTime": "2026-04-15 19:30"
}
```
All fields except `postIndex` are optional.

**Response:**
```json
{ "ok": true, "updated": 0 }
```

---

## Review

### `GET /review/:brand/:runId`
Redirects (302) to the GCS-hosted HTML review page for a **post pipeline run**.

**Errors:** `404` if run or review URL not found.

---

### `GET /review/reel/:reelId`
Serves the reel review HTML page inline (not a redirect). Shows the generated video, script, scene breakdown, stage log, and approval status for a reel.

**Note:** This route is distinct from `/review/:brand/:runId` — do not confuse reel IDs with run IDs.

**Errors:** `404` if reel not found.

---

## Reels

### `POST /reels/:brand`
Trigger a new reel generation (fire-and-forget).

**Body** (optional):
```json
{ "category": "breaking", "theme": "Economy" }
```
Valid categories: `breaking` | `trending` | `human_interest` | `business` | `open`

**Response:**
```json
{ "status": "started", "brand": "ns" }
```

---

### `GET /reels/:brand`
List recent reels.

**Query params:** `limit` (default 10)

**Response:** Array of reel rows.

---

### `GET /reels/:brand/:reelId`
Reel detail.

**Response:** Single reel row including `script` (JSON string), `videoGcsUrl`, `reviewUrl`, `status`, etc.

---

### `POST /reels/:brand/:reelId/resume`
Resume a reel from its last completed stage (smart skip — checks for existing audio/image files).

**Response:**
```json
{ "status": "resuming", "reelId": "uuid" }
```

---

### `POST /reels/:brand/:reelId/rebuild`
Force re-run stages 2–4 (voice + images + assembly) from scratch, keeping the existing script.

**Response:**
```json
{ "status": "rebuilding", "reelId": "uuid" }
```

---

### `POST /reels/:brand/:reelId/rerescript`
Re-run all reel stages 2–5 (generates a new script, voice, images, video).

**Body** (optional):
```json
{ "category": "trending" }
```

**Response:**
```json
{ "status": "rescripting", "reelId": "uuid" }
```

---

### `POST /reels/:brand/:reelId/fork`
Create a new reel that inherits assets from an existing reel, then continue from a given stage. Useful for A/B testing different voices, images, or assembly settings without re-running discovery.

**Body:**
```json
{ "fromStage": "assembly" }
```
Valid values: `"script"` | `"voice"` | `"images"` | `"assembly"` — determines which artifacts are copied and which stages run fresh.

**Response:**
```json
{ "reelId": "new-uuid", "fromStage": "assembly", "sourceReelId": "uuid" }
```

---

## Analytics Dashboard

### `GET /dashboard`
Serves the analytics dashboard HTML page for a brand.

**Layout (top to bottom):**
1. **Header** — brand name, logo, switcher (ThaiDaily / WorldBrief)
2. **CMP Progress** — dual progress bars: followers toward 10,000 and watch minutes (60d) toward 600,000 (Facebook monetization eligibility). Estimated months-to-eligibility label computed from 7-day growth rate.
3. **Hero** — 30-day daily views bar chart + 30-day daily follower gain chart; 4 KPI cards (Views 7d, Avg Engagement 7d, Reels Published, Followers Gained 7d)
4. **Reel Cards (14d)** — sortable by Score / Views / Eng% / Watch Time / Followers Gained; each card links to `/review/reel/:id`; color-coded left border (green ≥1.2x, yellow ≥0.8x, red below, gray no score)
5. **Breakdowns (30d)** — collapsible horizontal bar panels: By Pillar, By Theme, By Voice, By Music, By Posting Time

**Query params:**
- `brand` — `ds` | `ns` (default `ds`)
- `token` — auth token (sets a session cookie; required on first visit if `DASHBOARD_SECRET` is set)

**Auth:** Protected by `DASHBOARD_SECRET` env var. Pass `?token=<secret>` once; a cookie is set for subsequent visits.

---

## Worker API (EC2 Assembly)

All `/worker/*` endpoints require `Authorization: Bearer <WORKER_API_TOKEN>`.

### `GET /worker/jobs/:jobId`
Returns job details + the associated reel record for a remote assembly worker.

**Response:** `{ "job": {...}, "reel": {...} }`

### `PUT /worker/jobs/:jobId`
Updates job status fields (`status`, `instanceId`, `startedAt`, `finishedAt`, `error`).

**Response:** `{ "ok": true }`

### `PUT /worker/reels/:runId`
Updates reel status/video/context from the remote worker.

**Body** (partial):
```json
{
  "status": "awaiting_approval",
  "videoGcsUrl": "https://...",
  "reviewUrl": "https://...",
  "context": {}
}
```

**Response:** `{ "ok": true }`

### `POST /worker/reels/:runId/notify`
Sends a completion notification (edits the Telegram progress message or sends a new one) after remote assembly finishes.

**Body:**
```json
{ "reviewUrl": "https://...", "assemblyDurationMs": 45000 }
```

**Response:** `{ "ok": true }`

---

## Studio (TikTok)

### `GET /studio`
Serves the NS Studio HTML page for manual TikTok publishing.
**Query params:** `session` — session token from OAuth callback

### `GET /studio/connect`
Redirects to TikTok OAuth authorize URL. Initiates OAuth flow for NS brand.

### `GET /studio/callback`
TikTok OAuth callback. Exchanges code for access token, stores session, redirects to `/studio?session=<id>`.

### `GET /studio/session`
Returns session user info.
**Query params:** `id` — session token
**Response:** `{ "displayName": "...", "avatarUrl": "..." }`

### `GET /studio/reel`
Returns the most recent NS reel with a video URL.
**Response:** `{ "id": "uuid", "headline": "...", "category": "...", "videoGcsUrl": "..." }`

### `POST /studio/publish`
Publish a reel to TikTok (fire-and-forget, returns a job ID for polling).
**Body:** `{ "reelId": "uuid" }`
**Response:** `{ "jobId": "hex" }`

### `GET /studio/publish/status`
Poll a publish job.
**Query params:** `jobId`
**Response:**
```json
{ "status": "pending" }
{ "status": "done", "publishId": "..." }
{ "status": "failed", "error": "..." }
```

---

## Webhooks

### `GET /webhook/tiktok`
TikTok webhook verification. Returns the `challenge` query param as plain text.

### `POST /webhook/tiktok`
TikTok event sink (logs events, no action taken — publishing uses polling).

### `POST /webhook/line`
LINE webhook receiver. Verifies HMAC signature, stores incoming `!`-prefixed command messages to `line_events` for polling.

---

## Auth (TikTok OAuth)

### `GET /auth/tiktok/start`
Initiate TikTok OAuth for a brand account (admin use).
**Query params:** `brand` — `ds` | `ns`

### `GET /auth/tiktok/callback`
Completes OAuth flow. Displays access token and refresh token in plain text for manual `.env` update.

---

## Health

### `GET /health`
**Response:** `{ "ok": true, "ts": "ISO-8601" }`

---

## Telegram / LINE Command Interface

Commands are sent as chat messages starting with `!`. The server long-polls Telegram and polls LINE for new messages.

| Command | Description |
|---------|-------------|
| `!help` | List all commands with review link if pending |
| `!status` | Current run status, scheduled times, latest reel |
| `!run` | Start pipeline (auto theme) |
| `!run <theme>` | Start pipeline with specific theme |
| `!run <url> [url2]` | Start pipeline from URL(s) |
| `!skip` | Skip next scheduled pipeline run |
| `!skip cancel` | Cancel pending skip |
| `!weights` | Show theme weights |
| `!weight <theme> <n>` | Set theme weight |
| `!resume` | Restart approval session for current run |
| `!approve all` | Approve all posts |
| `!approve all now` | Approve and publish immediately |
| `!approve all at HH:MM` | Approve and reschedule |
| `!approve N` | Approve post N |
| `!approve N now` | Approve and publish post N immediately |
| `!approve N at HH:MM` | Approve and reschedule post N |
| `!reject` | Reject current run |
| `!new image N` | Regenerate image for post N |
| `!new text N` | Regenerate caption and image for post N |
| `!reschedule N to HH:MM` | Reschedule post N |
| `!reel [-nostock]` | Generate reel (auto discovery + auto category) |
| `!reel text` | Start manual text intake — bot asks for article text next |
| `!reel hint` | Start hint intake — bot asks for a topic hint to bias discovery |
| `!reel confirm <id>` | Confirm story headline and continue to script/voice/images/video |
| `!reel <theme\|url\|category>` | Generate reel with override |
| `!reel <category> <effect>` | Generate reel with category + camera effect (zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, ken_burns, none) |
| `!reel -preset <preset>` | Override Hyperframes camera preset (cinematic_drift, urgent_push, slow_reveal, documentary_slide, portrait_float, locked_frame) |
| `!reel list` | List 5 most recent reels |
| `!reel status` | Latest reel + next scheduled run |
| `!reel approve [id] [HH:MM] [tmr]` | Approve/publish reel |
| `!reel reject [id]` | Reject reel |
| `!reel cancel` | Cancel currently generating reel |
| `!reel skip` | Skip next scheduled reel |
| `!reel skip cancel` | Reduce skip count by 1 |
| `!reel skip cancel all` | Clear all pending skips |
| `!reel resume <id>` | Resume reel from last completed stage (smart skip of done work) |
| `!reel rebuild <id>` | Force re-run voice + images + video (keeps script) |
| `!reel rescript <id> [category] [effect]` | Regenerate script + video |
| `!reel re-voice [id] [voice-id\|speed] [speed]` | Regenerate voice only, then re-assemble video |
| `!reel re-images [id] [-nostock]` | Regenerate images only, then re-assemble video |
| `!reel re-music [id] [track]` | Regenerate music mix only (track = 1-based index or filename) |
| `!reel re-effect [id] <effect\|preset>` | Re-assemble video with a different camera effect or preset |
| `!batch N` | Start overnight batch of N reels |
| `!batch status` | Show batch run history |
