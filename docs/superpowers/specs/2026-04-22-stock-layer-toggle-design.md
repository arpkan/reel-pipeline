# Design: Stock Image Layer Toggle

**Date:** 2026-04-22

## Goal
Allow users to enable or disable the stock image layer both at the brand level (permanent setting) and at the run level (using a `-nostock` flag in commands).

---

## Technical Approach

### 1. Types and Config
Update `src/types.ts` to include `useStockImages: boolean` in:
- `BrandConfig`
- `RunContext`
- `ReelContext`
- `RunOptions` (in `runner.ts`)
- `ReelRunOptions` (in `types.ts`)

Update `src/brands/ds.ts` and `src/brands/ns.ts` to include `useStockImages: true` by default.

### 2. Command Parsing
Update `src/pipeline/command-listener.ts`:
- Create a helper to detect and strip `-nostock` from `subCmd`.
- For `!post`, if `-nostock` is present, set `useStockImages: false` in `options`.
- For `!reel`, if `-nostock` is present, set `useStockImages: false` in `options`.

### 3. Pipeline Runners
Update `src/pipeline/runner.ts` and `src/pipeline/reel-runner.ts`:
- Propagate the `useStockImages` option into the context.
- For Reels, ensure `useStockImages` is persisted in the `context` JSON blob in the DB (and restored in `resume()`).
- For Posts, it should be part of the `RunContext` (we'll add it to the `runs.context` JSON column).

### 4. Image Generation Stages
Update `src/stages/post-stage3-image-gen.ts` and `src/stages/reel-stage4-images.ts`:
- Check `ctx.useStockImages` (which will default to `brand.useStockImages` if not overridden).
- If `false`, skip `services.stockImage.tryStockImage` and go directly to AI generation.

### 5. Review HTML
- **Post Review**: Add a "Stock Images: On/Off" line to the Theme & Pillar Decision panel.
- **Reel Review**: Add "Stock Images: On/Off" to the Category Discovery panel.

---

## Backward Compatibility
- Existing runs in the DB won't have `useStockImages` in their context blobs.
- Logic will default to `brand.useStockImages` (which is `true`) if the context field is missing.
- Review pages for old runs will show "Stock Images: On".
