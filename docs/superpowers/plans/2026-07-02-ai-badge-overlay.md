# AI Badge Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a subtle `✨ AI` text badge during AI-generated image scenes in the hyperframes reel template, hidden during stock photo scenes.

**Architecture:** Add an `ai-badge-layer` CSS class and per-scene clip generation to `enhanced-default.ts`. The `ctx.imageSourceMap` (already populated by stage4) maps scene numbers to `ImageSource` — clips are only emitted for scenes where `type === "ai"`. No other files change.

**Tech Stack:** TypeScript, Vitest, existing hyperframes HTML template pattern

## Global Constraints

- Only `src/stages/reel-stage5-templates/enhanced-default.ts` and `tests/reel-stage5-enhanced-template.test.ts` change
- Badge position: `left: 68px, top: 340px` (below the 256px brand logo at top 68px — verified in Facebook Reels safe zone)
- Badge style: plain text, `font-size: 28px`, `color: rgba(255,255,255,0.65)`, `text-shadow: 0 2px 6px rgba(0,0,0,0.6)`, no background
- Track index: `data-track-index="7"` (watermark is `6`)
- Condition: `ctx.imageSourceMap?.[scene.sceneNumber]?.type === "ai"`
- No badge when `imageSourceMap` is absent or scene source is `"stock"` or `"failed"`

---

### Task 1: AI badge clips in the hyperframes template

**Files:**
- Modify: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Modify: `tests/reel-stage5-enhanced-template.test.ts`

**Interfaces:**
- Consumes: `ctx.imageSourceMap?: Record<number, ImageSource>` where `ImageSource = { type: "ai"; model: string; provider?: ApiProvider } | { type: "stock"; ... } | { type: "failed" }`
- Produces: `<div class="clip ai-badge-layer" data-start="..." data-duration="..." data-track-index="7">✨ AI</div>` per AI scene

- [ ] **Step 1: Write the failing tests**

Add these three `it()` blocks inside the existing `describe("buildEnhancedDefaultHyperframesHtml", ...)` in `tests/reel-stage5-enhanced-template.test.ts`, after the last existing test:

```typescript
it("renders ai-badge-layer clips only for AI-sourced scenes", async () => {
  const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
  const ctx = makeCtx();
  ctx.imageSourceMap = {
    1: { type: "ai", model: "imagen-3" },
    2: { type: "ai", model: "imagen-3" },
  };
  const html = buildEnhancedDefaultHyperframesHtml({ ctx });

  // Both scenes are AI — badge appears twice
  const matches = html.match(/class="clip ai-badge-layer"/g);
  expect(matches).toHaveLength(2);
  expect(html).toContain('class="clip ai-badge-layer" data-start="0" data-duration="5" data-track-index="7"');
  expect(html).toContain('class="clip ai-badge-layer" data-start="5" data-duration="6.6" data-track-index="7"');
  expect(html).toContain("✨ AI");
  expect(html).toContain(".ai-badge-layer");
  expect(html).toContain("left: 68px");
  expect(html).toContain("top: 340px");
  expect(html).toContain("rgba(255, 255, 255, 0.65)");
});

it("omits ai-badge-layer when all scenes are stock", async () => {
  const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
  const ctx = makeCtx();
  ctx.imageSourceMap = {
    1: { type: "stock", provider: "unsplash" },
    2: { type: "stock", provider: "pexels" },
  };
  const html = buildEnhancedDefaultHyperframesHtml({ ctx });

  expect(html).not.toContain("ai-badge-layer");
  expect(html).not.toContain("✨ AI");
});

it("renders ai-badge-layer only on the AI scene in a mixed reel", async () => {
  const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
  const ctx = makeCtx();
  ctx.imageSourceMap = {
    1: { type: "ai", model: "azure-dall-e-3" },
    2: { type: "stock", provider: "pixabay" },
  };
  const html = buildEnhancedDefaultHyperframesHtml({ ctx });

  // Only scene 1 (start=0) gets the badge
  const matches = html.match(/class="clip ai-badge-layer"/g);
  expect(matches).toHaveLength(1);
  expect(html).toContain('class="clip ai-badge-layer" data-start="0" data-duration="5" data-track-index="7"');
  expect(html).not.toContain('data-start="5" data-duration="6.6" data-track-index="7"');
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run tests/reel-stage5-enhanced-template.test.ts 2>&1 | tail -20
```

Expected: the three new tests fail with errors like `AssertionError: expected null not to be null` or `expected ... to contain "ai-badge-layer"`.

- [ ] **Step 3: Add the CSS and clip generation to the template**

In `src/stages/reel-stage5-templates/enhanced-default.ts`, make three edits:

**Edit 1** — add the `aiBadgeClips` variable after the `watermarkClip` variable (around line 79):

```typescript
  const aiBadgeClips = timedScenes
    .filter(({ scene }) => ctx.imageSourceMap?.[scene.sceneNumber]?.type === "ai")
    .map(({ start, duration }) =>
      `\n      <div class="clip ai-badge-layer" data-start="${start}" data-duration="${duration}" data-track-index="7">✨ AI</div>`)
    .join("");
```

**Edit 2** — add `.ai-badge-layer` CSS inside the `<style>` block, after the `.watermark-logo` rule (around line 187):

```css
      .ai-badge-layer {
        position: absolute;
        inset: auto;
        left: 68px;
        top: 340px;
        right: auto;
        bottom: auto;
        font-size: 28px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.65);
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
        letter-spacing: 0.04em;
        pointer-events: none;
        line-height: 1;
      }
```

**Edit 3** — append `${aiBadgeClips}` to the composition string (line 236). Change:

```typescript
    <main class="composition" data-composition-id="${escapeAttr(ctx.runId)}" data-width="${WIDTH}" data-height="${HEIGHT}" data-duration="${totalDuration}">${sceneClips}${hookClips}${voiceClips}${subtitleClips}${musicClip}${preMixedClip}${watermarkClip}
```

to:

```typescript
    <main class="composition" data-composition-id="${escapeAttr(ctx.runId)}" data-width="${WIDTH}" data-height="${HEIGHT}" data-duration="${totalDuration}">${sceneClips}${hookClips}${voiceClips}${subtitleClips}${musicClip}${preMixedClip}${watermarkClip}${aiBadgeClips}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run tests/reel-stage5-enhanced-template.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the three new ones.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage5-templates/enhanced-default.ts tests/reel-stage5-enhanced-template.test.ts
git commit -m "feat: render ✨ AI badge on AI-generated image scenes"
```
