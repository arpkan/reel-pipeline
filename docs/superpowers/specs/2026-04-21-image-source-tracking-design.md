# Image Source Tracking — Design Spec

**Date:** 2026-04-21

## Goal

Track whether each image (post or reel) was sourced from a stock provider (Unsplash / Pexels / Pixabay) or AI-generated (Gemini), including the specific provider or model name. Surface this information in the review HTML for both posts and reels, and persist it to the database.

---

## Background

Currently `tryStockImage()` returns `Buffer | null` — the provider that was used is silently discarded. `image-gen.ts` uses a hardcoded model ID (`gemini-3.1-flash-image-preview`) that is never recorded anywhere. After stage execution, there is no way to tell which images came from stock vs. AI.

---

## Shared Type: `ImageSource`

Defined in `src/types.ts`:

```ts
export type StockProvider = 'unsplash' | 'pexels' | 'pixabay';

export type ImageSource =
  | { type: 'stock';  provider: StockProvider }
  | { type: 'ai';     model: string }
  | { type: 'failed' }
```

---

## Service Changes

### `src/services/stock-image.ts`

Change `tryStockImage()` return type from `Buffer | null` to `{ buffer: Buffer; provider: StockProvider } | null`.

Each internal search function (`searchUnsplash`, `searchPexels`, `searchPixabay`) already knows which provider it is — thread the provider name through to the return value instead of discarding it.

The `Promise.all` + `find` pattern is replaced: each search function returns `{ buffer, provider } | null`, and the first non-null result is returned.

### `src/services/image-gen.ts`

Expose the active model ID via a readonly getter `get modelName(): string` so callers can record it without hardcoding the string at call sites.

---

## Data Model

### Posts

**`src/types.ts` — `Post` interface:**
Add `imageSource?: ImageSource`

**`src/db/schema.ts` — `posts` table:**
Add `imageSource: text('image_source')` (nullable, stores JSON)

**`src/db/queries.ts` — `updatePost()` fields:**
Add `imageSource?: ImageSource` to the updatable fields; serialize to JSON on write, parse on read.

### Reels

**`src/types.ts` — `ReelContext` interface:**
Add `imageSourceMap?: Record<number, ImageSource>` (key = `sceneNumber`, 1-based)

**DB persistence:** Stored inside the existing `context` JSON blob that `reel-runner.ts` already serializes to the `reels` table — no schema migration needed.

---

## Stage Changes

### `src/stages/post-stage3-image-gen.ts`

- Destructure `{ buffer, provider }` from `tryStockImage()` result
- Set `imageSource = { type: 'stock', provider }` on stock success
- Set `imageSource = { type: 'ai', model: services.imageGen.modelName }` on AI success
- Set `imageSource = { type: 'failed' }` when all attempts fail (alongside existing `imageFailed = true`)
- Pass `imageSource` to `updatePost()`

### `src/stages/reel-stage4-images.ts`

- Build `imageSourceMap: Record<number, ImageSource>` as it iterates scenes
- Set `imageSourceMap[scene.sceneNumber] = { type: 'stock', provider }` on stock hit
- Set `imageSourceMap[scene.sceneNumber] = { type: 'ai', model: imageGen.modelName }` on AI generation
- Return `{ imagePaths, imageSourceMap }`

---

## Review HTML

### Post review (`src/review/html-builder.ts` → `buildPostCard`)

Add a source badge rendered just below the `<img>` or failed-image block, above the post label:

- `📷 Unsplash` / `📷 Pexels` / `📷 Pixabay` — blue pill (`.pill-blue`)
- `🤖 gemini-3.1-flash-image-preview` — grey pill (`.pill-grey`)
- No badge when `imageSource` is undefined (backward compatible with existing runs)
- `type: 'failed'` is already handled by the `imageFailed` flag; no extra badge needed

### Reel review (`src/review/reel-html-builder.ts` → scene header)

Add badge next to scene number in `.scene-header`:

- `Scene 2 · 📷 Pexels`
- `Scene 2 · 🤖 gemini-3.1-flash-image-preview`
- No badge when `imageSourceMap` is undefined or has no entry for the scene

---

## Backward Compatibility

- `imageSource` on `Post` is optional — existing DB rows without the column value render without a badge
- `imageSourceMap` on `ReelContext` is optional — reels resumed from pre-feature state render scene headers without badges
- No DB migration required for reels (stored in existing `context` blob)
- DB migration IS required for posts (new `image_source` column) — added as an `ALTER TABLE` in the schema init block, guarded with `IF NOT EXISTS` semantics via Drizzle

---

## Out of Scope

- Photographer / attribution credit (no attribution data is fetched from stock APIs)
- Surfacing source in the published video or post caption
- Tracking image source for `!post new image N` regenerations (future work)
