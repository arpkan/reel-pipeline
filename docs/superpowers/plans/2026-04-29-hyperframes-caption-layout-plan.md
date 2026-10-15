# Hyperframes Caption Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Hyperframes enhanced reel template so captions are stable/readable, hook text is less prominent, and WorldBrief reels include a small white watermark.

**Architecture:** Keep all visual behavior inside `enhanced-default` template generation. Share the FFmpeg subtitle block splitting behavior by exporting the existing helper from `reel-stage5-assemble.ts`, and have the Hyperframes renderer copy an optional brand watermark asset into the composition asset folder.

**Tech Stack:** TypeScript ESM, Vitest, Hyperframes HTML clip metadata, CSS transitions, existing asset-copy pipeline.

---

## File Structure

- Modify `src/stages/reel-stage5-assemble.ts`: export `splitIntoBlocks` so Hyperframes can reuse FFmpeg phrase grouping.
- Modify `src/stages/reel-stage5-templates/enhanced-default.ts`: build hook red-line styling, stable subtitle phrase clips, active word spans, and optional watermark markup.
- Modify `src/stages/reel-stage5-hyperframes-renderer.ts`: copy `assets/brands/worldbrief_logo_white_transparent.png` for `ns` renders and pass its relative asset path into the template.
- Create `assets/brands/worldbrief_logo_white_transparent.png`: transparent white logo mark used at runtime.
- Modify `tests/reel-stage5-enhanced-template.test.ts`: assert hook/subtitle/watermark HTML behavior.
- Modify `tests/reel-stage5-hyperframes-renderer.test.ts`: assert runtime watermark asset copying/reference.

---

### Task 1: Stable Premium Caption Template

**Files:**
- Modify: `src/stages/reel-stage5-assemble.ts`
- Modify: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Test: `tests/reel-stage5-enhanced-template.test.ts`

- [ ] **Step 1: Write failing template tests**

Add tests that call `buildEnhancedDefaultTemplate(ctx)` and assert:

```ts
expect(html).toContain("subtitle-phrase");
expect(html).toContain("subtitle-word active-word");
expect(html).toContain("data-start=\"2\"");
expect(html).toContain("hook-card");
expect(html).toContain("hook-accent");
expect(html).not.toContain("subtitle-word\" data-start=\"2\"");
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`
Expected: FAIL because phrase subtitles and hook accent markup do not exist yet.

- [ ] **Step 3: Implement phrase subtitle layout**

Export `splitIntoBlocks` from `src/stages/reel-stage5-assemble.ts`. In `enhanced-default.ts`, replace per-word clip generation with phrase clip generation:

```ts
const blocks = splitIntoBlocks(timedScene.scene.wordTimings ?? []);
```

For each block, create one phrase clip active from the first word start to last word end. Inside that phrase, render every word and add active-word spans with their own Hyperframes clip timing.

- [ ] **Step 4: Implement smaller hook style**

Render hook text as a `.hook-card` with `.hook-accent`, but no background card or pill. CSS should be small, upper-positioned, and text-shadowed.

- [ ] **Step 5: Run green test**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`
Expected: PASS.

---

### Task 2: WorldBrief Watermark Asset

**Files:**
- Create: `assets/brands/worldbrief_logo_white_transparent.png`
- Modify: `src/stages/reel-stage5-hyperframes-renderer.ts`
- Modify: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Test: `tests/reel-stage5-hyperframes-renderer.test.ts`

- [ ] **Step 1: Write failing renderer test**

Add a test that runs the mocked Hyperframes renderer with brand `ns` and asserts copied composition assets include `worldbrief_logo_white_transparent.png`, and generated `index.html` references it.

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/reel-stage5-hyperframes-renderer.test.ts`
Expected: FAIL because no watermark asset is copied/referenced.

- [ ] **Step 3: Add runtime logo asset**

Copy `docs/worldbrief_logo_white_transparent.png` to `assets/brands/worldbrief_logo_white_transparent.png`.

- [ ] **Step 4: Copy/pass watermark asset**

In `reel-stage5-hyperframes-renderer.ts`, when `ctx.brand.id === "ns"`, copy the logo into the composition `assets` directory and pass its relative path to `buildEnhancedDefaultTemplate`.

- [ ] **Step 5: Render watermark markup**

In `enhanced-default.ts`, add an optional `<img class="watermark-logo clip" ...>` fixed top-left for the provided logo asset.

- [ ] **Step 6: Run green tests**

Run: `npm test -- tests/reel-stage5-hyperframes-renderer.test.ts tests/reel-stage5-enhanced-template.test.ts`
Expected: PASS.

---

### Task 3: Verification And Commit

**Files:**
- Modified source/tests/assets from Tasks 1-2

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-hyperframes-renderer.test.ts tests/reel-stage5-renderer.test.ts`
Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add assets/brands/worldbrief_logo_white_transparent.png src/stages/reel-stage5-assemble.ts src/stages/reel-stage5-templates/enhanced-default.ts src/stages/reel-stage5-hyperframes-renderer.ts tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-hyperframes-renderer.test.ts
git commit -m "feat: refine hyperframes caption layout"
```

---

## Self-Review

- Spec coverage: phrase subtitles, small red-line hook, smaller caption text, and WorldBrief watermark are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: watermark path is passed as an optional template input and reused by renderer/template tests.
