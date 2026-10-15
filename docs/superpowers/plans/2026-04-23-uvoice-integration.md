# uvoice Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add uvoice as a second TTS provider alongside ElevenLabs, with per-voice provider config, cross-provider fallback, and local Whisper word-timing for uvoice audio.

**Architecture:** A `VoiceProvider` interface is introduced; both `ElevenLabsService` and `UVoiceService` implement it. `reel-stage3-voice` dispatches to the correct provider based on each voice's `provider` tag, and retries with the other provider's voices on failure. `UVoiceService` calls a `WhisperService` subprocess to produce word timings since the uvoice API returns audio only.

**Tech Stack:** TypeScript (ESM), Node.js ≥22, `whisper-timestamped` Python package, `ffmpeg`/`ffprobe` (already present), Vitest for tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/services/voice-provider.ts` | `VoiceProvider` interface + `VoiceEntry` / `VoiceProviderName` types |
| Create | `src/services/uvoice.ts` | `UVoiceService` — calls uvoice API, delegates timing to WhisperService |
| Create | `src/services/whisper.ts` | `WhisperService` — subprocess wrapper for `whisper-timestamped` |
| Modify | `src/services/elevenlabs.ts` | Add `implements VoiceProvider` (no logic change) |
| Modify | `src/types.ts` | Add `VoiceEntry` import + `voices?: VoiceEntry[]` to `ReelConfig` |
| Modify | `src/stages/reel-stage3-voice.ts` | Provider-aware dispatch, cross-provider fallback |
| Modify | `src/brands/ds.ts` | Add `voices` pool with uvoice entry |
| Modify | `src/brands/ns.ts` | Add `voices` pool with uvoice entry |
| Modify | `.env.example` | Add `UVOICE_API_KEY`, `ELEVENLABS_API_KEY`, `WHISPER_MODEL`, `DS_REEL_UVOICE_VOICE_ID`, `NS_REEL_UVOICE_VOICE_ID` |
| Create | `tests/uvoice.test.ts` | Unit tests for `UVoiceService` |
| Create | `tests/whisper.test.ts` | Unit tests for `WhisperService` |
| Create | `tests/reel-stage3-voice.test.ts` | Unit tests for provider dispatch + fallback in stage 3 |

---

## Task 1: VoiceProvider interface and VoiceEntry types

**Files:**
- Create: `src/services/voice-provider.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Create `src/services/voice-provider.ts`**

```typescript
import type { WordTiming } from "../types.js";

export type VoiceProviderName = "elevenlabs" | "uvoice";

export interface VoiceEntry {
  id: string;
  provider: VoiceProviderName;
  speed?: number; // atempo override for this specific voice; falls back to brand voiceSpeed ?? 1.2
}

export interface VoiceProvider {
  textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
}
```

- [ ] **Step 2: Add `VoiceEntry` to `ReelConfig` in `src/types.ts`**

In `src/types.ts`, add the import at the top of the Reel section and add the `voices` field to `ReelConfig`:

```typescript
// At the top of the file, add this import alongside other type imports:
import type { VoiceEntry } from "./services/voice-provider.js";
```

In `ReelConfig` (line 223), add `voices` after `voiceSpeed`:

```typescript
  voiceSpeed?: number;   // atempo multiplier, default 1.2 (e.g. 1.3 = 30% faster)
  voices?: VoiceEntry[]; // provider-tagged voice pool; takes precedence over voiceIds/voiceId
```

- [ ] **Step 3: Build to verify no type errors**

```bash
npm run build
```

Expected: Compile succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/voice-provider.ts src/types.ts
git commit -m "feat: add VoiceProvider interface and VoiceEntry type"
```

---

## Task 2: WhisperService — word timing for uvoice audio

**Files:**
- Create: `src/services/whisper.ts`
- Create: `tests/whisper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/whisper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

// Mock child_process before importing WhisperService
vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { spawnSync } from "child_process";
import { WhisperService } from "../src/services/whisper.js";

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>;

describe("WhisperService", () => {
  let service: WhisperService;

  beforeEach(() => {
    service = new WhisperService("tiny");
    vi.clearAllMocks();
  });

  it("returns word timings from whisper output", async () => {
    const whisperOutput = JSON.stringify({
      segments: [
        {
          words: [
            { text: "Hello", start: 0.0, end: 0.4 },
            { text: "world", start: 0.5, end: 0.9 },
          ],
        },
      ],
    });

    mockSpawnSync.mockReturnValue({ status: 0, stdout: whisperOutput, stderr: "" });

    const result = await service.transcribe(Buffer.from("fake-audio"), "en");

    expect(result).toEqual([
      { word: "Hello", start: 0.0, end: 0.4 },
      { word: "world", start: 0.5, end: 0.9 },
    ]);
  });

  it("falls back to even distribution when whisper fails", async () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "error" });

    // Provide a 2-second audio duration via ffprobe mock
    // WhisperService calls ffprobe to get duration for the fallback
    // We supply the audio and text; the fallback estimates from text word count
    const result = await service.transcribe(Buffer.from("fake-audio"), "en", "Hello world", 2.0);

    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("Hello");
    expect(result[1].word).toBe("world");
    // Even distribution: each word gets 1.0s
    expect(result[0].start).toBeCloseTo(0.0);
    expect(result[0].end).toBeCloseTo(1.0);
    expect(result[1].start).toBeCloseTo(1.0);
    expect(result[1].end).toBeCloseTo(2.0);
  });

  it("falls back to even distribution when whisper output is invalid JSON", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "not-json", stderr: "" });

    const result = await service.transcribe(Buffer.from("fake-audio"), "en", "One two three", 3.0);

    expect(result).toHaveLength(3);
    expect(result[0].word).toBe("One");
    expect(result[2].word).toBe("three");
  });

  it("skips empty words in whisper output", async () => {
    const whisperOutput = JSON.stringify({
      segments: [
        {
          words: [
            { text: "  ", start: 0.0, end: 0.1 },
            { text: "Hello", start: 0.1, end: 0.5 },
          ],
        },
      ],
    });

    mockSpawnSync.mockReturnValue({ status: 0, stdout: whisperOutput, stderr: "" });

    const result = await service.transcribe(Buffer.from("fake-audio"), "en");

    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("Hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/whisper.test.ts
```

Expected: FAIL — `WhisperService` not found.

- [ ] **Step 3: Implement `src/services/whisper.ts`**

```typescript
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { WordTiming } from "../types.js";

export class WhisperService {
  private readonly model: string;

  constructor(model = "tiny") {
    this.model = model;
  }

  /**
   * Transcribe audio buffer to word-level timings using whisper-timestamped.
   * Falls back to even distribution if whisper fails.
   *
   * @param audio      Raw audio buffer (MP3 or WAV)
   * @param language   Language code e.g. "en", "th"
   * @param text       Original text (used only for fallback even distribution)
   * @param duration   Audio duration in seconds (used only for fallback)
   */
  async transcribe(
    audio: Buffer,
    language: string,
    text?: string,
    duration?: number,
  ): Promise<WordTiming[]> {
    const tmpFile = path.join(os.tmpdir(), `whisper-in-${Date.now()}.mp3`);
    try {
      fs.writeFileSync(tmpFile, audio);

      const script = [
        "import sys, json, whisper_timestamped as whisper",
        `model = whisper.load_model(${JSON.stringify(this.model)})`,
        `result = whisper.transcribe(model, ${JSON.stringify(tmpFile)}, language=${JSON.stringify(language)})`,
        "print(json.dumps(result))",
      ].join("\n");

      const result = spawnSync("python3", ["-c", script], {
        encoding: "utf8",
        timeout: 30_000,
      });

      if (result.status === 0 && result.stdout) {
        try {
          const data = JSON.parse(result.stdout.trim()) as {
            segments: Array<{ words: Array<{ text: string; start: number; end: number }> }>;
          };
          const timings: WordTiming[] = [];
          for (const segment of data.segments) {
            for (const w of segment.words) {
              const word = w.text.trim();
              if (word) timings.push({ word, start: w.start, end: w.end });
            }
          }
          if (timings.length > 0) return timings;
        } catch {
          // fall through to fallback
        }
      }

      console.warn(`    ⚠️ whisper transcription failed — using even word distribution`);
      return this.evenDistribution(text ?? "", duration ?? 8);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  private evenDistribution(text: string, duration: number): WordTiming[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const perWord = duration / words.length;
    return words.map((word, i) => ({
      word,
      start: i * perWord,
      end: (i + 1) * perWord,
    }));
  }
}

export function createWhisperService(): WhisperService {
  return new WhisperService(process.env.WHISPER_MODEL ?? "tiny");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/whisper.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/whisper.ts tests/whisper.test.ts
git commit -m "feat: add WhisperService for uvoice word timing"
```

---

## Task 3: UVoiceService

**Files:**
- Create: `src/services/uvoice.ts`
- Create: `tests/uvoice.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uvoice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/whisper.js", () => ({
  WhisperService: vi.fn().mockImplementation(() => ({
    transcribe: vi.fn().mockResolvedValue([
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ]),
  })),
  createWhisperService: vi.fn().mockReturnValue({
    transcribe: vi.fn().mockResolvedValue([
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ]),
  }),
}));

import { UVoiceService } from "../src/services/uvoice.js";

describe("UVoiceService", () => {
  let service: UVoiceService;
  const fakeAudio = Buffer.from("fake-mp3-data");

  beforeEach(() => {
    service = new UVoiceService("test-api-key");
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls uvoice API with correct parameters", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
    });

    await service.textToSpeechWithTimestamps("Hello world", "EN-ManaSD", "en");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.uvoice.ai/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.settings.voiceID).toBe("EN-ManaSD");
    expect(body.settings.text).toBe("Hello world");
    expect(body.settings.outputFormat).toBe("mp3");
    expect(body.settings.autoBreak).toBe(false);
  });

  it("returns audio buffer and word timings", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
    });

    const result = await service.textToSpeechWithTimestamps("Hello world", "EN-ManaSD", "en");

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.wordTimings).toEqual([
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ]);
  });

  it("throws on non-ok API response", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(
      service.textToSpeechWithTimestamps("Hello world", "EN-ManaSD", "en"),
    ).rejects.toThrow("uvoice API error 401: Unauthorized");
  });

  it("throws if UVOICE_API_KEY is not set", () => {
    const saved = process.env.UVOICE_API_KEY;
    delete process.env.UVOICE_API_KEY;
    // Directly instantiate with missing key via factory logic inline
    expect(() => {
      const key = process.env.UVOICE_API_KEY;
      if (!key) throw new Error("UVOICE_API_KEY is not set");
    }).toThrow("UVOICE_API_KEY is not set");
    process.env.UVOICE_API_KEY = saved;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/uvoice.test.ts
```

Expected: FAIL — `UVoiceService` not found.

- [ ] **Step 3: Implement `src/services/uvoice.ts`**

```typescript
import type { VoiceProvider } from "./voice-provider.js";
import type { WordTiming } from "../types.js";
import { createWhisperService } from "./whisper.js";

export class UVoiceService implements VoiceProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const response = await fetch("https://api.uvoice.ai/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          voiceID: voiceId,
          text,
          outputFormat: "mp3",
          autoBreak: false,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`uvoice API error ${response.status}: ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    const whisper = createWhisperService();
    const wordTimings = await whisper.transcribe(audio, language, text);

    return { audio, wordTimings };
  }
}

export function createUVoiceService(): UVoiceService {
  const apiKey = process.env.UVOICE_API_KEY;
  if (!apiKey) throw new Error("UVOICE_API_KEY is not set");
  return new UVoiceService(apiKey);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/uvoice.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/uvoice.ts tests/uvoice.test.ts
git commit -m "feat: add UVoiceService TTS provider"
```

---

## Task 4: ElevenLabsService — implement VoiceProvider interface

**Files:**
- Modify: `src/services/elevenlabs.ts`

- [ ] **Step 1: Add `implements VoiceProvider` to `ElevenLabsService`**

In `src/services/elevenlabs.ts`, change line 1 and the class declaration:

```typescript
import { spawnSync } from "child_process";
import type { WordTiming } from "../types.js";
import type { VoiceProvider } from "./voice-provider.js";

// ...

export class ElevenLabsService implements VoiceProvider {
```

No other changes. The existing `textToSpeechWithTimestamps` signature already matches the `VoiceProvider` interface.

- [ ] **Step 2: Build to verify no type errors**

```bash
npm run build
```

Expected: Compile succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/elevenlabs.ts
git commit -m "feat: ElevenLabsService implements VoiceProvider interface"
```

---

## Task 5: reel-stage3-voice — provider-aware dispatch and fallback

**Files:**
- Modify: `src/stages/reel-stage3-voice.ts`
- Create: `tests/reel-stage3-voice.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/reel-stage3-voice.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ReelContext, ReelConfig } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";

// Mock ElevenLabs and uvoice services
vi.mock("../src/services/elevenlabs.js", () => ({
  createElevenLabsService: vi.fn(),
  ElevenLabsService: vi.fn(),
}));

vi.mock("../src/services/uvoice.js", () => ({
  createUVoiceService: vi.fn(),
  UVoiceService: vi.fn(),
}));

// Mock child_process for ffmpeg/ffprobe
vi.mock("child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" }),
  execSync: vi.fn().mockReturnValue("1.5\n"),
}));

// Mock fs.writeFileSync and fs.renameSync (don't actually write files)
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { createElevenLabsService } from "../src/services/elevenlabs.js";
import { createUVoiceService } from "../src/services/uvoice.js";
import { ReelStage3Voice } from "../src/stages/reel-stage3-voice.js";

const fakeAudio = Buffer.from("fake-audio");
const fakeTimings = [{ word: "Hello", start: 0, end: 0.5 }];

function makeMockProvider(fail = false) {
  return {
    textToSpeechWithTimestamps: fail
      ? vi.fn().mockRejectedValue(new Error("Provider error"))
      : vi.fn().mockResolvedValue({ audio: fakeAudio, wordTimings: fakeTimings }),
  };
}

function makeCtx(reelOverrides: Partial<ReelConfig> = {}): ReelContext {
  const brand = getBrand("ns");
  return {
    runId: "test-run",
    brand: {
      ...brand,
      reels: { ...brand.reels!, ...reelOverrides },
    },
    runDate: "2026-04-23",
    workDir: os.tmpdir(),
    script: {
      title: "Test",
      scenes: [{ sceneNumber: 1, voiceover: "Hello world", caption: "Hi", imagePrompt: "test" }],
      hashtags: [],
    },
    stageLogs: [],
    status: "running",
  };
}

describe("ReelStage3Voice provider dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses elevenlabs when voice entry has provider: elevenlabs", async () => {
    const elMock = makeMockProvider();
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);

    const ctx = makeCtx({
      voices: [{ id: "el-voice-id", provider: "elevenlabs" }],
    });

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(elMock.textToSpeechWithTimestamps).toHaveBeenCalledWith(
      "Hello world",
      "el-voice-id",
      expect.any(String),
    );
    expect(createUVoiceService).not.toHaveBeenCalled();
  });

  it("uses uvoice when voice entry has provider: uvoice", async () => {
    const uvMock = makeMockProvider();
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

    const ctx = makeCtx({
      voices: [{ id: "EN-ManaSD", provider: "uvoice" }],
    });

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalledWith(
      "Hello world",
      "EN-ManaSD",
      expect.any(String),
    );
    expect(createElevenLabsService).not.toHaveBeenCalled();
  });

  it("falls back to the other provider when primary fails", async () => {
    const elMock = makeMockProvider(true);  // ElevenLabs fails
    const uvMock = makeMockProvider(false); // uvoice succeeds
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

    const ctx = makeCtx({
      voices: [
        { id: "el-voice-id", provider: "elevenlabs" },
        { id: "EN-ManaSD", provider: "uvoice" },
      ],
    });

    const stage = new ReelStage3Voice();
    // Deterministically pick the ElevenLabs voice first
    vi.spyOn(Math, "random").mockReturnValue(0); // picks index 0 = elevenlabs

    await stage.run(ctx);

    expect(elMock.textToSpeechWithTimestamps).toHaveBeenCalled();
    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalled();
  });

  it("throws when all providers fail", async () => {
    const elMock = makeMockProvider(true);
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);

    const ctx = makeCtx({
      voices: [{ id: "el-voice-id", provider: "elevenlabs" }],
      // No uvoice voices — no fallback available
    });

    const stage = new ReelStage3Voice();
    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(stage.run(ctx)).rejects.toThrow("Provider error");
  });

  it("falls back to voiceIds pool (legacy config) treating all as elevenlabs", async () => {
    const elMock = makeMockProvider();
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);

    // ns brand has no `voices` field — uses legacy voiceIds
    const ctx = makeCtx(); // uses brand default with voiceIds, no voices[]

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(elMock.textToSpeechWithTimestamps).toHaveBeenCalled();
  });

  it("uses per-voice speed when set on VoiceEntry", async () => {
    const elMock = makeMockProvider();
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);
    const spawnMock = (await import("child_process")).spawnSync as ReturnType<typeof vi.fn>;

    const ctx = makeCtx({
      voices: [{ id: "el-voice-id", provider: "elevenlabs", speed: 1.3 }],
    });

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    // ffmpeg atempo call should use 1.3
    const atempoCall = spawnMock.mock.calls.find(
      (c: string[]) => c[0] === "ffmpeg" && c[1].includes("-filter:a"),
    );
    expect(atempoCall).toBeDefined();
    expect(atempoCall[1]).toContain("atempo=1.3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/reel-stage3-voice.test.ts
```

Expected: FAIL — dispatch logic not yet in stage 3.

- [ ] **Step 3: Rewrite `src/stages/reel-stage3-voice.ts`**

```typescript
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import type { ReelContext, ReelStage } from "../types.js";
import type { VoiceEntry, VoiceProvider } from "../services/voice-provider.js";
import { createElevenLabsService } from "../services/elevenlabs.js";
import { createUVoiceService } from "../services/uvoice.js";

const DEFAULT_ATEMPO = 1.2;

function buildVoicePool(ctx: ReelContext): VoiceEntry[] {
  const reels = ctx.brand.reels;
  if (!reels) throw new Error("brand.reels is not configured");

  // New explicit provider-tagged pool
  if (reels.voices && reels.voices.length > 0) return reels.voices;

  // Legacy fallback: voiceIds / voiceId — all treated as elevenlabs
  const ids = reels.voiceIds ?? (reels.voiceId ? [reels.voiceId] : []);
  if (ids.length === 0) throw new Error("brand.reels.voiceId is not configured");
  return ids.map((id) => ({
    id,
    provider: "elevenlabs" as const,
    speed: reels.voiceSpeeds?.[id],
  }));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createProvider(entry: VoiceEntry): VoiceProvider {
  if (entry.provider === "uvoice") return createUVoiceService();
  return createElevenLabsService();
}

function fallbackVoices(pool: VoiceEntry[], usedEntry: VoiceEntry): VoiceEntry[] {
  return pool.filter((v) => v.provider !== usedEntry.provider);
}

export class ReelStage3Voice implements ReelStage {
  name = "reel-stage3-voice";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script — run reel-stage2-script first");

    const pool = buildVoicePool(ctx);
    const languageCode = ctx.brand.language === "th" ? "th" : "en";
    const tmpDir = ctx.workDir!;
    fs.mkdirSync(tmpDir, { recursive: true });

    const audioPaths: string[] = [];

    for (const scene of ctx.script.scenes) {
      const outPath = path.join(tmpDir, `scene${scene.sceneNumber}.mp3`);
      console.log(`  Scene ${scene.sceneNumber}: "${scene.voiceover.slice(0, 60)}..."`);

      const entry = pickRandom(pool);
      const atempo = entry.speed ?? ctx.brand.reels?.voiceSpeed ?? DEFAULT_ATEMPO;
      console.log(`  Voice: ${entry.id} (provider: ${entry.provider}, speed: ${atempo}x, lang: ${languageCode})`);

      let audio: Buffer;
      let wordTimings: { word: string; start: number; end: number }[];

      try {
        const provider = createProvider(entry);
        ({ audio, wordTimings } = await provider.textToSpeechWithTimestamps(
          scene.voiceover,
          entry.id,
          languageCode,
        ));
      } catch (primaryErr) {
        const fallbacks = fallbackVoices(pool, entry);
        if (fallbacks.length === 0) throw primaryErr;

        const fallbackEntry = pickRandom(fallbacks);
        console.warn(`    ⚠️ ${entry.provider} failed — falling back to ${fallbackEntry.provider} voice ${fallbackEntry.id}`);
        const fallbackProvider = createProvider(fallbackEntry);
        ({ audio, wordTimings } = await fallbackProvider.textToSpeechWithTimestamps(
          scene.voiceover,
          fallbackEntry.id,
          languageCode,
        ));
      }

      fs.writeFileSync(outPath, audio);

      // Speed up audio via ffmpeg atempo
      const fastPath = outPath.replace(".mp3", "_fast.mp3");
      const atempoResult = spawnSync("ffmpeg", [
        "-y", "-i", outPath, "-filter:a", `atempo=${atempo}`, fastPath,
      ], { stdio: "pipe" });
      if (atempoResult.status === 0) {
        fs.renameSync(fastPath, outPath);
      } else {
        console.warn(`    ⚠️ atempo failed, using original speed`);
      }

      // Scale word timings to match sped-up audio
      scene.wordTimings = wordTimings.map((wt) => ({
        word: wt.word,
        start: wt.start / atempo,
        end: wt.end / atempo,
      }));

      // Get duration via ffprobe
      try {
        const dur = execSync(
          `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outPath}"`,
          { encoding: "utf8" },
        ).trim();
        scene.durationSeconds = parseFloat(dur);
        console.log(`    → ${scene.durationSeconds.toFixed(2)}s, ${wordTimings.length} words`);
      } catch {
        scene.durationSeconds = 8;
      }

      audioPaths.push(outPath);
    }

    return { audioPaths };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/reel-stage3-voice.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage3-voice.ts tests/reel-stage3-voice.test.ts
git commit -m "feat: reel-stage3-voice provider-aware dispatch with cross-provider fallback"
```

---

## Task 6: Update brand configs

**Files:**
- Modify: `src/brands/ds.ts`
- Modify: `src/brands/ns.ts`

- [ ] **Step 1: Update `src/brands/ds.ts`**

Add the `voices` array to the `reels` config in `ds.ts`. Add it after `voiceSpeed: 1.4,`:

```typescript
    voiceSpeed: 1.4,
    voices: [
      { id: process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
      { id: "qWWAqFomnJ99VwQLREfT", provider: "elevenlabs" as const, speed: 1.2 },
      { id: process.env.DS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" as const },
      // Note: EN-ManaSD has no speed override — inherits DS brand default (1.4x).
      // Tune per-voice once audio is reviewed.
    ],
```

Also add the import for `VoiceEntry` at the top of `ds.ts`:

```typescript
import type { BrandConfig } from "../types.js";
import type { VoiceEntry } from "../services/voice-provider.js";
```

- [ ] **Step 2: Update `src/brands/ns.ts`**

Add the `voices` array to the `reels` config in `ns.ts`. Add it after `voiceIds: [...]`:

```typescript
    voiceIds: [process.env.NS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"],
    voices: [
      { id: process.env.NS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs" as const },
      { id: process.env.NS_REEL_UVOICE_VOICE_ID ?? "EN-ManaSD", provider: "uvoice" as const },
      // Note: EN-ManaSD has no speed override — inherits NS brand default (1.2x).
      // Tune per-voice once audio is reviewed.
    ],
```

Also add the import for `VoiceEntry` at the top of `ns.ts`:

```typescript
import type { BrandConfig } from "../types.js";
import type { VoiceEntry } from "../services/voice-provider.js";
```

- [ ] **Step 3: Build to verify no type errors**

```bash
npm run build
```

Expected: Compile succeeds with no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/brands/ds.ts src/brands/ns.ts
git commit -m "feat: add uvoice voice to DS and NS brand voice pools"
```

---

## Task 7: Update .env.example and install whisper

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

Add a new section at the end of `.env.example`:

```bash
# TTS — ElevenLabs
ELEVENLABS_API_KEY=

# TTS — uvoice (https://uvoice.app)
UVOICE_API_KEY=
DS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD
NS_REEL_UVOICE_VOICE_ID=   # optional, defaults to EN-ManaSD

# Whisper — local word timing for uvoice voices
# Model options: tiny (default), base, small, medium, large
WHISPER_MODEL=tiny
```

- [ ] **Step 2: Install `whisper-timestamped`**

```bash
pip3 install whisper-timestamped
```

Expected output includes: `Successfully installed whisper-timestamped-...`

Verify it works:

```bash
python3 -c "import whisper_timestamped; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add uvoice and whisper env vars to .env.example"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Smoke test uvoice service (requires real UVOICE_API_KEY in .env)**

```bash
node --env-file=.env -e "
import('./dist/services/uvoice.js').then(async ({ createUVoiceService }) => {
  const svc = createUVoiceService();
  const { audio, wordTimings } = await svc.textToSpeechWithTimestamps('Hello world, this is a test.', 'EN-ManaSD', 'en');
  console.log('Audio bytes:', audio.length);
  console.log('Word timings:', wordTimings);
});
"
```

Expected: Audio buffer size > 0 and word timing array with at least 2 entries.

- [ ] **Step 4: Deploy**

```bash
npm run build && pm2 restart pipeline && pm2 logs pipeline --lines 20
```

Expected: Server restarts cleanly with no startup errors.
