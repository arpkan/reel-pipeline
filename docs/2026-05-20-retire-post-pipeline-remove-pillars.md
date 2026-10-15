# Retire Post Pipeline, Remove Pillar System & Remove Theme Weights

## Summary

Remove the pillar content-categorisation system, the `themeWeights` auto-selection system, and fully retire the post (Facebook photo-post) pipeline. The reel pipeline becomes the sole production pipeline.

`theme` itself is **kept** as a user-specified discovery filter (`!reel -theme Tech`). What is removed is the automated weighted-random theme picker — from now on, theme is only active when explicitly passed by the user.

---

## What Gets Removed

### Pillar system
- `BrandConfig.pillars` array (Thai category labels per brand)
- `BrandConfig.captionRules` (keyed by pillar name, only used in post pipeline)
- `PillarBalance` type and all usages (`deprioritise`, `prioritise`, `forcePillar`)
- `Story.pillar` field
- `stage0-pillar-balance.ts` stage (compute pillar balance before discover)
- Pillar fields from `stage1-discover.ts` prompts and tool schema (`pillar` in required fields, pillar balance blocks in system prompt)
- Pillar display in `html-builder.ts` and `reel-html-builder.ts`

### Theme weight system
- `BrandConfig.themeWeights` — entire field removed from both brands
- `themeWeights` DB table — leave as-is (no migration), just no new writes
- `getThemeWeights()` and `getThemeHistory()` DB queries
- `computeThemeBalance()` logic in `stage0-pillar-balance.ts` (deleted anyway)
- `ThemeSource` type — simplify to just `"custom"` (remove `"weight-winning"` and `"forced-pillar"`)
- `themeSource` field on run contexts — remove (theme is always user-specified or absent)
- `!weights` and `!weight <theme> <n>` Telegram commands — remove from command-listener and help text
- `buildReelThemePanel` themeSource label in `reel-html-builder.ts` — simplify to just show theme name
- `validThemes` in `command-listener.ts` currently reads from `brand.themeWeights` keys — replace with a hardcoded constant: `["Tech","Health","Economy","Politics","Entertainment","Environment","Science","Sports","Lifestyle"]`

### Post pipeline
- **Delete files:**
  - `src/stages/post-stage1b-viral-check.ts`
  - `src/stages/post-stage2-captions.ts`
  - `src/stages/post-stage3-image-gen.ts`
  - `src/stages/post-stage4-review-notify.ts`
  - `src/stages/stage0-pillar-balance.ts`
  - `src/pipeline/runner.ts`
- **Remove from `command-listener.ts`:** entire `!post` command block (~200 lines) and all `PipelineRunner` imports/calls; remove `!post` entries from help text
- **Remove from `html-builder.ts`:** entire file is post-only — delete or gut to an empty stub
- **Remove from `db/queries.ts`:** post-related queries (`insertRun`, `updateRun`, `insertPost`, `getPostsByRunId`, etc.) — reel queries stay
- **Remove from `services/metrics-collector.ts`:** post metric tracking (reel metrics stay)
- **Remove from `types.ts`:** `PillarBalance`, `RunContext` (post context), pillar fields on `Story`, `BrandConfig.pillars`, `BrandConfig.captionRules`

---

## What Stays Untouched

- `!reel Tech` (positional theme argument) — user-specified theme still drives discovery focus; valid themes become a hardcoded list in `command-listener.ts`
- `theme` field on `Story` / reel context
- `reel-html-builder.ts` — keep, simplify theme panel (just show theme name, drop source label)
- `dashboard-html-builder.ts` — keep, remove pillar and theme breakdown columns
- All reel pipeline stages and reel-runner
- DB posts table and `theme_weights` table — leave as-is (no migration, just no new writes)

---

## Files Modified

| File | Change |
|------|--------|
| `src/brands/ds.ts` | Remove `pillars`, `captionRules`, entire `themeWeights` |
| `src/brands/ns.ts` | Same |
| `src/types.ts` | Remove `PillarBalance`, `pillar` from `Story`/`BrandConfig`, `themeWeights` from `BrandConfig`, simplify `ThemeSource` to `"custom"` only |
| `src/stages/stage1-discover.ts` | Remove `pillar` from tool schema required fields and system prompt blocks |
| `src/pipeline/reel-runner.ts` | Remove `Stage0PillarBalance` import/call, `pillarBalance` from context |
| `src/pipeline/command-listener.ts` | Remove `!post` block, `PipelineRunner` import, `!post` + `!weights` help text; remove `"weights"` from command guard |
| `src/review/html-builder.ts` | Remove pillar display rows; or delete if post-only |
| `src/review/reel-html-builder.ts` | Remove `PillarBalance` import, `"forced-pillar"` label |
| `src/review/dashboard-html-builder.ts` | Remove pillar breakdown column |
| `src/db/queries.ts` | Remove post-related queries; remove `getThemeWeights`, `getThemeHistory` |
| `src/services/metrics-collector.ts` | Remove post metrics, remove theme dimension tracking |

---

## Database

No migration needed. The `posts` table and `pillar` column remain in the DB — they just receive no new writes. Historical data is preserved for reference.

---

## Risk

- Low. The reel pipeline does not depend on pillar at runtime (pillar was injected into `stage1-discover.ts` prompts but the LLM already ignores it in reel context). Removing it cleans up dead prompt noise.
- `!post` commands will 404 with "unknown command" after removal — acceptable since post pipeline is being retired.
