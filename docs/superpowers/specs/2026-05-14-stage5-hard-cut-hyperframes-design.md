# Stage 5 Hard Cut to Hyperframes - Design

Date: 2026-05-14
Status: Approved for spec drafting
Scope: Reel pipeline Stage 5 renderer only

## Goals

- Retire ffmpeg as a Stage 5 renderer path.
- Make Hyperframes the only supported Stage 5 renderer.
- Reduce renderer branching complexity in CLI, command parsing, runner selection, and tests.
- Preserve all non-Stage-5 ffmpeg usage (Stage 3 voice tempo, Stage 4 image normalization, and Hyperframes post-render muxing).

## Non-Goals

- Removing ffmpeg from the full repository.
- Refactoring Stage 3 or Stage 4 media processing.
- Redesigning Hyperframes template capabilities.

## Current Context

The codebase currently supports a dual Stage 5 renderer model (`ffmpeg` and `hyperframes`) with:

- Type-level union support in shared context types.
- Runtime selection and timeout branching in `src/stages/reel-stage5-renderer.ts`.
- User-facing selection flags in CLI and command listener.
- Mixed default/fallback labels in review metadata.
- Tests that assert both renderer options.

Current stability indicates Hyperframes is the preferred and proven path for Stage 5, so keeping ffmpeg support in this specific layer is now maintenance-only overhead.

## Architecture Changes

1. Restrict Stage 5 renderer model to Hyperframes-only.
2. Remove Stage 5 ffmpeg renderer implementation and import paths.
3. Remove Stage 5 ffmpeg user controls and validation branches.
4. Narrow Stage 5 renderer types and persisted parsing rules.
5. Update defaults and metadata fallbacks to Hyperframes.

### Target Files (Expected)

- `src/types.ts`
- `src/stages/reel-stage5-renderer.ts`
- `src/stages/reel-stage5-ffmpeg-renderer.ts` (delete)
- `src/pipeline/command-listener.ts`
- `src/pipeline/reel-intake-session-store.ts`
- `bin/run.ts`
- `src/review/reel-html-builder.ts`
- Related tests under `tests/` that currently assert ffmpeg Stage 5 behavior

## Runtime and Data Flow Design

### Renderer Resolution

- Stage 5 resolution becomes deterministic: Hyperframes only.
- Brand-level and per-run renderer overrides no longer route to ffmpeg.
- Stage 5 timeout behavior becomes single-path for Hyperframes.

### CLI Behavior

- Preferred hard-cut behavior: remove `--stage5-renderer` entirely.
- Keep `--stage5-template` support where applicable.
- If renderer flag is retained temporarily, it validates only `hyperframes` and errors for `ffmpeg` with retirement guidance.

### Command Behavior (Telegram/LINE)

- Remove `-ffmpeg` support as an executable option.
- `-hf` / `-hyperframes` are redundant in a hard cut and can be removed.
- For compatibility, if legacy `-ffmpeg` input is encountered, respond with a clear retirement message rather than silently ignoring.

### Session Persistence

- Intake/session parsing should no longer accept `ffmpeg` for Stage 5 renderer.
- Existing legacy rows containing `ffmpeg` may still be read as historical data but must not drive new Stage 5 routing.

### Review Metadata

- New Stage 5 runs should report Hyperframes renderer telemetry consistently.
- Review-page fallback labels should default to Hyperframes rather than ffmpeg.

## Error Handling

- Any explicit ffmpeg Stage 5 request surfaces a clear message:
  - Stage 5 ffmpeg renderer is retired.
  - Hyperframes is the only supported renderer.
- Validation text and usage hints must no longer present ffmpeg as valid.

## Testing Strategy

Update and prune tests to match the hard cut:

- CLI arg tests:
  - Remove ffmpeg-valid cases.
  - Add retirement/error behavior for explicit ffmpeg requests (if flag retained).
- Command flag parsing tests:
  - Remove ffmpeg override assertions.
  - Add legacy messaging assertion for `-ffmpeg` where applicable.
- Stage 5 renderer tests:
  - Remove dual-renderer selection assertions.
  - Assert Hyperframes-only selection and timeout path.
- Runner override and metadata tests:
  - Remove ffmpeg override cases.
  - Ensure telemetry/review output remains coherent with Hyperframes-only semantics.
- Delete Stage 5 ffmpeg renderer tests that have no remaining production target.

Verification sequence:

1. Run focused reel Stage 5 + command parsing tests.
2. Run full `npm test` to catch type-narrowing side effects.

## Risks and Mitigations

- Risk: hidden caller still passes ffmpeg renderer values.
  - Mitigation: explicit validation failures and compatibility messaging.
- Risk: stale persisted state contains ffmpeg and affects new runs.
  - Mitigation: normalize or ignore legacy values during new run routing.
- Risk: user confusion on removed flags.
  - Mitigation: clear error/help text in CLI and command listener.

## Rollout Plan

- Apply hard-cut code changes in one cohesive PR.
- Validate via tests and one dry-run reel execution.
- Update usage text/docs in the same change set to avoid drift.

## Acceptance Criteria

- No Stage 5 code path can select ffmpeg.
- No public Stage 5 interface presents ffmpeg as valid.
- Stage 5 render telemetry and review metadata are Hyperframes-consistent.
- All relevant tests pass after removing ffmpeg Stage 5 expectations.
- Non-Stage-5 ffmpeg behavior remains unchanged.
