# Voice Override Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `DS_VOICE_OVERRIDE` and `NS_VOICE_OVERRIDE` env vars that collapse the voice pool to a single named voice at config load time, with no code change required.

**Architecture:** A new `resolveVoicePool()` helper in `src/brands/voice-pool.ts` takes an optional override ID and a full pool; it returns either the full pool (no override) or a single-entry array (override set). Brand config files call it when defining `voices`. Invalid override IDs throw at startup with a clear error.

**Tech Stack:** TypeScript (ESM), Vitest for tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/brands/voice-pool.ts` | `resolveVoicePool()` helper |
| Create | `tests/voice-pool.test.ts` | Unit tests for `resolveVoicePool()` |
| Modify | `src/brands/ds.ts` | Wrap `voices` with `resolveVoicePool(process.env.DS_VOICE_OVERRIDE, [...])` |
| Modify | `src/brands/ns.ts` | Wrap `voices` with `resolveVoicePool(process.env.NS_VOICE_OVERRIDE, [...])` |
| Modify | `.env.example` | Add `DS_VOICE_OVERRIDE` and `NS_VOICE_OVERRIDE` |

---

## Task 1: `resolveVoicePool` helper with tests

**Files:**
- Create: `src/brands/voice-pool.ts`
- Create: `tests/voice-pool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/voice-pool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveVoicePool } from "../src/brands/voice-pool.js";
import type { VoiceEntry } from "../src/services/voice-provider.js";

const pool: VoiceEntry[] = [
  { id: "el-voice-1", provider: "elevenlabs" },
  { id: "el-voice-2", provider: "elevenlabs", speed: 1.2 },
  { id: "EN-ManaSD", provider: "uvoice" },
];

describe("resolveVoicePool", () => {
  it("returns full pool when override is undefined", () => {
    expect(resolveVoicePool(undefined, pool)).toEqual(pool);
  });

  it("returns full pool when override is empty string", () => {
    expect(resolveVoicePool("", pool)).toEqual(pool);
  });

  it("returns single-entry array when override matches a voice ID", () => {
    const result = resolveVoicePool("EN-ManaSD", pool);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "EN-ManaSD", provider: "uvoice" });
  });

  it("preserves speed on the matched entry", () => {
    const result = resolveVoicePool("el-voice-2", pool);
    expect(result).toHaveLength(1);
    expect(result[0].speed).toBe(1.2);
  });

  it("throws with clear message when override ID is not in pool", () => {
    expect(() => resolveVoicePool("unknown-voice", pool)).toThrow(
      'Voice override "unknown-voice" not found in pool. Available IDs: el-voice-1, el-voice-2, EN-ManaSD'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/voice-pool.test.ts
```

Expected: FAIL — `resolveVoicePool` not found.

- [ ] **Step 3: Implement `src/brands/voice-pool.ts`**

```typescript
import type { VoiceEntry } from "../services/voice-provider.js";

/**
 * Resolves the effective voice pool for a brand.
 *
 * If `override` is set (non-empty), collapses the pool to the single entry
 * matching that voice ID. Throws at startup if the ID is not found in the pool.
 *
 * If `override` is unset or empty, returns the full pool unchanged.
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
      `Available IDs: ${pool.map((v) => v.id).join(", ")}`,
    );
  }

  return [entry];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/voice-pool.test.ts
```

Expected: 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/brands/voice-pool.ts tests/voice-pool.test.ts
git commit -m "feat: add resolveVoicePool helper for per-brand voice override"
```

---

## Task 2: Wire into brand configs

**Files:**
- Modify: `src/brands/ds.ts` (lines 90–96)
- Modify: `src/brands/ns.ts` (lines 83–88)

- [ ] **Step 1: Update `src/brands/ds.ts`**

Add the import after the existing imports at the top of `ds.ts`:

```typescript
import type { BrandConfig } from "../types.js";
import type { VoiceEntry } from "../services/voice-provider.js";
import { resolveVoicePool } from "./voice-pool.js";
```

Replace the `voices` field (lines 90–96) with:

```typescript
    voices: resolveVoicePool(process.env.DS_VOICE_OVERRIDE, [
      { id: process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
      { id: "qWWAqFomnJ99VwQLREfT", provider: "elevenlabs" as const, speed: 1.2 },
      { id: process.env.DS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" as const },
    ] satisfies VoiceEntry[]),
```

- [ ] **Step 2: Update `src/brands/ns.ts`**

Add the import after the existing imports at the top of `ns.ts`:

```typescript
import type { BrandConfig } from "../types.js";
import type { VoiceEntry } from "../services/voice-provider.js";
import { resolveVoicePool } from "./voice-pool.js";
```

Replace the `voices` field (lines 83–88) with:

```typescript
    voices: resolveVoicePool(process.env.NS_VOICE_OVERRIDE, [
      { id: process.env.NS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
      { id: process.env.NS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" as const },
    ] satisfies VoiceEntry[]),
```

- [ ] **Step 3: Build to verify no type errors**

```bash
npm run build
```

Expected: Clean compile, no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All main workspace tests pass (ignore pre-existing `.worktrees/` failures).

- [ ] **Step 5: Commit**

```bash
git add src/brands/ds.ts src/brands/ns.ts
git commit -m "feat: apply voice override env vars to DS and NS brand configs"
```

---

## Task 3: Update `.env.example` and verify end-to-end

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

Add the two new vars to the uvoice section (already present at the bottom of `.env.example`). Replace the existing uvoice block:

```
# TTS — uvoice (https://uvoice.app)
UVOICE_API_KEY=
DS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD
NS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD
```

With:

```
# TTS — uvoice (https://uvoice.app)
UVOICE_API_KEY=
DS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD
NS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD

# Voice override — force a single voice per brand (skips random pool selection)
# Set to any voice ID from the brand's pool (ElevenLabs or uvoice)
# Leave empty to use the full pool (random selection, default)
DS_VOICE_OVERRIDE=         # e.g. EN-ManaSD  or  JBFqnCBsd6RMkjVDRZzb
NS_VOICE_OVERRIDE=         # e.g. EN-ManaSD  or  JBFqnCBsd6RMkjVDRZzb
```

- [ ] **Step 2: Verify override works correctly at runtime**

```bash
# Test: DS_VOICE_OVERRIDE=EN-ManaSD collapses DS pool to uvoice only
node --env-file=.env --input-type=module <<'EOF'
process.env.DS_VOICE_OVERRIDE = 'EN-ManaSD';
process.env.NS_VOICE_OVERRIDE = '';
const { getBrand } = await import('./dist/src/brands/index.js');
const ds = getBrand('ds');
const ns = getBrand('ns');
console.log('DS voices:', ds.reels.voices.map(v => `${v.provider}:${v.id}`));
console.log('NS voices:', ns.reels.voices.map(v => `${v.provider}:${v.id}`));
EOF
```

Expected output:
```
DS voices: [ 'uvoice:EN-ManaSD' ]
NS voices: [ 'elevenlabs:JBFqnCBsd6RMkjVDRZzb', 'uvoice:EN-ManaSD' ]
```

- [ ] **Step 3: Verify invalid override throws clearly**

```bash
node --env-file=.env --input-type=module <<'EOF'
process.env.NS_VOICE_OVERRIDE = 'bad-voice-id';
try {
  const { getBrand } = await import('./dist/src/brands/index.js');
  getBrand('ns');
  console.log('ERROR: should have thrown');
} catch (e) {
  console.log('Got expected error:', e.message);
}
EOF
```

Expected output:
```
Got expected error: Voice override "bad-voice-id" not found in pool. Available IDs: JBFqnCBsd6RMkjVDRZzb, EN-ManaSD
```

Note: the runtime verification steps above import from `dist/` — run `npm run build` first if dist is stale.

- [ ] **Step 4: Set override in `.env`**

Add or update these two lines in `.env` (the live config file, not `.env.example`):

```
DS_VOICE_OVERRIDE=EN-ManaSD
NS_VOICE_OVERRIDE=EN-ManaSD
```

- [ ] **Step 5: Commit and deploy**

```bash
git add .env.example
git commit -m "chore: add DS_VOICE_OVERRIDE and NS_VOICE_OVERRIDE to .env.example"
npm run build && pm2 restart pipeline --update-env
pm2 logs pipeline --lines 10 --nostream
```

Expected: Server restarts cleanly with no errors.
