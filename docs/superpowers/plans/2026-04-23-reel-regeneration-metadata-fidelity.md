# Reel Regeneration Metadata Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `resume`, `rebuild`, `rerescript`, and `rebuildPart` persist the latest reel metadata and `/review/reel/:reelId` always renders the final current state accurately.

**Architecture:** Add a small shared persistence helper in `ReelRunner` so all completion paths write the same context contract (including `musicFile`). Update review-route hydration to load that contract into `ReelContext` before HTML build. Add focused tests that prove persisted metadata appears in rendered review HTML and that runner persistence includes the new fields.

**Tech Stack:** TypeScript (ESM), Vitest, Hono route handlers, Drizzle query layer.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/pipeline/reel-runner.ts` | Add shared context persistence helper and use it in all reel completion paths |
| Modify | `api/routes/review.ts` | Hydrate full persisted reel context fields for HTML rendering |
| Create | `tests/reel-review-metadata-fidelity.test.ts` | Verify review HTML shows latest music/image-source/prompt metadata from persisted state |

---

## Task 1: Add failing review-fidelity tests (TDD)

**Files:**
- Create: `tests/reel-review-metadata-fidelity.test.ts`

- [ ] **Step 1: Write failing tests for final-state metadata rendering**

Create `tests/reel-review-metadata-fidelity.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { buildReelReviewHtml } from "../src/review/reel-html-builder.js";
import { getBrand } from "../src/brands/index.js";
import type { ReelContext } from "../src/types.js";

function baseCtx(): ReelContext {
  return {
    runId: "run-1",
    brand: getBrand("ns"),
    runDate: "2026-04-23",
    workDir: "/tmp",
    story: {
      index: 0,
      headline: "Headline",
      source: "Reuters",
      sourceUrl: "https://example.com/story",
      snippet: "Snippet",
      pillar: "",
      selectionReason: "",
      compositeScore: 0,
      verified: false,
    },
    script: {
      title: "Title",
      category: "business",
      hashtags: ["#a"],
      scenes: [
        {
          sceneNumber: 1,
          caption: "Cap",
          voiceover: "VO",
          imagePrompt: "NEW PROMPT",
          durationSeconds: 2,
          wordTimings: [{ word: "hello", start: 0, end: 0.5 }],
        },
      ],
    },
    videoGcsUrl: "https://storage.googleapis.com/bucket/reel.mp4",
    status: "awaiting_approval",
    stageLogs: [],
  };
}

describe("reel review metadata fidelity", () => {
  it("renders latest music file and scene source badge from persisted context", () => {
    const ctx = {
      ...baseCtx(),
      musicFile: "business-2.mp3",
      imageSourceMap: { 1: { type: "stock", provider: "unsplash" as const } },
    };
    const html = buildReelReviewHtml(ctx);
    expect(html).toContain("business-2.mp3");
    expect(html).toContain("📷 Unsplash");
  });

  it("renders latest script prompt after regeneration", () => {
    const html = buildReelReviewHtml(baseCtx());
    expect(html).toContain("NEW PROMPT");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/reel-review-metadata-fidelity.test.ts`

Expected: at least one failing assertion (current persistence/hydration path does not reliably carry `musicFile`).

---

## Task 2: Persist complete reel metadata in all completion paths

**Files:**
- Modify: `src/pipeline/reel-runner.ts`

- [ ] **Step 1: Add shared persisted-context helper**

Near other top-level helpers in `src/pipeline/reel-runner.ts`, add:

```ts
function buildPersistedReelContext(ctx: ReelContext): Record<string, unknown> {
  return {
    themeSource: ctx.themeSource,
    pillarBalance: ctx.pillarBalance,
    trendingSignals: ctx.trendingSignals,
    categorySource: ctx.categorySource,
    discoveryBias: ctx.discoveryBias,
    recentTopics: ctx.recentTopics,
    imageSourceMap: ctx.imageSourceMap,
    useStockImages: ctx.useStockImages,
    apiSourceMap: ctx.apiSourceMap,
    musicFile: ctx.musicFile,
  };
}
```

- [ ] **Step 2: Use helper in `run` completion update**

Replace inline `context: { ... }` in `ReelRunner.run(...)` success `queries.updateReel(...)` with:

```ts
context: buildPersistedReelContext(ctx),
```

- [ ] **Step 3: Use helper in `rerescript` completion update**

Replace inline context block in `ReelRunner.rerescript(...)` success update with:

```ts
context: buildPersistedReelContext(ctx),
```

- [ ] **Step 4: Use helper in `resume` completion update**

Replace inline context block in `ReelRunner.resume(...)` success update with:

```ts
context: buildPersistedReelContext(ctx),
```

- [ ] **Step 5: Use helper in `rebuild` completion update**

Replace inline context block in `ReelRunner.rebuild(...)` success update with:

```ts
context: buildPersistedReelContext(ctx),
```

- [ ] **Step 6: Use helper in `rebuildPart` completion update**

Replace inline context block in `ReelRunner.rebuildPart(...)` success update with:

```ts
context: buildPersistedReelContext(ctx),
```

- [ ] **Step 7: Run focused reel-runner tests**

Run:
- `npm test -- tests/reel-runner-rebuild-part.test.ts`
- `npm test -- tests/reel-runner-rebuild-part-cancel.test.ts`

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/reel-runner.ts
git commit -m "fix: persist complete reel metadata after regeneration"
```

---

## Task 3: Hydrate full persisted context in reel review route

**Files:**
- Modify: `api/routes/review.ts`

- [ ] **Step 1: Extend stored context typing in review route**

In `/review/reel/:reelId` block, include optional fields in parsed `stored` type:

```ts
musicFile?: ReelContext["musicFile"];
categorySource?: ReelContext["categorySource"];
useStockImages?: ReelContext["useStockImages"];
```

- [ ] **Step 2: Hydrate these fields into `ctx`**

In the `ctx = { ...ctx, ... }` assignment for stored context, include:

```ts
categorySource: stored.categorySource,
useStockImages: stored.useStockImages,
musicFile: stored.musicFile,
```

- [ ] **Step 3: Run fidelity test to verify GREEN**

Run: `npm test -- tests/reel-review-metadata-fidelity.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add api/routes/review.ts tests/reel-review-metadata-fidelity.test.ts
git commit -m "fix: hydrate latest reel metadata for review html"
```

---

## Task 4: Final verification

**Files:**
- Verify only

- [ ] **Step 1: Run test suite slices for touched behavior**

Run:
- `npm test -- tests/reel-review-metadata-fidelity.test.ts`
- `npm test -- tests/reel-runner-rebuild-part.test.ts`
- `npm test -- tests/reel-runner-rebuild-part-cancel.test.ts`
- `npm test -- tests/reel-music-selector.test.ts`

Expected: all pass.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: `tsc` success.

- [ ] **Step 3: Manual smoke checklist (operator)**

For one reel ID in awaiting approval:
1. Run `!reel re-music <id> <track>` and confirm review page music row updates to chosen track.
2. Run `!reel re-images <id> -nostock` and confirm scene source badges update (no stale providers).
3. Run `!reel rescript <id>` and confirm scene prompt details show updated prompts.

- [ ] **Step 4: Commit verification-only updates if any**

If no files changed, skip commit.
