# Hyperframes Stage 5 Renderer Design

## Summary

Introduce Hyperframes as an optional stage 5 renderer for reels. The first version keeps the existing FFmpeg renderer as the default-safe path, adds a configurable Hyperframes path, and ships one `enhanced-default` template that improves visual design, subtitle motion, scene transitions, and render determinism visibility.

The design does not replace the current stage 5 offload flow. Renderer selection must work identically for local stage 5 runs and EC2 offloaded assembly jobs.

## Goals

- Improve reel visual quality through richer motion, transitions, and caption treatment.
- Make subtitle animation easier to evolve than the current generated PNG plus FFmpeg overlay flow.
- Create a template boundary that can support future content types and category-specific visual styles.
- Keep renderer choice explicit and observable through brand config and per-run overrides.
- Preserve current publishing, review, approval, and offload behavior.
- Fail clearly when Hyperframes is selected and fails; do not silently fall back to FFmpeg.

## Non-Goals

- Replace all FFmpeg rendering in the first version.
- Build multiple brand/category templates initially.
- Add a visual editor or browser-based template authoring workflow.
- Change upstream discovery, script, voice, or image generation stages.
- Automatically choose renderers based on content quality heuristics.

## Current Context

The reel pipeline currently runs:

- Stage 2: `ReelStage2Script` creates the reel script, captions, voiceover, image prompts, and hashtags.
- Stage 3: `ReelStage3Voice` creates per-scene audio and word timings.
- Stage 4: `ReelStage4Images` creates or selects per-scene portrait images.
- Stage 5: `ReelStage5Assemble` renders hook/caption PNG overlays, builds FFmpeg filter graphs, assembles segments, mixes music, uploads the final MP4, and returns `videoPath`, `videoGcsUrl`, and `musicFile`.

Stage 5 can run locally or through the existing offload path:

- `runReelStage5Boundary()` decides whether to execute stage 5 locally or dispatch an assembly job.
- Offload uploads scene audio, scene images, and music to GCS, then queues or launches an EC2 worker.
- `reel-assembly-worker.ts` reconstructs `ReelContext`, materializes inputs, runs stage 5, updates the reel, and notifies approval channels.

This means renderer selection must be persisted before dispatch and used by both local and worker execution paths.

## Proposed Approach

Use a configurable stage 5 renderer facade.

Renderer selection order:

1. Per-run override.
2. Brand config default.
3. Current FFmpeg renderer.

Supported renderers:

- `ffmpeg`: the current stage 5 implementation.
- `hyperframes`: a new renderer using one `enhanced-default` template.

The first Hyperframes template should provide light enhancement, not a full template system:

- Use the same scene images, scene audio, script captions, word timings, and optional music.
- Render a 9:16 vertical MP4.
- Add improved hook/caption styling.
- Add animated scene transitions.
- Add word or phrase subtitle animation using available word timings.
- Keep final output compatible with the existing GCS upload, review page, approval commands, and Meta publishing flow.

## Architecture

Add a small renderer boundary around stage 5:

- `Stage5Renderer`: interface with one method accepting `ReelContext` and returning `Partial<ReelContext>`.
- `FfmpegStage5Renderer`: wraps the current `ReelStage5Assemble` behavior to minimize risk.
- `HyperframesStage5Renderer`: generates a Hyperframes composition and renders the MP4.
- `selectStage5Renderer(ctx)`: resolves renderer from persisted context, run override, or brand config.
- `ReelStage5Facade`: the stage 5 class used by both local runner and offload worker.
- `enhanced-default` template module: converts reel data into Hyperframes HTML and asset references.

Suggested files:

- `src/stages/reel-stage5-renderer.ts`
- `src/stages/reel-stage5-ffmpeg-renderer.ts`
- `src/stages/reel-stage5-hyperframes-renderer.ts`
- `src/stages/reel-stage5-templates/enhanced-default.ts`

The existing `ReelStage5Assemble` should remain mostly intact at first and be wrapped by the FFmpeg renderer. A later cleanup can rename or split it after parity is stable.

## Data Flow

Upstream stages remain unchanged.

Before stage 5 executes, the runner resolves and persists renderer metadata into reel context:

- `stage5Renderer`: `"ffmpeg" | "hyperframes"`.
- `stage5Template`: initially `"enhanced-default"` when renderer is `hyperframes`.
- `stage5RenderSettings`: resolved fps, quality, worker count, timeout, and mapped performance profile values used for the selected renderer.

If stage 5 is offloaded:

- `runReelStage5Boundary()` continues uploading standard stage 5 inputs.
- The persisted renderer/template metadata travels in reel context.
- The EC2 worker reconstructs context and calls the same `ReelStage5Facade` as the local path.

For Hyperframes rendering:

1. Create a composition directory inside the existing reel work directory.
2. Write or reference `sceneN.png`, `sceneN.mp3`, optional `music.mp3`, and generated `index.html`.
3. Render `reel.mp4` using Hyperframes.
4. Upload the MP4 through the existing GCS service.
5. Return the same output fields as the FFmpeg renderer: `videoPath`, `videoGcsUrl`, and `musicFile`.

## Configuration And Overrides

Add brand-level config under `reels`, for example:

```ts
stage5Renderer?: "ffmpeg" | "hyperframes";
stage5Template?: "enhanced-default";
```

Add optional run-level fields to `ReelRunOptions` and `ReelContext` so manual commands or CLI runs can override the brand default.

The exact command syntax can be decided during planning, but the design requires a per-run override mechanism for testing and controlled rollout.

## Error Handling

If `hyperframes` is selected, Hyperframes failures fail the reel clearly.

No automatic fallback to FFmpeg should occur in the first version. This includes scheduled runs. The goal is to surface dependency, composition, timeout, and render issues rather than hide them behind fallback behavior.

Failures should include enough context in logs and stage logs:

- selected renderer
- template
- render settings
- command or API used
- truncated stderr or thrown error
- local/offload mode when available

Existing cancellation and offload failure behavior should remain intact.

## Hyperframes Template Constraints

The `enhanced-default` template must follow Hyperframes rendering rules so generated videos are frame-accurate and lintable:

- The root element must define `data-composition-id`, `data-width="1080"`, and `data-height="1920"` for vertical reels.
- Every timed visual or audio element must include `class="clip"`, `data-start`, `data-duration`, and `data-track-index`.
- The registered GSAP timeline key must exactly match `data-composition-id`.
- GSAP timelines must be created with `paused: true` and registered on `window.__timelines`.
- Prefer `gsap.set()` plus `tl.to()` for scrub-safe animations instead of relying on `tl.from()` behavior.
- Template scripts must not call media playback APIs such as `.play()` or manually mutate audio/video current time.
- The timeline must be explicitly extended to the full reel duration so renders do not cut off early.
- DS/Thai templates must use Thai-safe typography, including `Noto Sans Thai` or a local equivalent, larger line height, and font sizing that avoids clipping Thai descenders.
- The renderer should run Hyperframes lint or equivalent validation before rendering and fail clearly if validation detects a blocking composition error.

## Performance And Observability

Hyperframes may be slower than the current FFmpeg path because it also uses headless Chrome plus FFmpeg. The first implementation should emphasize observability rather than aggressive optimization.

Persist render telemetry in reel context:

- renderer
- template
- fps
- quality or mapped performance profile
- render duration
- output size
- local or offloaded mode when known

Show renderer/template/performance information on the reel review page so operators can compare FFmpeg and Hyperframes runs.

The existing `stage5Performance` profile should map to Hyperframes settings where practical. For example, `fast`, `balanced`, and `high` can map to fps and quality presets. Hyperframes may need a renderer-specific timeout that is longer than the current stage 5 timeout if scheduled reels still finish before publish time.

## Testing Strategy

Tests should avoid requiring full expensive video renders in the normal test suite.

Required tests:

- Renderer selection respects run override, brand config, and default order.
- Persisted renderer/template metadata survives offload context reconstruction.
- Worker path calls the same stage 5 facade and does not hardcode FFmpeg.
- Hyperframes template generation produces valid expected asset references from a fixture `ReelContext`.
- Failure from selected renderer is propagated without fallback.

Manual or separate benchmark verification:

- Render one existing reel with FFmpeg and Hyperframes.
- Compare render duration, output size, and visual quality.
- Confirm uploaded video appears correctly in the review page and can be approved/published through existing flow.

## Rollout Plan

1. Add renderer types, config fields, context persistence, and facade while keeping FFmpeg behavior unchanged.
2. Update local runner and offload worker to call the facade.
3. Add Hyperframes renderer and `enhanced-default` template.
4. Add telemetry and review page display.
5. Run manual benchmarks using explicit per-run override.
6. Enable Hyperframes by brand config only after benchmark and visual checks are acceptable.

## Open Decisions For Implementation Planning

- Exact per-run override command syntax.
- Whether to use Hyperframes CLI or `@hyperframes/producer` programmatic API. The producer API may fit better inside Node.js and offload workers; the CLI may be simpler for the first pass.
- Exact mapping from existing `stage5Performance` profiles to Hyperframes fps, quality, and worker count.
- Whether Hyperframes dependencies should be installed in the app package or isolated in a generated composition directory.
