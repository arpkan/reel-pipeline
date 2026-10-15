# Botnoi Voice Provider for DS

**Date:** 2026-04-29
**Goal:** Add Botnoi (Thai TTS) as a fourth voice provider, available **only in the DS brand pool**, with voice ID `5` and atempo speed `1.1`.

---

## Why

DS currently has `elevenlabs + uvoice` in its pool. ElevenLabs is quota-exhausted; uvoice has been the silent fallback (also Thai). Botnoi gives DS a third Thai option and reduces the chance that both providers fail simultaneously.

---

## API confirmed (live probe)

- **Endpoint:** `POST https://api-voice.botnoi.ai/openapi/v1/generate_audio`
- **Auth header:** `Botnoi-Token: <api key>`
- **Body (JSON):**
  ```json
  {
    "text": "สวัสดีครับ",
    "speaker": "5",
    "volume": 1,
    "speed": 1,
    "type_media": "mp3",
    "save_file": "false",
    "language": "th"
  }
  ```
- **Response (JSON):**
  ```json
  {
    "text": "...",
    "audio_url": "https://botnoi-dictionary.s3.amazonaws.com/<hash>_<timestamp>.mp3",
    "point": 1990,
    "user_monthly_point": 0
  }
  ```
- **Rate limit:** 300 req/min (per response headers).

The response is a URL — we have to download the MP3 in a second request. No word timings are returned, so we'll use the existing Whisper transcription path (same as uvoice).

---

## Files to change

### 1. New file: `src/services/botnoi.ts`

Mirrors `uvoice.ts`. Implements `VoiceProvider`:

- Constructor takes API key + optional Whisper service.
- `textToSpeechWithTimestamps(text, voiceId, language)`:
  1. POST to `https://api-voice.botnoi.ai/openapi/v1/generate_audio` with the body above. `language` param is mapped (`"th"` → `"th"`, `"en"` → `"en"`).
  2. Parse JSON, read `audio_url`.
  3. GET `audio_url`, return MP3 buffer.
  4. Whisper-transcribe the buffer for word timings.
- Throws `Botnoi API error <status>: <body>` on non-200 from the generate endpoint.
- Throws `Botnoi audio download failed <status>` if the `audio_url` GET fails.
- Throws `Botnoi: missing audio_url in response` if the JSON has no `audio_url`.
- `createBotnoiService()` reads `process.env.BOTNOI_API_KEY` and throws if unset.

### 2. `src/services/voice-provider.ts`

Add `"botnoi"` to the union:
```ts
export type VoiceProviderName = "elevenlabs" | "uvoice" | "minimax" | "botnoi";
```

### 3. `src/stages/reel-stage3-voice.ts`

In `createProvider()`:
```ts
if (entry.provider === "botnoi") return createBotnoiService();
```
Plus the import.

### 4. `src/brands/ds.ts`

Add the Botnoi entry to **both** `voices` and `voicesFull` pools, with `speed: 1.1` (existing per-voice atempo field, applied via ffmpeg post-process — same convention as the other voices). Botnoi-side `speed` parameter stays at `1`.

```ts
voices: resolveVoicePool(process.env.DS_VOICE_OVERRIDE, [
  { id: process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
  { id: "qWWAqFomnJ99VwQLREfT", provider: "elevenlabs" as const, speed: 1.2 },
  { id: "TH-ThaptimSD", provider: "uvoice" as const, speed: 1.2 },
  { id: "5", provider: "botnoi" as const, speed: 1.1 },
] satisfies VoiceEntry[]),
voicesFull: [
  { id: process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
  { id: "qWWAqFomnJ99VwQLREfT", provider: "elevenlabs" as const, speed: 1.2 },
  { id: "TH-ThaptimSD", provider: "uvoice" as const, speed: 1.2 },
  { id: "5", provider: "botnoi" as const, speed: 1.1 },
] satisfies VoiceEntry[],
```

NS pool is **not** touched — Botnoi is DS-only as requested.

### 5. `.env.example`

Add a new section after the Minimax one:
```
# TTS — Botnoi (https://voice.botnoi.ai/developer/api) — Thai voices, used by DS
BOTNOI_API_KEY=
```

### 6. `.env` (local only, not committed)

Set:
```
BOTNOI_API_KEY=<your-value>
```

(Will be added with the Edit tool, separately from the git commit. The repo `.env` is gitignored, the example file does not contain the key.)

---

## Tests

Existing `tests/reel-stage3-voice.test.ts` covers provider dispatch generically. No new test needed for the Botnoi service itself (consistent with `uvoice.ts` and `minimax.ts`, which have no per-provider unit tests).

---

## Build & Deploy

```bash
npm run build
pm2 restart pipeline
```

## Verification

- Trigger a DS reel (`!reel` for DS). Logs should show one of:
  - `Voice: 5 (provider: botnoi, lang: th)` followed by normal scene completion.
  - On failure: `⚠️ botnoi failed (...) — falling back to <other provider> ...` (using the cross-provider fallback we just shipped).
- Audio plays back at slightly faster than natural (atempo 1.1).
- `point` field in Botnoi response is informational — ignored by us.

---

## Out of scope

- No retry inside the Botnoi service itself — fallback already covers transient failures.
- No `speed` parameter passed through to Botnoi (we use ffmpeg atempo for consistency with other providers). Can revisit if natural-sounding speed varies materially between Botnoi's native speed and ffmpeg atempo.
- No NS pool change.
