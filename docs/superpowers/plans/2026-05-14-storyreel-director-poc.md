# StoryReel Director POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated director-only TypeScript POC that sends local raw clips to Gemini and saves structured edit direction for manual review.

**Architecture:** Keep production pipeline code untouched. Put prompt construction, JSON parsing, validation, summary formatting, and CLI argument parsing in a small testable module under `src/storyreel/`; put the Gemini upload/generate orchestration in the same module behind an injectable client interface; put the runnable CLI wrapper in `scripts/storyreel-director-poc.ts`.

**Tech Stack:** Node 22, TypeScript ESM, `@google/genai`, Vitest, local filesystem artifacts under `work/storyreel-poc/`.

---

## File Structure

- Create `src/storyreel/director-poc.ts`: pure types/helpers plus the minimal Gemini orchestration function. This file owns CLI parsing, prompt generation, director JSON parsing, validation, summary rendering, artifact writing, and `runStoryReelDirectorPoc`.
- Create `scripts/storyreel-director-poc.ts`: tiny executable entrypoint that calls `runStoryReelDirectorPoc(process.argv.slice(2))` and exits non-zero on errors.
- Create `tests/storyreel-director-poc.test.ts`: unit tests for parsing, prompt content, JSON cleanup, validation failures, summary output, and artifact writing using a fake Gemini client.
- Modify no existing reel pipeline files.

## Task 1: Test CLI Parsing And Prompt Shape

**Files:**
- Create: `tests/storyreel-director-poc.test.ts`
- Create: `src/storyreel/director-poc.ts`

- [ ] **Step 1: Write failing tests for CLI parsing and prompt content**

Create `tests/storyreel-director-poc.test.ts` with these initial tests:

```ts
import { describe, expect, it } from "vitest";
import { buildDirectorPrompt, parseArgs } from "../src/storyreel/director-poc.js";

describe("StoryReel director POC", () => {
  it("parses required CLI arguments", () => {
    const args = parseArgs([
      "--clips", "clip1.mp4", "clip2.mov",
      "--product", "Testing story",
      "--note", "surprising value from Germany",
      "--language", "thai",
    ]);

    expect(args).toEqual({
      clips: ["clip1.mp4", "clip2.mov"],
      product: "Testing story",
      note: "surprising value from Germany",
      language: "thai",
      outputBaseDir: "work/storyreel-poc",
    });
  });

  it("defaults language, note, product, and output directory", () => {
    const args = parseArgs(["--clips", "clip1.mp4"]);

    expect(args).toEqual({
      clips: ["clip1.mp4"],
      product: "Testing story",
      note: "",
      language: "thai",
      outputBaseDir: "work/storyreel-poc",
    });
  });

  it("rejects missing clips", () => {
    expect(() => parseArgs(["--product", "Testing story"])).toThrow("Usage:");
  });

  it("builds a strict director prompt", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 2,
      product: "Dyson Airwrap",
      note: "focus on the packaging",
      language: "thai",
    });

    expect(prompt).toContain("CONTENT: 2 raw clip(s) of: Dyson Airwrap");
    expect(prompt).toContain("CREATOR'S NOTE");
    expect(prompt).toContain("focus on the packaging");
    expect(prompt).toContain("LANGUAGE: Thai");
    expect(prompt).toContain("Return ONLY valid JSON");
    expect(prompt).toContain("\"hook_clip\"");
    expect(prompt).toContain("\"voiceover_script\"");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: FAIL because `src/storyreel/director-poc.ts` does not exist.

- [ ] **Step 3: Add minimal exported types, parser, and prompt builder**

Create `src/storyreel/director-poc.ts`:

```ts
import fs from "fs";
import path from "path";
import { GoogleGenAI, createPartFromText, createPartFromUri, type File } from "@google/genai";

export type StoryReelLanguage = "thai" | "english";

export interface StoryReelCliArgs {
  clips: string[];
  product: string;
  note: string;
  language: StoryReelLanguage;
  outputBaseDir: string;
}

export interface BuildDirectorPromptInput {
  clipCount: number;
  product: string;
  note: string;
  language: StoryReelLanguage;
}

export interface StoryReelDirectorDirection {
  hook_clip: {
    clip_index: number;
    start_sec: number;
    end_sec: number;
    reason: string;
  };
  clips: Array<{
    clip_index: number;
    start_sec: number;
    end_sec: number;
    order: number;
    role: string;
  }>;
  voiceover_script: {
    full_text: string;
    segments?: Array<{
      order: number;
      text: string;
      duration_sec: number;
    }>;
  };
  hook_text_overlay: string;
  caption_lines: string[];
  cta_text: string;
  facebook_caption: string;
  hashtags: string[];
  total_duration_sec: number;
  director_notes: string;
}

export interface StoryReelGeminiClient {
  uploadFile(filePath: string, mimeType: string): Promise<{ uri: string; mimeType: string; name?: string }>;
  generateDirection(parts: Array<{ uri: string; mimeType: string }>, prompt: string): Promise<string>;
}

const DEFAULT_OUTPUT_BASE_DIR = "work/storyreel-poc";
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv"]);

function usage(): string {
  return `Usage: tsx scripts/storyreel-director-poc.ts --clips <clip...> [--product <name>] [--note <text>] [--language thai|english] [--output-dir <dir>]`;
}

export function parseArgs(argv: string[]): StoryReelCliArgs {
  const clips: string[] = [];
  let product = "Testing story";
  let note = "";
  let language: StoryReelLanguage = "thai";
  let outputBaseDir = DEFAULT_OUTPUT_BASE_DIR;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clips") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        clips.push(argv[++i]);
      }
    } else if (arg === "--product") {
      product = argv[++i] ?? "";
    } else if (arg === "--note") {
      note = argv[++i] ?? "";
    } else if (arg === "--language") {
      const value = argv[++i];
      if (value !== "thai" && value !== "english") throw new Error(`${usage()}\nInvalid --language: ${value}`);
      language = value;
    } else if (arg === "--output-dir") {
      outputBaseDir = argv[++i] ?? "";
    } else {
      throw new Error(`${usage()}\nUnknown argument: ${arg}`);
    }
  }

  if (clips.length === 0) throw new Error(`${usage()}\nMissing --clips`);
  if (!product.trim()) throw new Error(`${usage()}\n--product cannot be empty`);
  if (!outputBaseDir.trim()) throw new Error(`${usage()}\n--output-dir cannot be empty`);

  return { clips, product, note, language, outputBaseDir };
}

export function buildDirectorPrompt(input: BuildDirectorPromptInput): string {
  const langLabel = input.language === "thai" ? "Thai" : "English";
  const ctaExample = input.language === "thai"
    ? "ติดตามเพื่อดูรีวิวจากยุโรปแบบนี้ทุกสัปดาห์"
    : "Follow for more honest reviews from Europe every week";
  const noteSection = input.note.trim()
    ? `\nCREATOR'S NOTE: ${input.note.trim()}\n`
    : "";

  return `You are an expert social media video director for vertical Facebook Reels, Instagram Reels, and TikTok.

TARGET AUDIENCE: Thai people aged 25-45 who enjoy honest product, travel, or experience stories from Europe.
FORMAT: 9:16 portrait short video.
LANGUAGE: ${langLabel} voiceover, captions, hook, CTA, and Facebook caption.
CONTENT: ${input.clipCount} raw clip(s) of: ${input.product}
${noteSection}
YOUR JOB:
- Watch every clip fully.
- Select only the strongest visual moments.
- Put the best hook first, even if it was filmed later.
- Create a coherent story arc from the selected moments.
- Write natural ${langLabel}, not translationese.
- Keep overlay text short enough for a phone screen.

Return ONLY valid JSON with this exact shape and no markdown fences:
{
  "hook_clip": { "clip_index": 0, "start_sec": 0, "end_sec": 3, "reason": "why this works as the hook" },
  "clips": [
    { "clip_index": 0, "start_sec": 0, "end_sec": 8, "order": 1, "role": "hook|setup|demo|detail|verdict" }
  ],
  "voiceover_script": {
    "full_text": "complete spoken script",
    "segments": [
      { "order": 1, "text": "script for this selected clip", "duration_sec": 8 }
    ]
  },
  "hook_text_overlay": "short hook text, max 8 words",
  "caption_lines": ["short caption 1", "short caption 2", "short caption 3", "short caption 4"],
  "cta_text": "${ctaExample}",
  "facebook_caption": "2-3 sentence post caption",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "total_duration_sec": 45,
  "director_notes": "brief explanation of creative choices"
}

RULES:
- Use zero-based clip_index values matching the uploaded clip order.
- start_sec and end_sec must be seconds within the source clip.
- end_sec must be greater than start_sec.
- Prefer 3-10 second selections per clip.
- You may skip weak clips.
- Use the CTA style: ${ctaExample}`;
}
```

- [ ] **Step 4: Run tests to verify parser and prompt pass**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS for the current tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/storyreel/director-poc.ts tests/storyreel-director-poc.test.ts
git commit -m "test: add StoryReel director POC prompt helpers"
```

## Task 2: Validate Director JSON And Build Summary

**Files:**
- Modify: `tests/storyreel-director-poc.test.ts`
- Modify: `src/storyreel/director-poc.ts`

- [ ] **Step 1: Add failing tests for JSON parsing, validation, and summaries**

Append these tests inside the existing `describe` block in `tests/storyreel-director-poc.test.ts`:

```ts
  it("parses Gemini JSON wrapped in markdown fences", () => {
    const raw = "```json\n" +
      "{\"hook_clip\":{\"clip_index\":0,\"start_sec\":1,\"end_sec\":4,\"reason\":\"clear reveal\"},\"clips\":[{\"clip_index\":0,\"start_sec\":1,\"end_sec\":4,\"order\":1,\"role\":\"hook\"}],\"voiceover_script\":{\"full_text\":\"สคริปต์ทดสอบ\"},\"hook_text_overlay\":\"คุ้มไหม\",\"caption_lines\":[\"เริ่มจากจุดนี้\"],\"cta_text\":\"ติดตามต่อ\",\"facebook_caption\":\"แคปชั่นทดสอบ\",\"hashtags\":[\"#Test\"],\"total_duration_sec\":3,\"director_notes\":\"ใช้ช่วงเปิดกล่อง\"}\n" +
      "```";
    const direction = parseDirectorJson(raw);

    expect(direction.hook_clip.reason).toBe("clear reveal");
    expect(direction.voiceover_script.full_text).toBe("สคริปต์ทดสอบ");
  });

  it("validates usable direction", () => {
    const direction = sampleDirection();

    expect(validateDirection(direction, 2)).toEqual([]);
  });

  it("reports invalid clip indices and timestamps", () => {
    const direction = sampleDirection();
    direction.clips[0].clip_index = 3;
    direction.clips[0].end_sec = direction.clips[0].start_sec;

    expect(validateDirection(direction, 2)).toEqual([
      "clips[0].clip_index 3 is outside uploaded clip range 0-1",
      "clips[0].end_sec must be greater than start_sec",
    ]);
  });

  it("builds a readable summary", () => {
    const summary = buildSummary(sampleDirection(), ["clip1.mp4", "clip2.mp4"]);

    expect(summary).toContain("StoryReel Director POC Summary");
    expect(summary).toContain("Hook: clip 1 1.00s-4.00s");
    expect(summary).toContain("1. clip 1 1.00s-4.00s [hook]");
    expect(summary).toContain("Voiceover Script");
    expect(summary).toContain("Facebook Caption");
  });
```

Also add the imports and helper below the existing import block:

```ts
import {
  buildSummary,
  parseDirectorJson,
  validateDirection,
  type StoryReelDirectorDirection,
} from "../src/storyreel/director-poc.js";

function sampleDirection(): StoryReelDirectorDirection {
  return {
    hook_clip: { clip_index: 0, start_sec: 1, end_sec: 4, reason: "clear reveal" },
    clips: [
      { clip_index: 0, start_sec: 1, end_sec: 4, order: 1, role: "hook" },
      { clip_index: 1, start_sec: 2, end_sec: 8, order: 2, role: "demo" },
    ],
    voiceover_script: { full_text: "สคริปต์ทดสอบ" },
    hook_text_overlay: "คุ้มไหม",
    caption_lines: ["เริ่มจากจุดนี้", "ดูผลลัพธ์"],
    cta_text: "ติดตามต่อ",
    facebook_caption: "แคปชั่นทดสอบ",
    hashtags: ["#Test", "#StoryReel"],
    total_duration_sec: 9,
    director_notes: "ใช้ช่วงเปิดกล่อง",
  };
}
```

If this creates duplicate imports, merge them into one import statement.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: FAIL because `parseDirectorJson`, `validateDirection`, and `buildSummary` are not implemented.

- [ ] **Step 3: Implement JSON parsing, validation, and summary helpers**

Append these functions to `src/storyreel/director-poc.ts`:

```ts
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripMarkdownJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function parseDirectorJson(raw: string): StoryReelDirectorDirection {
  const cleaned = stripMarkdownJson(raw);
  try {
    return JSON.parse(cleaned) as StoryReelDirectorDirection;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Gemini director JSON: ${message}\n${raw.slice(0, 500)}`);
  }
}

function hasNumber(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "number" && Number.isFinite(obj[key]);
}

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string" && obj[key].trim().length > 0;
}

export function validateDirection(direction: StoryReelDirectorDirection, clipCount: number): string[] {
  const errors: string[] = [];
  const root = direction as unknown;
  if (!isObject(root)) return ["direction must be an object"];

  if (!isObject(root.hook_clip)) {
    errors.push("hook_clip must be an object");
  } else {
    const hook = root.hook_clip;
    if (!hasNumber(hook, "clip_index")) errors.push("hook_clip.clip_index must be numeric");
    if (!hasNumber(hook, "start_sec")) errors.push("hook_clip.start_sec must be numeric");
    if (!hasNumber(hook, "end_sec")) errors.push("hook_clip.end_sec must be numeric");
    if (!hasString(hook, "reason")) errors.push("hook_clip.reason must be non-empty");
    if (hasNumber(hook, "clip_index") && (hook.clip_index < 0 || hook.clip_index >= clipCount)) {
      errors.push(`hook_clip.clip_index ${hook.clip_index} is outside uploaded clip range 0-${clipCount - 1}`);
    }
    if (hasNumber(hook, "start_sec") && hasNumber(hook, "end_sec") && hook.end_sec <= hook.start_sec) {
      errors.push("hook_clip.end_sec must be greater than start_sec");
    }
  }

  if (!Array.isArray(root.clips) || root.clips.length === 0) {
    errors.push("clips must be a non-empty array");
  } else {
    root.clips.forEach((clip, index) => {
      if (!isObject(clip)) {
        errors.push(`clips[${index}] must be an object`);
        return;
      }
      if (!hasNumber(clip, "clip_index")) errors.push(`clips[${index}].clip_index must be numeric`);
      if (!hasNumber(clip, "start_sec")) errors.push(`clips[${index}].start_sec must be numeric`);
      if (!hasNumber(clip, "end_sec")) errors.push(`clips[${index}].end_sec must be numeric`);
      if (!hasNumber(clip, "order")) errors.push(`clips[${index}].order must be numeric`);
      if (!hasString(clip, "role")) errors.push(`clips[${index}].role must be non-empty`);
      if (hasNumber(clip, "clip_index") && (clip.clip_index < 0 || clip.clip_index >= clipCount)) {
        errors.push(`clips[${index}].clip_index ${clip.clip_index} is outside uploaded clip range 0-${clipCount - 1}`);
      }
      if (hasNumber(clip, "start_sec") && hasNumber(clip, "end_sec") && clip.end_sec <= clip.start_sec) {
        errors.push(`clips[${index}].end_sec must be greater than start_sec`);
      }
    });
  }

  if (!isObject(root.voiceover_script) || !hasString(root.voiceover_script, "full_text")) {
    errors.push("voiceover_script.full_text must be non-empty");
  }
  if (!hasString(root, "hook_text_overlay")) errors.push("hook_text_overlay must be non-empty");
  if (!Array.isArray(root.caption_lines)) errors.push("caption_lines must be an array");
  if (!hasString(root, "cta_text")) errors.push("cta_text must be non-empty");
  if (!hasString(root, "facebook_caption")) errors.push("facebook_caption must be non-empty");
  if (!Array.isArray(root.hashtags)) errors.push("hashtags must be an array");
  if (!hasNumber(root, "total_duration_sec")) errors.push("total_duration_sec must be numeric");
  if (!hasString(root, "director_notes")) errors.push("director_notes must be non-empty");

  return errors;
}

function formatRange(start: number, end: number): string {
  return `${start.toFixed(2)}s-${end.toFixed(2)}s`;
}

export function buildSummary(direction: StoryReelDirectorDirection, clipPaths: string[]): string {
  const ordered = [...direction.clips].sort((a, b) => a.order - b.order);
  const lines = [
    "StoryReel Director POC Summary",
    "================================",
    "",
    `Hook: clip ${direction.hook_clip.clip_index + 1} ${formatRange(direction.hook_clip.start_sec, direction.hook_clip.end_sec)}`,
    `Reason: ${direction.hook_clip.reason}`,
    `Hook Overlay: ${direction.hook_text_overlay}`,
    "",
    "Selected Clips:",
    ...ordered.map((clip) => `${clip.order}. clip ${clip.clip_index + 1} ${formatRange(clip.start_sec, clip.end_sec)} [${clip.role}] ${path.basename(clipPaths[clip.clip_index] ?? "unknown")}`),
    "",
    "Voiceover Script:",
    direction.voiceover_script.full_text,
    "",
    "Caption Lines:",
    ...direction.caption_lines.map((line, index) => `${index + 1}. ${line}`),
    "",
    `CTA: ${direction.cta_text}`,
    "",
    "Facebook Caption:",
    direction.facebook_caption,
    "",
    `Hashtags: ${direction.hashtags.join(" ")}`,
    `Total Duration: ${direction.total_duration_sec}s`,
    "",
    "Director Notes:",
    direction.director_notes,
    "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/storyreel/director-poc.ts tests/storyreel-director-poc.test.ts
git commit -m "feat: validate StoryReel director output"
```

## Task 3: Validate Input Clips And Save Artifacts

**Files:**
- Modify: `tests/storyreel-director-poc.test.ts`
- Modify: `src/storyreel/director-poc.ts`

- [ ] **Step 1: Add failing tests for clip path validation and artifact writing**

Add these imports to `tests/storyreel-director-poc.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
```

Add `validateClipPaths`, `writeArtifacts`, and `createRunId` to the existing import from `director-poc.js`.

Append these tests inside the `describe` block:

```ts
  it("validates local clip paths and extensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-test-"));
    const clip = path.join(dir, "clip1.mp4");
    fs.writeFileSync(clip, "fake video");

    expect(validateClipPaths([clip])).toEqual([clip]);
    expect(() => validateClipPaths([path.join(dir, "missing.mp4")])).toThrow("Clip not found");
    expect(() => validateClipPaths([path.join(dir, "notes.txt")])).toThrow("Unsupported clip extension");
  });

  it("writes direction, prompt, and summary artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-artifacts-"));
    const direction = sampleDirection();
    const summary = buildSummary(direction, ["clip1.mp4", "clip2.mp4"]);

    const result = writeArtifacts({
      outputBaseDir: dir,
      runId: "storyreel-test",
      prompt: "prompt text",
      direction,
      summary,
    });

    expect(result.runDir).toBe(path.join(dir, "storyreel-test"));
    expect(fs.readFileSync(path.join(result.runDir, "prompt.txt"), "utf8")).toBe("prompt text");
    expect(JSON.parse(fs.readFileSync(path.join(result.runDir, "direction.json"), "utf8"))).toEqual(direction);
    expect(fs.readFileSync(path.join(result.runDir, "summary.txt"), "utf8")).toBe(summary);
  });

  it("creates sortable run ids", () => {
    expect(createRunId(new Date("2026-05-14T12:34:56Z"))).toBe("storyreel-20260514-123456");
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: FAIL because artifact/input helpers are not implemented.

- [ ] **Step 3: Implement clip validation, run IDs, and artifact writing**

Append this code to `src/storyreel/director-poc.ts`:

```ts
export function createRunId(now = new Date()): string {
  const stamp = now.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `storyreel-${stamp}`;
}

export function mimeTypeForClip(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

export function validateClipPaths(clipPaths: string[]): string[] {
  return clipPaths.map((clipPath) => {
    const resolved = path.resolve(clipPath);
    const ext = path.extname(resolved).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported clip extension for ${clipPath}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
    }
    if (!fs.existsSync(resolved)) throw new Error(`Clip not found: ${clipPath}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Clip path is not a file: ${clipPath}`);
    return resolved;
  });
}

export interface WriteArtifactsInput {
  outputBaseDir: string;
  runId: string;
  prompt: string;
  direction: StoryReelDirectorDirection;
  summary: string;
}

export function writeArtifacts(input: WriteArtifactsInput): { runDir: string } {
  const runDir = path.join(input.outputBaseDir, input.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "prompt.txt"), input.prompt);
  fs.writeFileSync(path.join(runDir, "direction.json"), `${JSON.stringify(input.direction, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "summary.txt"), input.summary);
  return { runDir };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/storyreel/director-poc.ts tests/storyreel-director-poc.test.ts
git commit -m "feat: save StoryReel director artifacts"
```

## Task 4: Add Gemini Orchestration With Fake-Client Test

**Files:**
- Modify: `tests/storyreel-director-poc.test.ts`
- Modify: `src/storyreel/director-poc.ts`

- [ ] **Step 1: Add failing test for end-to-end orchestration without network**

Append this test inside the `describe` block:

```ts
  it("runs the POC with an injected Gemini client", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-run-"));
    const clip1 = path.join(dir, "clip1.mp4");
    const clip2 = path.join(dir, "clip2.mp4");
    fs.writeFileSync(clip1, "fake video 1");
    fs.writeFileSync(clip2, "fake video 2");

    const uploads: string[] = [];
    const result = await runStoryReelDirectorPoc([
      "--clips", clip1, clip2,
      "--product", "Testing story",
      "--note", "make it honest",
      "--language", "thai",
      "--output-dir", dir,
    ], {
      now: new Date("2026-05-14T12:34:56Z"),
      client: {
        async uploadFile(filePath, mimeType) {
          uploads.push(`${path.basename(filePath)}:${mimeType}`);
          return { uri: `gemini://${path.basename(filePath)}`, mimeType };
        },
        async generateDirection(parts, prompt) {
          expect(parts).toEqual([
            { uri: "gemini://clip1.mp4", mimeType: "video/mp4" },
            { uri: "gemini://clip2.mp4", mimeType: "video/mp4" },
          ]);
          expect(prompt).toContain("make it honest");
          return JSON.stringify(sampleDirection());
        },
      },
    });

    expect(uploads).toEqual(["clip1.mp4:video/mp4", "clip2.mp4:video/mp4"]);
    expect(result.runDir).toBe(path.join(dir, "storyreel-20260514-123456"));
    expect(result.summary).toContain("StoryReel Director POC Summary");
    expect(fs.existsSync(path.join(result.runDir, "direction.json"))).toBe(true);
  });
```

Add `runStoryReelDirectorPoc` to the import from `director-poc.js`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: FAIL because `runStoryReelDirectorPoc` is not implemented.

- [ ] **Step 3: Implement Gemini client and runner**

Append this code to `src/storyreel/director-poc.ts`:

```ts
export class GoogleStoryReelGeminiClient implements StoryReelGeminiClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.STORYREEL_GEMINI_MODEL ?? "gemini-2.5-flash") {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async uploadFile(filePath: string, mimeType: string): Promise<{ uri: string; mimeType: string; name?: string }> {
    const uploaded: File = await this.ai.files.upload({
      file: filePath,
      config: { mimeType, displayName: path.basename(filePath) },
    });
    const uri = uploaded.uri;
    if (!uri) throw new Error(`Gemini upload did not return a URI for ${filePath}`);
    return { uri, mimeType: uploaded.mimeType ?? mimeType, name: uploaded.name };
  }

  async generateDirection(parts: Array<{ uri: string; mimeType: string }>, prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{
        role: "user",
        parts: [
          ...parts.map((part) => createPartFromUri(part.uri, part.mimeType)),
          createPartFromText(prompt),
        ],
      }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });
    const text = response.text?.trim();
    if (!text) throw new Error("Gemini returned an empty director response");
    return text;
  }
}

export interface RunStoryReelDirectorPocOptions {
  client?: StoryReelGeminiClient;
  now?: Date;
}

export async function runStoryReelDirectorPoc(argv: string[], options: RunStoryReelDirectorPocOptions = {}): Promise<{ runDir: string; direction: StoryReelDirectorDirection; summary: string }> {
  const args = parseArgs(argv);
  const clipPaths = validateClipPaths(args.clips);
  const prompt = buildDirectorPrompt({
    clipCount: clipPaths.length,
    product: args.product,
    note: args.note,
    language: args.language,
  });

  const client = options.client ?? new GoogleStoryReelGeminiClient();
  const uploadedParts = [];
  for (const clipPath of clipPaths) {
    uploadedParts.push(await client.uploadFile(clipPath, mimeTypeForClip(clipPath)));
  }

  const raw = await client.generateDirection(uploadedParts, prompt);
  const direction = parseDirectorJson(raw);
  const errors = validateDirection(direction, clipPaths.length);
  if (errors.length > 0) {
    throw new Error(`Gemini director response failed validation:\n${errors.map((err) => `- ${err}`).join("\n")}`);
  }

  const summary = buildSummary(direction, clipPaths);
  const runId = createRunId(options.now ?? new Date());
  const { runDir } = writeArtifacts({
    outputBaseDir: args.outputBaseDir,
    runId,
    prompt,
    direction,
    summary,
  });

  return { runDir, direction, summary };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/storyreel/director-poc.ts tests/storyreel-director-poc.test.ts
git commit -m "feat: run StoryReel director POC"
```

## Task 5: Add CLI Entrypoint And Verify Build

**Files:**
- Create: `scripts/storyreel-director-poc.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Add the CLI entrypoint**

Create `scripts/storyreel-director-poc.ts`:

```ts
import { runStoryReelDirectorPoc } from "../src/storyreel/director-poc.js";

try {
  const result = await runStoryReelDirectorPoc(process.argv.slice(2));
  console.log(result.summary);
  console.log(`Artifacts written to: ${result.runDir}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
```

- [ ] **Step 2: Include scripts in TypeScript build**

Modify `tsconfig.json` so `scripts/**/*` is included:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["bin/**/*", "src/**/*", "test/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Run CLI with missing clip to verify clear error**

Run:

```bash
tsx scripts/storyreel-director-poc.ts --clips work/storyreel-poc/input/missing.mp4
```

Expected: exit code 1 and output containing `Clip not found: work/storyreel-poc/input/missing.mp4`.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add scripts/storyreel-director-poc.ts tsconfig.json
git commit -m "feat: add StoryReel director POC CLI"
```

## Task 6: Run Real Director POC With User Clips

**Files:**
- No source changes expected.
- Runtime input directory: `work/storyreel-poc/input/`

- [ ] **Step 1: Ensure input directory exists**

Run:

```bash
mkdir -p work/storyreel-poc/input
```

Expected: directory exists. User should place clips at:

```text
work/storyreel-poc/input/clip1.mp4
work/storyreel-poc/input/clip2.mp4
```

- [ ] **Step 2: Verify clips are present**

Run:

```bash
ls -lh work/storyreel-poc/input
```

Expected: `clip1.mp4` and `clip2.mp4` are present. If filenames differ, use the actual filenames in Step 3.

- [ ] **Step 3: Run the director POC**

Run:

```bash
tsx scripts/storyreel-director-poc.ts \
  --clips work/storyreel-poc/input/clip1.mp4 work/storyreel-poc/input/clip2.mp4 \
  --product "Testing story" \
  --note "Create an honest short story from these two clips" \
  --language thai
```

Expected: console prints the director summary and `Artifacts written to: work/storyreel-poc/storyreel-<timestamp>`.

- [ ] **Step 4: Review artifacts**

Open these files in the generated run directory:

```text
direction.json
summary.txt
prompt.txt
```

Expected: `direction.json` has selected timestamps for both uploaded clips or a clear reason for skipping one; `summary.txt` is readable enough to manually compare against the raw clips.

## Final Verification

- [ ] Run focused tests:

```bash
npm test -- tests/storyreel-director-poc.test.ts
```

Expected: PASS.

- [ ] Run full tests if time allows:

```bash
npm test
```

Expected: PASS, or document any unrelated existing failures.

- [ ] Run build:

```bash
npm run build
```

Expected: PASS.

- [ ] Confirm artifacts exist after the real run:

```bash
ls -lh work/storyreel-poc
```

Expected: at least one `storyreel-YYYYMMDD-HHMMSS` run directory plus `input/`.
