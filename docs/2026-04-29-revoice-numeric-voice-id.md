# `!reel re-voice` — Disambiguate Numeric Voice IDs

**Date:** 2026-04-29
**Problem:** `!reel re-voice 967ee2bb 5` errors with `Invalid speed "5". Must be 0.5-2.0` because the parser treats any numeric second arg as a speed.

---

## Root cause

`src/pipeline/command-listener.ts:71-82` parses the second arg as `parseFloat`. If it's a number it's interpreted as `voiceSpeedOverride`; only non-numeric tokens fall through to `voiceIdOverride`. Since Botnoi voice IDs are bare integers (`"5"`, `"63"`), they get caught by the speed branch and rejected for being out of `[0.5, 2.0]`.

This wasn't a problem before Botnoi: ElevenLabs voice IDs are alphanumeric (`JBFqnCBsd6RMkjVDRZzb`), uvoice IDs are dash-prefixed (`TH-ThaptimSD`), Minimax IDs contain underscores (`English_expressive_narrator`).

---

## Fix

Make the parser **pool-aware**: if the second arg matches a voice ID in the brand's voice pool, treat it as `voiceIdOverride` regardless of whether it parses as a number. Otherwise fall through to the existing speed logic.

### Changes

1. **`src/pipeline/command-listener.ts`** — `parseReelRebuildCommand` gains an optional `validVoiceIds?: Set<string>` parameter. The `re-voice` branch checks the set first; if `args[1]` is in it, it's a voice ID. The single call site (line 707) builds the set from the brand's pool and passes it through.

2. **Caller** (line 707) — resolve `getBrand(brandId).reels?.voicesFull` (the full pool, since re-voice can pick any voice from it) into a `Set<string>` of IDs and pass it.

### Code shape

```ts
// command-listener.ts
export function parseReelRebuildCommand(
  subCmdRaw: string,
  validVoiceIds?: Set<string>,
): ReelRebuildCommand {
  // ...
  if (cmd === "re-voice") {
    // ...
    if (args.length >= 2) {
      // Pool-aware: explicit voice ID match wins over speed-number heuristic.
      if (validVoiceIds?.has(args[1])) {
        result.voiceIdOverride = args[1];
      } else {
        const maybeSpeed = parseFloat(args[1]);
        if (!isNaN(maybeSpeed) && maybeSpeed >= 0.5 && maybeSpeed <= 2.0) {
          result.voiceSpeedOverride = maybeSpeed;
        } else if (!isNaN(maybeSpeed)) {
          throw new Error(`Invalid speed "${args[1]}". Must be 0.5-2.0 (e.g. 1.0=normal, 1.2=20% faster)`);
        } else {
          result.voiceIdOverride = args[1];
        }
      }
    }
    // args.length === 3 branch unchanged (third arg is always speed)
  }
}
```

```ts
// caller, near line 707
const poolIds = new Set(
  (getBrand(brandId).reels?.voicesFull ?? []).map((v) => v.id),
);
parsed = parseReelRebuildCommand(subCmdPreserveCase, poolIds);
```

### Behaviour table

| Input | Before | After |
|---|---|---|
| `re-voice abcd 1.2` | speed 1.2 | speed 1.2 (unchanged) |
| `re-voice abcd 5` | error: invalid speed | voice ID `5` (if in pool); else error (clear: "voice not in pool") |
| `re-voice abcd JBFqnCBsd6RMkjVDRZzb` | voice ID | voice ID (unchanged) |
| `re-voice abcd 5 1.3` | error before reaching speed | voice `5` + speed 1.3 |
| `re-voice abcd 1` | error: invalid speed (1 is out of [0.5,2.0]? no, 1 is in range — speed 1.0) | speed 1.0 (unchanged) — only out-of-pool numeric still parses as speed |

The third-arg-as-speed branch is untouched; it's already unambiguous.

If a numeric arg is **not** in the pool and parses as a number outside `[0.5, 2.0]`, we still throw the existing speed error — it's the most likely user intent (typoed speed) since the value isn't a valid voice anyway. We could improve the message to mention "or pool voice IDs", but that's a polish item.

---

## Tests

Update `tests/reel-command-parser.test.ts` to:

- Add a case that passes `validVoiceIds = new Set(["5", "63", "JBFqnCBsd6RMkjVDRZzb"])` and verifies `re-voice abcd 5` returns `voiceIdOverride: "5"`.
- Verify that without the set (or with a set not containing `"5"`), the old behaviour holds (errors with "Invalid speed").
- Verify `re-voice abcd 5 1.3` returns both `voiceIdOverride: "5"` and `voiceSpeedOverride: 1.3`.

---

## Build & Deploy

```bash
npm run build
pm2 restart pipeline
```

## Verification

- `!reel re-voice <id> 5` for a DS reel — should rebuild with Botnoi voice 5.
- `!reel re-voice <id> 1.2` — should rebuild with speed 1.2 (unchanged).
- `!reel re-voice <id> 5 1.3` — voice 5 at speed 1.3.
- `!reel re-voice <id> 99` (not in pool) — still errors as invalid speed.

## Out of scope

- No global rename of `voiceIdOverride` parsing in other commands.
- No friendlier "voice ID not in pool" error if the value parses as a number outside [0.5, 2.0]; existing speed error suffices.
