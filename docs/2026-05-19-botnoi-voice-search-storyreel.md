# Botnoi Voice Auto-Selection for Thai in Storyreel

## Goal

When `--voice-provider botnoi` is passed to storyreel without `--voice-id`, automatically select the best Botnoi voice using `GET /openapi/v1/get_speaker_data` instead of requiring the user to know voice IDs.

Botnoi is only used when language is Thai (`th`). All other languages continue to use ElevenLabs shared voice search.

## Changes

### `src/services/botnoi.ts`

Add two exports:

1. `BotnoiSpeaker` interface matching the API response shape:
   - `speaker_id`, `eng_name`, `thai_name`, `eng_speech_style`, `eng_gender`, `eng_speed`, `available_language`, `language`, `audio`, `price`

2. `fetchBotnoiSpeakers(): Promise<BotnoiSpeaker[]>` — calls `GET https://api-voice.botnoi.ai/openapi/v1/get_speaker_data` with `Botnoi-Token` header, returns array.

3. `selectBotnoiVoice(direction: StoryReelVoiceDirection): Promise<SelectedSharedVoice & { provider: "botnoi" }>` — filters speakers by:
   - `available_language` includes `"th"` (language is always Thai for Botnoi)
   - `eng_speech_style` includes `"News Reading"` or `"Narrating"` (preferred), fallback to any speaker if none match
   - `eng_gender` preference from `direction.gender` if set
   - Pick first match; return result shaped as `SelectedSharedVoice` so it fits the existing pipeline

### `src/storyreel/audio-rough-cut-poc.ts`

In `runStoryReelAudioRoughCutPoc`, update voice selection logic:

```
if botnoi provider AND no voiceId:
  → call selectBotnoiVoice(direction.voice_direction)
elif botnoi provider AND voiceId provided:
  → selectedVoiceFromId(voiceId, "botnoi")  ← unchanged
elif elevenlabs AND voiceId provided:
  → selectedVoiceFromId(voiceId, "elevenlabs")  ← unchanged
else (elevenlabs, no voiceId):
  → selectSharedVoice(direction.voice_direction)  ← unchanged
```

## Behaviour

| Invocation | Voice selection |
|---|---|
| `--voice-provider botnoi` (no `--voice-id`) | Auto-select from `get_speaker_data` → fallback to ElevenLabs if Botnoi fails |
| `--voice-provider botnoi --voice-id 27` | Use voice 27 directly (unchanged) |
| `--voice-provider elevenlabs` or no flag | ElevenLabs shared voice search (unchanged) |

## No schema changes, no new dependencies
