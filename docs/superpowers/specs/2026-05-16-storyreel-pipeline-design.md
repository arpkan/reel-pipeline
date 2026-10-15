# StoryReel Pipeline Design

## Goal

Promote the proven StoryReel POC into a production pipeline that lets multiple users create short-form personal videos from raw clips via Telegram. Users upload clips to a Telegram channel, Gemini directs the story, ElevenLabs generates a voiceover, FFmpeg + Hyperframes assemble the rough cut, and the final video is delivered back to the channel with a GCS download link.

StoryReel is a **personal video pipeline** — not limited to lifestyle. It supports all six content styles: informative, storytelling, tutorial, review, conversational, and lifestyle.

---

## Reference: Enumerations

**`inferred_voice_style`** — delivery mode (how the story is told; used for voice pool filtering):
`informative` | `storytelling` | `tutorial` | `review` | `conversational` | `lifestyle`

**`inferred_content_type`** — content shape (what kind of story is being told):
`lifestyle` | `tutorial` | `review` | `travel` | `food` | `story` | `opinion` | `other`

Both are **fields in Gemini's director output schema** — the prompt instructs Gemini to classify and return them as part of the direction JSON. Stored in `story_runs.directionJson` automatically. No extra columns, no separate logging step. Both are inferred from clips — not asked of the user. The two axes are independent: a tutorial can be delivered conversationally; a lifestyle moment can be storytelling.

**`inferred_voice_style` drives behavior** (voice pool filtering in stage 2) AND is logged. It is not purely observational.

**`inferred_content_type` is Phase 1 logged data only — must not drive any pipeline behavior.**

The reason this asymmetry matters: if `inferred_content_type` drove defaults from day one, the data would be tautological — Gemini's classification would produce reels matching your defaults table, and you'd have no way to tell whether those defaults were good. You'd be observing a system confirming its own priors, not revealing ground truth.

After ~30 runs, query `directionJson` using SQLite `json_extract(directionJson, '$.inferred_content_type')` to analyse: avg duration Gemini chose per content type, most common music genre per type, publishable rate per type. That observed data becomes a real defaults table for Phase 2 — one you earned rather than guessed. Phase 2 can then decide whether to codify observed defaults into driven behavior, or conclude the within-category variance is too high to defaults-drive.

**Music genres** (from `music_direction.genre` in director output — maps to library folder):
`upbeat` | `calm` | `neutral` | `playful` | `dramatic` | `inspirational`

**Music energy:** `low` | `medium` | `high`

**Music tempo:** `slow` | `medium` | `fast`

**Audience languages:** `thai` | `english` | `german`

**Voice providers:** `elevenlabs` | `botnoi`

---

## Key Decisions

| Question | Decision |
|---|---|
| Where does this live? | Third pipeline type in content-pipeline (alongside post and reel) |
| How do users submit clips? | Telegram channel — one channel = one profile |
| Multi-user model | Each channel is independently configured; multiple users = multiple channels |
| User registration | None — profile is channel-level, set up via `!setup` wizard |
| Clip order | Any order — Gemini decides narrative sequence from content |
| File limits | 5 clips max / 50MB per clip / 3 min per clip |
| Music | Auto-selected from library by director's genre output; user can override with `!music` |
| Post-delivery | GCS link + inline thumbnail + `!tweak <note>` for regeneration |
| Concurrent runs | 1 per channel — bot blocks with friendly message if already running |
| Social publishing | Deferred — no Facebook/TikTok in Phase 1 |

---

## Channel = Profile Model

Every Telegram channel the bot is added to maps to exactly one profile. The profile must be created via `!setup` before the bot accepts any clips.

**Profile fields:** profile name, audience language (thai / english / german), audience description.

**First-time flow:**
1. Bot added to channel → detects no profile
2. Bot replies: "Welcome! This channel has no profile yet. Run !setup to configure it before sending clips."
3. `!setup` wizard: profile name → audience language → audience description → confirm
   - `audienceDescription` requires minimum 20 characters — bot rejects shorter input with: "Please describe your audience in a bit more detail (at least 20 characters). This helps Gemini understand who the video is for."
   - Phase 1: `!setup` re-run replaces all fields; no in-place field editing. Phase 2 will add field-level editing.
   - `!profile` shows: profile name, language, audience description, preferred voice (if set), runs completed.

**Returning flow:** User sends a clip → bot finds profile by `chat_id` → validates → buffers.

`profiles.telegram_chat_id` is the primary identifier. No `user_id` required for Phase 1.

---

## File Limits (Enforced at Intake)

| Limit | Value |
|---|---|
| Max clips per run | 5 |
| Max size per clip | 50MB (standard Telegram Bot API) |
| Max duration per clip | 3 minutes (checked via ffprobe) |

Each clip's orientation is detected via `ffprobe` at intake and stored as metadata. Orientation is included in the director prompt so Gemini can prefer centre-framed segments from horizontal clips and avoid edge-heavy compositions that would be lost to cropping.

**Aspect ratio handling at assembly (stage 3):** all clips are normalised to 9:16 (1080×1920). Strategy by input orientation:
- **Vertical (9:16)** — pass through, no transformation
- **Horizontal (16:9)** — centre-crop: `crop=608:1080:656:0,scale=1080:1920`
- **Square (1:1)** — centre-crop to 9:16: `crop=607:1080:236:0,scale=1080:1920`
- **Other ratios** — centre-crop using the same principle (crop to target aspect ratio from centre, then scale)

No letterboxing, no rejection. Clips are never refused for orientation — only warned.

**User warning at intake** (not blocking): "Clip 2 is horizontal (16:9) and will be centre-cropped to 9:16. Subjects near the left/right edges may be cut off."

Validation errors are sent back in plain language:
- "This clip is 72MB — max is 50MB. Please compress and resend."
- "This clip is 4m12s — max is 3 minutes. Please trim and resend."
- "You've already sent 5 clips. Use !run to start or !cancel to clear."

---

## Bot Commands

StoryReel uses a **separate Telegram bot** (`STORYREEL_BOT_TOKEN`) for isolation from the main post/reel pipeline. When `STORYREEL_BOT_TOKEN` is not set, commands fall through to the shared main bot (backward compatible).

All commands use the `!` prefix, consistent with the existing `!post`/`!reel` namespace in the main pipeline.

| Command | Purpose |
|---|---|
| `!setup` | Create or update channel profile (wizard) |
| `!profile` | Show current profile settings |
| `!music [genre]` | Override music genre for the next run — invalid genre returns: "Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational" |
| `!story` | Show current clip buffer (count, sizes, durations) |
| `!run [note]` | Start story run with buffered clips and optional context note |
| `!cancel` | Clear clip buffer |
| `!tweak <note>` | Re-run the last story with an amended director note (reuses same clips) |
| `!story resume <id>` | Resume a failed run from its last successful stage checkpoint |
| `!story rebuild <id> <stage>` | Force re-run from a specific stage (1–4), discarding later outputs |

**Clip upload:** User sends a video file → bot validates → acknowledges: "Clip 1/5 received (2m14s, 38MB). Send more or !run to start."

---

## Music Library

Six genre folders matching the director's `music_direction.genre` output:

```
music/storyreel/
  upbeat/       ← 3 tracks
  calm/         ← 3 tracks  (includes scott-buckley-wanderlust.mp3)
  neutral/      ← 3 tracks
  playful/      ← 3 tracks
  dramatic/     ← 3 tracks
  inspirational/← 3 tracks
  index.json    ← { genre, filename, title, artist, licenseUrl } per track
```

**Selection:** Director outputs `music_direction.genre` → runner picks a random track from matching folder. User can override with `!music upbeat` before `!run` or `!tweak`.

**Override scope:** `!music [genre]` sets a one-shot `pendingMusicOverride` on the channel's intake session. It is consumed by the next `!run` or `!tweak` and then cleared. If not set, Gemini's genre choice from the new direction is used. Override does not persist across multiple runs — each unconsumed run reverts to the director's choice.

**Attribution:** Delivery message includes "Music: [Title] by [Artist] (CC BY 4.0)" — required for Creative Commons tracks.

---

## Direction Precedence

When inputs conflict, `story-stage1-direction.ts` must encode this hierarchy **explicitly in the prompt** — not left to Gemini to improvise:

1. **Per-video user note** — highest priority. Overrides everything for this run only. If the note says "make this formal for a vet clinic", Gemini ignores the profile's casual tone for this video.
2. **Profile settings** — `audienceLanguage`, `audienceDescription`. Permanent context, applied unless the user note overrides.
3. **Category defaults** — style-specific conventions inferred from content (e.g. tutorials tend toward instructional pacing, storytelling toward emotional arc).
4. **Language defaults** — conventions natural to the audience language (e.g. Thai content cultural norms, German directness).
5. **System defaults** — lowest priority. General StoryReel conventions when nothing else applies.

The prompt must state this explicitly: *"If a user note is provided, it takes priority over all profile preferences for this video only. Treat the profile as permanent context and the user note as a per-video override."*

Without this, Gemini will blend conflicting inputs unpredictably across runs.

---

## 4-Stage Pipeline

### Stage 1 — Direction (10 min timeout)
Wraps `buildDirectorPrompt` + `GoogleStoryReelGeminiClient` + `validateDirection` from `src/storyreel/director-poc.ts`.
- Input: clips, `profile.audienceLanguage`, `profile.audienceDescription`, user note
- Prompt encodes the direction precedence hierarchy above explicitly — user note overrides profile for this run only
- Director output includes two inferred classification fields: `inferred_content_type` (content shape, data collection only) and `inferred_voice_style` (delivery mode, used for voice pool filtering) — two independent axes, not collapsed into one
- Output: `direction.json` written to `work/stories/<id>/director/`
- Raw Gemini JSON saved to `raw-direction.json` before validation for debugging
- Gemini token counts (`usageMetadata`) and calculated cost written to `story_runs` immediately after API response — before validation, so even failed runs are costed
- Log `uploadDurationMs` and `generationDurationMs` separately to `stageLogs` — 10-min timeout is conservative; tune down in Phase 2 once real measurements exist (POC used 1–2 short clips; 5 clips × 3 min each = 15 min of footage is unmeasured territory)
- **Validation failure:** if `validateDirection` fails, retry the Gemini call once (non-deterministic — a re-roll often fixes shape errors), then fail the run. Mark `story_runs.error` with a distinct `DIRECTION_VALIDATION_FAILED` code so invalid-JSON frequency can be monitored. If >5% of runs fail validation, the prompt or schema needs work.

### Stage 2 — Voice (5 min timeout)
Reuses `generateVoiceover` from `src/storyreel/audio-poc.ts`. Voice selection follows priority order:

1. `profiles.preferredVoiceId` set → use it directly, skip lookup
2. Not set (first run) → query `voices` DB table filtered by language + `inferred_voice_style`
3. DB match found → random pick from results, save to `profiles.preferredVoiceId` + `profiles.preferredVoiceProvider`
4. No DB match → `selectSharedVoice` fallback:
   - **ElevenLabs (any language including Thai):** search by tone + style; drop language filter for Thai since ElevenLabs voices are multilingual and handle Thai text even when not labeled as Thai
   - **Botnoi:** no search API — hard error if no DB voices found for Botnoi. Botnoi voice IDs must be pre-seeded in `voices` table.

**Implication:** ElevenLabs channels (Thai, English, German) work out of the box via `selectSharedVoice` fallback. Botnoi channels require at least one voice seeded in the `voices` table before they can run.

- Input: `direction.voice_direction`, `direction.voiceover_script.full_text`, `profile.preferredVoiceId`
- Output: `voiceover.mp3`, `word-timings.json` in `work/stories/<id>/voice/`

### Stage 3 — Assembly (15 min timeout)
Uses `buildAssemblyPlan` + `buildRoughCutHtml` + `renderWithHyperframes` + `mixVoiceAndMusic` + `muxVideoAndAudio` from storyreel POC library.
- Input: direction, clips, voiceover, music track (from library by genre)
- Output: `rough-cut-with-audio.mp4` in `work/stories/<id>/rough-cut/`

**Clip audio — Phase 1: strip.** Source audio is removed from all clips. Final audio track = voiceover + music only. Gemini's director prompt must state this explicitly so it does not plan segments around source audio being heard (e.g. dialogue, reactions).

Limitation: content types that depend on source audio ("watch what my friend said", interviews, ambient environment texture) cannot work in Phase 1.

Phase 2 candidate: duck source audio to ~15% under voiceover (`amix` with `volume=0.15` on clip audio). Adds environmental texture for lifestyle, travel, and food content without competing with the voice. No architectural change required — FFmpeg handles it in the same assembly step.

### Stage 4 — Publish (3 min timeout)
Uploads to GCS, extracts thumbnail (`ffmpeg -ss 00:00:03 -frames:v 1`), notifies channel.
- Input: rough cut video, `telegram_chat_id`
- Output: `videoGcsUrl`, `reviewUrl`
- Delivery message: thumbnail image + GCS link + attribution + `/tweak` hint

---

## Failure Recovery

Mirrors the reel pipeline's `!reel resume` and `!reel rebuild` pattern.

**`!story resume <id>`** — resumes from the last successful stage using DB checkpoints:
- `directionJson` set but `voiceoverPath` not set → resume from stage 2 (voice)
- `voiceoverPath` set but video not at GCS → resume from stage 3 (assembly)
- Video assembled but `videoGcsUrl` not set → resume from stage 4 (publish)

Prevents re-spending Gemini and ElevenLabs costs when a late stage fails. Particularly valuable during testing iterations where stage 3 (Hyperframes/FFmpeg) is the most likely failure point.

**`!story rebuild <id> <stage>`** — discards all outputs from the given stage onward and re-runs. Useful when direction or voice output is unsatisfactory but clips don't need to be re-uploaded.

Both are backed by `StoryRunner.resume(storyId)` and `StoryRunner.rebuild(storyId, fromStage)` which are already planned in the runner design.

## Tweak Flow

`!tweak <note>` creates a **new** `story_run` record reusing the same source clips from the previous run, with an amended user note. Runs full pipeline from stage 1. Preserves history — original run record is untouched.

**Clip availability:** When `!run` fires, clips are copied from the intake buffer (`work/stories/intake/<chatId>/`) to `work/stories/<storyId>/clips/` before stage 1 starts. The intake buffer is then cleared and its temp files deleted. `story_runs.sourceClipsMetadata` stores the absolute paths under the story work dir. `!tweak` loads clip paths from the previous run's `sourceClipsMetadata` — the files persist in `work/stories/<originalStoryId>/clips/` for as long as that directory exists. Chained tweaks (tweak → tweak again) all point back to the same original clip directory.

---

## Concurrent Run Limiting

- 1 active run per channel at a time
- In-memory Set keyed by `chat_id` + DB guard (check for recent `generating` story_runs)
- Bot message when blocked: "A story is already being generated for this channel. Wait for it to finish or check its status."
- Global assembly lock inherited from reel pipeline (1 FFmpeg assembly at a time across all channels) — fine for Phase 1 single tester. Phase 2 (5+ concurrent users) may need a queue with user feedback; worst case is 5 × 15 min = 75 min wait for the 5th user.

---

## Database Schema

### `voices` table
```typescript
{
  id: text PK,                    // uuid
  voiceId: text NOT NULL,         // ElevenLabs or Botnoi voice ID
  name: text NOT NULL,
  provider: text NOT NULL,        // "elevenlabs" | "botnoi"
  language: text NOT NULL,        // "thai" | "english" | "german"
  styles: text NOT NULL,          // JSON string[] — e.g. ["storytelling","conversational"]
  description: text,
  createdAt: text NOT NULL,
}
```

Voices are added via admin CLI or direct insert. No code change needed to expand the library. Botnoi voice IDs must be seeded before Botnoi channels can run; ElevenLabs channels fall back to `selectSharedVoice` if the table is empty.

### `profiles` table
```typescript
{
  id: text PK,                    // uuid
  telegramChatId: text,           // channel chat_id — primary lookup key
  profileName: text NOT NULL,     // "Dog Walking"
  audienceLanguage: text NOT NULL,// "thai" | "english" | "german"
  audienceDescription: text NOT NULL,
  preferredVoiceId: text,         // saved after first run; sticky for all subsequent runs
  preferredVoiceProvider: text,   // "elevenlabs" | "botnoi"
  createdAt: text NOT NULL,
  updatedAt: text NOT NULL,
}
```

### `story_intake_sessions` table (DB-persisted, survives restarts)
```typescript
{
  chatId: text PK,
  clips: text NOT NULL,           // JSON string[] absolute paths
  totalSizeMb: real NOT NULL,
  totalDurationSec: real NOT NULL,
  pendingMusicOverride: text,     // one-shot genre override from /music; consumed and cleared by next /run or /tweak
  expiresAt: text NOT NULL,       // 24h TTL
  createdAt: text NOT NULL,
}
```

### `story_runs` table
```typescript
{
  id: text PK,
  profileId: text,                // FK → profiles.id
  telegramChatId: text,           // channel that triggered this run
  sourceClipsMetadata: text NOT NULL, // JSON string[] absolute paths
  clipCount: integer NOT NULL,
  totalClipsSizeMb: real NOT NULL,
  totalSourceDurationSec: real NOT NULL,
  userNote: text,
  musicPath: text,                // absolute path to selected track
  musicTitle: text,               // for attribution
  musicArtist: text,
  musicGenreUsed: text,           // actual genre used in assembly — written end of stage 3 (override or directionJson genre)
  voiceIdUsed: text,              // actual voice used — written end of stage 2 (profile preference, DB lookup, or selectSharedVoice)
  voiceProviderUsed: text,        // actual provider used — written end of stage 2
  durationUsedSec: real,          // actual final video duration — written end of stage 3 (may differ from Gemini's predicted total_duration_sec)
  directionJson: text,            // JSON StoryReelDirectorDirection
  workDir: text,                  // work/stories/<id>/
  voiceoverPath: text,            // enables resume at stage 2
  geminiInputTokens: integer,   // from usageMetadata.promptTokenCount after stage 1
  geminiOutputTokens: integer,  // from usageMetadata.candidatesTokenCount
  geminiCostUsd: real,          // calculated at log time; key metric for Phase 3 SaaS pricing
  videoGcsUrl: text,
  reviewUrl: text,
  status: text NOT NULL DEFAULT "pending",
  currentStage: text,
  stageLogs: text,                // JSON StageLog[]
  error: text,
  createdAt: text NOT NULL,
  updatedAt: text NOT NULL,
}
```

---

## Validation View

A SQLite view to flatten `story_runs` into the format the Phase 1 validation spreadsheet needs — one row per run, all observation columns as direct fields, no JSON extraction at query time:

```sql
CREATE VIEW story_runs_validation AS
SELECT
  r.id,
  r.telegramChatId,
  p.audienceLanguage        AS language,
  r.userNote,
  r.clipCount,
  r.totalSourceDurationSec,
  json_extract(r.directionJson, '$.inferred_content_type')  AS gemini_inferred_content_type,
  json_extract(r.directionJson, '$.inferred_voice_style')   AS gemini_inferred_voice_style,
  r.voiceIdUsed,
  r.voiceProviderUsed,
  r.musicGenreUsed,
  r.durationUsedSec,
  r.geminiCostUsd,
  r.status,
  r.error,
  r.createdAt
FROM story_runs r
LEFT JOIN profiles p ON p.id = r.profileId;
```

Run `SELECT * FROM story_runs_validation` to export the Phase 1 dataset for analysis.

---

## Work Directory Layout

```
work/
  stories/
    intake/<chatId>/  ← temp clips during intake; deleted after /run copies them
    <storyId>/
      clips/          ← clip-1.mp4 ... copied from intake on /run; persists for /tweak
      director/       ← direction.json, raw-direction.json, prompt.txt, summary.txt
      voice/          ← voiceover.mp3, word-timings.json, voice-selection.json
      rough-cut/      ← assembly-plan.json, final-audio.m4a, rough-cut-with-audio.mp4, thumbnail.jpg
        hyperframes/
          assets/     ← segment-001.mp4 ...
music/
  storyreel/
    upbeat/calm/neutral/playful/dramatic/inspirational/
    index.json
```

---

## What Does NOT Change

- `PipelineRunner`, `ReelRunner`, all existing stages — untouched
- `BrandConfig`, `RunContext`, `ReelContext` — untouched
- POC library `src/storyreel/*.ts` — promoted as-is, no rewrites
- DB tables `runs`, `posts`, `reels`, `reelIntakeSessions` — untouched

---

## Feature Flag

```typescript
STORYREEL_ENABLED: z.boolean().default(false)
STORYREEL_BOT_TOKEN: string (optional)
```

Gates Telegram handler registration and CLI. Existing pipelines unaffected.

When `STORYREEL_BOT_TOKEN` is set, StoryReel runs on a **dedicated Telegram bot** with independent polling via `startStoryReelListener()`. This isolates StoryReel commands from the main `!post`/`!reel` pipeline. When not set, StoryReel commands fall through to the shared main bot (backward compatible).

**Env vars for StoryReel:**
- `STORYREEL_ENABLED` — master switch (default: false)
- `STORYREEL_BOT_TOKEN` — dedicated Telegram bot token (optional; falls back to shared bot)
- `STORYREEL_GEMINI_MODEL` — Gemini model override (default: gemini-2.5-flash)
- `ELEVENLABS_API_KEY` — required for voice generation

---

## Implementation Sequence (TDD throughout)

1. DB layer — `schema.ts` + `client.ts` + `queries.ts` for `profiles`, `story_intake_sessions`, `story_runs`
2. `story-stage1-direction.ts` — wrapper over POC director; tests with injected Gemini client
3. `story-stage2-voice.ts` — adapt `reel-stage3-voice.ts`; tests with injected TTS
4. `story-stage3-assembly.ts` — POC assembly flow; tests with injected FFmpeg + Hyperframes
5. `story-stage4-publish.ts` — GCS upload + thumbnail + Telegram notify; tests with injected GCS + bot
6. `story-runner.ts` — orchestrator with stage loop, timeouts, DB checkpoints
7. `story-intake.ts` — Telegram handlers (`!setup`, clip upload, `!run`, `!tweak`, `!cancel`, `!music`); tests with bot mock
8. `scripts/story-runner.ts` — admin CLI + `STORYREEL_ENABLED` flag
9. Music library — source and add 18 tracks across 6 genre folders
10. End-to-end manual test — 5 clips, German language, Wanderlust music via Telegram channel
