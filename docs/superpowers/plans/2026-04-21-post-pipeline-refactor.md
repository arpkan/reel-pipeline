# Post Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align post pipeline architecture with reel pipeline — unified stage numbering, merge stages, add timeouts/cancellation/progress, remove poller, refactor commands to `!post` namespace, make `!approve` publish immediately.

**Architecture:** Unified stage numbering where stages 0-1 are shared between both pipelines. Post-specific stages use `post-` prefix, reel-specific stages use `reel-` prefix. The long-lived approval poller is eliminated — the runner stops after stage4 and sets `awaiting_approval`, then command-listener handles `!post approve`/`!post reject`/`!post new image` inline (same pattern as reels). Post commands are namespaced under `!post` (matching `!reel`). No cron scheduling for posts means no skip infrastructure needed.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM (SQLite), Telegram Bot API

**Unified Stage Numbering:**

| # | Shared | Post Pipeline | Reel Pipeline |
|---|--------|---------------|---------------|
| 0 | `stage0-pillar-balance` / `stage0-from-url` | ✓ | ✓ |
| 1 | `stage1-discover` | ✓ | ✓ |
| 1b | — | `post-stage1b-viral-check` (DS only) | — |
| 2 | — | `post-stage2-captions` (merged: captions+prompts) | `reel-stage2-script` |
| 3 | — | `post-stage3-image-gen` | `reel-stage3-voice` |
| 4 | — | `post-stage4-review-notify` (merged: review+notify) | `reel-stage4-images` |
| 5 | — | — | `reel-stage5-assemble` |

**Post Commands (new `!post` namespace, symmetric with `!reel`):**

| Command | Meaning |
|---------|---------|
| `!post` | Start post run (auto theme) |
| `!post <theme>` | Start with theme |
| `!post <url>` | Start from URL |
| `!post status` | Show post status |
| `!post list` | Show recent post runs |
| `!post approve all` | Publish all immediately |
| `!post approve all at HH:MM` | Schedule all |
| `!post approve N` | Publish post N immediately |
| `!post approve N at HH:MM` | Schedule post N |
| `!post reject` | Reject current run |
| `!post cancel` | Cancel running pipeline |
| `!post new image N` | Regenerate image |
| `!post new text N` | Regenerate caption + image |
| `!post reschedule N HH:MM` | Change post N schedule |
| `!post resume [id]` | Resume pending run |
| `!post weights` / `!post weight <t> <n>` | Theme weights |

**Top-level commands that remain:** `!help`, `!status` (combined shortcut), `!weights`, `!weight`, `!reel`, `!batch`

**Design decisions:**
- No DB migration for old stage names — old `stage_logs` keep old names, new runs get new names
- Stages are idempotent — resuming an old run after deploy re-runs a stage harmlessly
- `reel-` prefix kept on reel-specific stages (2-5) for clarity
- `post-` prefix added to post-specific stages (1b, 2, 3, 4) for symmetry
- Shared stages (0, 1) have no prefix
- Poller eliminated — command-listener handles approval inline (like reels)
- No skip infrastructure needed (post cron is disabled)
- Clean break on commands — old `!run`, `!approve`, `!reject` etc. removed, no backwards compat

---

## File Structure

### Files Created
| File | Responsibility |
|------|----------------|
| `src/pipeline/progress.ts` | `PostProgress` class mirroring `ReelProgress` |
| `src/stages/post-stage4-review-notify.ts` | Merged review URL + notification |

### Files Renamed (7)
| Old | New |
|-----|-----|
| `src/stages/stage1b-viral-check.ts` | `src/stages/post-stage1b-viral-check.ts` |
| `src/stages/stage2-captions.ts` | `src/stages/post-stage2-captions.ts` |
| `src/stages/stage3b-image-gen.ts` | `src/stages/post-stage3-image-gen.ts` |
| `src/stages/reel-stage1-script.ts` | `src/stages/reel-stage2-script.ts` |
| `src/stages/reel-stage2-voice.ts` | `src/stages/reel-stage3-voice.ts` |
| `src/stages/reel-stage3-images.ts` | `src/stages/reel-stage4-images.ts` |
| `src/stages/reel-stage4-assemble.ts` | `src/stages/reel-stage5-assemble.ts` |

### Files Deleted (7)
| File | Reason |
|------|--------|
| `src/approval/poller.ts` | Poller eliminated — command-listener handles approval |
| `src/stages/stage3-image-prompts.ts` | Merged into `post-stage2-captions` |
| `src/stages/stage4a-review.ts` | Merged into `post-stage4-review-notify` |
| `src/stages/stage4b-notify.ts` | Merged into `post-stage4-review-notify` |
| `src/stages/stage5-publish.ts` | Approval handled inline in command-listener |
| `bin/publish-due.ts` | Posts publish immediately on approval |
| *(old filenames after rename)* | Replaced by renamed files |

### Files Modified (7+)
| File | Changes |
|------|---------|
| `src/pipeline/runner.ts` | Remove `approveAndPublish`, `resumeApprovalPoller`, `_activePollers`, `_skipNextRun`, skip functions. Add timeouts, cancellation, progress. Update stage list and hooks. Runner stops after stage4. |
| `src/pipeline/reel-runner.ts` | Updated stage names/imports, timeout keys |
| `src/pipeline/command-listener.ts` | Add `!post` namespace, inline approval logic, remove `!run`/`!skip`/`!resume`/`!cancel` |
| `src/db/queries.ts` | Add `getStaleRunningRuns()` |
| `bin/server.ts` | Remove poller-resume startup code, add post heartbeat cron |
| `AGENTS.md` | Updated stage list, command docs, publish flow |
| Various test files | Updated imports and names |

---

## Task 1: Rename reel stages (reel-stage1→2, 2→3, 3→4, 4→5)

**Files:**
- Rename: 4 reel stage files
- Modify: `src/pipeline/reel-runner.ts`
- Modify: any test files importing reel stages

Purely mechanical rename — no logic changes.

- [ ] **Step 1: Rename files**

```bash
cd src/stages
git mv reel-stage1-script.ts reel-stage2-script.ts
git mv reel-stage2-voice.ts reel-stage3-voice.ts
git mv reel-stage3-images.ts reel-stage4-images.ts
git mv reel-stage4-assemble.ts reel-stage5-assemble.ts
```

- [ ] **Step 2: Update class names and `name` property in each file**

- `reel-stage2-script.ts`: class `ReelStage1Script` → `ReelStage2Script`, `name = "reel-stage2-script"`
- `reel-stage3-voice.ts`: class `ReelStage2Voice` → `ReelStage3Voice`, `name = "reel-stage3-voice"`
- `reel-stage4-images.ts`: class `ReelStage3Images` → `ReelStage4Images`, `name = "reel-stage4-images"`
- `reel-stage5-assemble.ts`: class `ReelStage4Assemble` → `ReelStage5Assemble`, `name = "reel-stage5-assemble"`

- [ ] **Step 3: Update reel-runner.ts imports and references**

Replace all imports:
```ts
const { ReelStage2Script } = await import("../stages/reel-stage2-script.js");
const { ReelStage3Voice } = await import("../stages/reel-stage3-voice.js");
const { ReelStage4Images } = await import("../stages/reel-stage4-images.js");
const { ReelStage5Assemble } = await import("../stages/reel-stage5-assemble.js");
```

Update all `new ReelStage1Script()` → `new ReelStage2Script()`, etc.

Update `STAGE_TIMEOUTS_MS` keys, `STAGE_LABELS` keys, `stageNames` arrays.

- [ ] **Step 4: Update test files**

Search for old class/file names in `tests/` and update.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: renumber reel stages 1→2, 2→3, 3→4, 4→5 (shared 0-1)"
```

---

## Task 2: Rename post stages with `post-` prefix + renumber stage3b→3

**Files:**
- Rename: 3 post stage files
- Modify: `src/pipeline/runner.ts`
- Modify: test files

- [ ] **Step 1: Rename files**

```bash
cd src/stages
git mv stage1b-viral-check.ts post-stage1b-viral-check.ts
git mv stage2-captions.ts post-stage2-captions.ts
git mv stage3b-image-gen.ts post-stage3-image-gen.ts
```

- [ ] **Step 2: Update class names and `name` property**

- `post-stage1b-viral-check.ts`: `Stage1bViralCheck` → `PostStage1bViralCheck`, `name = "post-stage1b-viral-check"`
- `post-stage2-captions.ts`: `Stage2Captions` → `PostStage2Captions`, `name = "post-stage2-captions"`
- `post-stage3-image-gen.ts`: `Stage3bImageGen` → `PostStage3ImageGen`, `name = "post-stage3-image-gen"`

- [ ] **Step 3: Update runner.ts imports and stage name checks**

All `Stage1bViralCheck` → `PostStage1bViralCheck`, etc.
All `stage.name === "stage2-captions"` → `stage.name === "post-stage2-captions"`, etc.

- [ ] **Step 4: Update test files**

Rename `tests/stage3b.test.ts` → `tests/post-stage3-image-gen.test.ts`, update imports.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename post stages with post- prefix, renumber stage3b→3"
```

---

## Task 3: Create PostProgress class

**Files:**
- Create: `src/pipeline/progress.ts`
- Create: `tests/post-progress.test.ts`

Mirrors `ReelProgress` from `reel-runner.ts:118-194` but for posts.

- [ ] **Step 1: Write the test**

Create `tests/post-progress.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/telegram.js", () => ({
  createTelegramService: vi.fn(() => ({
    sendMessageWithId: vi.fn().mockResolvedValue(42),
    editMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { PostProgress } from "../src/pipeline/progress.js";

describe("PostProgress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders initial pending state for all stages", () => {
    const p = new PostProgress("TestBrand", "run-123", [
      "post-stage2-captions",
      "post-stage3-image-gen",
      "post-stage4-review-notify",
    ]);
    const rendered = (p as any).render("running");
    expect(rendered).toContain("TestBrand");
    expect(rendered).toContain("◻️");
    expect(rendered).not.toContain("✅");
  });

  it("updates stage to running then ok", () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    p.stageStart("post-stage2-captions");
    let rendered = (p as any).render("running");
    expect(rendered).toContain("⏳");
    p.stageEnd("post-stage2-captions", 1500);
    rendered = (p as any).render("running");
    expect(rendered).toContain("✅");
    expect(rendered).toContain("(2s)");
  });

  it("renders error state", () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    p.stageEnd("post-stage2-captions", 100, "API error");
    const rendered = (p as any).render("failed", undefined, "API error");
    expect(rendered).toContain("❌");
  });

  it("init sends message and stores msgId", async () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    await p.init("chat-123");
    const msgId = (p as any).msgId;
    expect(msgId).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/post-progress.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PostProgress**

Create `src/pipeline/progress.ts`:

```ts
import { createTelegramService } from "../services/telegram.js";

const STAGE_LABELS: Record<string, string> = {
  "stage0-pillar-balance": "Balance",
  "stage0-from-url": "Discover",
  "stage1-discover": "Discover",
  "post-stage1b-viral-check": "Viral Check",
  "post-stage2-captions": "Captions + Prompts",
  "post-stage3-image-gen": "Image Gen",
  "post-stage4-review-notify": "Review + Notify",
};

export class PostProgress {
  private chatId: string | null = null;
  private msgId: number | null = null;
  private brandName: string;
  private runId: string;
  private stages: Array<{ name: string; label: string; status: "pending" | "running" | "ok" | "error"; durationMs?: number }>;
  private startTime = Date.now();

  constructor(brandName: string, runId: string, stageNames: string[]) {
    this.brandName = brandName;
    this.runId = runId;
    this.stages = stageNames.map((name) => ({
      name,
      label: STAGE_LABELS[name] ?? name,
      status: "pending" as const,
    }));
  }

  async init(chatId: string): Promise<void> {
    this.chatId = chatId;
    const telegram = createTelegramService();
    this.msgId = await telegram.sendMessageWithId(chatId, this.render("running"));
  }

  stageStart(name: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) s.status = "running";
    this.pushUpdate("running");
  }

  stageEnd(name: string, durationMs: number, error?: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) { s.status = error ? "error" : "ok"; s.durationMs = durationMs; }
    this.pushUpdate("running");
  }

  async finish(reviewUrl?: string): Promise<void> {
    await this.pushUpdateAsync("done", reviewUrl);
  }

  async fail(stageName: string, error: string): Promise<void> {
    const s = this.stages.find((s) => s.name === stageName);
    if (s) s.status = "error";
    await this.pushUpdateAsync("failed", undefined, error);
  }

  render(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): string {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const icon = state === "done" ? "✅" : state === "failed" ? "❌" : "⏳";
    const lines = [
      `${icon} <b>Posts ${state === "done" ? "ready" : state === "failed" ? "failed" : "in progress"} — ${this.brandName}</b>`,
      `ID: <code>${this.runId.slice(0, 8)}</code>  ⏱ ${elapsed}s`,
      "",
    ];
    for (const s of this.stages) {
      const dot = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : s.status === "running" ? "⏳" : "◻️";
      const dur = s.durationMs !== undefined ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
      lines.push(`${dot} ${s.label}${dur}`);
    }
    if (reviewUrl) { lines.push(""); lines.push(`🔗 <a href="${reviewUrl}">Review</a>`); }
    if (errorMsg) { lines.push(""); lines.push(`⚠️ <code>${errorMsg.slice(0, 200)}</code>`); }
    return lines.join("\n");
  }

  private pushUpdate(state: "running" | "done" | "failed"): void {
    this.pushUpdateAsync(state).catch(() => {});
  }

  private async pushUpdateAsync(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): Promise<void> {
    if (!this.chatId || !this.msgId) return;
    const telegram = createTelegramService();
    await telegram.editMessage(this.chatId, this.msgId, this.render(state, reviewUrl, errorMsg));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/post-progress.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/progress.ts tests/post-progress.test.ts
git commit -m "feat: add PostProgress class for live Telegram stage updates"
```

---

## Task 4: Merge stage3-image-prompts into post-stage2-captions

**Files:**
- Modify: `src/stages/post-stage2-captions.ts`
- Create: `tests/post-stage2-captions.test.ts`
- Delete: `src/stages/stage3-image-prompts.ts`

The merged stage generates caption + textOverlay + imagePrompt in one pass. New method `generatePromptForPost()` for approval command reuse.

- [ ] **Step 1: Write the test**

Create `tests/post-stage2-captions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostStage2Captions } from "../src/stages/post-stage2-captions.js";
import type { RunContext, Services, Post, Story } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";

function makeStory(pillar = "Breaking"): Story {
  return {
    index: 0, headline: "Test headline", source: "test.com",
    sourceUrl: "https://test.com/story", snippet: "snippet text",
    pillar, selectionReason: "reason", compositeScore: 7, verified: true,
  };
}

function makePost(index = 0, story?: Story): Post {
  return {
    index, story: story ?? makeStory(), pillar: story?.pillar ?? "Breaking",
    caption: "", textOverlay: "", imagePrompt: "",
    scheduledTime: "2026-04-21 08:00", approved: false,
  };
}

function makeServices(): Services {
  return {
    bedrock: {
      converse: vi.fn()
        .mockResolvedValueOnce("CAPTION:\n🔥 Breaking news!\n\nBody text here.\n\nComment below 👇\n\nVia test.com\n\n#test\n\nTEXT_OVERLAY:\nBREAKING NEWS")
        .mockResolvedValueOnce('{"VISUAL_SUBJECT": "fire truck", "MOOD": "urgent", "STORY_COLOUR": "red and orange"}'),
    },
    search: {} as any,
    gemini: {} as any,
    imageGen: {} as any,
    stockImage: {} as any,
    gcs: {} as any,
    telegram: {} as any,
    line: {} as any,
    meta: {} as any,
  };
}

describe("PostStage2Captions (merged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates caption, textOverlay AND imagePrompt in one stage", async () => {
    const stage = new PostStage2Captions();
    const story = makeStory("Breaking");
    const ctx: RunContext = {
      runId: "test", brand: getBrand("ns"), runDate: "2026-04-21",
      pillarBalance: { deprioritise: [], prioritise: [] },
      stories: [story], posts: [], stageLogs: [], status: "running",
    };
    const services = makeServices();
    const result = await stage.run(ctx, services);
    expect(result.posts).toHaveLength(1);
    const post = result.posts![0];
    expect(post.caption).toContain("Breaking news");
    expect(post.textOverlay).toBeTruthy();
    expect(post.imagePrompt).toContain("fire truck");
    expect(post.imagePrompt).toContain("BREAKING NEWS");
  });

  it("generateForPost returns caption + textOverlay", async () => {
    const stage = new PostStage2Captions();
    const story = makeStory("Breaking");
    const services = makeServices();
    const { caption, textOverlay } = await stage.generateForPost(story, getBrand("ns"), undefined, services);
    expect(caption).toBeTruthy();
    expect(textOverlay).toBeTruthy();
  });

  it("generatePromptForPost generates imagePrompt", async () => {
    const stage = new PostStage2Captions();
    const post = makePost();
    const services = makeServices();
    await stage.generatePromptForPost(post, services);
    expect(post.imagePrompt).toContain("fire truck");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/post-stage2-captions.test.ts`
Expected: FAIL

- [ ] **Step 3: Modify post-stage2-captions.ts**

**3a.** Add the `PillarStyle` interface and `pillarStyles` / `defaultStyle` objects from `stage3-image-prompts.ts` (lines 3-86) into `post-stage2-captions.ts` after the existing theme modifier constants.

**3b.** Add new method `generatePromptForPost()`:

```ts
async generatePromptForPost(post: Post, services: Services): Promise<void> {
  const systemPrompt = `You are a visual art director creating image prompts for AI image generation.
Extract visual elements from the story and combine with style guidance.
Respond with ONLY a JSON object, no markdown.`;

  const message = `Extract visual elements from this news story:
Headline: ${post.story.headline}
Snippet: ${post.story.snippet.slice(0, 300)}

Return JSON: {"VISUAL_SUBJECT": "...", "MOOD": "...", "STORY_COLOUR": "..."}
VISUAL_SUBJECT: the most specific visual element of this story (object/place/scene — no real people's faces, no trademarked logos)
MOOD: one word emotional tone (e.g. urgent, celebratory, thought-provoking, surprising, alarming)
STORY_COLOUR: dominant colour palette fitting this specific story (e.g. "deep navy and crimson", "warm gold and orange", "electric blue and white")`;

  const elementsResponse = await services.bedrock.converse(systemPrompt, message);

  let elements = { VISUAL_SUBJECT: "abstract editorial scene", MOOD: "neutral", STORY_COLOUR: "blue and white" };
  try {
    const json = elementsResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    elements = JSON.parse(json);
  } catch {}

  const style = pillarStyles[post.pillar] ?? defaultStyle;
  post.imagePrompt = [
    elements.VISUAL_SUBJECT,
    `${elements.STORY_COLOUR} ${style.composition}`,
    `${elements.MOOD} atmosphere`,
    `large bold sans-serif text reading exactly: ${post.textOverlay}, positioned ${style.textPosition}, ${style.textOnBg}, high contrast for legibility`,
    "no faces, no trademarked logos",
    "square 1:1 aspect ratio, no UI elements, no social media interface, no frames, no borders",
  ].join(", ");
}
```

**3c.** Modify `run()` to call `generatePromptForPost` after creating each post:

```ts
async run(ctx: RunContext, services: Services): Promise<Partial<RunContext>> {
  const { brand, stories, theme, runDate } = ctx;
  const posts: Post[] = [];

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const scheduledTime = `${runDate} ${brand.postTimes[i] ?? brand.postTimes[0]}`;
    const { caption, textOverlay } = await this.generateForPost(story, brand, theme, services);
    const post: Post = {
      index: i,
      story,
      pillar: story.pillar,
      caption,
      textOverlay,
      imagePrompt: "",
      scheduledTime,
      approved: false,
    };
    await this.generatePromptForPost(post, services);
    posts.push(post);
  }

  return { posts };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/post-stage2-captions.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Delete stage3-image-prompts.ts**

```bash
rm src/stages/stage3-image-prompts.ts
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: merge image prompts into post-stage2-captions, delete stage3-image-prompts"
```

---

## Task 5: Create post-stage4-review-notify (merge 4a+4b)

**Files:**
- Create: `src/stages/post-stage4-review-notify.ts`
- Create: `tests/post-stage4-review-notify.test.ts`
- Delete: `src/stages/stage4a-review.ts`
- Delete: `src/stages/stage4b-notify.ts`

- [ ] **Step 1: Write the test**

Create `tests/post-stage4-review-notify.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PostStage4ReviewNotify } from "../src/stages/post-stage4-review-notify.js";
import type { RunContext, Services } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";

vi.mock("../src/db/queries.js", () => ({
  updateRunReviewUrl: vi.fn(),
}));

vi.mock("../src/services/messaging.js", () => ({
  getEnabledChannels: vi.fn(() => [
    { name: "telegram", send: vi.fn().mockResolvedValue(undefined) },
  ]),
}));

function makeCtx(): RunContext {
  return {
    runId: "test-run", brand: getBrand("ns"), runDate: "2026-04-21",
    pillarBalance: { deprioritise: [], prioritise: [] },
    stories: [], posts: [
      { index: 0, story: { index: 0, headline: "Test", source: "t.com", sourceUrl: "https://t.com", snippet: "", pillar: "Breaking", selectionReason: "", compositeScore: 0, verified: true }, pillar: "Breaking", caption: "cap", textOverlay: "ov", imagePrompt: "", scheduledTime: "08:00", approved: false },
    ],
    stageLogs: [], status: "running",
  };
}

describe("PostStage4ReviewNotify", () => {
  it("sets reviewUrl and sends notification", async () => {
    const stage = new PostStage4ReviewNotify();
    const services = {
      telegram: { send: vi.fn() },
      line: null,
    } as any as Services;
    const result = await stage.run(makeCtx(), services);
    expect(result.reviewUrl).toContain("/review/ns/test-run");
    expect(result.status).toBe("awaiting_approval");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/post-stage4-review-notify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement merged stage**

Create `src/stages/post-stage4-review-notify.ts` — combines the logic from `stage4a-review.ts` (build review URL, persist to DB) and `stage4b-notify.ts` (send notification via messaging channels). See existing `src/stages/stage4a-review.ts` and `src/stages/stage4b-notify.ts` for the exact code to merge.

Class: `PostStage4ReviewNotify`, `name = "post-stage4-review-notify"`
Imports: `updateRunReviewUrl` from queries, `getEnabledChannels` from messaging
Returns: `{ reviewUrl, status: "awaiting_approval" }`

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/post-stage4-review-notify.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Delete old files**

```bash
rm src/stages/stage4a-review.ts src/stages/stage4b-notify.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: merge stage4a+4b into post-stage4-review-notify"
```

---

## Task 6: Update runner — stage list, hooks, delete stage5, remove poller/skip

**Files:**
- Modify: `src/pipeline/runner.ts`

This is the big one. The runner becomes a pure stage executor.

- [ ] **Step 1: Remove all poller infrastructure**

Delete from runner.ts:
- `import { RacingPoller, SupersededError }` and all poller-related imports in `approveAndPublish`
- The entire `approveAndPublish()` method (lines ~358-592)
- The entire `resumeApprovalPoller()` method (lines ~137-190)
- `_activePollers` set and `isPollerActive()`, `getActivePollerRunIds()`

- [ ] **Step 2: Remove all skip infrastructure**

Delete from runner.ts:
- `_skipNextRun` set
- `setSkipNextRun()`, `cancelSkipNextRun()`, `isSkipNextRun()`, `consumeSkipNextRun()`

- [ ] **Step 3: Update stage list**

Remove imports for `Stage3ImagePrompts`, `Stage5Publish`, `Stage4aReview`, `Stage4bNotify`.
Update to `PostStage1bViralCheck`, `PostStage2Captions`, `PostStage3ImageGen`, `PostStage4ReviewNotify`.

Stage list:
```ts
const stages: Stage[] = options.sourceUrls?.length
  ? [
      new Stage0FromUrl(options.sourceUrls),
      new PostStage2Captions(),
    ]
  : [
      new Stage0PillarBalance(),
      new Stage1Discover(),
      ...(brand.viralCheck ? [new PostStage1bViralCheck()] : []),
      new PostStage2Captions(),
    ];
stages.push(
  new PostStage3ImageGen(),
  new PostStage4ReviewNotify(),
);
```

- [ ] **Step 4: Update after-stage hooks**

```ts
if (stage.name === "post-stage2-captions") {
  for (const post of ctx.posts) {
    queries.updatePost(runId, post.index, {
      caption: post.caption,
      textOverlay: post.textOverlay,
      imagePrompt: post.imagePrompt,
    });
  }
}
if (stage.name === "post-stage3-image-gen") {
  for (const post of ctx.posts) {
    queries.updatePost(runId, post.index, {
      ...(post.imagePath ? { imagePath: post.imagePath } : {}),
      imageFailed: post.imageFailed ?? false,
    });
  }
}
```

Delete old hooks for `stage2-captions`, `stage3-image-prompts`, `stage3b-image-gen`.

- [ ] **Step 5: Update `run()` method**

Remove `approveAndPublish` call. After stages complete:
```ts
ctx = await PipelineRunner.runStages(runId, ctx, stages, services, options, new Set(), progress);

if (options.dryRun || options.stageFilter !== undefined) return ctx;

// Runner's job is done — set awaiting_approval status
queries.updateRunStatus(runId, "awaiting_approval", { reviewUrl: ctx.reviewUrl });
ctx.status = "awaiting_approval";

if (chatId) await progress.finish(ctx.reviewUrl);
return ctx;
```

- [ ] **Step 6: Update `resume()` method**

Remove `approveAndPublish` call at the end. Same pattern — resume runs stages, then returns with `awaiting_approval`.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: ALL PASS (runner.test.ts is lightweight, tests dryRun path)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove poller, skip, approveAndPublish from runner — pure stage executor"
```

---

## Task 7: Fix post-stage3 — remove direct DB persistence

**Files:**
- Modify: `src/stages/post-stage3-image-gen.ts`
- Modify: `tests/post-stage3-image-gen.test.ts`

- [ ] **Step 1: Remove `updatePost()` calls from post-stage3-image-gen.ts**

Remove `import { updatePost } from "../db/queries.js";`
Remove all three `updatePost()` calls. Method only mutates `post` object in memory.

- [ ] **Step 2: Update test**

Remove `vi.mock("../src/db/queries.js")` from `tests/post-stage3-image-gen.test.ts`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: post-stage3 no longer persists directly — runner handles DB"
```

---

## Task 8: Add per-stage timeouts

**Files:**
- Modify: `src/pipeline/runner.ts`

- [ ] **Step 1: Add timeout constants and helper**

```ts
const STAGE_TIMEOUTS_MS: Record<string, number> = {
  "stage0-pillar-balance": 1 * 60_000,
  "stage0-from-url":       2 * 60_000,
  "stage1-discover":       3 * 60_000,
  "post-stage1b-viral-check": 1 * 60_000,
  "post-stage2-captions":  3 * 60_000,
  "post-stage3-image-gen": 5 * 60_000,
  "post-stage4-review-notify": 30_000,
};

async function withTimeout<T>(name: string, promise: Promise<T>): Promise<T> {
  const ms = STAGE_TIMEOUTS_MS[name] ?? 3 * 60_000;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Stage "${name}" timed out after ${ms / 1000}s`)), ms)
  );
  return Promise.race([promise, timeout]);
}
```

- [ ] **Step 2: Wrap `stage.run()` in runStages**

```ts
const partial = await withTimeout(stage.name, stage.run(ctx, services));
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "feat: add per-stage timeouts to post pipeline"
```

---

## Task 9: Add cancellation support

**Files:**
- Modify: `src/pipeline/runner.ts`

- [ ] **Step 1: Add cancellation flags**

```ts
const _cancelRequestedBrands = new Set<string>();
export function requestCancelRun(brandId: string): void { _cancelRequestedBrands.add(brandId); }
export function isCancelRequested(brandId: string): boolean { return _cancelRequestedBrands.has(brandId); }
```

- [ ] **Step 2: Check between stages**

In `runStages`, at start of loop:
```ts
if (isCancelRequested(ctx.brand.id)) {
  _cancelRequestedBrands.delete(ctx.brand.id);
  queries.updateRunStatus(runId, "cancelled");
  ctx.status = "cancelled";
  throw new Error("Run cancelled by user");
}
```

In catch block: `_cancelRequestedBrands.delete(ctx.brand.id);`

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "feat: add cancellation support to post pipeline"
```

---

## Task 10: Wire PostProgress into runner

**Files:**
- Modify: `src/pipeline/runner.ts`

- [ ] **Step 1: Add progress parameter to runStages**

Add optional `progress?: import("./progress.js").PostProgress` as last parameter.

- [ ] **Step 2: Add progress calls**

Before try: `progress?.stageStart(stage.name);`
After success: `progress?.stageEnd(stage.name, Date.now() - start);`
In catch: `progress?.fail(stage.name, error);`

- [ ] **Step 3: Initialize progress in run()**

```ts
const { PostProgress } = await import("./progress.js");
const postStageNames = stages.map((s) => s.name);
const progress = new PostProgress(brand.name, runId, postStageNames);

const tgConfig = brand.channels.telegram;
const chatId = tgConfig?.enabled ? (process.env[tgConfig.chatIdEnvVar] ?? null) : null;
if (chatId) await progress.init(chatId);
```

Pass `progress` to `runStages`. After stages: `if (chatId) await progress.finish(ctx.reviewUrl);`

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "feat: wire PostProgress into post pipeline runner"
```

---

## Task 11: Delete poller, remove poller-resume from server

**Files:**
- Delete: `src/approval/poller.ts`
- Modify: `bin/server.ts`

- [ ] **Step 1: Delete poller**

```bash
rm src/approval/poller.ts
```

- [ ] **Step 2: Remove poller-resume from server.ts**

Delete the "Resume approval pollers" section (~lines 376-390):
```ts
// Delete this entire block:
const awaitingRuns = getAwaitingApprovalRuns();
...
PipelineRunner.resumeApprovalPoller(run.id);
```

Remove `getAwaitingApprovalRuns` from imports if no longer used.

- [ ] **Step 3: Remove skip-related imports from server.ts**

Remove `consumeSkipNextRun` from imports (no longer used by cron since post cron is disabled).

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "refactor: delete poller, remove poller-resume from server startup"
```

---

## Task 12: Refactor command-listener — add `!post` namespace, inline approval

**Files:**
- Modify: `src/pipeline/command-listener.ts`

This is the largest task. The command-listener gains a `!post` handler that handles all post operations inline (like the `!reel` handler).

- [ ] **Step 1: Add `!post` handler (parallel structure to `!reel` handler)**

Add after the `!reel` handler (~line 968):

```ts
// ── !post [subcommand|theme|url] — post commands ──────────────────────────────
if (t === "post" || t.startsWith("post ")) {
  const subCmd = t === "post" ? "" : t.slice(5).trim();

  // !post (no subcommand) = start run (like !reel with no subcommand)
  // !post <theme> = start run with theme
  // !post <url> = start run from URL

  // !post status — show post status
  // !post list — show recent post runs
  // !post approve all / N — publish immediately
  // !post approve all at HH:MM / N at HH:MM — schedule
  // !post reject — reject current run
  // !post cancel — cancel running pipeline
  // !post new image N — regenerate image
  // !post new text N — regenerate caption + image
  // !post reschedule N HH:MM — change schedule
  // !post resume [id] — resume pending run
  // !post weights / post weight <t> <n> — theme weights
}
```

- [ ] **Step 2: Implement `!post` (no subcommand) — start run**

Same logic as current `!run` handler but triggered by `!post` or `!post <theme>` or `!post <url>`. Use the existing `parseRunCommand` helper (adapted).

- [ ] **Step 3: Implement `!post approve` — inline publish**

Look up the latest `awaiting_approval` run from DB. Load its posts. Publish via Meta API (same as current `approveAndPublish` publish-now path). Update DB.

For `!post approve all at HH:MM` — update scheduledTime in DB, set status to `approved`.

- [ ] **Step 4: Implement `!post reject`**

Look up latest `awaiting_approval` run, set status to `rejected`.

- [ ] **Step 5: Implement `!post cancel`**

Call `requestCancelRun(brandId)`.

- [ ] **Step 6: Implement `!post new image N` and `!post new text N`**

Reconstruct context from DB (same pattern as `resumeApprovalPoller`):
1. Load run from DB
2. Load stories and posts from DB
3. Instantiate stages (`PostStage2Captions`, `PostStage3ImageGen`, `PostStage4ReviewNotify`)
4. Run regeneration
5. Update review page
6. Broadcast notification

Extract this into a helper function `reconstructPostContext(runId)` that returns `{ ctx, stage2, stage3, stage4, services }`.

- [ ] **Step 7: Implement `!post reschedule N HH:MM`**

Look up run, update post's scheduledTime in DB.

- [ ] **Step 8: Implement `!post resume [id]`**

Look up pending run (or specific run by short ID), call `PipelineRunner.resume()` or a new resume-by-ID method.

- [ ] **Step 9: Implement `!post list`**

Show recent post runs with short IDs, status, review links (parallel to `!reel list`).

- [ ] **Step 10: Implement `!post status`**

Show current run status (reuse existing `!status` post logic).

- [ ] **Step 11: Remove old handlers**

Delete:
- `!run` handler and `parseRunCommand` function
- `!resume` handler
- `!skip` / `!skip cancel` handler
- `!cancel` handler
- Top-level approval command handling (the `isApprovalCommand` block)

Update `!status` to remain as a combined shortcut (shows both post + reel status).

Update `!help` text to show new `!post` commands instead of old top-level commands.

- [ ] **Step 12: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "feat: add !post namespace, inline approval, remove poller dependency"
```

---

## Task 13: Remove skip infrastructure

**Files:**
- Modify: `src/pipeline/command-listener.ts` (remove skip imports)
- Modify: `bin/server.ts` (remove skip cron code)

- [ ] **Step 1: Remove skip imports from command-listener**

Remove `setSkipNextRun`, `cancelSkipNextRun`, `isSkipNextRun` from runner imports.

- [ ] **Step 2: Remove skip cron code from server.ts**

Remove the `consumeSkipNextRun` calls from the post cron handler (which is already disabled, but clean up the code).

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "refactor: remove skip infrastructure (no post auto-scheduling)"
```

---

## Task 14: Delete publish-due + stage5, add post heartbeat

**Files:**
- Delete: `bin/publish-due.ts`
- Delete: `src/stages/stage5-publish.ts`
- Modify: `src/db/queries.ts`
- Modify: `bin/server.ts`

- [ ] **Step 1: Delete files**

```bash
rm bin/publish-due.ts src/stages/stage5-publish.ts
```

- [ ] **Step 2: Add `getStaleRunningRuns` to queries.ts**

```ts
export function getStaleRunningRuns(maxMinutes: number) {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString();
  return db.select().from(runs)
    .where(and(
      eq(runs.status, "running"),
      lt(runs.updatedAt, cutoff),
    ))
    .all();
}
```

Import `lt` from `drizzle-orm`.

- [ ] **Step 3: Add post heartbeat cron to server.ts**

After reel heartbeat:

```ts
cron.schedule("* * * * *", async () => {
  const stale = getStaleRunningRuns(30);
  for (const run of stale) {
    console.warn(`[post-heartbeat] stale run: ${run.id.slice(0, 8)} brand=${run.brand}`);
    updateRunStatus(run.id, "failed");
    const brand = getBrand(run.brand as BrandId);
    const channels = getEnabledChannels(brand, telegram, line);
    await Promise.all(channels.map((ch) =>
      ch.send(`⚠️ Pipeline timed out — ${brand.name}\n<code>${run.id.slice(0, 8)}</code>\nMarked as failed.`).catch(() => {})
    ));
  }
});
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run && npm run build`
Expected: ALL PASS, no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove publish-due cron and stage5; add post heartbeat"
```

---

## Task 15: Update AGENTS.md and help text

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/pipeline/command-listener.ts` (help text)

- [ ] **Step 1: Update AGENTS.md**

Architecture section — new stage list:
```
Shared: stage0 (pillar-balance / from-url), stage1 (discover)
Posts: post-stage1b (viral-check, DS only), post-stage2 (captions+prompts), post-stage3 (image-gen), post-stage4 (review+notify)
Reels: reel-stage2 (script), reel-stage3 (voice), reel-stage4 (images), reel-stage5 (assemble)
```

Remove: Stage5Publish, poller, publish-due cron, skip commands.

Approval workflow: `!post approve` publishes immediately, `!post approve at HH:MM` schedules.

- [ ] **Step 2: Update help text in command-listener**

Replace "Pipeline" section with "Posts" section using `!post` commands.
Remove "Approval" section (now under "Posts").
Add `!post cancel`.

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run && git add -A && git commit -m "docs: update AGENTS.md and help text for refactored pipeline"
```

---

## Task 16: Final build verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: TypeScript build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: No orphaned references**

```bash
rg -l "stage3-image-prompts|stage4a-review|stage4b-notify|stage5-publish|publish-due|Stage3ImagePrompts|Stage5Publish|Stage4aReview|Stage4bNotify|Stage1bViralCheck|Stage2Captions|Stage3bImageGen|ReelStage1Script|ReelStage2Voice|ReelStage3Images|ReelStage4Assemble|approveAndPublish|resumeApprovalPoller|RacingPoller|SupersededError|_activePollers|_skipNextRun|setSkipNextRun|consumeSkipNextRun" src/ bin/ tests/
```
Expected: No results

---

## Summary of Changes

| Change | Before | After |
|--------|--------|-------|
| Stage naming | No prefix for posts, `reel-` for reels | `post-` for posts, `reel-` for reels, no prefix for shared (0,1) |
| Reel numbering | reel-stage1→4 | reel-stage2→5 (shared 0-1) |
| Post stages | 8 (stage0→stage5) | 5 post-specific (post-stage1b through post-stage4) |
| Caption+Prompt | 2 stages | 1 stage (`post-stage2-captions`) |
| Review+Notify | 2 stages | 1 stage (`post-stage4-review-notify`) |
| Approval flow | Long-lived poller (`RacingPoller`) | Inline in command-listener (like reels) |
| Commands | `!run`, `!approve`, `!reject` etc. (top-level) | `!post run`, `!post approve`, `!post reject` (namespaced) |
| Publish flow | approve → cron publishes | approve → publish immediately; approve HH:MM → schedule |
| Skip infrastructure | `_skipNextRun` set + cron integration | Removed (no post auto-scheduling) |
| Poller | `src/approval/poller.ts` + resume on startup | Deleted |
| DB persistence | stage3b calls updatePost() directly | Runner persists after each stage |
| Timeouts | None | Per-stage (30s–5min) |
| Cancellation | None | `!post cancel` |
| Progress tracking | None | PostProgress live Telegram updates |
| Stale run detection | Reels only | Both reels and posts |
| publish-due cron | Standalone script | Deleted |
| Files deleted | — | 7 files (poller, stage3, stage4a, stage4b, stage5, publish-due) |
