# Hyperframes Caption Layout Design

## Goal

Make the Hyperframes `enhanced-default` reel template easier to read and more polished by replacing jumping per-word subtitles with stable phrase-level karaoke captions, reducing hook prominence, and adding a small WorldBrief watermark.

## Approved Visual Direction

- Use the mockup in `docs/hyperframes-caption-watermark-mockup.html` as the visual reference.
- Add a small transparent white WorldBrief watermark in the top-left corner.
- Render the hook caption as small upper text with a thin WorldBrief-red vertical line. Do not use a dark hook card or red pill.
- Render subtitles as a fixed bottom-center phrase block. The phrase should stay aligned like a sentence; only the active word should animate.
- Keep captions smaller than the first mockup version.

## Subtitle Behavior

- Group `wordTimings` into readable phrase blocks using the same rules as the FFmpeg renderer where practical.
- Show all words in the active phrase as a stable sentence/chunk.
- Inactive words should be white with reduced opacity.
- The active word should use a premium but restrained highlight: warm gold, soft glow, and slight scale.
- Avoid the current behavior where individual words appear in different positions with no neighboring context.

## Logo Asset

- Source logo: `assets/brands/worldbrief_logo.png`.
- Runtime template should use a transparent white version without the red background.
- The generated logo asset should be copied into the Hyperframes composition asset folder along with image/audio assets.

## Scope

- Change only the Hyperframes enhanced template and renderer asset preparation.
- Do not change the FFmpeg renderer.
- Keep the first implementation for WorldBrief (`ns`) reels; non-NS brands can omit the watermark unless a white logo asset is configured later.

## Verification

- Unit tests should prove the generated HTML has a stable subtitle phrase layer, active-word markup/timing, red-line hook styling, and watermark markup for WorldBrief.
- Hyperframes renderer tests should prove the transparent WorldBrief logo asset is copied and referenced.
- Existing Stage 5 tests and TypeScript build must pass.
