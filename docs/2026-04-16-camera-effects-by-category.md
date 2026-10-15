# Camera Effects by Category

## Context

Reels currently apply identical visual treatment to every scene regardless of category — the background image is static (plain scale + crop). Adding per-category Ken Burns / zoom-pan effects makes reels feel more cinematic and category-appropriate (urgent zoom for breaking news, warm pan for human interest, etc.).

The effect system must also accept a user-specified override so operators can force a specific effect via the `!reel` bot command.

## Approach

### Effect types

Six motion effects plus a `none` passthrough:

| Effect | FFmpeg filter |
|---|---|
| `zoom_in` | zoompan zoom 1.0→1.5, centered |
| `zoom_out` | zoompan zoom 1.5→1.0, centered |
| `pan_left` | zoompan fixed zoom 1.3, x left→right |
| `pan_right` | zoompan fixed zoom 1.3, x right→left |
| `pan_up` | zoompan fixed zoom 1.3, y top→bottom |
| `pan_down` | zoompan fixed zoom 1.3, y bottom→top |
| `ken_burns` | zoompan zoom 1.0→1.5 + diagonal pan |
| `none` | existing plain scale+crop (no motion) |

### Default mapping

| Category | Default effect |
|---|---|
| `breaking` | `zoom_in` |
| `trending` | `ken_burns` |
| `human_interest` | `pan_left` |
| `business` | `zoom_in` |
| `open` | `ken_burns` |

### Resolution strategy (per scene)

1. If `ctx.cameraEffect` is set (user override from command) → use it.
2. Else look up `ctx.brand.reels.cameraEffectByCategory[category]` → use it.
3. Else use the hardcoded default mapping above.
4. If no category is known → fall back to `ken_burns`.

## Files to Modify

### 1. `src/types.ts`

- Add `CameraEffectType` union after `ReelCategory`:
  ```ts
  export type CameraEffectType = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "ken_burns" | "none";
  ```
- Add `cameraEffectByCategory?: Partial<Record<ReelCategory, CameraEffectType>>` to `ReelConfig` (alongside `musicByCategory`).
- Add `cameraEffect?: CameraEffectType` to `ReelContext`.
- Add `cameraEffect?: CameraEffectType` to `ReelRunOptions`.

> **Note**: Stages were renumbered since initial analysis — assembly is now stage 5 (`reel-stage5-assemble.ts`, class `ReelStage5Assemble`). The stage name constant used in heartbeat updates is `"reel-stage5-assemble"`.

### 2. `src/effects/camera-effects.ts` (new file)

Single exported function:

```ts
export function buildBgFilter(
  effect: CameraEffectType,
  totalDurationSeconds: number,
  fps = 25
): string
```

Returns the FFmpeg filter string for the `[0:v]…[bg]` step only. Examples:

- `none` → `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]`
- `zoom_in` → `[0:v]scale=8000:-1,zoompan=z='min(zoom+<rate>,1.5)':d=<frames>:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25[bg]`
- `pan_left` → `[0:v]scale=8000:-1,zoompan=z='1.3':x='iw*on/<frames>-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=<frames>:s=1080x1920:fps=25[bg]`
- `ken_burns` → `[0:v]scale=8000:-1,zoompan=z='min(zoom+<rate>,1.5)':x='iw*on/<frames>':y='ih*on/<frames>':d=<frames>:s=1080x1920:fps=25[bg]`

Also export:
```ts
export const CAMERA_EFFECT_TYPES: CameraEffectType[]
export const DEFAULT_EFFECT_BY_CATEGORY: Record<ReelCategory, CameraEffectType>

export function resolveEffect(
  category: ReelCategory | undefined,
  brandConfig: ReelConfig | undefined,
  override?: CameraEffectType
): CameraEffectType
```

### 3. `src/stages/reel-stage5-assemble.ts`

- Import `buildBgFilter` and `resolveEffect` from `../effects/camera-effects.js`.
- Resolve the effect once before the scene loop (before line 146). Variable is named `_category` to avoid collision with the `category` used later for music selection:
  ```ts
  const _category = ctx.category ?? ctx.script?.category;
  const cameraEffect = resolveEffect(_category, ctx.brand.reels, ctx.cameraEffect);
  ```
- Inside the scene loop, replace the hardcoded `[bg]` filter string (line 224) with:
  ```ts
  filterParts.push(buildBgFilter(cameraEffect, totalDuration));
  ```
- Drop `-tune stillimage` from the output flags (line 279) when `cameraEffect !== "none"` (motion frames break stillimage tune).

### 4. `src/brands/ds.ts` and `src/brands/ns.ts`

Add `cameraEffectByCategory` inside `reels`, using the approved defaults (brands start identical; operators can diverge later):

```ts
cameraEffectByCategory: {
  breaking:       "zoom_in",
  trending:       "ken_burns",
  human_interest: "pan_left",
  business:       "zoom_in",
  open:           "ken_burns",
},
```

### 5. `src/pipeline/reel-runner.ts`

- Pass `opts.cameraEffect` into the initial `ReelContext` construction in `ReelRunner.run()`.
- Add `cameraEffect` to `buildPersistedReelContext()` so it survives resume/rebuild.
- Restore `cameraEffect` from stored context in `rerescript`, `resume`, `rebuild`, and `rebuildPart` (same pattern as `useStockImages`).
- `rerescript()` accepts an optional `cameraEffectOverride` parameter, wired into the rebuilt context.
- `rebuildPart()` supports a `"video"` part type that only runs `reel-stage5-assemble` — used by the `re-effect` command.
- `getRebuildPartArtifacts()` expanded: `"video"` reuses the same artifact checks as `"music"` (video/audio paths must exist).
- Camera effect override in `rebuildPart`: `if (options?.cameraEffectOverride) ctx.cameraEffect = options.cameraEffectOverride`.

### 6. `src/pipeline/command-listener.ts`

Extend `!reel` command with three effect-related forms:

| Form | Example | Behaviour |
|---|---|---|
| `!reel <category> <effect>` | `!reel breaking zoom_out` | Generate reel with explicit category + effect override |
| `!reel <effect>` | `!reel zoom_out` | Generate reel with auto category + explicit effect (effect-only form) |
| `!reel re-effect [id] <effect>` | `!reel re-effect zoom_in` or `!reel re-effect abc123 pan_right` | Re-assemble existing reel with a different camera effect |

**Parsing logic**:
- First token is checked against `CAMERA_EFFECT_TYPES` — if it matches and is not a valid category/URL/theme, it's treated as an effect-only form.
- `re-effect` is parsed as a rebuild command with `"video"` part type and `cameraEffectOverride`.
- ID in `re-effect` is optional: if only one arg follows `re-effect`, it's treated as the effect name (uses the most recent reel).

Also extend `!reel rescript <id> [category] [effect]` with the same optional effect argument.

> **Coexistence**: Partial rebuild commands (`re-voice`, `re-images`, `re-music`) are parsed before the effect token, so there's no conflict — effect names don't start with `re-`.

## Verification

1. Run `npx tsc --noEmit` — must pass with no errors.
2. Trigger `!reel breaking zoom_out` on DS — confirm the assembled video has visible zoom-out motion.
3. Trigger `!reel zoom_out` on DS — confirm auto-selected category with zoom-out override.
4. Trigger `!reel human_interest` on DS — confirm pan-left motion (no override).
5. Trigger `!reel` (no args, auto category) — confirm default effect for the selected category is applied.
6. Trigger `!reel re-effect pan_right` — confirm the most recent reel is re-assembled with pan-right effect (no re-voice, no re-images).
7. Trigger `!reel re-effect <id> ken_burns` — confirm the specified reel is re-assembled with ken_burns effect.
8. Confirm music selection is unchanged (existing `musicByCategory` logic untouched).
9. Confirm `none` effect produces identical output to the current behavior (regression check).
