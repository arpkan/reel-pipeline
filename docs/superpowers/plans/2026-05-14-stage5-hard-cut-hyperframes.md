# Stage 5 Hard Cut to Hyperframes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ffmpeg as a Stage 5 renderer option and make Hyperframes the only Stage 5 renderer path while preserving non-Stage-5 ffmpeg usage.

**Architecture:** Collapse Stage 5 renderer selection to a single Hyperframes path, delete the ffmpeg Stage 5 adapter, and remove ffmpeg-facing controls from CLI and command parsing. Keep historical DB values readable but non-routable. Update tests to enforce Hyperframes-only behavior and retire ffmpeg Stage 5 expectations.

**Tech Stack:** TypeScript (ESM), Vitest, Node.js, existing reel pipeline modules.

---

## File Structure and Responsibilities

- `src/types.ts`
  - Narrow `Stage5RendererType` to Hyperframes-only.
- `src/stages/reel-stage5-renderer.ts`
  - Single-path Stage 5 selection/settings/renderer creation.
- `src/stages/reel-stage5-ffmpeg-renderer.ts`
  - Delete obsolete ffmpeg Stage 5 adapter.
- `bin/run.ts`
  - Remove or hard-fail ffmpeg renderer CLI option.
- `src/pipeline/command-listener.ts`
  - Remove ffmpeg flag routing; return retirement guidance for legacy `-ffmpeg`.
- `src/pipeline/reel-intake-session-store.ts`
  - Stop accepting `ffmpeg` from persisted intake sessions.
- `src/review/reel-html-builder.ts`
  - Update renderer fallback label from ffmpeg to hyperframes.
- `tests/run-cli-args.test.ts`
  - Validate new CLI behavior.
- `tests/reel-stage5-command-flags.test.ts`
  - Validate command-flag behavior after hard cut.
- `tests/reel-stage5-renderer.test.ts`
  - Assert Hyperframes-only selection/settings.
- `tests/reel-stage5-runner-overrides.test.ts`
  - Remove ffmpeg override expectations.
- `tests/reel-review-html-builder.test.ts`
  - Remove ffmpeg telemetry assertion and keep renderer profile assertions valid.

### Task 1: Convert Stage 5 types and renderer facade to Hyperframes-only

**Files:**
- Modify: `src/types.ts`
- Modify: `src/stages/reel-stage5-renderer.ts`
- Delete: `src/stages/reel-stage5-ffmpeg-renderer.ts`
- Test: `tests/reel-stage5-renderer.test.ts`

- [ ] **Step 1: Write failing tests for Hyperframes-only defaults**

```ts
// tests/reel-stage5-renderer.test.ts
it("defaults to hyperframes", async () => {
  const { resolveStage5RendererSelection } = await import("../src/stages/reel-stage5-renderer.js");
  expect(resolveStage5RendererSelection(makeCtx())).toEqual({
    renderer: "hyperframes",
    template: "enhanced-default",
  });
});

it("uses single Hyperframes timeout", async () => {
  const { resolveStage5RenderSettings } = await import("../src/stages/reel-stage5-renderer.js");
  expect(resolveStage5RenderSettings(makeCtx())).toEqual({
    fps: 24,
    quality: "standard",
    workers: 1,
    timeoutMs: 30 * 60_000,
    performanceProfile: "balanced",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage5-renderer.test.ts`
Expected: FAIL at previous ffmpeg default/branch expectations.

- [ ] **Step 3: Narrow Stage 5 renderer type**

```ts
// src/types.ts
export type Stage5RendererType = "hyperframes";
```

- [ ] **Step 4: Remove ffmpeg branch from Stage 5 facade**

```ts
// src/stages/reel-stage5-renderer.ts
export function resolveStage5RendererSelection(ctx: ReelContext): Stage5RendererSelection {
  return {
    renderer: "hyperframes",
    template: ctx.stage5Template ?? ctx.brand.reels?.stage5Template ?? DEFAULT_HYPERFRAMES_TEMPLATE,
  };
}

export function resolveStage5RenderSettings(ctx: ReelContext): Stage5RenderSettings {
  const profile = resolveStage5Performance(ctx.stage5Performance ?? ctx.brand.reels?.stage5Performance);
  const qualityByProfile = { fast: "draft", balanced: "standard", high: "high" } as const;
  return {
    fps: profile.targetFps,
    quality: qualityByProfile[profile.effectQuality],
    workers: 1,
    timeoutMs: 30 * 60_000,
    performanceProfile: profile.effectQuality,
  };
}

export async function createStage5Renderer(_ctx: ReelContext): Promise<Stage5Renderer> {
  const { HyperframesStage5Renderer } = await import("./reel-stage5-hyperframes-renderer.js");
  return new HyperframesStage5Renderer();
}
```

- [ ] **Step 5: Delete obsolete ffmpeg Stage 5 renderer adapter**

Delete file: `src/stages/reel-stage5-ffmpeg-renderer.ts`

- [ ] **Step 6: Re-run Stage 5 renderer tests**

Run: `npm test -- tests/reel-stage5-renderer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/types.ts src/stages/reel-stage5-renderer.ts src/stages/reel-stage5-ffmpeg-renderer.ts tests/reel-stage5-renderer.test.ts
git commit -m "refactor: make stage5 renderer hyperframes-only"
```

### Task 2: Remove ffmpeg Stage 5 CLI surface

**Files:**
- Modify: `bin/run.ts`
- Test: `tests/run-cli-args.test.ts`

- [ ] **Step 1: Write failing CLI tests for hard-cut behavior**

```ts
// tests/run-cli-args.test.ts
it("rejects ffmpeg renderer value", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => parseArgs(["ns", "--reel", "--stage5-renderer", "ffmpeg"]))
    .toThrow("process.exit");
  expect(error).toHaveBeenCalledWith(
    "Stage 5 ffmpeg renderer is retired. Valid: hyperframes"
  );
  expect(exit).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 2: Run CLI arg tests to verify failure**

Run: `npm test -- tests/run-cli-args.test.ts`
Expected: FAIL before parser updates.

- [ ] **Step 3: Update CLI usage and validation**

```ts
// bin/run.ts (usage)
console.error(
  "Usage: npx tsx bin/run.ts <brand> [--reel] [--url <url>] [--theme <Theme>] [--dry-run] [--stage <N>] [--resume <runId>] [--stage5-renderer <hyperframes>] [--stage5-template <enhanced-default>]"
);

// bin/run.ts (validation)
if (value !== "hyperframes") {
  console.error("Stage 5 ffmpeg renderer is retired. Valid: hyperframes");
  process.exit(1);
}
```

- [ ] **Step 4: Update existing parser tests for new valid/invalid text**

```ts
// tests/run-cli-args.test.ts
expect(error).toHaveBeenCalledWith("Missing value for --stage5-renderer. Valid: hyperframes");
expect(error).toHaveBeenCalledWith("Stage 5 ffmpeg renderer is retired. Valid: hyperframes");
```

- [ ] **Step 5: Re-run CLI tests**

Run: `npm test -- tests/run-cli-args.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add bin/run.ts tests/run-cli-args.test.ts
git commit -m "fix: retire ffmpeg stage5 cli option"
```

### Task 3: Remove ffmpeg command flag behavior and enforce legacy guidance

**Files:**
- Modify: `src/pipeline/command-listener.ts`
- Test: `tests/reel-stage5-command-flags.test.ts`

- [ ] **Step 1: Add failing test for legacy `-ffmpeg` handling**

```ts
// tests/reel-stage5-command-flags.test.ts
it("keeps legacy -ffmpeg in cleaned text instead of selecting renderer", () => {
  expect(parseReelCommandFlags("business -ffmpeg")).toEqual({
    cleaned: "business -ffmpeg",
    useStockImages: undefined,
    stage5Renderer: undefined,
    stage5Template: undefined,
  });
});
```

- [ ] **Step 2: Run command-flag tests to verify failure**

Run: `npm test -- tests/reel-stage5-command-flags.test.ts`
Expected: FAIL at old ffmpeg parsing expectation.

- [ ] **Step 3: Remove ffmpeg token parser branch and simplify Hyperframes branch**

```ts
// src/pipeline/command-listener.ts
if (lower === "-hf" || lower === "-hyperframes") {
  stage5Renderer = "hyperframes";
  continue;
}
// remove: if (lower === "-ffmpeg") { ... }
```

- [ ] **Step 4: Add explicit legacy guidance in command execution path**

```ts
// src/pipeline/command-listener.ts (inside !reel handling, before ReelRunner.run)
if (/\s-ffmpeg(\s|$)/i.test(rawTrimmed)) {
  await telegram.sendMessage(chatId, "❌ Stage 5 ffmpeg renderer is retired. Hyperframes is now the default.");
  return;
}
```

- [ ] **Step 5: Update camera preset guard to assume Hyperframes default**

```ts
// src/pipeline/command-listener.ts
// remove ffmpeg-dependent guard condition; camera preset no longer blocked by renderer selection
```

- [ ] **Step 6: Re-run command-flag tests**

Run: `npm test -- tests/reel-stage5-command-flags.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/pipeline/command-listener.ts tests/reel-stage5-command-flags.test.ts
git commit -m "fix: remove stage5 ffmpeg command flag routing"
```

### Task 4: Normalize persisted Stage 5 renderer semantics and review defaults

**Files:**
- Modify: `src/pipeline/reel-intake-session-store.ts`
- Modify: `src/review/reel-html-builder.ts`
- Test: `tests/reel-review-html-builder.test.ts`
- Test: `tests/reel-intake-session-store.test.ts`

- [ ] **Step 1: Add failing tests for hyperframes-only persistence/read path**

```ts
// tests/reel-intake-session-store.test.ts
expect(row?.stage5Renderer).toBe("hyperframes");
// add case ensuring legacy "ffmpeg" input from query layer maps to undefined
```

```ts
// tests/reel-review-html-builder.test.ts
it("defaults renderer label to hyperframes when telemetry is absent", () => {
  const html = buildReelReviewHtml(ctxWithoutRenderer);
  expect(html).toContain("hyperframes");
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm test -- tests/reel-intake-session-store.test.ts tests/reel-review-html-builder.test.ts`
Expected: FAIL before fallback/read changes.

- [ ] **Step 3: Narrow intake-session read filter**

```ts
// src/pipeline/reel-intake-session-store.ts
const stage5Renderer = row.stage5Renderer === "hyperframes" ? row.stage5Renderer : undefined;
```

- [ ] **Step 4: Update review renderer fallback default**

```ts
// src/review/reel-html-builder.ts
const rendererLabel = ctx.stage5Renderer ?? renderTelemetry?.renderer ?? reelContext?.stage5Renderer ?? "hyperframes";
```

- [ ] **Step 5: Update review/intake tests for final semantics**

```ts
// tests/reel-review-html-builder.test.ts
// remove ffmpeg-specific telemetry expectation; keep fps/profile formatting assertions renderer-agnostic
```

- [ ] **Step 6: Re-run targeted tests**

Run: `npm test -- tests/reel-intake-session-store.test.ts tests/reel-review-html-builder.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/pipeline/reel-intake-session-store.ts src/review/reel-html-builder.ts tests/reel-intake-session-store.test.ts tests/reel-review-html-builder.test.ts
git commit -m "chore: normalize stage5 renderer persistence to hyperframes"
```

### Task 5: Update Stage 5 override tests and full verification

**Files:**
- Modify: `tests/reel-stage5-runner-overrides.test.ts`
- Modify: any additional failing tests referencing Stage 5 ffmpeg renderer

- [ ] **Step 1: Write/adjust failing tests for Hyperframes-only override behavior**

```ts
// tests/reel-stage5-runner-overrides.test.ts
it("ignores legacy persisted ffmpeg renderer in favor of current hyperframes brand setting", () => {
  expect(resolveStoredStage5Selection(
    { stage5Renderer: undefined, stage5Template: undefined },
    { stage5Renderer: "hyperframes", stage5Template: "enhanced-default" },
    {}
  )).toEqual({ stage5Renderer: "hyperframes", stage5Template: "enhanced-default" });
});
```

- [ ] **Step 2: Run focused Stage 5 suite and capture failures**

Run: `npm test -- tests/reel-stage5-renderer.test.ts tests/reel-stage5-runner-overrides.test.ts tests/reel-stage5-command-flags.test.ts`
Expected: Initial FAIL until all assertions are updated.

- [ ] **Step 3: Update all remaining ffmpeg Stage 5 expectations in tests**

```ts
// Example assertion migration
expect(resolveStageTimeoutMs!("reel-stage5-assemble", {})).toBe(30 * 60_000);
```

- [ ] **Step 4: Re-run focused Stage 5 suite**

Run: `npm test -- tests/reel-stage5-renderer.test.ts tests/reel-stage5-runner-overrides.test.ts tests/reel-stage5-command-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS (no TypeScript/runtime regressions from type narrowing).

- [ ] **Step 6: Commit Task 5**

```bash
git add tests/reel-stage5-runner-overrides.test.ts tests/reel-stage5-renderer.test.ts tests/reel-stage5-command-flags.test.ts
git commit -m "test: remove stage5 ffmpeg expectations"
```

### Task 6: Final repo hygiene and graph refresh

**Files:**
- Modify: graph artifacts generated by tool

- [ ] **Step 1: Verify ffmpeg Stage 5 references are removed from code paths**

Run: `rg "stage5Renderer.*ffmpeg|--stage5-renderer.*ffmpeg|-ffmpeg|reel-stage5-ffmpeg-renderer" src bin tests`
Expected: no active Stage 5 routing references remain; only intentional legacy/error text or historical fixtures if any.

- [ ] **Step 2: Run final status check**

Run: `git status --short`
Expected: only intended files changed/deleted.

