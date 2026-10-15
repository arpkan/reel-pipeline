# Review HTML — Show Actual Selected Voice and Camera Effect

**Date:** 2026-04-29
**Problem:** The review page shows "auto" for voice and camera effect even when a specific value was actually used. Music shows correctly because `ctx.musicFile` is recorded by stage5.

---

## Root cause

Two independent gaps:

1. **Camera effect is never persisted when auto-picked.**
   - `resolveEffect(category, brand.reels, ctx.cameraEffect)` runs in `src/stages/reel-stage5-assemble.ts:167` and stores the result in a local const. It's never written back to `ctx`.
   - `buildPersistedReelContext` records `ctx.cameraEffect`, which only holds an explicit user override (`!reel re-effect`, `!reel ... cam=...`). Auto-picked effects vanish.
   - Review HTML at `src/review/reel-html-builder.ts:79` reads `ctx.cameraEffect ?? "Auto"` → shows "Auto".

2. **Voice is dropped on rebuilds of non-voice parts.**
   - Stage 3 sets `ctx.usedVoiceId/Provider/Speed` and `buildPersistedReelContext` includes them. ✓ during the initial run.
   - But `ReelRunner.rebuildPart()` (`reel-runner.ts:1403-1436`) restores ctx from stored context **without** reading `usedVoiceId/Provider/Speed`. So a `!reel re-music` or `!reel re-images` rebuild starts ctx with those undefined, and the next persist clears them in the DB.
   - Review HTML reads `ctx.usedVoiceId ?? "auto"` → shows "auto".

Confirmed against `data/pipeline.db`: reels published via the original run path have `usedVoiceProvider: minimax / English_expressive_narrator` persisted; reels touched by a rebuild lose them.

---

## Fix

### 1. Persist resolved camera effect (new field)

Add `usedCameraEffect` to `ReelContext`, mirroring the `usedVoiceId/Provider/Speed` pattern:

- **`src/types.ts`** — add `usedCameraEffect?: CameraEffectType` next to `usedVoiceSpeed`.
- **`src/stages/reel-stage5-assemble.ts`** — after `resolveEffect(...)`, write the result back: `ctx.usedCameraEffect = cameraEffect;`. Return it in the stage's patch return object so the runner persists it.
- **`src/pipeline/reel-runner.ts`** — `buildPersistedReelContext` adds `usedCameraEffect: ctx.usedCameraEffect`.

### 2. Restore voice + effect fields on rebuild

In `ReelRunner.rebuildPart` (`src/pipeline/reel-runner.ts:1403-1436`), extend the stored-context type and the spread to include:

```ts
usedVoiceId?: string;
usedVoiceProvider?: string;
usedVoiceSpeed?: number;
usedCameraEffect?: CameraEffectType;
```

…and assign them onto the rebuilt `ctx`. So a rebuild of a non-voice part inherits the prior run's voice metadata, and a rebuild that doesn't touch stage5 inherits the prior camera effect.

### 3. Update review surface

- **`src/review/reel-html-builder.ts`** — change `effectLabel` to prefer `usedCameraEffect` over `cameraEffect`:
  ```ts
  const effectLabel = ctx.usedCameraEffect ?? ctx.cameraEffect ?? (isThai ? "อัตโนมัติ" : "Auto");
  ```
  Voice rows already use `usedVoiceId/Provider/Speed`; no change needed once #2 is in place.

- **`api/routes/review.ts`** — extend the `stored` type and the spread to include `usedCameraEffect` (same as #2 but for the API rebuild of `ctx` for rendering).

### 4. Provider label for botnoi

`reel-html-builder.ts:75` has a label map `{ elevenlabs, uvoice, minimax }` — add `botnoi: "Botnoi"` so the new provider doesn't display as the bare string.

---

## Files

- `src/types.ts`
- `src/stages/reel-stage5-assemble.ts`
- `src/pipeline/reel-runner.ts` (`buildPersistedReelContext`, `rebuildPart` ctx restore)
- `src/review/reel-html-builder.ts`
- `api/routes/review.ts`

---

## Tests

No existing review-html tests. The flow is covered by integration: build → run reel → check review page.

## Build & Deploy

```bash
npm run build
pm2 restart pipeline
```

## Verification

- Trigger a fresh DS reel → review page should show the actual voice (e.g. `5 (Botnoi)`) and the actual camera effect (e.g. `🔍 zoom_in` for breaking news per DS's `cameraEffectByCategory`).
- Run `!reel re-music <id>` on an existing reel — voice and effect should still be displayed correctly afterward (rebuild no longer wipes them).
- `cameraEffect` field in `data/pipeline.db` reels' context column should be set even when the user didn't pass an override.

## Out of scope

- Backfilling missing `usedVoiceId` / `usedCameraEffect` on already-persisted reels. Old reels will keep showing "auto" until they're rebuilt.
- Showing the resolved music track filename when `ctx.musicFile` isn't set (currently shows "None"). Music tracking already works for new reels; not changing.
