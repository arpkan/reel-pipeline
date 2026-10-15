# Voice Override Configuration Design

**Date:** 2026-04-23  
**Status:** Approved

## Overview

Add per-brand env vars (`DS_VOICE_OVERRIDE`, `NS_VOICE_OVERRIDE`) that collapse the voice pool to a single voice at config load time. When not set, the pool behaves exactly as today — random selection across all configured voices.

---

## Problem

The `voices[]` pool in `src/brands/ds.ts` and `src/brands/ns.ts` is hardcoded. Changing which voice is used requires a code edit and redeploy. Operators need to be able to switch voices (e.g. force uvoice's EN-ManaSD, or revert to ElevenLabs) without touching code.

---

## Solution

### New env vars

```
DS_VOICE_OVERRIDE=   # optional — force a specific voice ID for all DS reels
NS_VOICE_OVERRIDE=   # optional — force a specific voice ID for all NS reels
```

**Examples:**
```
DS_VOICE_OVERRIDE=EN-ManaSD          # all DS reels use uvoice EN-ManaSD
NS_VOICE_OVERRIDE=JBFqnCBsd6RMkjVDRZzb  # all NS reels use this ElevenLabs voice
```

When unset (default), the full pool is used and voices are picked randomly as today.

---

## Architecture

### New helper: `src/brands/voice-pool.ts`

```typescript
import type { VoiceEntry } from "../services/voice-provider.js";

/**
 * Resolves the effective voice pool for a brand.
 * If override is set, collapses the pool to the matching single entry.
 * Throws at startup if the override ID is not found in the pool.
 */
export function resolveVoicePool(
  override: string | undefined,
  pool: VoiceEntry[],
): VoiceEntry[] {
  if (!override) return pool;
  const entry = pool.find((v) => v.id === override);
  if (!entry) {
    throw new Error(
      `Voice override "${override}" not found in pool. ` +
      `Available IDs: ${pool.map((v) => v.id).join(", ")}`
    );
  }
  return [entry];
}
```

### Modified files

| File | Change |
|------|--------|
| `src/brands/voice-pool.ts` | New — `resolveVoicePool()` helper |
| `src/brands/ds.ts` | Wrap `voices` array with `resolveVoicePool(process.env.DS_VOICE_OVERRIDE, [...])` |
| `src/brands/ns.ts` | Wrap `voices` array with `resolveVoicePool(process.env.NS_VOICE_OVERRIDE, [...])` |
| `.env.example` | Add `DS_VOICE_OVERRIDE` and `NS_VOICE_OVERRIDE` |

### No other changes

- `src/stages/reel-stage3-voice.ts` — unchanged; it already reads from `brand.reels.voices`
- `src/types.ts` — unchanged
- `src/services/` — unchanged

---

## Behavior

| `DS_VOICE_OVERRIDE` | Pool at runtime |
|---------------------|----------------|
| unset | All 3 DS voices — EL primary, EL secondary, uvoice EN-ManaSD |
| `EN-ManaSD` | Only uvoice EN-ManaSD |
| `JBFqnCBsd6RMkjVDRZzb` | Only that ElevenLabs voice |
| `unknown-id` | **Throws at startup** with list of valid IDs |

---

## Error Handling

- Invalid override ID → throws at module load time (brand config is evaluated at startup) → server fails to start with a clear message → operator sees the error in `pm2 logs pipeline` immediately
- Empty string `DS_VOICE_OVERRIDE=` → treated as unset (falsy), full pool used

---

## Out of Scope

- Per-scene voice override (all scenes in a reel use the same pool)
- Weighted selection (not requested)
- Runtime hot-reload of override without restart (env vars require restart)
