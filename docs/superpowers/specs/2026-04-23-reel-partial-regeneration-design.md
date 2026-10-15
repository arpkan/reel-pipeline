# Reel Partial Regeneration Commands Design

**Date:** 2026-04-23  
**Status:** Approved

## Overview

Add targeted reel regeneration commands so operators can rerun only the needed part of an existing reel:

- `!reel re-voice [id]`
- `!reel re-images [id] [-nostock]`
- `!reel re-music [id] [track]`

This avoids expensive full rebuilds when only one part needs adjustment.

---

## Problem

Current options are too coarse:

- `!reel rebuild <id>` reruns voice + images + assembly
- `!reel rescript <id> [category]` reruns script + downstream stages

Operators cannot quickly iterate on one asset type (voice, images, or music) without recomputing unrelated stages.

---

## Command Contract

### New commands

- `!reel re-voice [id]`
- `!reel re-images [id] [-nostock]`
- `!reel re-music [id] [track]`

### Target resolution

- `id` optional for all three commands
- If `id` omitted: target latest reel with `status = awaiting_approval`
- If no pending reel exists: return clear error (`⚠️ Reel not found` / `⚠️ No reel awaiting approval`)

### `-nostock` rules

- Allowed only for `re-images`
- Invalid for `re-voice` and `re-music` (return usage error)

### `re-music` track selection

- `track` optional:
  - omitted => random track from category pool (current behavior)
  - numeric index => select track by index in resolved pool (1-based)
  - basename => select by filename (e.g. `breaking-news-3.mp3`)
- Both index and basename formats are supported
- Invalid track selector => return clear list of available tracks

---

## Stage Mapping

Command-to-stage behavior:

- `re-voice` => run `reel-stage3-voice` then `reel-stage5-assemble`
- `re-images` => run `reel-stage4-images` then `reel-stage5-assemble`
- `re-music` => run `reel-stage5-assemble` only

No other stages are touched.

---

## Architecture

### 1) Extend reel runner with partial rebuild entrypoint

Add a new method in `src/pipeline/reel-runner.ts`:

```ts
static async rebuildPart(
  reelId: string,
  brandId: BrandId,
  part: "voice" | "images" | "music",
  options?: {
    useStockImagesOverride?: boolean;
    musicTrackSelector?: string; // index or basename
  }
): Promise<void>
```

This method reuses current rebuild context reconstruction and lock behavior, but runs only the required stage subset.

### 2) Carry optional music override through context

Add optional field to `ReelContext` in `src/types.ts`:

```ts
musicTrackOverride?: string;
```

Used only by `reel-stage5-assemble` for forced track selection.

### 3) Teach stage 5 to honor music override selector

In `src/stages/reel-stage5-assemble.ts`, before random selection:

- Resolve category music pool as today
- If `ctx.musicTrackOverride` exists:
  - try numeric selector (1-based index)
  - else try basename match
  - if found: use exact file
  - if not found: throw clear error listing available basenames
- If no override: existing random behavior unchanged

### 4) Add command listener routes

In `src/pipeline/command-listener.ts` under `!reel` block:

- Parse `re-voice`, `re-images`, `re-music`
- Resolve target reel by optional id or latest pending
- Validate `-nostock` compatibility
- Call `ReelRunner.rebuildPart(...)`

Help text (`!help`) updated in TH/EN sections.

---

## Data Flow

1. User sends command in Telegram/LINE
2. `command-listener` resolves target reel + options
3. Calls `ReelRunner.rebuildPart`
4. Runner reconstructs reel context from DB + workdir
5. Runs selected stage subset
6. Updates reel row (`script`, `videoGcsUrl`, `context`, `reviewUrl`, status)
7. Sends updated review notification

---

## Error Handling

- Unknown reel id => `⚠️ Reel not found`
- No pending reel when id omitted => `⚠️ No reel awaiting approval`
- `-nostock` on `re-voice`/`re-music` => usage error
- `re-music` invalid selector => include available tracks in error message
- Missing required artifacts for chosen part (e.g. no script for re-voice) => fail fast with explicit error

---

## Backward Compatibility

- Existing commands unchanged:
  - `!reel rebuild <id>`
  - `!reel rescript <id> [category]`
  - `!reel resume <id>`
- Existing random music behavior unchanged when no track selector is provided.

---

## Out of Scope

- `re-all` command alias (explicitly not needed)
- Per-scene track selection
- Persistent “preferred track” saved to DB for future reels
- UI changes outside command help text
