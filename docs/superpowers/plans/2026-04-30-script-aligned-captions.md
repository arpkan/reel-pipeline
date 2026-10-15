# Script-Aligned Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the original script text to correct Whisper caption text while preserving Whisper word timings.

**Architecture:** Add a small, deterministic alignment helper in the voice stage. Stage 3 will pass Whisper `wordTimings` through the helper after TTS and before storing them on `scene.wordTimings`; Stage 5 remains unchanged and continues rendering timings.

**Tech Stack:** TypeScript, Vitest, existing ReelStage3Voice pipeline.

---

### Task 1: Script-Aligned Caption Words

**Files:**
- Modify: `src/stages/reel-stage3-voice.ts`
- Modify: `tests/reel-stage3-voice.test.ts`

- [ ] **Step 1: Write failing test for brand-name correction**

Add a test that mocks Whisper/TTS returning incorrect caption words and expects `scene.wordTimings` to use the script words with the same timings:

```ts
it("aligns caption words to the original script when Whisper text is close", async () => {
  const uvMock = makeMockProvider(false, [
    { word: "New", start: 0, end: 0.2 },
    { word: "snap", start: 0.2, end: 0.4 },
    { word: "confirmed", start: 0.4, end: 0.8 },
  ]);
  (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

  const ctx = makeCtx({ voices: [{ id: "EN-ManaSD", provider: "uvoice" }] });
  ctx.script!.scenes[0].voiceover = "WorldBrief confirmed";

  await new ReelStage3Voice().run(ctx);

  expect(ctx.script!.scenes[0].wordTimings).toEqual([
    { word: "WorldBrief", start: 0, end: 0.2 },
    { word: "confirmed", start: 0.2 / 1.2, end: 0.4 / 1.2 },
  ]);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- tests/reel-stage3-voice.test.ts`

Expected: the new test fails because current code stores Whisper words directly.

- [ ] **Step 3: Implement minimal alignment helper**

Add helper functions in `src/stages/reel-stage3-voice.ts`:

```ts
export function alignWordTimingsToScript(whisperTimings: WordTiming[], scriptText: string, languageCode: string): WordTiming[] {
  if (languageCode !== "en" || whisperTimings.length === 0) return whisperTimings;
  const scriptWords = tokenizeScriptWords(normalizeVoiceoverForTts(scriptText, languageCode));
  if (scriptWords.length === 0) return whisperTimings;
  if (Math.abs(scriptWords.length - whisperTimings.length) > 1) return whisperTimings;

  if (scriptWords.length === whisperTimings.length) {
    return whisperTimings.map((timing, index) => ({ ...timing, word: scriptWords[index] }));
  }

  if (scriptWords.length === whisperTimings.length - 1) {
    const merged = tryMergeOneExtraWhisperToken(whisperTimings, scriptWords);
    if (merged) return merged;
  }

  return whisperTimings;
}
```

Use it where Stage 3 assigns `scene.wordTimings`:

```ts
const alignedTimings = alignWordTimingsToScript(wordTimings, scene.voiceover, languageCode);
scene.wordTimings = alignedTimings.map((wt) => ({
  word: wt.word,
  start: wt.start / atempo,
  end: wt.end / atempo,
}));
```

- [ ] **Step 4: Run focused test**

Run: `npm test -- tests/reel-stage3-voice.test.ts`

Expected: all voice-stage tests pass.

- [ ] **Step 5: Run full verification and deploy**

Run: `npm test`, `npm run build && pm2 restart pipeline`.

Expected: all tests pass, build succeeds, PM2 reports `pipeline` online.
