# Pipeline Testing Environment

**Date:** 2026-04-21
**Status:** Approved
**Revised:** 2026-04-25 — aligned with implemented code, auth, brand theming, config overrides

## Problem

Both pipelines (post + reel) are expensive and slow to run end-to-end. We need a way to:
- test stage behavior in isolation,
- reuse real run/reel data and assets,
- and safely validate changes before production publishing.

## Goals

1. Run individual stages cheaply against seeded data.
2. Compare outputs against previous runs as neutral change logs (not pass/fail).
3. Support reel testing as first-class workflow.
4. Support production fork flow for stage-focused reruns.
5. Keep stage/service code unchanged; use wrappers/routing around it.
6. Config overrides for every pipeline parameter — adjustable from the UI.
7. Auth-gated access (token + cookie) to prevent public exposure.

---

## Architecture

### 1) Seeded test database + workdir

- `test/seed.ts`
  - `seed(brand, runId)` copies post-run data into `test.db`.
  - `seedReel(brand, reelId)` copies reel row plus `work/reels/{reelId}` assets into `test/work/reels/{reelId}`.

### 2) Stage runner + mocks

- `test/runner.ts`
  - `runReelStage(fromStage, brand, update, sequential?, reelId?)` for reel testing.
  - Accepts `overrides` object for per-run config (theme, category, voice, images, music).
- Uses `nock` to mock expensive integrations (Tavily/Gemini/Bedrock/ElevenLabs/Imagen/GCS) where needed.

### 3) Change comparison

- `test/compare.ts` compares DB query output against `test/snapshots/stage-*.json`.
- `update` mode writes new baselines.
- UI shows "Changes from last run" — neutral diff with added/removed/changed counts. No PASS/FAIL badges.

### 4) Web UI

- `GET /testing` serves dashboard UI.
- HTML built in `api/routes/testing-html.ts` (1437 lines), served via `api/routes/testing.ts`.
- Reel-only (no post pipeline section in UI).
- Dynamic brand theming via CSS custom properties — NS = crimson (#c41e3a), DS = ThaiDaily blue (#3B82F6).
- NS tab first, DS tab second. Brand logos shown in tab buttons.

### 5) Auth

- `TESTING_SECRET` env var gates all `/testing` routes.
- First visit: `?token=<secret>` → sets 30-day HttpOnly cookie.
- No `TESTING_SECRET` set = open access (dev mode).

### 6) Production fork API

- `POST /reels/:brand/:reelId/fork` in `api/routes/runs.ts`.
- Creates a new reel from an existing one and optionally reuses assets by `fromStage`.

---

## Current Stage Mapping

### Reel pipeline (testing — primary)
- `0` Balance (shared)
- `1` Discover (shared)
- `script` → reel stage 2
- `voice` → reel stage 3
- `images` → reel stage 4
- `assembly` → reel stage 5

`sequential=true` means run from selected stage through assembly.

---

## Endpoints (Implemented)

### Testing (`api/routes/testing.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/testing` | Dashboard (auth-gated) |
| `GET` | `/testing/runs/:brand` | List recent post runs |
| `POST` | `/testing/seed` | Seed post data into `test.db` |
| `POST` | `/testing/run/:stage` | Run post stage test |
| `GET` | `/testing/diff/:stage` | Read diff for stage |
| `POST` | `/testing/snapshot/:stage/update` | Update snapshot |
| `GET` | `/testing/reels/:brand` | List recent reels |
| `POST` | `/testing/seed-reel` | Seed reel row + assets |
| `POST` | `/testing/run-reel/:fromStage` | Run reel test stage (`sequential`, `reelId`, `overrides` supported) |
| `GET` | `/testing/reel-output/:reelId` | Rich scene data from test.db |
| `GET` | `/testing/work/reels/:reelId/:file` | Stream audio/image files from work dir |
| `GET` | `/testing/logo/:brand` | Serve brand logo (NS=worldbrief, DS=thaidaily) |

### Production (`api/routes/runs.ts`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/reels/:brand/:reelId/fork` | Fork reel with inherited assets |
| `POST` | `/reels/:brand/:reelId/resume` | Resume failed/interrupted reel |
| `POST` | `/reels/:brand/:reelId/rebuild` | Rebuild from later stages |
| `POST` | `/reels/:brand/:reelId/rerescript` | Regenerate script and continue |
| `POST` | `/reels/:brand/:reelId/re-voice` | Re-run voice stage |
| `POST` | `/reels/:brand/:reelId/re-images` | Re-run images stage |
| `POST` | `/reels/:brand/:reelId/re-music` | Re-run music/assembly |

---

## Config Overrides

POST `/testing/run-reel/:fromStage` accepts an `overrides` object in the body:

```typescript
interface TestRunOverrides {
  theme?: string;
  category?: ReelCategory;
  sourceUrl?: string;
  sceneCount?: number;
  voiceId?: string;
  voiceProvider?: "elevenlabs" | "uvoice";
  voiceSpeed?: number;
  voiceModel?: string;
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  useStockImages?: boolean;
  stockProvider?: "unsplash" | "pexels" | "pixabay" | "any";
  imageModel?: string;
  musicTrack?: string;
  musicVolume?: number;
}
```

Applied at the ReelContext level before calling stage functions. No changes to `src/stages/*`.

---

## UI Structure

### Brand tabs
- NS tab (crimson theme, worldbrief logo) — first/default
- DS tab (blue theme, thaidaily logo)

### Cards
1. **Seed** — brand selector, reel dropdown, seed button, review link
2. **Configuration** (5 tabs) — Discovery, Script, Voice, Images, Assembly
   - Each tab has relevant controls (dropdowns, sliders, radio buttons, checkboxes)
3. **Stage Runner** — `0·Balance` `1·Discover` `2·Script` `3·Voice` `4·Images` `5·Assembly` `▶ Run All`
   - Sequential checkbox, update snapshot checkbox
4. **Output** — accumulates as stages complete
   - Script: vertical numbered scene list with voiceover text
   - Voice: audio player per scene
   - Images: scene thumbnails with source badge
   - "Changes from last run" diff (added/removed/changed counts + field-level detail)
5. **Production Actions** — Fork, Resume, Rebuild, Re-Voice, Re-Images, Re-Music, Rerescript

---

## Auth Setup

Add to `.env`:
```
TESTING_SECRET=<your-secret>
```

Access URL (one time): `https://pipeline.example.com/testing?token=<your-secret>`

After first visit, cookie persists for 30 days. No `TESTING_SECRET` = open access.

---

## Verification

1. `npm run build` passes.
2. `GET /testing` returns 401 without token, 200 with token.
3. `POST /testing/run-reel/:fromStage` accepts `sequential` + `overrides`.
4. Brand tabs switch CSS theme dynamically.
5. Script output renders as vertical numbered scenes.
6. "Changes from last run" shows neutral diff (no PASS/FAIL).
