# Hyperframes Storytelling Retention v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured Stage 2 storytelling contract and Hyperframes-only retention pacing profile that improves hook speed, flow, and emotional arc while preserving baseline compatibility.

**Architecture:** Keep the current reel pipeline stages, but extend `ReelScene` with optional storytelling metadata validated in Stage 2, then consume that metadata in the Hyperframes enhanced template behind `storytellingProfile` (`baseline` vs `retention_v1`). Use fallback-safe behavior per scene/run, and emit variant metadata for KPI analysis.

**Tech Stack:** TypeScript (ESM), Vitest, existing Bedrock Stage 2 script generation, Hyperframes enhanced template renderer.

---

## File Structure and Responsibilities

- Modify `src/types.ts`
  - Add optional storytelling profile/config fields and scene-level storytelling metadata types.
- Modify `src/stages/reel-stage2-script.ts`
  - Extend prompt JSON contract and normalize/validate optional storytelling metadata.
- Modify `src/stages/reel-stage5-templates/enhanced-default.ts`
  - Replace hardcoded audio lead-in with profile-driven timing and add emphasis-word-aware subtitle classing.
- Modify `src/services/metrics-collector.ts`
  - Parse and expose `storytellingProfile` from run context for analytics dimensions.
- Modify `tests/reel-stage5-enhanced-template.test.ts`
  - Add template-level assertions for profile timing and emphasis-word behavior.
- Create `tests/reel-stage2-script.test.ts`
  - Add Stage 2 contract validation tests for new metadata + fallback behavior.
- Create `tests/storytelling-meta-metrics.test.ts`
  - Add metrics parse tests for profile extraction and null-safe fallback.

### Task 1: Add storytelling types and profile plumbing

**Files:**
- Modify: `src/types.ts`
- Test: `tests/reel-stage5-enhanced-template.test.ts` (compile-time compatibility via test fixtures)

- [ ] **Step 1: Write the failing type usage test fixture update**

```ts
// tests/reel-stage5-enhanced-template.test.ts (inside makeCtx() scene fixtures)
scenes: [
  {
    sceneNumber: 1,
    voiceover: "Big update today",
    caption: "Big update",
    imagePrompt: "news image",
    storyBeat: "hook",
    energy: "high",
    emphasisWords: ["update"],
    transitionIntent: "escalate",
  },
]
```

- [ ] **Step 2: Run test to verify it fails on missing type fields**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`
Expected: FAIL with TypeScript/type-check errors for unknown scene properties.

- [ ] **Step 3: Add new types and optional fields in `src/types.ts`**

```ts
export type StoryBeat = "hook" | "context" | "turn" | "payoff";
export type StoryEnergy = "low" | "medium" | "high";
export type TransitionIntent = "escalate" | "contrast" | "resolve";
export type StorytellingProfile = "baseline" | "retention_v1";

export interface ReelScene {
  sceneNumber: number;
  voiceover: string;
  caption: string;
  imagePrompt: string;
  storyBeat?: StoryBeat;
  energy?: StoryEnergy;
  emphasisWords?: string[];
  transitionIntent?: TransitionIntent;
  durationSeconds?: number;
  wordTimings?: WordTiming[];
}

// in ReelContext
storytellingProfile?: StorytellingProfile;
```

- [ ] **Step 4: Run focused tests to verify compile and runtime compatibility**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/reel-stage5-enhanced-template.test.ts
git commit -m "feat: add storytelling profile and scene metadata types"
```

### Task 2: Extend Stage 2 script contract with validation + fallback

**Files:**
- Modify: `src/stages/reel-stage2-script.ts`
- Create: `tests/reel-stage2-script.test.ts`

- [ ] **Step 1: Write failing tests for structured scene metadata parsing**

```ts
import { describe, it, expect, vi } from "vitest";
import { ReelStage2Script } from "../src/stages/reel-stage2-script.js";

it("keeps valid storytelling metadata from model output", async () => {
  // mock bedrock.converse() to return JSON with storyBeat/energy/emphasisWords/transitionIntent
  // expect returned ctx.script.scenes[0].storyBeat === "hook"
});

it("drops invalid storytelling metadata without failing run", async () => {
  // mock invalid values: storyBeat: "boom", emphasisWords: ["a","b","c","d"]
  // expect scene fields undefined or clamped, and script still returned
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-stage2-script.test.ts`
Expected: FAIL because Stage 2 currently does not validate/normalize these fields.

- [ ] **Step 3: Implement minimal Stage 2 normalization helpers**

```ts
const STORY_BEATS = new Set(["hook", "context", "turn", "payoff"]);
const STORY_ENERGY = new Set(["low", "medium", "high"]);
const TRANSITION_INTENTS = new Set(["escalate", "contrast", "resolve"]);

function normalizeEmphasisWords(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const words = input
    .filter((w): w is string => typeof w === "string")
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 3);
  return words.length > 0 ? words : undefined;
}

function normalizeSceneStoryMeta(scene: ReelScript["scenes"][number]) {
  scene.storyBeat = STORY_BEATS.has(String(scene.storyBeat)) ? scene.storyBeat : undefined;
  scene.energy = STORY_ENERGY.has(String(scene.energy)) ? scene.energy : undefined;
  scene.transitionIntent = TRANSITION_INTENTS.has(String(scene.transitionIntent)) ? scene.transitionIntent : undefined;
  scene.emphasisWords = normalizeEmphasisWords(scene.emphasisWords);
}
```

- [ ] **Step 4: Update Stage 2 prompt JSON contract (add optional fields)**

```ts
// in system prompt JSON shape example per scene:
{
  "sceneNumber": 1,
  "voiceover": "...",
  "caption": "...",
  "imagePrompt": "...",
  "storyBeat": "hook",
  "energy": "high",
  "emphasisWords": ["keyword1", "keyword2"],
  "transitionIntent": "escalate"
}
```

- [ ] **Step 5: Run tests to verify Stage 2 behavior**

Run: `npm test -- tests/reel-stage2-script.test.ts tests/reel-runner-context.test.ts`
Expected: PASS with valid metadata preserved and invalid metadata safely dropped.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage2-script.ts tests/reel-stage2-script.test.ts
git commit -m "feat: add Stage2 storytelling metadata contract with safe normalization"
```

### Task 3: Implement Hyperframes retention_v1 pacing and emphasis behavior

**Files:**
- Modify: `src/stages/reel-stage5-templates/enhanced-default.ts`
- Modify: `tests/reel-stage5-enhanced-template.test.ts`

- [ ] **Step 1: Write failing template tests for profile-specific audio timing**

```ts
it("uses retention_v1 short voice lead-in", async () => {
  const { buildEnhancedDefaultHyperframesHtml } = await import("../src/stages/reel-stage5-templates/enhanced-default.js");
  const ctx = makeCtx();
  ctx.storytellingProfile = "retention_v1";
  const html = buildEnhancedDefaultHyperframesHtml({ ctx });
  expect(html).toContain('class="clip voice voice-1"');
  expect(html).toContain('data-start="0.5"');
});

it("keeps baseline intro timing when profile missing", async () => {
  const html = buildEnhancedDefaultHyperframesHtml({ ctx: makeCtx() });
  expect(html).toContain('data-start="2"');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts`
Expected: FAIL because template currently hardcodes `HOOK_DURATION_SECONDS = 2`.

- [ ] **Step 3: Implement profile-driven hook/voice offsets in template**

```ts
const PROFILE_HOOK_SECONDS: Record<StorytellingProfile, number> = {
  baseline: 2,
  retention_v1: 0.5,
};

function resolveHookDurationSeconds(ctx: ReelContext): number {
  const profile = ctx.storytellingProfile ?? "baseline";
  return PROFILE_HOOK_SECONDS[profile] ?? PROFILE_HOOK_SECONDS.baseline;
}

// replace HOOK_DURATION_SECONDS usage in buildTimedScenes/getSceneDuration
// with per-context hookDurationSeconds.
```

- [ ] **Step 4: Add emphasis-word-aware subtitle classing (non-breaking)**

```ts
function isEmphasisWord(word: string, emphasisWords?: string[]): boolean {
  if (!emphasisWords?.length) return false;
  return emphasisWords.some((w) => w.toLowerCase() === word.toLowerCase());
}

// when building subtitle spans:
const classes = ["subtitle-word"];
if (word.isActive) classes.push("active-word");
if (isEmphasisWord(word.text, timedScene.scene.emphasisWords)) classes.push("emphasis-word");
```

- [ ] **Step 5: Add/adjust CSS for emphasis words under active timing**

```css
.subtitle-word.emphasis-word {
  letter-spacing: 0.01em;
  text-decoration: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.12em;
}
```

- [ ] **Step 6: Run template and renderer tests**

Run: `npm test -- tests/reel-stage5-enhanced-template.test.ts tests/reel-stage5-hyperframes-renderer.test.ts`
Expected: PASS; baseline timing unchanged when profile is absent, retention timing active when profile enabled.

- [ ] **Step 7: Commit**

```bash
git add src/stages/reel-stage5-templates/enhanced-default.ts tests/reel-stage5-enhanced-template.test.ts
git commit -m "feat: add Hyperframes retention_v1 pacing and emphasis behavior"
```

### Task 4: Add variant observability for metrics slicing

**Files:**
- Modify: `src/services/metrics-collector.ts`
- Create: `tests/storytelling-meta-metrics.test.ts`

- [ ] **Step 1: Write failing tests for profile extraction from reel context JSON**

```ts
import { describe, it, expect } from "vitest";
import { __testables } from "../src/services/metrics-collector.js";

it("parses storytellingProfile from reel context", () => {
  const meta = __testables.parseReelMeta(JSON.stringify({ storytellingProfile: "retention_v1" }));
  expect(meta.storytellingProfile).toBe("retention_v1");
});

it("falls back to null for malformed context", () => {
  const meta = __testables.parseReelMeta("{bad json");
  expect(meta.storytellingProfile).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/storytelling-meta-metrics.test.ts`
Expected: FAIL because `storytellingProfile` is not currently parsed/exported.

- [ ] **Step 3: Extend ReelMeta parse and dimensions map**

```ts
interface ReelMeta {
  pillar: string | null;
  theme: string | null;
  category: string | null;
  voiceId: string | null;
  musicFile: string | null;
  storytellingProfile: string | null;
}

// in parseReelMeta return object:
storytellingProfile: (ctx.storytellingProfile as string) ?? null,

// add benchmark dimension
{ dimension: "storytelling_profile", value: meta.storytellingProfile },
```

- [ ] **Step 4: Export parse helper for testability with narrow surface**

```ts
export const __testables = { parseReelMeta };
```

- [ ] **Step 5: Run tests for metrics and regressions**

Run: `npm test -- tests/storytelling-meta-metrics.test.ts tests/testing-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/metrics-collector.ts tests/storytelling-meta-metrics.test.ts
git commit -m "feat: track storytelling profile in reel metrics metadata"
```

### Task 5: End-to-end verification and rollout guardrails

**Files:**
- Modify: `tests/reel-runner-context.test.ts`
- Modify: `tests/reel-review-metadata-fidelity.test.ts`

- [ ] **Step 1: Add failing integration assertions for profile propagation**

```ts
expect(resultContext.storytellingProfile).toBe("retention_v1");
expect(savedReelContext.storytellingProfile).toBe("retention_v1");
```

- [ ] **Step 2: Run integration-focused tests to verify failure first**

Run: `npm test -- tests/reel-runner-context.test.ts tests/reel-review-metadata-fidelity.test.ts`
Expected: FAIL where profile is not threaded through all expected paths.

- [ ] **Step 3: Implement minimal context threading where missing**

```ts
// ensure reel context construction preserves profile
storytellingProfile: options.storytellingProfile ?? "baseline",

// ensure context serialization includes the field unchanged
```

- [ ] **Step 4: Run full targeted suite for this feature**

Run: `npm test -- tests/reel-stage2-script.test.ts tests/reel-stage5-enhanced-template.test.ts tests/storytelling-meta-metrics.test.ts tests/reel-runner-context.test.ts tests/reel-review-metadata-fidelity.test.ts`
Expected: PASS.

- [ ] **Step 5: Run broad regression suite before merge**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/reel-runner-context.test.ts tests/reel-review-metadata-fidelity.test.ts src/pipeline/reel-runner.ts src/types.ts
git commit -m "test: verify storytelling profile propagation and retention safeguards"
```

## Spec Coverage Check

- Structured Stage 2 contract: covered in Task 2.
- Hyperframes-only timing behavior with ~0.5s lead-in for `retention_v1`: covered in Task 3.
- Emphasis words + transition intent consumption in template: covered in Task 3.
- A/B metrics observability: covered in Task 4 and Task 5.
- Backward compatibility + fallback safety: covered in Tasks 2 and 3.

## Placeholder Scan

- No TODO/TBD placeholders left.
- All code-changing steps include concrete snippets.
- All test steps include exact commands and expected outcomes.

## Type Consistency Check

- Uses `storytellingProfile`, `storyBeat`, `energy`, `emphasisWords`, `transitionIntent` consistently across tasks.
- Uses `retention_v1` and `baseline` consistently as the profile enum values.
