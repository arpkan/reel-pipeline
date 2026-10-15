# C2PA "Made with AI" Labeling for Reel Videos

## Problem

Reel videos are assembled from AI-generated content (Imagen images + TTS voiceover + AI script) but the final MP4 carries no C2PA metadata. Meta platforms use C2PA provenance signals to automatically apply "Made with AI" / "AI info" labels. Without these signals, our published reels lack AI transparency labels.

## Discovery

Google Imagen images **ship with production C2PA manifests** signed by Google's trusted CA (`Google C2PA Root CA G3`). Each image contains:
- `c2pa.created` action: "Created by Google Generative AI"
- `digitalSourceType`: `trainedAlgorithmicMedia`
- SynthID watermark assertion
- Valid signature chain to Google's trusted root

This means we **do not need to purchase our own C2PA certificate**. We carry Google's trusted manifest into the video as an ingredient, creating a provenance chain Meta can validate.

## Approach

After ffmpeg assembly produces `reel.mp4`, read the C2PA manifest from one or more Imagen scene images and embed them as ingredients in a new manifest signed into the MP4.

### Stock Image Handling

The pipeline tracks `imageSourceMap` per scene. Only scenes using Imagen (native) images have C2PA metadata. Stock images (Unsplash/Pexels/Pixabay) are real photographs without C2PA manifests.

**Rule: Only embed C2PA when at least one scene image is from Imagen.** All-stock reels skip C2PA entirely.

When mixing stock + Imagen images:
- Imagen images are added as C2PA ingredients (carrying Google's trusted manifest)
- Stock images are added as regular ingredients (no manifest chain)
- The video's own action is `c2pa.composed` with `trainedAlgorithmicMedia`

### Signing

Use `@contentauth/c2pa-node` library with a self-signed ES256 key pair. The top-level manifest signature may be untrusted (self-signed), but the **ingredient manifest is signed by Google's trusted CA** — that's what Meta's validation relies on.

Key pair stored as PEM files referenced by env vars:
- `C2PA_SIGN_CERT` — path to the signing certificate PEM
- `C2PA_SIGN_KEY` — path to the private key PEM

Generate with: `openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout c2pa-key.pem -x509 -out c2pa-cert.pem -days 3650 -nodes -subj "/CN=content-pipeline"`

## Architecture

```
reel-stage5-assemble.ts (or hyperframes renderer)
  ↓  ffmpeg produces reel.mp4
  ↓
c2pa-signer.ts
  1. Check imageSourceMap for any Imagen scenes
  2. If none → return original buffer, skip C2PA
  3. Read C2PA from first Imagen scene image
  4. Build manifest: add Imagen image as ingredient, c2pa.composed action
  5. Sign with LocalSigner (ES256, self-signed key pair)
  6. Return signed MP4 buffer
  ↓
GCS upload (signed buffer replaces original)
```

## Files

| File | Change |
|------|--------|
| `src/services/c2pa-signer.ts` | **New** — C2paSigner class wrapping Reader + Builder + LocalSigner |
| `src/stages/reel-stage5-assemble.ts` | Call signer after ffmpeg concat/music, before GCS upload |
| `src/stages/reel-stage5-hyperframes-renderer.ts` | Same integration point |
| `src/workers/reel-assembly-worker.ts` | Same for offload worker |
| `package.json` | Add `@contentauth/c2pa-node` |
| `.env.example` | Add `C2PA_SIGN_CERT`, `C2PA_SIGN_KEY` |

## C2paSigner Service API

```typescript
class C2paSigner {
  constructor(certPath: string, keyPath: string);

  // Embed C2PA manifest into an MP4 buffer using Imagen scene images as ingredients
  // Returns the original buffer unchanged if no Imagen images are present
  signReel(
    videoBuffer: Buffer,
    sceneImages: Array<{ buffer: Buffer; source: string; mimeType: string }>
  ): Promise<Buffer>;
}
```

- `sceneImages[].source` matches the existing `imageSourceMap` values ("native" for Imagen, "unsplash"/"pexels"/"pixabay" for stock)
- Only images with `source === "native"` are used as C2PA ingredients
- The first Imagen image provides the ingredient manifest; additional Imagen images are also added

## Out of Scope

- Post images (single-image posts): these go to Meta as JPEG with Google's C2PA already intact — ffmpeg is not involved
- TikTok publishing: no C2PA support
- Buying a production C2PA signing certificate

## Verification

After implementation, verify by:
1. Run `scripts/test-imagen-c2pa.ts` to confirm end-to-end signing works
2. Upload a signed video to Meta and check if "AI info" label appears
3. Use `Reader.fromAsset()` on the signed MP4 to inspect the manifest chain
