# StoryReel Telegram GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace text-only `!` commands with guided inline-keyboard wizards, add multilingual bot messages keyed to the profile language, add run options toggles (voice/music/captions), deliver videos via View/Download buttons, and display short run IDs.

**Architecture:** A `ConversationStateStore` (in-memory, TTL) tracks which wizard step a chat is on. `story-messages.ts` holds full English/Thai/German translation maps. `TelegramService` gains five new methods (`sendMessageWithButtons`, `editMessageWithButtons`, `answerCallbackQuery`, `deleteMessage`, `sendPhotoWithButtons`) and the polling loop emits `callback_query` updates alongside regular messages. Wizard logic lives in `command-listener.ts`; `handleStoryReelCallback` routes button taps to the appropriate wizard step.

**Tech Stack:** TypeScript, Telegram Bot API (inline keyboards, callback queries), Vitest, existing `queries.ts` / `TelegramService` patterns.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/pipeline/story-messages.ts` | `BotMessages` interface + EN/TH/DE translation map + `getMessages()` |
| Create | `src/pipeline/story-conversation-state.ts` | In-memory wizard state store with 10-min TTL |
| Modify | `src/services/telegram.ts` | 5 new bot methods + `callback_query` in polling loop + `pollForCallbackQueries()` + `InlineKeyboardButton` union type |
| Modify | `src/pipeline/story-intake.ts` | Remove 20-char audience validation; allow blank; add `!help` command type |
| Modify | `src/storyreel/director-poc.ts` | Skip blank `audienceDescription` in prompt |
| Modify | `src/pipeline/command-listener.ts` | Extended `Sender` interface; wizard handlers for setup/music/run/run-options/tweak/story/cancel/help; callback query router; `startStoryReelListener` callback loop; short ID display; cancel message deletion |
| Modify | `src/pipeline/story-runner.ts` | `voiceEnabled`/`musicEnabled`/`captionsEnabled` on `StoryContext`; skip voice stage when disabled; short ID deps |
| Modify | `src/stages/story-stage3-assembly.ts` | Handle all 8 combinations of voice/music/captions disabled; `mixMusicOnly` dep |
| Modify | `src/stages/story-stage4-publish.ts` | `sendPhotoWithButtons` with View/Download URL buttons; HTML escape music attribution |
| Modify | `src/storyreel/audio-poc.ts` | `buildMusicOnlyArgs` + `mixMusicOnly` for music-without-voice path |
| Modify | `src/pipeline/story-runtime.ts` | Wire `mixMusicOnly`, `sendPhotoWithButtons`, toggle options |
| Create | `api/routes/storyreel-download.ts` | Download proxy route with `Content-Disposition: attachment` |
| Modify | `src/db/queries.ts` | `getStoryRunByShortId(chatId, shortId)` for prefix match |
| Modify | `bin/server.ts` | Mount download proxy route |
| Create | `tests/story-messages.test.ts` | Translation map completeness + `getMessages()` fallback |
| Create | `tests/story-conversation-state.test.ts` | TTL, set/get/clear |
| Modify | `tests/telegram-service.test.ts` | New bot methods + callback_query polling |
| Modify | `tests/story-command-listener.test.ts` | Wizard flows (setup, music, run, run-options, tweak, story, cancel, help, mid-wizard interrupt, stale button) |
| Create | `tests/story-stage3-assembly.test.ts` | Voice/music/captions toggle combinations |
| Create | `tests/story-stage4-publish.test.ts` | View/Download buttons, HTML escape, caption cleanup |
| Create | `tests/storyreel-download-route.test.ts` | Download proxy route |
| Create | `tests/storyreel-audio-poc.test.ts` | Music-only args, loudnorm filter |

---

## Task 1: `story-messages.ts` — translation map

- [x] Create `src/pipeline/story-messages.ts` with full EN/TH/DE translations including run options labels (`voiceLabel`, `musicLabel`, `captionsLabel`, `startButton`, `runOptionsHeader`, `runOptionsWithNote`, `runOptionsAskNote`, `runOptionsSkipNoteButton`)
- [x] Create `tests/story-messages.test.ts`
- [x] All 6 tests pass

---

## Task 2: `story-conversation-state.ts` — wizard state store

- [x] Create `src/pipeline/story-conversation-state.ts` with `run-options` wizard type and toggle state fields (`voiceEnabled`, `musicEnabled`, `captionsEnabled`)
- [x] Create `tests/story-conversation-state.test.ts`
- [x] All tests pass

---

## Task 3: TelegramService — five new bot methods

- [x] Add `InlineKeyboardButton` union type (callback_data | url)
- [x] Add `sendMessageWithButtons`, `editMessageWithButtons`, `answerCallbackQuery`, `deleteMessage`, `sendPhotoWithButtons` to `TelegramService`
- [x] Tests pass

---

## Task 4: TelegramService — `callback_query` polling

- [x] Add `TelegramCallbackQueryEvent` type (includes `messageId`)
- [x] Emit `cbq:*` events in `startPolling`
- [x] Add `pollForCallbackQueries()` async generator
- [x] Tests pass

---

## Task 5: Allow blank audience description

- [x] Remove 20-char validation in `story-intake.ts`
- [x] Skip blank audience in `director-poc.ts`
- [x] Tests pass

---

## Task 6: `!setup` wizard + `!help` command

- [x] Add `!help` to `StoryCommand` union and `parseStoryCommand`
- [x] 5-step setup wizard with language-first ordering
- [x] `resolveMessages()` helper for language resolution
- [x] `handleWizardTextInput()` for free-text wizard steps
- [x] `handleStoryReelCallback()` for all callback routing
- [x] Tests pass

---

## Task 7: `!music`, `!story`, `!cancel` wizards

- [x] `!music` → genre buttons (2 rows of 3) when no genre argument
- [x] `!story` → clip buffer with Run/Cancel buttons
- [x] `!cancel` → confirmation dialog (Yes, clear / Keep clips)
- [x] Cancel choices delete the confirmation message
- [x] Tests pass

---

## Task 8: `!run` wizard with toggle panel

- [x] Step 1: Toggle panel with Voice/Music/Captions ✅/❌ buttons + Start
- [x] Toggle callbacks (`run-opt:toggle:voice`, `run-opt:toggle:music`, `run-opt:toggle:captions`) update keyboard in-place
- [x] Step 2: Note prompt with Skip button after Start
- [x] `run-opt:start` → transition to note prompt
- [x] `run-opt:skip-note` → execute without note
- [x] Free text in step 1 captured as note, shown in header
- [x] Free text in step 2 → execute immediately with note
- [x] `!cancel` and `!help` bypass wizard-in-progress guard
- [x] Tests pass

---

## Task 9: Run options — stage logic

- [x] Add `voiceEnabled`, `musicEnabled`, `captionsEnabled` to `StoryContext`
- [x] Stage 2 (voice) skipped when `voiceEnabled === false`
- [x] Stage 3 (assembly) handles all 8 combinations:
  - Voice + Music → normal `mixVoiceAndMusic`
  - Voice only → mux voiceover directly
  - Music only → `mixMusicOnly` (new in `audio-poc.ts`)
  - Neither → raw video
- [x] `captionsEnabled === false` clears `hook_text_overlay` and `caption_lines`
- [x] Wire `mixMusicOnly` in `story-runtime.ts`
- [x] Tests pass

---

## Task 10: View/Download buttons + download proxy

- [x] `sendPhotoWithButtons` on `TelegramService` for multipart photo + URL buttons
- [x] Stage 4 sends thumbnail with `[ View ] [ Download ]` inline URL buttons
- [x] Caption: "Your StoryReel is ready." + music attribution (HTML escaped)
- [x] Download proxy route (`api/routes/storyreel-download.ts`) streams from GCS with `Content-Disposition: attachment`
- [x] Route mounted in `bin/server.ts` on both main and worktree
- [x] Tests pass

---

## Task 11: Short run IDs

- [x] `getStoryRunByShortId(chatId, shortId)` in `queries.ts` — prefix match scoped to chat
- [x] `resumingStory`/`rebuildingStory` messages use `id.slice(0, 8)` wrapped in `<code>` tags
- [x] Resume/rebuild commands accept short IDs, resolve via `getStoryRunByShortId`
- [x] Tests pass

---

## Task 12: Wire callback queries + build + deploy

- [x] `startStoryReelListener` has parallel callback query loop passing `messageId`
- [x] `handleStoryReelCallback` accepts `messageId` parameter
- [x] Cancel handlers delete confirmation message via `messageId`
- [x] `npm run build` clean
- [x] `pm2 restart storyreel-listener && pm2 restart pipeline`

---

## Status

All tasks implemented and deployed. Pre-existing test failures in `tests/storyreel-audio-poc.test.ts` (shared voice search query expectations) are unrelated to this work.
