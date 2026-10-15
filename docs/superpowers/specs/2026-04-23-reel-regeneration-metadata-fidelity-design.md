# Reel Regeneration Metadata Fidelity Design

Date: 2026-04-23
Status: Draft

## Goal

Ensure every reel regeneration path (`resume`, `rebuild`, `rerescript`, `rebuildPart`) persists the latest generation metadata, and ensure `/review/reel/:reelId` always renders that final, current state accurately.

## Problem Statement

After partial/full reel regenerations, the review HTML can show stale or missing metadata because some fields (notably `musicFile`, and some context-derived fields) are not consistently persisted and re-hydrated for rendering.

## User Requirement

Display mode is **final state only**:
- Do not show historical diffs in the review page.
- Always show the latest persisted metadata for the reel.

## Source of Truth

Use `reels` row as canonical source:
- `script` contains latest scene content and `imagePrompt` values.
- `context` contains latest run metadata for review panels and badges.
- `videoGcsUrl` + `reviewUrl` reflect current output asset.

## Metadata Contract (Reel Context Persistence)

Persist these fields into `reels.context` at completion of all reel execution paths:

- discovery/context fields (existing):
  - `themeSource`
  - `pillarBalance`
  - `trendingSignals`
  - `categorySource`
  - `discoveryBias`
  - `recentTopics`
- generation fields:
  - `imageSourceMap`
  - `useStockImages`
  - `apiSourceMap`
  - `musicFile`

Notes:
- `musicFile` must represent the track actually used in final stage-5 output.
- `imagePrompt` remains derived from latest persisted `script` scenes (not duplicated into `context`).

## Design Changes

### 1) Runner persistence consistency

Update final `queries.updateReel(..., { context: ... })` calls in all completion paths in `src/pipeline/reel-runner.ts` to include `musicFile` in context payload, alongside existing generation metadata.

Paths in scope:
- normal run
- `resume`
- `rebuild`
- `rerescript`
- `rebuildPart`

### 2) Review route hydration consistency

Update reel context hydration in `api/routes/review.ts` to read and pass through all persisted context fields needed by HTML rendering, including:
- `musicFile`
- `categorySource`
- `useStockImages`
- existing source maps and discovery fields

### 3) HTML rendering behavior

`src/review/reel-html-builder.ts` continues to render from hydrated `ReelContext` and latest `script`.

Expected result after any regenerate command:
- Music row shows current track.
- Scene source badges reflect current image source map.
- Prompt details reflect current script scene prompts.
- API source panel reflects latest providers.

## Verification Plan

### Automated tests

Add/adjust tests to verify:
- review route correctly hydrates `musicFile` and related context fields from persisted `reels.context`.
- rerun completion writes include updated `musicFile` and source maps.

### Manual checks

For one reel, run each command and reload review page:
- `!reel rebuild <id>`
- `!reel rescript <id>`
- `!reel resume <id>`
- `!reel re-images <id> [-nostock]`
- `!reel re-music <id> [track]`

Confirm metadata updates on the same review URL reflect latest run state only.

## Non-Goals

- No metadata history timeline in review page.
- No schema migration to add dedicated `music_file` column.
- No UI redesign beyond correctness updates.

## Risks and Mitigation

- Risk: Missing one runner completion path causes inconsistent behavior.
  - Mitigation: central checklist for all five paths + tests covering each.
- Risk: Mixed old/new context records in existing DB rows.
  - Mitigation: defensive optional reads in review route with sensible fallbacks.
