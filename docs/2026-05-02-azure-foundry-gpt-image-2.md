# Azure AI Foundry — GPT-Image-2 integration

## Goal

Add `gpt-image-2` via Azure AI Foundry as a second AI image provider alongside Gemini, selectable per brand.

## Architecture

### New file: `src/services/azure-image-gen.ts`

Wraps the Azure OpenAI image generation API (`gpt-image-2`). Plain fetch — no SDK. Returns `Buffer` and source metadata, same shape as Gemini's `generate()`.

```
POST https://your-resource.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2025-04-01-preview
Headers: api-key: <AZURE_FOUNDRY_API_KEY>
Body: { prompt, n: 1, size: "1024x1792", quality: "high", output_format: "png" }
Response: { data: [{ b64_json: "..." }] }
```

### Updated: `reel-stage4-images.ts`

`buildImageProvider()` selects provider via `IMAGE_PROVIDER` env var (local type, no shared interface file needed):
- `"gemini"` (default) — existing Gemini service
- `"azure"` — new Azure GPT-Image-2 service
- `"azure+gemini"` — Azure primary, Gemini fallback on error

### New env vars

```
IMAGE_PROVIDER=gemini         # or azure, or azure+gemini (default: gemini)
AZURE_FOUNDRY_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_FOUNDRY_API_KEY=<key>
AZURE_FOUNDRY_DEPLOYMENT=gpt-image-2
AZURE_FOUNDRY_API_VERSION=2025-04-01-preview
```

### Image size

GPT-Image-2 portrait: `1024x1792` (closest to 9:16). The existing landscape-crop guard in stage4 already handles any orientation mismatch.

## Files changed

- `src/services/azure-image-gen.ts` — new Azure provider (plain fetch, no SDK)
- `src/stages/reel-stage4-images.ts` — `buildImageProvider()` with `IMAGE_PROVIDER` selection
- `src/types.ts` — added `"azure"` to `ApiProvider` union
