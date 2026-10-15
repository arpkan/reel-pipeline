# Image Source Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track whether each post/reel image came from a stock provider (Unsplash/Pexels/Pixabay) or AI (Gemini model name), persist it to the DB, and display it in both review HTML pages.

**Architecture:** Add `ImageSource` discriminated union type to `types.ts`. Change `tryStockImage()` to return `{ buffer, provider } | null`. Add `imageSource` to `Post` and `imageSourceMap` to `ReelContext`. Persist post source in new `image_source` DB column; persist reel source inside existing `context` JSON blob. Render badges in both review HTML builders.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `StockProvider`, `ImageSource` types; add `imageSource?` to `Post`; add `imageSourceMap?` to `ReelContext` |
| `src/services/stock-image.ts` | Change `tryStockImage()` return from `Buffer \| null` to `{ buffer: Buffer; provider: StockProvider } \| null` |
| `src/services/image-gen.ts` | Add `get modelName(): string` getter |
| `src/db/schema.ts` | Add `imageSource: text('image_source')` to `posts` table |
| `src/db/queries.ts` | Add `imageSource` to `updatePost()` fields; serialize/deserialize JSON |
| `src/stages/post-stage3-image-gen.ts` | Set `post.imageSource` after each branch; call `updatePost()` with it |
| `src/stages/reel-stage4-images.ts` | Build `imageSourceMap` per scene; return it |
| `src/review/html-builder.ts` | Render `imageSource` badge in `buildPostCard` |
| `src/review/reel-html-builder.ts` | Render `imageSourceMap[scene.sceneNumber]` badge in scene header |
| `tests/image-source.test.ts` | Unit tests for type helpers and badge rendering |
| `tests/stock-image.test.ts` | Update existing tests for new return type |

---

### Task 1: Add `ImageSource` types to `src/types.ts` and update `Post` + `ReelContext`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the types**

In `src/types.ts`, after the `ImageGenOptions` interface (around line 195), add:

```ts
// ─── Image source tracking ────────────────────────────────────────────────────

export type StockProvider = 'unsplash' | 'pexels' | 'pixabay';

export type ImageSource =
  | { type: 'stock';  provider: StockProvider }
  | { type: 'ai';     model: string }
  | { type: 'failed' }
```

- [ ] **Step 2: Add `imageSource` to `Post`**

In the `Post` interface (around line 99), add after `imageFailed`:

```ts
  imageSource?: ImageSource;         // how the image was obtained
```

- [ ] **Step 3: Add `imageSourceMap` to `ReelContext`**

In the `ReelContext` interface (around line 257), add after `imagePaths`:

```ts
  imageSourceMap?: Record<number, ImageSource>; // sceneNumber → source
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ImageSource type to types.ts"
```

---

### Task 2: Update `stock-image.ts` to return provider name

**Files:**
- Modify: `src/services/stock-image.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/stock-image.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("StockImageService.tryStockImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no API keys are configured", async () => {
    const { StockImageService } = await import("../src/services/stock-image.js");
    const svc = new StockImageService("", "", "");
    const result = await svc.tryStockImage("a news photo", "square");
    expect(result).toBeNull();
  });

  it("returns { buffer, provider: 'unsplash' } when unsplash finds an image", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ urls: { regular: "https://example.com/img.jpg" } }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as Response);

    const { StockImageService } = await import("../src/services/stock-image.js");
    const svc = new StockImageService("unsplash-key", "", "");
    const result = await svc.tryStockImage("a news photo", "square");

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("unsplash");
    expect(result!.buffer).toBeInstanceOf(Buffer);
  });

  it("returns { buffer, provider: 'pexels' } when only pexels has a result", async () => {
    // unsplash search returns empty
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)
      // pexels search returns a photo
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ photos: [{ src: { large: "https://example.com/pexels.jpg" } }] }),
      } as Response)
      // fetch actual image
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as Response);

    const { StockImageService } = await import("../src/services/stock-image.js");
    const svc = new StockImageService("unsplash-key", "pexels-key", "");
    const result = await svc.tryStockImage("a news photo", "square");

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("pexels");
  });

  it("returns null when all providers return no results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], photos: [], hits: [] }),
    } as unknown as Response);

    const { StockImageService } = await import("../src/services/stock-image.js");
    const svc = new StockImageService("unsplash-key", "pexels-key", "pixabay-key");
    const result = await svc.tryStockImage("a news photo", "square");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/stock-image.test.ts 2>&1
```

Expected: FAIL — return type is `Buffer | null`, not `{ buffer, provider } | null`.

- [ ] **Step 3: Update `tryStockImage()` to return provider**

Replace the entire `StockImageService` class in `src/services/stock-image.ts`:

```ts
export class StockImageService {
  private readonly unsplashKey: string;
  private readonly pexelsKey: string;
  private readonly pixabayKey: string;

  constructor(unsplashKey: string, pexelsKey: string, pixabayKey: string) {
    this.unsplashKey = unsplashKey;
    this.pexelsKey = pexelsKey;
    this.pixabayKey = pixabayKey;
  }

  async tryStockImage(
    prompt: string,
    orientation: "portrait" | "square"
  ): Promise<{ buffer: Buffer; provider: StockProvider } | null> {
    try {
      if (!this.unsplashKey && !this.pexelsKey && !this.pixabayKey) return null;

      const query = extractSearchQuery(prompt);

      const searches: { promise: Promise<string | null>; provider: StockProvider }[] = [];
      if (this.unsplashKey) searches.push({ promise: searchUnsplash(query, orientation, this.unsplashKey), provider: "unsplash" });
      if (this.pexelsKey)   searches.push({ promise: searchPexels(query, orientation, this.pexelsKey),     provider: "pexels"   });
      if (this.pixabayKey)  searches.push({ promise: searchPixabay(query, orientation, this.pixabayKey),   provider: "pixabay"  });

      const results = await Promise.all(searches.map((s) => s.promise));

      const winnerIndex = results.findIndex((r) => r !== null);
      if (winnerIndex === -1) return null;

      const imageUrl = results[winnerIndex]!;
      const provider = searches[winnerIndex].provider;

      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return null;
      const arrBuf = await imgRes.arrayBuffer();
      return { buffer: Buffer.from(arrBuf), provider };
    } catch {
      return null;
    }
  }
}
```

Also add `import type { StockProvider } from "../types.js";` at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/stock-image.test.ts 2>&1
```

Expected: PASS (4 tests).

- [ ] **Step 5: Build to catch any consumers of old return type**

```bash
npm run build 2>&1
```

Expected: TypeScript errors at `post-stage3-image-gen.ts` and `reel-stage4-images.ts` where `stockBuffer` was `Buffer | null`. These will be fixed in Tasks 4 and 5.

- [ ] **Step 6: Commit**

```bash
git add src/services/stock-image.ts tests/stock-image.test.ts
git commit -m "feat: return provider name from tryStockImage()"
```

---

### Task 3: Add `modelName` getter to `ImageGenService`

**Files:**
- Modify: `src/services/image-gen.ts`

- [ ] **Step 1: Add getter**

In `src/services/image-gen.ts`, after the `private readonly modelId` field (line 27), add:

```ts
  get modelName(): string {
    return this.modelId;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/image-gen.ts
git commit -m "feat: expose modelName getter on ImageGenService"
```

---

### Task 4: Add `image_source` column to DB schema and `updatePost()`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Add column to schema**

In `src/db/schema.ts`, in the `posts` table definition, add after `imageFailed` (line 40):

```ts
  imageSource: text("image_source"),                    // JSON ImageSource — nullable
```

- [ ] **Step 2: Add `imageSource` to `updatePost()` fields**

In `src/db/queries.ts`, update the `updatePost` function. Change the fields type and add serialization:

```ts
import type { BrandId, RunStatus, Story, Post, StageLog, ReelScript, ImageSource } from "../types.js";

export function updatePost(runId: string, index: number, fields: Partial<{
  caption: string;
  textOverlay: string;
  imagePrompt: string;
  imagePath: string;
  imageFailed: boolean;
  imageSource: ImageSource;
  scheduledTime: string;
  facebookPostId: string;
  publishedAt: string;
  approved: boolean;
}>): void {
  const { imageSource, ...rest } = fields;
  const dbFields: Record<string, unknown> = { ...rest };
  if (imageSource !== undefined) {
    dbFields.imageSource = JSON.stringify(imageSource);
  }
  db.update(posts)
    .set(dbFields)
    .where(and(eq(posts.runId, runId), eq(posts.index, index)))
    .run();
}
```

- [ ] **Step 3: Parse `imageSource` when reading posts**

In `src/db/queries.ts`, find `getPostsByRun` (around line 201):

```ts
export function getPostsByRun(runId: string): Post[] {
  const rows = db.select().from(posts).where(eq(posts.runId, runId)).all();
  return rows.map((row) => ({
    ...row,
    imageSource: row.imageSource ? (JSON.parse(row.imageSource) as ImageSource) : undefined,
  })) as unknown as Post[];
}
```

- [ ] **Step 4: Build**

```bash
npm run build 2>&1
```

Expected: no errors (the `imageSource` field on `Post` is optional so existing callers still compile).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts
git commit -m "feat: add image_source column to posts table"
```

---

### Task 5: Update `post-stage3-image-gen.ts` to record image source

**Files:**
- Modify: `src/stages/post-stage3-image-gen.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/post-stage3-image-source.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PostStage3ImageGen } from "../src/stages/post-stage3-image-gen.js";
import type { RunContext, Services, Post } from "../src/types.js";

function makePost(index: number): Post {
  return {
    index,
    story: { index, headline: "h", source: "s", sourceUrl: "u", snippet: "sn", pillar: "p", selectionReason: "r", compositeScore: 1, verified: false },
    pillar: "p",
    caption: "c",
    textOverlay: "t",
    imagePrompt: "a photo of news",
    scheduledTime: "2026-01-01 10:00",
    approved: false,
  };
}

function makeServices(stockResult: { buffer: Buffer; provider: "unsplash" | "pexels" | "pixabay" } | null, aiBuffer: Buffer | null) {
  return {
    stockImage: { tryStockImage: vi.fn().mockResolvedValue(stockResult) },
    imageGen: {
      generate: vi.fn().mockResolvedValue(aiBuffer ?? (() => { throw new Error("failed"); })()),
      modelName: "gemini-3.1-flash-image-preview",
    },
    gcs: { uploadImage: vi.fn().mockResolvedValue("https://gcs/img.png") },
  } as unknown as Services;
}

describe("PostStage3ImageGen image source tracking", () => {
  it("sets imageSource to stock with provider when stock image is found", async () => {
    const post = makePost(0);
    const services = makeServices(
      { buffer: Buffer.from("img"), provider: "pexels" },
      null
    );
    const stage = new PostStage3ImageGen();
    await stage.generateForPost(post, "run1", "prefix", services);

    expect(post.imageSource).toEqual({ type: "stock", provider: "pexels" });
    expect(post.imageFailed).toBe(false);
  });

  it("sets imageSource to ai with model when AI generation succeeds", async () => {
    const post = makePost(0);
    const services = makeServices(null, Buffer.from("aiimg"));
    const stage = new PostStage3ImageGen();
    await stage.generateForPost(post, "run1", "prefix", services);

    expect(post.imageSource).toEqual({ type: "ai", model: "gemini-3.1-flash-image-preview" });
    expect(post.imageFailed).toBe(false);
  });

  it("sets imageSource to failed when all AI attempts fail", async () => {
    const post = makePost(0);
    const services = {
      stockImage: { tryStockImage: vi.fn().mockResolvedValue(null) },
      imageGen: {
        generate: vi.fn().mockRejectedValue(new Error("blocked")),
        modelName: "gemini-3.1-flash-image-preview",
      },
      gcs: { uploadImage: vi.fn() },
    } as unknown as Services;
    const stage = new PostStage3ImageGen();
    await stage.generateForPost(post, "run1", "prefix", services);

    expect(post.imageSource).toEqual({ type: "failed" });
    expect(post.imageFailed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/post-stage3-image-source.test.ts 2>&1
```

Expected: FAIL — `post.imageSource` is undefined.

- [ ] **Step 3: Update `post-stage3-image-gen.ts`**

Replace the full file content:

```ts
import type { Stage, RunContext, Services, Post } from "../types.js";

const MAX_ATTEMPTS = 3;

export class PostStage3ImageGen implements Stage {
  name = "post-stage3-image-gen";

  async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
    const posts: Post[] = [...ctx.posts];

    for (const post of posts) {
      // Skip posts that already have a successfully generated image (resume path)
      if (post.imagePath && !post.imageFailed) {
        console.log(`[${ctx.runId}] skipping image gen for post ${post.index + 1} — already generated`);
        continue;
      }
      await this.generateForPost(post, ctx.runId, ctx.brand.gcsPrefix, services);
    }

    return { posts };
  }

  async generateForPost(
    post: Post,
    runId: string,
    gcsPrefix: string,
    services: Services
  ): Promise<void> {
    const filename = `post${post.index + 1}.png`;

    const stockResult = await services.stockImage.tryStockImage(post.imagePrompt, "square");
    if (stockResult) {
      console.log(`[${runId}] post ${post.index + 1}: using stock image (${stockResult.provider})`);
      const url = await services.gcs.uploadImage(gcsPrefix, runId, filename, stockResult.buffer);
      post.imagePath = url;
      post.imageFailed = false;
      post.imageSource = { type: "stock", provider: stockResult.provider };
      return;
    }

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const buffer = await services.imageGen.generate(post.imagePrompt);
        const url = await services.gcs.uploadImage(gcsPrefix, runId, filename, buffer);

        post.imagePath = url;
        post.imageFailed = false;
        post.imageSource = { type: "ai", model: services.imageGen.modelName };
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`[${runId}] image gen attempt ${attempt}/${MAX_ATTEMPTS} failed for post ${post.index + 1}: ${lastError}`);

        if (attempt < MAX_ATTEMPTS) {
          // Slightly modify prompt on retry to work around content filters
          post.imagePrompt = post.imagePrompt + " Artistic illustration style.";
        }
      }
    }

    // All attempts failed — mark as failed, do not halt pipeline
    console.error(`[${runId}] image gen failed for post ${post.index + 1} after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    post.imageFailed = true;
    post.imagePath = undefined;
    post.imageSource = { type: "failed" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/post-stage3-image-source.test.ts 2>&1
```

Expected: PASS (3 tests).

- [ ] **Step 5: Full build**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stages/post-stage3-image-gen.ts tests/post-stage3-image-source.test.ts
git commit -m "feat: record imageSource on Post in post-stage3-image-gen"
```

---

### Task 6: Update `reel-stage4-images.ts` to build `imageSourceMap`

**Files:**
- Modify: `src/stages/reel-stage4-images.ts`

- [ ] **Step 1: Update the stage**

Replace the full file content of `src/stages/reel-stage4-images.ts`:

```ts
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { ReelContext, ReelStage, ImageSource } from "../types.js";
import { createImageGenService, ImageSafetyError } from "../services/image-gen.js";
import { createStockImageService } from "../services/stock-image.js";

export class ReelStage4Images implements ReelStage {
  name = "reel-stage4-images";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script — run reel-stage1-script first");

    const imageGen = createImageGenService();
    const stockService = createStockImageService();
    const tmpDir = ctx.workDir!;
    fs.mkdirSync(tmpDir, { recursive: true });

    const imagePaths: string[] = [];
    const imageSourceMap: Record<number, ImageSource> = {};

    for (const scene of ctx.script.scenes) {
      const outPath = path.join(tmpDir, `scene${scene.sceneNumber}.png`);
      console.log(`  Scene ${scene.sceneNumber}: ${scene.imagePrompt.slice(0, 70)}...`);

      let buffer: Buffer;

      const stockResult = await stockService.tryStockImage(scene.imagePrompt, "portrait");
      if (stockResult) {
        console.log(`    → stock image found (${stockResult.provider})`);
        buffer = stockResult.buffer;
        imageSourceMap[scene.sceneNumber] = { type: "stock", provider: stockResult.provider };
      } else {
        try {
          buffer = await imageGen.generate(scene.imagePrompt, { aspectRatio: "9:16" });
          imageSourceMap[scene.sceneNumber] = { type: "ai", model: imageGen.modelName };
        } catch (err) {
          if (err instanceof ImageSafetyError) {
            const safePrompt = `Cinematic news photo, no people visible: ${scene.imagePrompt.replace(/\b(child|kid|boy|girl|man|woman|person|people|minor|\d+-year-old)\b/gi, "").trim()}. Dramatic lighting, photorealistic.`;
            console.log(`    ⚠️ IMAGE_SAFETY — retrying with safe prompt`);
            buffer = await imageGen.generate(safePrompt, { aspectRatio: "9:16" });
            imageSourceMap[scene.sceneNumber] = { type: "ai", model: imageGen.modelName };
          } else {
            throw err;
          }
        }
      }
      fs.writeFileSync(outPath, buffer);

      // Validate portrait orientation — force-crop if landscape
      const probeResult = spawnSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0", outPath,
      ], { encoding: "utf8" });
      const [w, h] = probeResult.stdout.trim().split(",").map(Number);
      if (w && h && w >= h) {
        console.log(`    ⚠️ Landscape detected (${w}x${h}) — cropping to portrait`);
        const targetW = Math.floor(h * 9 / 16);
        const x = Math.floor((w - targetW) / 2);
        const croppedPath = outPath.replace(".png", "_portrait.png");
        spawnSync("ffmpeg", [
          "-i", outPath,
          "-vf", `crop=${targetW}:${h}:${x}:0`,
          "-y", croppedPath,
        ]);
        fs.renameSync(croppedPath, outPath);
      }

      imagePaths.push(outPath);
      const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
      console.log(`    → ${outPath} (${kb} KB)`);
    }

    return { imagePaths, imageSourceMap };
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stages/reel-stage4-images.ts
git commit -m "feat: build imageSourceMap in reel-stage4-images"
```

---

### Task 7: Persist `imageSourceMap` in reel-runner context blob

**Files:**
- Modify: `src/pipeline/reel-runner.ts`

- [ ] **Step 1: Find where context is serialized/deserialized**

```bash
grep -n "imageSourceMap\|context.*JSON\|JSON.*context\|imagePaths" src/pipeline/reel-runner.ts | head -30
```

- [ ] **Step 2: Include `imageSourceMap` in the context blob**

In `src/pipeline/reel-runner.ts`, find the section where `context` JSON is built for DB persistence (look for where `trendingSignals`, `themeSource`, `pillarBalance` are serialized). Add `imageSourceMap` to the same blob:

```ts
// When serializing context to DB (in updateReel call after stage 4):
context: JSON.stringify({
  themeSource: ctx.themeSource,
  pillarBalance: ctx.pillarBalance,
  trendingSignals: ctx.trendingSignals,
  categorySource: ctx.categorySource,
  discoveryBias: ctx.discoveryBias,
  recentTopics: ctx.recentTopics,
  imageSourceMap: ctx.imageSourceMap,   // ← add this
}),
```

And when deserializing context back (look for where `context` JSON is parsed to restore `themeSource` etc.):

```ts
// When parsing context from DB row:
if (row.context) {
  const c = JSON.parse(row.context);
  ctx.themeSource     = c.themeSource;
  ctx.pillarBalance   = c.pillarBalance;
  ctx.trendingSignals = c.trendingSignals;
  ctx.categorySource  = c.categorySource;
  ctx.discoveryBias   = c.discoveryBias;
  ctx.recentTopics    = c.recentTopics;
  ctx.imageSourceMap  = c.imageSourceMap;   // ← add this
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/reel-runner.ts
git commit -m "feat: persist imageSourceMap in reel context blob"
```

---

### Task 8: Add image source badge to post review HTML

**Files:**
- Modify: `src/review/html-builder.ts`

- [ ] **Step 1: Add a helper function for the badge**

In `src/review/html-builder.ts`, add before `buildPostCard`:

```ts
function imageSourceBadge(source: import("../types.js").ImageSource | undefined): string {
  if (!source) return "";
  if (source.type === "stock") {
    const label = source.provider.charAt(0).toUpperCase() + source.provider.slice(1);
    return `<span class="badge verified">📷 ${label}</span>`;
  }
  if (source.type === "ai") {
    return `<span class="badge unverified">🤖 ${escapeHtml(source.model)}</span>`;
  }
  return "";
}
```

- [ ] **Step 2: Render the badge in `buildPostCard`**

In `buildPostCard`, update the `imageSection` block. After the `<img>` or failed block, append the badge. Replace:

```ts
  const imageSection = post.imageFailed
    ? `<div class="image-failed">
        <span>⚠️ ${isThai ? "สร้างรูปภาพไม่สำเร็จ" : "Image generation failed"}</span>
        <small>${isThai ? `ใช้คำสั่ง: new image ${post.index + 1}` : `Use: new image ${post.index + 1}`}</small>
      </div>`
    : post.imagePath
    ? `<img src="${post.imagePath}" alt="Post ${post.index + 1}">`
    : `<div class="image-failed"><span>${isThai ? "ยังไม่มีรูปภาพ" : "No image yet"}</span></div>`;
```

With:

```ts
  const sourceBadge = imageSourceBadge(post.imageSource);
  const imageSection = post.imageFailed
    ? `<div class="image-failed">
        <span>⚠️ ${isThai ? "สร้างรูปภาพไม่สำเร็จ" : "Image generation failed"}</span>
        <small>${isThai ? `ใช้คำสั่ง: new image ${post.index + 1}` : `Use: new image ${post.index + 1}`}</small>
      </div>`
    : post.imagePath
    ? `<img src="${post.imagePath}" alt="Post ${post.index + 1}">`
    : `<div class="image-failed"><span>${isThai ? "ยังไม่มีรูปภาพ" : "No image yet"}</span></div>`;
```

And in the returned card HTML, add `${sourceBadge}` on the line after `${imageSection}` and before `<div class="card-body">`:

```ts
  return `<div class="card">
  ${imageSection}
  ${sourceBadge ? `<div style="padding:6px 16px 0;">${sourceBadge}</div>` : ""}
  <div class="card-body">
    ...
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/review/html-builder.ts
git commit -m "feat: show image source badge in post review HTML"
```

---

### Task 9: Add image source badge to reel review HTML

**Files:**
- Modify: `src/review/reel-html-builder.ts`

- [ ] **Step 1: Add the badge helper and wire it into scene header**

In `src/review/reel-html-builder.ts`, in the `scenesHtml` map (around line 70), find the scene header template:

```ts
      <div class="scene-header">
        <span class="scene-num">${isThai ? "ฉาก" : "Scene"} ${scene.sceneNumber}</span>
        <span class="scene-dur">2s + ${audioDur.toFixed(1)}s = ${totalDur.toFixed(1)}s</span>
      </div>
```

Replace with:

```ts
      <div class="scene-header">
        <span class="scene-num">${isThai ? "ฉาก" : "Scene"} ${scene.sceneNumber}${buildSceneSourceBadge(ctx.imageSourceMap?.[scene.sceneNumber])}</span>
        <span class="scene-dur">2s + ${audioDur.toFixed(1)}s = ${totalDur.toFixed(1)}s</span>
      </div>
```

Add the helper function at the bottom of the file (before the closing):

```ts
function buildSceneSourceBadge(source: import("../types.js").ImageSource | undefined): string {
  if (!source) return "";
  if (source.type === "stock") {
    const label = source.provider.charAt(0).toUpperCase() + source.provider.slice(1);
    return ` <span style="font-size:10px;font-weight:400;color:#5b9dd9;margin-left:6px;">📷 ${label}</span>`;
  }
  if (source.type === "ai") {
    return ` <span style="font-size:10px;font-weight:400;color:#888;margin-left:6px;">🤖 ${escapeHtml(source.model)}</span>`;
  }
  return "";
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: same pass/fail count as baseline (9 failed / 8 passed — all pre-existing failures).

- [ ] **Step 4: Commit**

```bash
git add src/review/reel-html-builder.ts
git commit -m "feat: show image source badge in reel review HTML scene headers"
```

---

### Task 10: Final build and orphan check

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1
```

Expected: clean — no errors.

- [ ] **Step 2: Full test suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `9 failed | 10 passed` (2 new passing tests from Tasks 2 and 5, baseline failures unchanged).

- [ ] **Step 3: Check no old `Buffer | null` callers remain**

```bash
rg "stockBuffer\b" src/ bin/ test/ 2>/dev/null
```

Expected: no results.

- [ ] **Step 4: Final commit if anything unstaged**

```bash
git status
```

If clean, done. If not:

```bash
git add -A && git commit -m "chore: final cleanup for image source tracking"
```
