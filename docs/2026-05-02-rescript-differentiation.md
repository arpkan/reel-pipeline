# Fix: !reel rescript produces scripts too similar to the original

## Problem

`!reel rescript` sends the exact same story (headline + snippet) to the LLM with the exact same prompt. The old script is never loaded into context, so the LLM has no way to know it's supposed to write something different. Result: the new script looks nearly identical to the original.

## Root Cause

In `ReelRunner.rerescript`, the context is rebuilt from the DB but `reel.script` is never attached. `ReelStage2Script` receives no previous script and no rescript instruction — it just re-runs the standard generation.

## Fix

**`reel-runner.ts`** — after restoring discovery context, load the existing script into `ctx.previousScript`:

```ts
if (reel.script) ctx.previousScript = reel.script;
```

**`types.ts`** — add `previousScript?: ReelScript` to `ReelContext`.

**`reel-stage2-script.ts`** — when `ctx.previousScript` exists, append the old script to the user message with a clear instruction:

```
IMPORTANT: This is a rescript. The previous script is shown below — you MUST write a meaningfully different version. Use a different hook, different angle, different scene structure, or different narrative focus. Do not repeat the same opening line or the same scene order.

Previous script:
[JSON of old script]
```

## Files changed

- `src/types.ts` — add `previousScript` field to `ReelContext`
- `src/pipeline/reel-runner.ts` — populate `ctx.previousScript` from DB
- `src/stages/reel-stage2-script.ts` — inject previous script + differentiation instruction into user message
