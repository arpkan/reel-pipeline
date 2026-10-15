# Reel Partial Regeneration Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `!reel re-voice`, `!reel re-images`, and `!reel re-music` commands that rerun only relevant reel stages with optional reel ID targeting and optional music track selection.

**Architecture:** Add a focused `ReelRunner.rebuildPart()` entrypoint that reconstructs context like existing rebuild flows, but executes only the required stage subset. Add a small pure helper for music track selection parsing (index or basename) and integrate it into stage 5 assembly through `ctx.musicTrackOverride`. Extend command parsing in `command-listener.ts` to route the three new commands and enforce `-nostock` rules.

**Tech Stack:** TypeScript (ESM), Vitest, existing reel pipeline stages and DB query APIs.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types.ts` | Add `musicTrackOverride?: string` to `ReelContext` |
| Create | `src/stages/reel-music-selector.ts` | Pure helper to resolve music track by index/basename/random |
| Modify | `src/stages/reel-stage5-assemble.ts` | Use `musicTrackOverride` and selector helper |
| Modify | `src/pipeline/reel-runner.ts` | Add `rebuildPart(reelId, brandId, part, options)` |
| Modify | `src/pipeline/command-listener.ts` | Parse and route `re-voice`, `re-images`, `re-music` |
| Modify | `src/pipeline/command-listener.ts` | Update help text (TH + EN sections) |
| Create | `tests/reel-music-selector.test.ts` | Unit tests for index/basename/random selector |
| Create | `tests/reel-command-parser.test.ts` | Unit tests for command argument parsing rules |

---

## Task 1: Music selector helper + tests (TDD)

**Files:**
- Create: `src/stages/reel-music-selector.ts`
- Create: `tests/reel-music-selector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/reel-music-selector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickMusicFile } from "../src/stages/reel-music-selector.js";

const files = [
  "/music/breaking-news-1.mp3",
  "/music/breaking-news-2.mp3",
  "/music/breaking-news-3.mp3",
];

describe("pickMusicFile", () => {
  it("picks random when selector is undefined", () => {
    const result = pickMusicFile(files, undefined, () => 0.99);
    expect(result).toBe("/music/breaking-news-3.mp3");
  });

  it("supports 1-based numeric index selector", () => {
    expect(pickMusicFile(files, "2")).toBe("/music/breaking-news-2.mp3");
  });

  it("supports basename selector", () => {
    expect(pickMusicFile(files, "breaking-news-1.mp3")).toBe("/music/breaking-news-1.mp3");
  });

  it("throws with available basenames for invalid selector", () => {
    expect(() => pickMusicFile(files, "9")).toThrow("Available tracks: breaking-news-1.mp3, breaking-news-2.mp3, breaking-news-3.mp3");
  });

  it("throws when pool is empty", () => {
    expect(() => pickMusicFile([], undefined)).toThrow("No music files available");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/reel-music-selector.test.ts`  
Expected: FAIL (`pickMusicFile` not found)

- [ ] **Step 3: Implement helper**

Create `src/stages/reel-music-selector.ts`:

```ts
import path from "path";

export function pickMusicFile(
  musicFiles: string[],
  selector?: string,
  randomFn: () => number = Math.random,
): string {
  if (musicFiles.length === 0) throw new Error("No music files available");

  if (!selector) {
    return musicFiles[Math.floor(randomFn() * musicFiles.length)];
  }

  const n = Number(selector);
  if (!Number.isNaN(n) && Number.isInteger(n)) {
    const idx = n - 1;
    if (idx >= 0 && idx < musicFiles.length) return musicFiles[idx];
  } else {
    const byName = musicFiles.find((f) => path.basename(f) === selector);
    if (byName) return byName;
  }

  const names = musicFiles.map((f) => path.basename(f)).join(", ");
  throw new Error(`Invalid music track selector: ${selector}. Available tracks: ${names}`);
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- tests/reel-music-selector.test.ts`  
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

Run:
```bash
git add src/stages/reel-music-selector.ts tests/reel-music-selector.test.ts
git commit -m "feat: add music track selector helper for reel assembly"
```

---

## Task 2: Stage 5 music override support + context field (TDD)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/stages/reel-stage5-assemble.ts`

- [ ] **Step 1: Add context field**

In `src/types.ts` under `ReelContext`, add:

```ts
musicTrackOverride?: string; // optional music selector: 1-based index or basename
```

- [ ] **Step 2: Implement override usage in stage 5**

In `src/stages/reel-stage5-assemble.ts`:

1) Add import:
```ts
import { pickMusicFile } from "./reel-music-selector.js";
```

2) Replace random music selection block:

```ts
const musicFile = pickMusicFile(musicFiles, ctx.musicTrackOverride);
musicFileName = path.basename(musicFile);
```

3) Keep existing behavior unchanged when `ctx.musicTrackOverride` is absent (helper handles this).

- [ ] **Step 3: Build and run targeted tests**

Run:
```bash
npm run build
npm test -- tests/reel-music-selector.test.ts
```

Expected: clean build + selector tests pass.

- [ ] **Step 4: Commit**

Run:
```bash
git add src/types.ts src/stages/reel-stage5-assemble.ts
git commit -m "feat: support explicit music track override in reel assembly"
```

---

## Task 3: Add `ReelRunner.rebuildPart` stage-subset entrypoint

**Files:**
- Modify: `src/pipeline/reel-runner.ts`

- [ ] **Step 1: Add method signature and part type**

Add to `ReelRunner` class:

```ts
static async rebuildPart(
  reelId: string,
  brandId: BrandId,
  part: "voice" | "images" | "music",
  options?: { useStockImagesOverride?: boolean; musicTrackSelector?: string },
): Promise<void>
```

- [ ] **Step 2: Implement stage mapping and execution**

Inside `rebuildPart`, reuse rebuild context reconstruction and DB update flow. Map parts to stage execution:

```ts
const runVoice = part === "voice";
const runImages = part === "images";
const runAssemble = true;

if (runVoice) await runStage(new ReelStage3Voice());

if (runImages || runAssemble) {
  await acquireAssemblyLock();
  try {
    if (runImages) await runStage(new ReelStage4Images());
    if (runAssemble) await runStage(new ReelStage5Assemble());
  } finally {
    releaseAssemblyLock();
  }
}
```

Before stage execution set:

```ts
ctx.musicTrackOverride = part === "music" ? options?.musicTrackSelector : undefined;
```

- [ ] **Step 3: Keep existing methods untouched**

Do not remove/rename:
- `rebuild`
- `resume`
- `rerescript`

`rebuildPart` is additive.

- [ ] **Step 4: Build + smoke verification**

Run:
```bash
npm run build
```

Then smoke-check method import exists:

```bash
node --input-type=module <<'EOF'
import { ReelRunner } from './dist/src/pipeline/reel-runner.js';
console.log(typeof ReelRunner.rebuildPart);
EOF
```

Expected: `function`

- [ ] **Step 5: Commit**

Run:
```bash
git add src/pipeline/reel-runner.ts
git commit -m "feat: add ReelRunner.rebuildPart for voice/images/music reruns"
```

---

## Task 4: Command parsing + routing + help text

**Files:**
- Modify: `src/pipeline/command-listener.ts`
- Create: `tests/reel-command-parser.test.ts`

- [ ] **Step 1: Add command parser helper tests**

Create `tests/reel-command-parser.test.ts` for pure parser extraction (extract helper in same file if needed). Cases:
- `re-voice` with optional id
- `re-images` with optional id and optional `-nostock`
- `re-music` with optional id and optional selector
- invalid `-nostock` on `re-voice` / `re-music`

- [ ] **Step 2: Implement `!reel re-*` routing**

In `command-listener.ts` under `!reel` block, add before generic `subCmd` generation branch:

```ts
if (subCmd.startsWith("re-voice") || subCmd.startsWith("re-images") || subCmd.startsWith("re-music")) {
  // parse args, resolve target by optional id else latest awaiting_approval
  // validate -nostock only for re-images
  // call ReelRunner.rebuildPart(target.id, brandId, part, { useStockImagesOverride, musicTrackSelector })
}
```

Target resolution rule:
- with id => `getReelByShortId`
- without id => latest `awaiting_approval` reel

`re-music` selector rule:
- if extra arg present and not id => pass as `musicTrackSelector`
- accepts both index and basename (resolved in stage helper)

- [ ] **Step 3: Update help text (TH + EN)**

In both help message blocks add lines:

```text
• !reel re-voice [id] — regenerate voice + re-assemble video
• !reel re-images [id] [-nostock] — regenerate images + re-assemble video
• !reel re-music [id] [track] — regenerate music mix only (track optional: index or filename)
```

- [ ] **Step 4: Run tests and build**

Run:
```bash
npm test -- tests/reel-command-parser.test.ts
npm test -- tests/reel-music-selector.test.ts
npm run build
```

Expected: pass + clean compile.

- [ ] **Step 5: Final verification command smoke test**

Run parser-level smoke checks by invoking `handleCommand` through existing command test harness or direct unit helper tests:

```bash
npm test -- tests/reel-command-parser.test.ts
```

And confirm server still starts:

```bash
pm2 restart pipeline --update-env
pm2 logs pipeline --lines 20 --nostream
```

- [ ] **Step 6: Commit**

Run:
```bash
git add src/pipeline/command-listener.ts tests/reel-command-parser.test.ts
git commit -m "feat: add reel re-voice re-images re-music commands"
```
