# Testing Dashboard — Implementation Plan

**Date:** 2026-04-25
**Status:** Implemented
**Spec:** `docs/superpowers/specs/2026-04-21-pipeline-testing-environment.md`

## Overview

This plan covers the full testing dashboard feature: reel test runner, seeded data, fork API, config overrides, brand theming, rich output, and auth. All tasks are complete.

---

## Completed Tasks

### Phase 1: Test infrastructure

- [x] Reel fixture files (`tests/fixtures/`)
- [x] `test/compare.ts` — reel stage snapshot comparison
- [x] `test/seed.ts` — `seedReel()` for copying reel data + assets into test.db
- [x] `test/runner.ts` — `runReelStage()` with `reelId` + `overrides` support
- [x] Nock mocks for Bedrock (Messages API format), Tavily, Gemini, GCS

### Phase 2: API endpoints

- [x] `GET /testing` — dashboard HTML
- [x] `GET /testing/reels/:brand` — list recent reels
- [x] `POST /testing/seed-reel` — seed reel row + assets into test.db
- [x] `POST /testing/run-reel/:fromStage` — run stage with `sequential`, `reelId`, `overrides`
- [x] `GET /testing/reel-output/:reelId` — rich scene data
- [x] `GET /testing/work/reels/:reelId/:file` — stream audio/image files
- [x] `GET /testing/logo/:brand` — serve brand logos
- [x] `POST /reels/:brand/:reelId/fork` — fork with inherited assets
- [x] `POST /reels/:brand/:reelId/resume` — resume failed reel
- [x] `POST /reels/:brand/:reelId/rebuild` — rebuild from later stages
- [x] `POST /reels/:brand/:reelId/rerescript` — regenerate script
- [x] `POST /reels/:brand/:reelId/re-voice` — re-run voice
- [x] `POST /reels/:brand/:reelId/re-images` — re-run images
- [x] `POST /reels/:brand/:reelId/re-music` — re-run music/assembly

### Phase 3: Dashboard UI

- [x] Brand tab system (NS first, DS second) with dynamic CSS theming
- [x] NS = crimson (#c41e3a), worldbrief logo; DS = ThaiDaily blue (#3B82F6), thaidaily logo
- [x] Config controls — 5 tabs (Discovery, Script, Voice, Images, Assembly)
  - Theme/category dropdowns, URL override, scene count slider
  - Voice provider/model/speed/stability/similarity controls
  - Image source/provider/model controls
  - Music track/volume controls
- [x] Stage runner — 6 stage buttons + Run All + Sequential toggle
- [x] Rich output — script as vertical numbered scenes, audio players, image thumbnails
- [x] Neutral "Changes from last run" diff (replaced PASS/FAIL)
- [x] Production actions — Fork, Resume, Rebuild, Re-Voice, Re-Images, Re-Music, Rerescript

### Phase 4: Auth

- [x] `TESTING_SECRET` env var gates all `/testing` routes
- [x] Token via `?token=<secret>` → 30-day HttpOnly cookie
- [x] No secret = open access (dev mode)
- [x] Both `/testing` and `/testing/*` patterns registered (Hono quirk)

---

## Files

| File | Purpose |
|---|---|
| `api/routes/testing.ts` | Routes, auth middleware, API handlers |
| `api/routes/testing-html.ts` | Dashboard HTML/CSS/JS builder |
| `test/runner.ts` | Stage runner with overrides |
| `test/seed.ts` | Seed functions |
| `test/compare.ts` | Snapshot comparison |
| `.env` | `TESTING_SECRET` |

## Key implementation notes

- **Bedrock mock**: `@anthropic-ai/bedrock-sdk` expects Messages API format, NOT AWS Converse API. Nock mock returns `{content:[{type:"text",text:"..."}]}` at top level.
- **test.db path**: Compiled code puts it at `dist/test.db`. Runner uses `path.resolve(__dirname, "..", "test.db")`.
- **Hono route matching**: `/testing*` skips the exact path `/testing`. Need both `use("/testing")` and `use("/testing/*")`.
- **Non-deterministic output**: AI output changes between runs, so diff is framed as neutral "Changes from last run", not pass/fail.
