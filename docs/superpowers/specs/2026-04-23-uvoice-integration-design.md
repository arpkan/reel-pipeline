# uvoice Integration Design

**Date:** 2026-04-23  
**Status:** Approved

## Overview

Add uvoice (https://uvoice.app) as a second TTS provider alongside ElevenLabs. Both providers are available in the brand voice pool; the pipeline picks a voice randomly per reel run and dispatches to the correct provider. If the selected provider fails, it retries with a voice from the other provider. Word-level timestamps (required for caption sync) are obtained from ElevenLabs natively; for uvoice, a local `whisper-timestamped` subprocess provides them.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/services/voice-provider.ts` | `VoiceProvider` interface + `VoiceEntry` type |
| `src/services/uvoice.ts` | `UVoiceService` implementing `VoiceProvider` |
| `src/services/whisper.ts` | Subprocess wrapper for `whisper-timestamped` |

### Modified Files

| File | Change |
|------|--------|
| `src/services/elevenlabs.ts` | Implement `VoiceProvider` interface (no logic change) |
| `src/stages/reel-stage3-voice.ts` | Provider-aware dispatch + cross-provider fallback |
| `src/types.ts` | Add `VoiceEntry` to `ReelConfig` |
| `src/brands/ds.ts` | Add uvoice voice to `voices` pool |
| `src/brands/ns.ts` | Add uvoice voice to `voices` pool |
| `.env.example` | Add `UVOICE_API_KEY`, `ELEVENLABS_API_KEY`, `WHISPER_MODEL`, `DS_REEL_UVOICE_VOICE_ID`, `NS_REEL_UVOICE_VOICE_ID` |

---

## Types

### `src/services/voice-provider.ts`

```ts
import type { WordTiming } from "../types.js";

export type VoiceProviderName = "elevenlabs" | "uvoice";

export interface VoiceEntry {
  id: string;
  provider: VoiceProviderName;
  speed?: number; // atempo override for this specific voice
}

export interface VoiceProvider {
  textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
}
```

### `src/types.ts` — additions to `ReelConfig`

```ts
voices?: VoiceEntry[]; // new explicit provider-tagged pool
// existing voiceId / voiceIds / voiceSpeeds / voiceSpeed kept for backwards compatibility
```

---

## Services

### `src/services/uvoice.ts`

- Calls `POST https://api.uvoice.ai/generate`
- Request body: `{ settings: { voiceID, text, outputFormat: "mp3", autoBreak: false } }`
- Returns raw binary MP3 as a `Buffer`
- No speed parameter sent — speed adjustment handled downstream by existing `ffmpeg atempo` step
- After receiving audio, calls `WhisperService.transcribe(audioBuffer, language)` for word timings
- Throws a clear error if `UVOICE_API_KEY` is not set
- Factory: `createUVoiceService(): UVoiceService`

### `src/services/whisper.ts`

- Accepts `audio: Buffer` and `language: string`
- Writes buffer to a temp file (`os.tmpdir()`)
- Runs `python3 -c "import whisper_timestamped as whisper; ..."` via `spawnSync`
- Parses JSON output — `whisper_timestamped` returns segments with word-level `start`/`end` timestamps
- Cleans up temp file in a `finally` block
- Returns `WordTiming[]` in the same shape as the rest of the pipeline
- On failure (whisper not installed, subprocess timeout, parse error): falls back to even distribution of words across total audio duration
- Model: `process.env.WHISPER_MODEL ?? "tiny"`
- Timeout: 30 seconds per call

### `src/services/elevenlabs.ts`

- Add `implements VoiceProvider` to the class declaration
- No logic changes — existing `textToSpeechWithTimestamps` already matches the interface signature
- Thai word timing: continues to use `pythainlp` + ElevenLabs character alignment (unchanged)
- English word timing: continues to use ElevenLabs character alignment directly (unchanged)
- Whisper is **never used** for ElevenLabs voices

---

## Stage 3 — Voice Dispatch

### Voice Selection

```
if ctx.brand.reels.voices exists:
  pick randomly from voices[] → { id, provider, speed? }
else:
  build pool from voiceIds ?? [voiceId], treat all as provider: "elevenlabs"
  pick randomly, resolve speed from voiceSpeeds[id] ?? voiceSpeed ?? 1.2
```

### Provider Dispatch

```
instantiate correct service (ElevenLabsService | UVoiceService) based on entry.provider
call textToSpeechWithTimestamps(scene.voiceover, entry.id, languageCode)
```

### Fallback on Failure

```
on error from primary provider:
  collect voices from the other provider in the pool
  if any exist: retry once with a random voice from that set
  if none exist: rethrow original error
```

### Downstream (unchanged)

- Speed adjustment via `ffmpeg atempo` using `entry.speed ?? brand.voiceSpeed ?? 1.2`
- Word timing scaling proportional to atempo
- Duration measurement via `ffprobe`
- Output: `scene{N}.mp3` written to `ctx.workDir`

---

## Brand Configuration

### `src/brands/ds.ts`

```ts
voices: [
  { id: process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" },
  { id: "qWWAqFomnJ99VwQLREfT", provider: "elevenlabs", speed: 1.2 },
  { id: process.env.DS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" },
  // No speed override — inherits DS brand default (1.4x). Tune per-voice once audio is reviewed.
]
```

### `src/brands/ns.ts`

```ts
voices: [
  { id: process.env.NS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" },
  { id: process.env.NS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" },
  // No speed override — inherits NS brand default (1.2x). Tune per-voice once audio is reviewed.
]
```

---

## Environment Variables

### `.env.example` additions

```
# TTS Providers
UVOICE_API_KEY=              # required to use uvoice voices
ELEVENLABS_API_KEY=          # required to use ElevenLabs voices

# Whisper (word timing for uvoice)
WHISPER_MODEL=tiny           # optional: tiny, base, small, medium, large

# uvoice voice overrides
DS_REEL_UVOICE_VOICE_ID=     # optional, defaults to EN-ManaSD
NS_REEL_UVOICE_VOICE_ID=     # optional, defaults to EN-ManaSD
```

### Validation

- Neither `UVOICE_API_KEY` nor `ELEVENLABS_API_KEY` is added to startup hard validation — either may legitimately be absent if only one provider is in use
- Both services throw a descriptive error at the point of use if their key is missing

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| uvoice API key missing | Throw at service instantiation: `"UVOICE_API_KEY is not set"` |
| uvoice API returns 4xx/5xx | Throw with status + body; stage 3 attempts cross-provider fallback |
| ElevenLabs API fails | Stage 3 attempts cross-provider fallback to uvoice voices in pool |
| No fallback voices available | Rethrow original error; reel run fails and is marked stale by heartbeat |
| whisper not installed | Log warning; fall back to even word distribution across audio duration |
| whisper subprocess timeout (30s) | Log warning; fall back to even word distribution |

---

## Dependencies

- `whisper-timestamped` Python package — installed via `pip install whisper-timestamped`
- `openai-whisper` (pulled in by `whisper-timestamped`)
- No new Node.js npm packages required

---

## Out of Scope

- uvoice Thai voices (no Thai uvoice voice IDs provided yet; whisper supports Thai if needed later)
- uvoice `speed`, `pitch`, `volume`, `key` API parameters (not needed; speed handled by ffmpeg atempo)
- uvoice `outputType: "url"` mode (binary is simpler and faster)
- Adding a third TTS provider
