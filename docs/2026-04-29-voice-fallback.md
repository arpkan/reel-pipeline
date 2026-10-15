# Voice Fallback — Cross-Provider, Walk-All-Providers, Aggregated Errors

**Date:** 2026-04-29
**Scope:** Make the per-scene voice synthesis fallback resilient to multi-provider outages and informative when everything fails.

This consolidates two earlier docs (`-aggregate-errors`, `-walk-all-providers`); the code described here is the **final** state.

---

## Problem

The DS and NS voice pools each contain multiple providers. Provider outages do happen (quota exhaustion, transient API errors). The original fallback:

- Caught the primary failure and tried **one** randomly-picked alternate provider.
- If that single fallback also failed, only its error was thrown — the primary failure was swallowed.
- Result on a real DS run with both elevenlabs and uvoice down:
  ```
  Voice synthesis failed on all providers.
  elevenlabs: ElevenLabs TTS error: {"status":"quota_exceeded", ...}
  | uvoice: uvoice API error 400: {"message":"Your remaining credit is insufficient. ..."}
  ```
  …even though **botnoi was healthy and never tried** because the random fallback picker happened to land on uvoice.

---

## Final design

In `src/stages/reel-stage3-voice.ts`, the per-scene catch block now:

1. **Honours operator intent.** If `ctx.voiceId` is set (re-voice / explicit voice override), the primary error is rethrown immediately — no silent provider switch.
2. **Builds a fallback list** from the pool: every voice whose provider differs from the primary's.
3. **Random-shuffles** the list so we don't always retry providers in the same order.
4. **De-dupes by provider** — at most one attempt per distinct provider. A second elevenlabs voice doesn't help when the first failed for quota reasons.
5. **Walks the list**, attempting each fallback in turn. First success wins. Each failure is appended to a `provider: message` accumulator.
6. **On total failure**, throws a single combined error listing every provider's failure:
   ```
   Voice synthesis failed on all providers.
   elevenlabs: ... | uvoice: ... | botnoi: ...
   ```
7. **Logs each transition** with the underlying error message:
   ```
   ⚠️ elevenlabs failed (ElevenLabs TTS error: ...) — trying uvoice voice TH-ThaptimSD
   ⚠️ uvoice failed (uvoice API error 400: ...) — trying botnoi voice 63
   ```

The runtime cost is bounded: at most `N-1` extra calls where `N` is the number of distinct providers in the pool (currently 3 for DS, 2 for NS). When all providers are healthy, the loop never runs.

---

## Files

- `src/stages/reel-stage3-voice.ts` — the per-scene try/catch in the run loop. No type, brand, runner, or service changes.

The pool itself (per-brand) is configured in `src/brands/{ds,ns}.ts` via `voices` / `voicesFull`. Adding/removing a provider just adds/removes an entry — no fallback logic change needed.

---

## Behaviour table

| Pool state | Behaviour |
|---|---|
| Single voice in pool, fails | Primary error rethrown (nothing to fall back to). |
| Multi-voice pool, primary succeeds | No catch entered, no logs. |
| Primary fails, ≥1 healthy alternate | Walks until success, logs each transition with the underlying error. |
| All providers down | Throws a single combined error naming every provider's failure. |
| `ctx.voiceId` set (re-voice) | Primary error rethrown; no fallback (operator picked a specific voice). |

---

## Build & Deploy

```bash
npm run build
pm2 restart pipeline
```

## Verification

- Trigger a DS reel with elevenlabs + uvoice both down: it should still succeed via botnoi.
- Trigger one with all three keys invalidated: thrown error should list all three providers' messages.
- Trigger a re-voice (`!reel revoice <voice>`): a failure on the chosen voice should surface as that single provider's error, not switch silently.

## Out of scope

- No retry of the same provider with a different voice ID (de-dup-by-provider keeps it simple; same-provider retry doesn't help in quota-exhaustion cases).
- No provider health caching — every scene independently rediscovers which providers are up.
- No HTTP-level timeout inside provider services. A hung upstream still relies on the stage-level 240s timeout in `reel-runner.ts:withTimeout` (which now reports the last activity via `ctx.progressNote`).
