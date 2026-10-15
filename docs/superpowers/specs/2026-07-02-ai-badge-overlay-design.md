# AI Badge Overlay for Reel Videos

## Problem

AI-generated images in reels carry no human-visible disclosure. C2PA metadata (already implemented) handles machine-readable provenance for Meta's automated labelling, but viewers have no direct indication that specific scenes were AI-generated.

## Goal

Add a subtle `✨ AI` text badge that appears during AI-generated image scenes only, without drawing attention or disrupting storytelling.

## Decision Log

- **Overlay vs. burned-in**: Video overlay layer chosen — no stage4-images changes needed, and timing/visibility can be controlled at composition time.
- **Per-scene vs. whole-reel**: Per-scene — badge appears only during scenes where `imageSourceMap[scene].type === "ai"`. Stock photo scenes show nothing.
- **Style**: Plain text (option C), not a pill — lower visual weight, less distracting. ~65% opacity.
- **Position**: Below the brand logo, top-left corner — only area fully clear of Facebook Reels UI (top bar, right action buttons, bottom caption/audio zone).
- **Safe zone verified**: Facebook Reels safe zone at 1080×1920 is top > 250px, bottom < 1520px, left side preferred. Badge sits at top ≈ 340px, left 68px — comfortably inside.

## Visual Spec

```
[NS/DS logo]      ← top: 68px, left: 68px, 256×256px
✨ AI             ← top: 340px, left: 68px, plain text, 65% opacity
```

- Font size: 28px (matches existing watermark scale)
- Color: `rgba(255, 255, 255, 0.65)`
- Text shadow: `0 2px 6px rgba(0, 0, 0, 0.6)` for legibility on any background
- No background, no border, no pill

## Architecture

The hyperframes renderer (`enhanced-default.ts`) builds a `<div class="clip">` per tracked element. The `imageSourceMap` on `ReelContext` is already available at template build time.

New layer: `ai-badge-layer` — one clip per AI scene, timing aligned to that scene's start and duration.

```
buildEnhancedDefaultHyperframesHtml(ctx)
  ↓
for each scene in ctx.script.scenes:
  if ctx.imageSourceMap[scene.number]?.type === "ai":
    emit <div class="clip ai-badge-layer" data-start=... data-duration=...>✨ AI</div>
```

No changes needed outside the template file.

## Files

| File | Change |
|------|--------|
| `src/stages/reel-stage5-templates/enhanced-default.ts` | Add `ai-badge-layer` CSS + clip generation logic |

## CSS

```css
.ai-badge-layer {
  position: absolute;
  left: 68px;
  top: 340px;
  font-size: 28px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  letter-spacing: 0.04em;
  pointer-events: none;
}
```

## Clip generation (pseudo-code)

```typescript
const aiBadgeClips = scenes
  .filter(s => ctx.imageSourceMap?.[s.number]?.type === "ai")
  .map(s => `<div class="clip ai-badge-layer" data-start="${s.start}" data-duration="${s.duration}" data-track-index="7">✨ AI</div>`)
  .join("");
```

`data-track-index="7"` is one above the existing watermark track (6).

## Scope

- Applies to both NS and DS brands (shared template)
- No change to stage4-images, C2PA, ffmpeg, voice, script stages
- No new env vars, no new dependencies
- `imageSourceMap` already populated by stage4 — no upstream change needed

## Out of Scope

- Instagram/TikTok safe zone differences (same template, same position — verify separately if needed)
- Animating the badge (fade in/out) — plain cut is sufficient and simpler
- StoryReel pipeline — separate templates, not covered here
