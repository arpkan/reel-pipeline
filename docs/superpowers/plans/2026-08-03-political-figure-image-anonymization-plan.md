# Political-Figure Image Anonymization Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent AI-generated reel images from rendering a specific, recognizable (often outdated) real person when the `imagePrompt` only contains generic political/government-role language and no actual name.

**Architecture:** A pure helper function, `guardAgainstRealPersonLikeness()`, inspects the prompt text for political-role keywords and the absence of a real-name-like token sequence. When both conditions hold, it appends a fixed anonymization clause to the prompt string sent to the image-gen API only — the stored `scene.imagePrompt` and the stock-photo search query are untouched.

**Tech Stack:** TypeScript (Node/ESM, `.js` import extensions), Vitest.

## Global Constraints

- Guard applies to AI-generated images only; the stock-photo search text (`stockService.tryStockImage`) is never modified.
- Guard only changes the string passed to `imageGen.generate()`; the stored `scene.imagePrompt` (persisted in `ReelScript` / `data/pipeline.db`) is never modified.
- No changes to `src/stages/reel-stage2-script.ts` / `buildSystemPrompt()` — this is a code-level guardrail, not an LLM-instruction change.
- Applies uniformly to all brands (`ds`, `ns`, `ts`) — no brand-specific branching; `imagePrompt` text is always English regardless of brand language.
- If a real name is already present in the prompt alongside a role keyword, the prompt is left unchanged (accuracy for named individuals is out of scope).
- Anonymization clause text (exact, verbatim, including the leading space and em dash `—`):
  `" Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead."`

---

### Task 1: `guardAgainstRealPersonLikeness()` helper + unit tests

**Files:**
- Modify: `src/stages/reel-stage4-images.ts` (add exported function + supporting regex/constants, after the `REBUILD_VARIATIONS` array, i.e. after line 62, before `export class ReelStage4Images` at line 64)
- Test: Create `tests/reel-stage4-images-guard.test.ts`

**Interfaces:**
- Produces: `export function guardAgainstRealPersonLikeness(prompt: string): string` — pure function. Returns `prompt` unchanged, or `prompt + ANONYMIZATION_CLAUSE` (string concatenation, no other transformation).

- [ ] **Step 1: Write the failing test file**

Create `tests/reel-stage4-images-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guardAgainstRealPersonLikeness } from "../src/stages/reel-stage4-images.js";

const ANONYMIZATION_CLAUSE =
  " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead.";

describe("guardAgainstRealPersonLikeness", () => {
  it("appends the anonymization clause to a generic political-role prompt with no name (regression: run ea0e9945-433a-4fd5-aa81-6652f517a0d1, scene 3 — nationality adjective 'German' must not count as a real name)", () => {
    const prompt =
      "German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("leaves a prompt unchanged when a real name is present alongside a role keyword", () => {
    const prompt =
      "German Minister Carsten Schneider at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt);
  });

  it("triggers on a title-only phrase with no attached name", () => {
    const prompt =
      "The Prime Minister addressing parliament, serious expression, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("leaves a prompt unchanged when there is no political-role language at all", () => {
    const prompt =
      "Wide dry sandbars emerging from the Rhine river near Duisburg Germany, dramatic low water levels, cracked dry riverbed visible, industrial city skyline faint in background, golden afternoon light, vertical 9:16 portrait composition, photorealistic, cinematic atmosphere";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt);
  });

  it("treats 'A German official' as a title phrase, not a real name, and triggers", () => {
    const prompt = "A German official speaking to reporters, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("treats a place/institution name (White House) as not a real name, and triggers", () => {
    const prompt = "German politician speaking outside the White House, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("accepted limitation: over-anonymizes a bare single-word surname with no first name", () => {
    // Merkel is a real, specific person, but the 2+-word name check can't tell a
    // lone capitalized surname apart from any other single capitalized word (a
    // place, a building, a brand). Loosening the check to count single words as
    // names would reopen the White House-style false negative above. This test
    // documents the accepted trade-off, not a bug to fix.
    const prompt = "German chancellor Merkel speaking at a podium, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage4-images-guard.test.ts`
Expected: FAIL — `guardAgainstRealPersonLikeness` is not exported from `src/stages/reel-stage4-images.ts` yet (import resolves to `undefined`, calling it throws `TypeError: guardAgainstRealPersonLikeness is not a function`).

- [ ] **Step 3: Implement the helper**

In `src/stages/reel-stage4-images.ts`, insert after line 62 (the closing `];` of `REBUILD_VARIATIONS`) and before line 64 (`export class ReelStage4Images`):

```ts
// Plural forms added for the simple pluralizable single-word alternatives (and the
// last word of "prime minister" / "party leader") so e.g. "German politicians" is
// still guarded — the bare \b word boundary never matches before a trailing "s".
// "mp" / "member of parliament" and "head of state" are left singular-only: MP's
// plural form is ambiguous/rare enough in prompt text to skip, and "heads of state"
// is irregular (the "s" isn't on the last word) so it's not worth the added regex
// complexity here. (added in final review)
const POLITICAL_ROLE_RE =
  /\b(politicians?|presidents?|prime\s+ministers?|premiers?|chancellors?|ministers?|secretary\s+of\s+state|senators?|governors?|mayors?|mp|member\s+of\s+parliament|parliamentarians?|cabinet|head\s+of\s+state|party\s+leaders?|diplomats?|ambassadors?|officials?)\b/i;

// ASCII-only by construction: accented names/places (e.g. "Jürgen Müller", "Élysée")
// never match this sequence regex, so they're handled only via the "no 2-word
// capitalized sequence matched" fallback path (i.e. over-anonymized), not via the
// TITLE_STOPWORDS list below. A Unicode-aware rewrite is out of scope here. (added in final review)
const CAPITALIZED_SEQUENCE_RE = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g;

const TITLE_STOPWORDS = new Set([
  // titles / nationalities
  "prime", "minister", "president", "chancellor", "secretary", "state",
  "senator", "governor", "mayor", "premier", "cabinet", "parliament",
  "congress", "house", "representatives", "foreign", "interior", "defense",
  "finance", "justice", "the", "of", "german", "thai", "american", "british",
  "french", "russian", "chinese", "european",
  // places / institutions (added after spec review — otherwise e.g. "White House"
  // reads as a real name and the guard wrongly skips anonymization)
  "white", "street", "downing", "palace", "capitol", "hill", "commission",
  "reichstag", "bundestag", "kremlin", "building", "square",
  "avenue", "hall",
  // NOTE: "elysée" was removed here in final review — CAPITALIZED_SEQUENCE_RE is
  // ASCII-only, so a token containing "é" can never be produced by that regex,
  // making this entry unreachable dead code. "Elysée Palace" is still guarded
  // correctly, just via the "no 2-word sequence matched" fallback path instead.
]);

function hasRealNameSequence(prompt: string): boolean {
  const matches = prompt.match(CAPITALIZED_SEQUENCE_RE) ?? [];
  return matches.some((seq) =>
    seq
      .toLowerCase()
      .split(/\s+/)
      .some((word) => !TITLE_STOPWORDS.has(word))
  );
}

const ANONYMIZATION_CLAUSE =
  " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead.";

export function guardAgainstRealPersonLikeness(prompt: string): string {
  if (!POLITICAL_ROLE_RE.test(prompt)) return prompt;
  if (hasRealNameSequence(prompt)) return prompt;
  return `${prompt}${ANONYMIZATION_CLAUSE}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reel-stage4-images-guard.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage4-images.ts tests/reel-stage4-images-guard.test.ts
git commit -m "add guardAgainstRealPersonLikeness helper for political image prompts"
```

---

### Task 2: Wire the guard into `ReelStage4Images.run()`

**Files:**
- Modify: `src/stages/reel-stage4-images.ts:102-119` (the `else` branch of the stock-vs-AI-gen scene loop)
- Test: Modify `tests/reel-stage3-stock.test.ts` (existing test file for this same stage — already has the mock scaffold for `image-gen.js` / `stock-image.js` / `child_process`)

**Interfaces:**
- Consumes: `guardAgainstRealPersonLikeness(prompt: string): string` from Task 1 (same file, no import needed — already in module scope).
- Produces: no new exports; behavioral change only to `ReelStage4Images.run()`.

- [ ] **Step 1: Write the failing test**

`tests/reel-stage3-stock.test.ts` currently defines the image-gen mock inline inside `vi.mock(...)`, so its calls can't be inspected. Change it to a hoisted mock (matching the existing `stockTryMock` pattern already in the file), and make `makeReelCtx` accept optional scene overrides so a new test can supply a custom `imagePrompt` without duplicating the whole context builder.

Replace the full contents of `tests/reel-stage3-stock.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReelStage4Images } from "../src/stages/reel-stage4-images.js";
import type { ReelContext, ReelScene } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";
import fs from "fs";
import path from "path";
import os from "os";

const { stockTryMock, generateMock } = vi.hoisted(() => ({
  stockTryMock: vi.fn(),
  generateMock: vi.fn().mockResolvedValue({
    buffer: Buffer.from("ai-image"),
    source: "imagen" as const,
  }),
}));

vi.mock("../src/services/image-gen.js", () => ({
  createImageGenService: () => ({
    modelName: "gemini-test-model",
    generate: generateMock,
  }),
  ImageSafetyError: class extends Error {
    constructor() {
      super("IMAGE_SAFETY");
      this.name = "ImageSafetyError";
    }
  },
}));

vi.mock("../src/services/stock-image.js", () => ({
  createStockImageService: () => ({
    tryStockImage: stockTryMock,
  }),
}));

vi.mock("child_process", () => ({
  spawnSync: () => ({ stdout: "800,1400" }),
}));

const DEFAULT_SCENES: ReelScene[] = [
  { sceneNumber: 1, voiceover: "Hello", caption: "Hi", imagePrompt: "Berlin cityscape at dusk, photorealistic" },
  { sceneNumber: 2, voiceover: "World", caption: "Wow", imagePrompt: "futuristic robot assembly line, neon lights" },
];

function makeReelCtx(workDir: string, scenes: ReelScene[] = DEFAULT_SCENES): ReelContext {
  return {
    runId: "test-reel",
    brand: getBrand("ns"),
    runDate: "2026-04-21",
    workDir,
    script: {
      title: "Test reel",
      scenes,
      hashtags: [],
    },
    stageLogs: [],
    status: "running",
  };
}

describe("ReelStage4Images stock integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-"));
    stockTryMock.mockReset();
    generateMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses stock image when available", async () => {
    stockTryMock.mockResolvedValue({
      buffer: Buffer.from("stock-photo-data"),
      provider: "unsplash",
    });

    const stage = new ReelStage4Images();
    const result = await stage.run(makeReelCtx(tmpDir));

    expect(result.imagePaths).toHaveLength(2);
    for (const p of result.imagePaths!) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it("falls back to Imagen when stock returns nothing", async () => {
    stockTryMock.mockResolvedValue(null);

    const stage = new ReelStage4Images();
    const result = await stage.run(makeReelCtx(tmpDir));

    expect(result.imagePaths).toHaveLength(2);
    for (const p of result.imagePaths!) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});

describe("ReelStage4Images political-figure image guard", () => {
  let tmpDir: string;
  const politicalPrompt =
    "German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-"));
    stockTryMock.mockReset();
    stockTryMock.mockResolvedValue(null);
    generateMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sends the anonymization-guarded prompt to the image generator but the original prompt to stock search", async () => {
    const scenes: ReelScene[] = [
      { sceneNumber: 1, voiceover: "test", caption: "test", imagePrompt: politicalPrompt },
    ];
    const stage = new ReelStage4Images();
    await stage.run(makeReelCtx(tmpDir, scenes));

    expect(stockTryMock).toHaveBeenCalledWith(politicalPrompt, "portrait");

    const [sentPrompt] = generateMock.mock.calls[0];
    expect(sentPrompt).not.toBe(politicalPrompt);
    expect(sentPrompt).toBe(
      politicalPrompt +
        " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage3-stock.test.ts`
Expected: FAIL on the new "political-figure image guard" test — `generateMock` is called with the raw, unguarded `politicalPrompt` (guard not wired in yet), so `sentPrompt` equals `politicalPrompt` and the `not.toBe` assertion fails. (The two pre-existing "stock integration" tests should still pass.)

- [ ] **Step 3: Wire the guard into `run()`**

In `src/stages/reel-stage4-images.ts`, replace lines 102-119:

```ts
        } else {
          try {
            const genResult = await imageGen.generate(prompt, { aspectRatio: "9:16" });
            buffer = genResult.buffer;
            imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
          } catch (err) {
            const isSafetyBlock = err instanceof ImageSafetyError
              || (err instanceof Error && /moderation|safety/i.test(err.message));
            if (isSafetyBlock) {
              const safePrompt = `Cinematic news photo, no people visible: ${prompt.replace(/\b(child|kid|boy|girl|man|woman|person|people|minor|\d+-year-old)\b/gi, "").trim()}. Dramatic lighting, photorealistic.`;
              console.log(`    ⚠️ Safety block — retrying with safe prompt`);
              const genResult = await imageGen.generate(safePrompt, { aspectRatio: "9:16" });
              buffer = genResult.buffer;
              imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
            } else {
              throw err;
            }
          }
        }
```

with:

```ts
        } else {
          const genPrompt = guardAgainstRealPersonLikeness(prompt);
          try {
            const genResult = await imageGen.generate(genPrompt, { aspectRatio: "9:16" });
            buffer = genResult.buffer;
            imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
          } catch (err) {
            const isSafetyBlock = err instanceof ImageSafetyError
              || (err instanceof Error && /moderation|safety/i.test(err.message));
            if (isSafetyBlock) {
              const safePrompt = `Cinematic news photo, no people visible: ${genPrompt.replace(/\b(child|kid|boy|girl|man|woman|person|people|minor|\d+-year-old)\b/gi, "").trim()}. Dramatic lighting, photorealistic.`;
              console.log(`    ⚠️ Safety block — retrying with safe prompt`);
              const genResult = await imageGen.generate(safePrompt, { aspectRatio: "9:16" });
              buffer = genResult.buffer;
              imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
            } else {
              throw err;
            }
          }
        }
```

Note line 95 (`stockService.tryStockImage(prompt, "portrait")`) is untouched — it must keep using the original `prompt`, not `genPrompt`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reel-stage3-stock.test.ts tests/reel-stage4-images-guard.test.ts`
Expected: PASS (all tests in both files)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions in other test files.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage4-images.ts tests/reel-stage3-stock.test.ts
git commit -m "wire guardAgainstRealPersonLikeness into ReelStage4Images AI-gen path"
```

---

## Self-Review Notes

- **Spec coverage:** Role-keyword detection (Task 1), name-like-sequence detection including the post-review place/institution stopwords (Task 1), anonymization clause + append behavior (Task 1), call-site wiring for both the main and safety-retry `imageGen.generate()` calls (Task 2, the retry path inherits the guard via `genPrompt` reuse), stock-search text left untouched (Task 2 test asserts this explicitly), all 7 test cases from the spec's Testing section (regression case, named-person-left-alone, title-only-triggers, no-role-keyword-unchanged, nationality-adjective-triggers, place/institution-not-a-name, accepted bare-surname limitation) are covered in Task 1's test file.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `guardAgainstRealPersonLikeness(prompt: string): string` signature is identical between its definition (Task 1) and its two call sites/import-free usage (Task 2, same module scope).
