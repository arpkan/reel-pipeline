# StoryReel Telegram GUI Design

## Goal

Replace text-only `!` commands with a guided conversational interface using Telegram inline keyboards. Every command becomes a wizard — buttons for fixed choices, text prompts for open-ended input. Bot messages use the profile's language from the moment the user selects it.

---

## Architecture

### `TelegramService` additions

Five new methods on the existing `TelegramService` class:

| Method | Purpose |
|---|---|
| `sendMessageWithButtons(chatId, text, buttons[][])` | Send a message with an inline keyboard. `buttons` is a 2D array of `{text, callback_data}` rows. |
| `editMessageWithButtons(chatId, messageId, text, buttons[][])` | Edit an existing bot message in place — used to update wizard steps without clutter. |
| `answerCallbackQuery(callbackQueryId, text?)` | Telegram requires this within 30s of every button tap or the button shows a spinner forever. Always called immediately on receipt, before async work. |
| `deleteMessage(chatId, messageId)` | Remove a wizard prompt message after completion. |
| `sendPhotoWithButtons(chatId, buffer, caption, buttons[][])` | Send a photo with inline URL buttons (for video delivery — View/Download). Uses `sendPhoto` multipart form with `reply_markup`. |

### Inline keyboard button types

`InlineKeyboardButton` is a union type supporting both `callback_data` (for wizard buttons) and `url` (for View/Download links):

```typescript
export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
```

### Polling loop

`startPolling` processes both `update.message` and `update.callback_query`. Callback queries extract `{id, data, from, message.chat.id, message.message_id}` and are emitted via `pollForCallbackQueries()`. Both update types share the same dispatch logic.

### `ConversationStateStore`

In-memory store keyed by `chatId`. 10-minute TTL — an abandoned wizard auto-clears.

```typescript
type WizardType = "setup" | "run" | "run-options" | "tweak" | "cancel" | "music";

interface ConversationState {
  wizard: WizardType;
  step: number;
  data: Partial<{
    language: AudienceLanguage;
    profileName: string;
    audienceDescription: string;
    note: string;
    voiceEnabled: boolean;
    musicEnabled: boolean;
    captionsEnabled: boolean;
    chatTitle: string;
    chatType: string;
    chatUsername: string;
  }>;
  promptMessageId?: number;
}
```

### `messages.ts`

Translation map covering every string the bot sends. Language resolution order: profile `audienceLanguage` → wizard in-progress language (from `ConversationState.data.language`) → `"english"`.

---

## Command Flows

### `!help`

No wizard. Bot sends a formatted HTML message listing all commands. No buttons.

### `!setup` wizard

Language is selected first so every subsequent step is in the user's language.

| Step | Bot sends | User input |
|---|---|---|
| 1 | (English) "Choose your language:" + `[ภาษาไทย] [English] [Deutsch]` | Taps a button |
| 2 | (selected language) "What's your profile name?" | Types name |
| 3 | (selected language) "Describe your audience:" + `[Skip]` | Types or taps Skip |
| 4 | (selected language) Confirmation card: name + language + audience (or "none") + `[Confirm] [Start over]` | Taps Confirm or Start over |
| 5 | (selected language) "Profile created." | — |

### `!music` wizard

Bot immediately sends: "Choose a music genre:" with buttons in two rows. User taps → genre confirmed, one-shot override stored.

### `!run` wizard

Two-step flow:

**Step 1 — Options toggle panel:**

```
⚙️ StoryReel Options

[ ✅ Voice ]  [ ✅ Music ]  [ ✅ Captions ]
[            ▶️ Start              ]
```

- Each toggle flips ✅/❌ and updates the keyboard in-place via `editMessageWithButtons`.
- If user typed `!run <note>`, the note is pre-filled in the header.
- Free text typed during step 1 is captured as a note (shown in the header).

**Step 2 — Note prompt (after tapping Start):**

```
Any context note for this story?

[ Skip — run now ]
```

- User types a note → run starts immediately with it.
- User taps Skip → run starts without a note.
- The saved toggle options (voice/music/captions) are passed through to the runner.

### `!tweak` wizard

Same shape as the old `!run` — prompt is "What would you like to change?" with `[Skip — re-run as-is]`. Does not show the toggle panel.

### `!story` (clip buffer)

Bot sends clip list then appends buttons: `[Run now] [Cancel]`

### `!cancel` confirmation

```
Bot: "Clear all clips?"
     [ Yes, clear ]  [ Keep clips ]
```

Both choices delete the confirmation message. "Yes, clear" also sends "Intake cleared." afterwards.

### `!story resume <id>` / `!story rebuild <id> <stage>`

IDs are displayed as 8-char short IDs (`id.slice(0, 8)`). Commands accept either short or full IDs. Short IDs are resolved by prefix match scoped to the chat's story runs.

---

## Run Options (Voice/Music/Captions)

Three boolean flags on `StoryContext`:

| Field | Default | Effect when `false` |
|---|---|---|
| `voiceEnabled` | `true` | Skip stage 2 (voiceover). No TTS call. |
| `musicEnabled` | `true` | Skip music mixing in stage 3. Uses `mixMusicOnly` ffmpeg path when only music is present. |
| `captionsEnabled` | `true` | Clear `hook_text_overlay` and `caption_lines` from direction before building assembly plan. |

Stage 3 handles all 8 combinations:
- Both voice + music → normal `mixVoiceAndMusic` + mux
- Voice only → mux voiceover directly onto video
- Music only → `mixMusicOnly` (new ffmpeg filter without voice input) + mux
- Neither → raw video (no audio track)

---

## Video Delivery (View/Download Buttons)

After stage 4 (publish), the bot sends the thumbnail photo with inline URL buttons instead of the video file:

```
Your StoryReel is ready.
Music: Track Name by Artist

[ View ]  [ Download ]
```

- **View** → GCS URL (direct stream)
- **Download** → Server proxy route (`/storyreel/:storyId/download`) that streams from GCS with `Content-Disposition: attachment` header.

The download proxy route exists in both the worktree and main checkout (`api/routes/storyreel-download.ts`), mounted on the main pipeline server.

---

## Short Run IDs

Run IDs are displayed as 8-character short IDs (`id.slice(0, 8)`) in all user-facing messages, wrapped in `<code>` tags. Commands accept short IDs and resolve them via `getStoryRunByShortId(chatId, shortId)` which matches by prefix scoped to the chat.

---

## Language Behaviour

- **Before profile exists:** all messages in English.
- **During `!setup`:** step 1 in English; steps 2–5 in the language the user selected in step 1.
- **After profile created:** all messages in `profile.audienceLanguage` for that `chatId`.

---

## Error Handling & Edge Cases

| Scenario | Behaviour |
|---|---|
| Command sent mid-wizard | Bot: "You're in the middle of a conversation…" Wizard state preserved. |
| `!cancel` or `!help` mid-wizard | These commands bypass the wizard guard — they always work. |
| Button tapped on stale message | `answerCallbackQuery` called silently; handler returns early. |
| Cancel confirmation buttons | Both choices delete the confirmation message for visual feedback. |
| `answerCallbackQuery` not called | Always called immediately on receipt, before any async work. |
| Wizard TTL expired (10 min) | State auto-cleared; next message treated as fresh. |

---

## What Does NOT Change

- `!run [note]` and `!tweak [note]` text commands still work (power users can bypass wizard).
- All existing command parsing in `story-intake.ts` remains — wizard is layered on top.
- Pipeline stages 1–4 (direction, voice, assembly, publish) — behavior unchanged when flags are default.
- Reel pipeline — untouched.
