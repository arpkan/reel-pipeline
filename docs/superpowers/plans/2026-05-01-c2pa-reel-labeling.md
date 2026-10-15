# C2PA Reel Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed C2PA "Made with AI" metadata into reel videos so Meta platforms auto-label them.

**Architecture:** After ffmpeg/Hyperframes assembly produces `reel.mp4`, read the C2PA manifest from Imagen-generated scene images (which already carry Google-signed `trainedAlgorithmicMedia` assertions). Build a new manifest referencing those images as ingredients, sign it with a self-signed ES256 key, and embed into the MP4 before GCS upload.

**Tech Stack:** `@contentauth/c2pa-node` (already installed as devDependency — move to dependencies), ES256 self-signed cert, `Reader` + `Builder` + `LocalSigner` from c2pa-node.

---

### Task 1: Create C2paSigner Service

**Files:**
- Create: `src/services/c2pa-signer.ts`
- Test: `tests/c2pa-signer.test.ts`

- [ ] **Step 1: Write the test for C2paSigner**

Create `tests/c2pa-signer.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";

describe("C2paSigner", () => {
  it("should export a class with a signReel method", async () => {
    const { C2paSigner } = await import("../src/services/c2pa-signer.js");
    const signer = new C2paSigner();
    expect(typeof signer.signReel).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/c2pa-signer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/services/c2pa-signer.ts`**

```typescript
import fs from "fs";
import { Reader, Builder, LocalSigner } from "@contentauth/c2pa-node";
import type { ImageSource } from "../types.js";

interface SceneImage {
  path: string;
  sceneNumber: number;
  source: ImageSource;
}

export class C2paSigner {
  private signer: InstanceType<typeof LocalSigner> | null = null;

  private getSigner(): InstanceType<typeof LocalSigner> {
    if (this.signer) return this.signer;
    const certPath = process.env.C2PA_SIGN_CERT;
    const keyPath = process.env.C2PA_SIGN_KEY;
    if (!certPath || !keyPath) {
      throw new Error("C2PA_SIGN_CERT and C2PA_SIGN_KEY env vars must be set");
    }
    this.signer = LocalSigner.newSigner(
      fs.readFileSync(certPath),
      fs.readFileSync(keyPath),
      "es256",
    );
    return this.signer;
  }

  async signReel(
    videoBuffer: Buffer,
    sceneImages: SceneImage[],
  ): Promise<Buffer> {
    const aiScenes = sceneImages.filter((s) => s.source.type === "ai");
    if (aiScenes.length === 0) {
      return videoBuffer;
    }

    const signer = this.getSigner();
    const builder = Builder.new();

    for (const scene of aiScenes) {
      const imgBuf = fs.readFileSync(scene.path);
      const mimeType = detectImageMime(imgBuf);
      try {
        const reader = await Reader.fromAsset({ buffer: imgBuf, mimeType });
        builder.addIngredientFromReader(reader);
      } catch (err) {
        console.warn(
          `  [c2pa] Could not read C2PA from scene ${scene.sceneNumber}: ${(err as Error).message}`,
        );
      }
    }

    builder.addAction(
      JSON.stringify({
        action: "c2pa.composed",
        description: "Assembled video from AI-generated images and voiceover",
        digitalSourceType:
          "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
      }),
    );

    const dest: { buffer: Buffer | null } = { buffer: null };
    builder.sign(
      signer,
      { buffer: videoBuffer, mimeType: "video/mp4" },
      dest,
    );

    if (!dest.buffer) {
      throw new Error("C2PA signing produced no output");
    }

    return dest.buffer;
  }
}

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/jpeg";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/c2pa-signer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/c2pa-signer.ts tests/c2pa-signer.test.ts
git commit -m "feat: add C2paSigner service for embedding C2PA manifests into videos"
```

---

### Task 2: Move `@contentauth/c2pa-node` to dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Move the dependency**

In `package.json`, move `"@contentauth/c2pa-node"` from `devDependencies` to `dependencies` (same version). Run:

```bash
npm install @contentauth/c2pa-node --save
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: move @contentauth/c2pa-node to production dependencies"
```

---

### Task 3: Integrate C2PA signing into FFmpeg renderer

**Files:**
- Modify: `src/stages/reel-stage5-assemble.ts` (lines ~344-356)

- [ ] **Step 1: Add C2PA signing after music mix, before GCS upload**

In `src/stages/reel-stage5-assemble.ts`, add the import at the top (after existing imports):

```typescript
import { C2paSigner } from "../services/c2pa-signer.js";
```

Then, between the music mix block (ending at line 344 with `}`) and the `outputBytes` line (line 346), insert the C2PA signing:

After `}` (closing the music block, line 344), before `const outputBytes`, add:

```typescript
    let videoBuffer = fs.readFileSync(videoPath);
    if (ctx.imageSourceMap) {
      try {
        const c2pa = new C2paSigner();
        const sceneImages = ctx.script.scenes.map((scene) => ({
          path: ctx.imagePaths![scene.sceneNumber - 1],
          sceneNumber: scene.sceneNumber,
          source: ctx.imageSourceMap[scene.sceneNumber] ?? { type: "failed" as const },
        }));
        const signed = await c2pa.signReel(videoBuffer, sceneImages);
        if (signed !== videoBuffer) {
          fs.writeFileSync(videoPath, signed);
          videoBuffer = signed;
          console.log(`  C2PA manifest embedded (${aiSceneCount(ctx.imageSourceMap)} AI scenes)`);
        }
      } catch (err) {
        console.warn(`  ⚠️ C2PA signing failed (video still valid): ${(err as Error).message}`);
      }
    }
```

Also add this helper at the bottom of the file (before the closing of the class or after it):

```typescript
function aiSceneCount(imageSourceMap: Record<number, ImageSource>): number {
  return Object.values(imageSourceMap).filter((s) => s.type === "ai").length;
}
```

And update `outputBytes` to use `videoBuffer` instead of `fs.statSync`:

Change:
```typescript
    const outputBytes = fs.statSync(videoPath).size;
```
To:
```typescript
    const outputBytes = videoBuffer.length;
```

Also add the `ImageSource` type to the existing import from `../types.js`:

```typescript
import type { ReelContext, ReelStage, Stage5RenderTelemetry, ImageSource } from "../types.js";
```

And update the GCS upload line to use `videoBuffer` instead of `fs.readFileSync`:

Change:
```typescript
    const videoGcsUrl = await gcs.uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", fs.readFileSync(videoPath));
```
To:
```typescript
    const videoGcsUrl = await gcs.uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", videoBuffer);
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Clean compilation, no errors

- [ ] **Step 3: Run existing stage5 tests to confirm no regressions**

Run: `npx vitest run tests/reel-stage5-assemble-telemetry.test.ts tests/reel-stage5-renderer.test.ts tests/reel-assembly-worker.test.ts`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/stages/reel-stage5-assemble.ts
git commit -m "feat: integrate C2PA signing into FFmpeg reel renderer"
```

---

### Task 4: Integrate C2PA signing into Hyperframes renderer

**Files:**
- Modify: `src/stages/reel-stage5-hyperframes-renderer.ts` (lines ~100-101)

- [ ] **Step 1: Add C2PA signing before GCS upload**

In `src/stages/reel-stage5-hyperframes-renderer.ts`, add the import at the top:

```typescript
import { C2paSigner } from "../services/c2pa-signer.js";
```

Then, between line 100 (`const videoBuffer = fs.readFileSync(videoPath);`) and line 101 (`const videoGcsUrl = ...`), insert:

```typescript
    let uploadBuffer = videoBuffer;
    if (ctx.imageSourceMap) {
      try {
        const c2pa = new C2paSigner();
        const sceneImages = ctx.script.scenes.map((scene) => ({
          path: ctx.imagePaths![scene.sceneNumber - 1],
          sceneNumber: scene.sceneNumber,
          source: ctx.imageSourceMap[scene.sceneNumber] ?? { type: "failed" as const },
        }));
        const signed = await c2pa.signReel(videoBuffer, sceneImages);
        if (signed !== videoBuffer) {
          uploadBuffer = signed;
          const aiCount = Object.values(ctx.imageSourceMap).filter((s) => s.type === "ai").length;
          console.log(`  C2PA manifest embedded (${aiCount} AI scenes)`);
        }
      } catch (err) {
        console.warn(`  ⚠️ C2PA signing failed (video still valid): ${(err as Error).message}`);
      }
    }
```

And change line 101 from `videoBuffer` to `uploadBuffer`:

```typescript
    const videoGcsUrl = await createGcsService().uploadVideo(ctx.brand.gcsPrefix, ctx.runId, "reel.mp4", uploadBuffer);
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Run existing hyperframes tests**

Run: `npx vitest run tests/reel-stage5-hyperframes-renderer.test.ts`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/stages/reel-stage5-hyperframes-renderer.ts
git commit -m "feat: integrate C2PA signing into Hyperframes reel renderer"
```

---

### Task 5: Generate signing key pair and add env config

**Files:**
- Create: `keys/c2pa-cert.pem`
- Create: `keys/c2pa-key.pem`
- Modify: `.env.example`

- [ ] **Step 1: Generate ES256 key pair**

```bash
mkdir -p keys
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout keys/c2pa-key.pem -x509 -out keys/c2pa-cert.pem -days 3650 -nodes -subj "/CN=content-pipeline"
```

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:

```
# C2PA signing (self-signed ES256 for embedding Google Imagen provenance into reels)
C2PA_SIGN_CERT=./keys/c2pa-cert.pem
C2PA_SIGN_KEY=./keys/c2pa-key.pem
```

- [ ] **Step 3: Add keys directory to `.gitignore`**

Ensure `keys/` is in `.gitignore` (private keys should not be committed).

- [ ] **Step 4: Commit**

```bash
git add .env.example .gitignore
git commit -m "feat: add C2PA signing key config and env vars"
```

---

### Task 6: Clean up test script

**Files:**
- Modify: `scripts/test-imagen-c2pa.ts`

- [ ] **Step 1: Rewrite as a proper standalone verification script**

Replace `scripts/test-imagen-c2pa.ts` with a clean version that generates an image, builds a video, signs it, and verifies the manifest:

```typescript
import "dotenv/config";
import { Reader, Builder, LocalSigner } from "@contentauth/c2pa-node";
import fs from "fs";
import { execSync } from "child_process";
import { GoogleGenAI } from "@google/genai";

async function main() {
  const apiKey = process.env.GEMINI_IMAGE_API_KEY;
  if (!apiKey) { console.error("GEMINI_IMAGE_API_KEY not set"); process.exit(1); }
  if (!process.env.C2PA_SIGN_CERT || !process.env.C2PA_SIGN_KEY) {
    console.error("C2PA_SIGN_CERT and C2PA_SIGN_KEY not set"); process.exit(1);
  }

  console.log("1. Generating Imagen image...");
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: "Generate a simple photo of a sunset over mountains",
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: "1K", aspectRatio: "1:1" },
    },
  });
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) { console.error("No image in response"); process.exit(1); }
  const imgBuf = Buffer.from(part.inlineData.data, "base64");
  fs.writeFileSync("/tmp/test-c2pa-image.jpg", imgBuf);
  console.log(`   Image: ${imgBuf.length} bytes`);

  console.log("2. Reading C2PA manifest from image...");
  const reader = await Reader.fromAsset({ buffer: imgBuf, mimeType: "image/jpeg" });
  console.log(`   Active label: ${reader.activeLabel()}`);

  console.log("3. Building test video...");
  execSync(
    `ffmpeg -y -loop 1 -i /tmp/test-c2pa-image.jpg -t 2 -vf "scale=512:512" ` +
    `-c:v libx264 -pix_fmt yuv420p /tmp/test-c2pa-video.mp4 2>/dev/null`,
  );
  const videoBuf = fs.readFileSync("/tmp/test-c2pa-video.mp4");
  console.log(`   Video: ${videoBuf.length} bytes`);

  console.log("4. Signing video...");
  const signer = LocalSigner.newSigner(
    fs.readFileSync(process.env.C2PA_SIGN_CERT),
    fs.readFileSync(process.env.C2PA_SIGN_KEY),
    "es256",
  );
  const builder = Builder.new();
  builder.addIngredient(
    JSON.stringify({ title: "AI scene", relationship: "componentOf", format: "image/jpeg" }),
    { buffer: imgBuf, mimeType: "image/jpeg" },
  );
  builder.addAction(JSON.stringify({
    action: "c2pa.composed",
    description: "Assembled video from AI-generated images",
    digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  }));
  const dest: { buffer: Buffer | null } = { buffer: null };
  builder.sign(signer, { buffer: videoBuf, mimeType: "video/mp4" }, dest);
  if (!dest.buffer) { console.error("Signing failed"); process.exit(1); }
  fs.writeFileSync("/tmp/test-c2pa-signed.mp4", dest.buffer);
  console.log(`   Signed video: ${dest.buffer.length} bytes`);

  console.log("5. Verifying...");
  const verifyReader = await Reader.fromAsset({ buffer: dest.buffer, mimeType: "video/mp4" });
  const json = verifyReader.json();
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const manifests = JSON.parse(str).manifests;
  const urns = Object.keys(manifests);
  console.log(`   ${urns.length} manifests found:`);
  for (const urn of urns) {
    const m = manifests[urn];
    const issuer = m.signature_info?.issuer ?? "unknown";
    const actions = m.assertions?.find((a: any) => a.label?.includes("actions"))?.data?.actions ?? [];
    console.log(`   - ${issuer}: ${actions.map((a: any) => a.action).join(", ")}`);
  }
  console.log("\n✅ C2PA signing verified successfully");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run the script end-to-end**

Run: `npx tsx scripts/test-imagen-c2pa.ts`
Expected: Script completes with "✅ C2PA signing verified successfully" and shows Google LLC as an ingredient issuer

- [ ] **Step 3: Commit**

```bash
git add scripts/test-imagen-c2pa.ts
git commit -m "feat: add C2PA end-to-end verification test script"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 3: Verify linter passes**

Run: `npx tsc --noEmit` (or project's typecheck command if available)
Expected: No type errors
