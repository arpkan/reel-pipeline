import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { alignWordTimingsToScript, normalizeVoiceoverForTts } from "../src/stages/reel-stage3-voice.js";
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
  const mocked = {
    ...actual,
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

import { createElevenLabsService } from "../src/services/elevenlabs.js";
import { createUVoiceService } from "../src/services/uvoice.js";
import { ReelStage3Voice } from "../src/stages/reel-stage3-voice.js";

const fakeAudio = Buffer.from("fake-audio");
const fakeTimings = [{ word: "Hello", start: 0, end: 0.5 }];

function makeMockProvider(fail = false, wordTimings = fakeTimings) {
  return {
    textToSpeechWithTimestamps: fail
      ? vi.fn().mockRejectedValue(new Error("Provider error"))
      : vi.fn().mockResolvedValue({ audio: fakeAudio, wordTimings }),
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

describe("normalizeVoiceoverForTts (Thai)", () => {
  it("converts comma-formatted แสน/หมื่น numbers to Thai words", () => {
    expect(normalizeVoiceoverForTts("ได้เพียง 267,225 คะแนน", "th"))
      .toBe("ได้เพียง สองแสนหกหมื่นเจ็ดพันสองร้อยยี่สิบห้า คะแนน");
  });

  it("converts million-range numbers to Thai words", () => {
    expect(normalizeVoiceoverForTts("ทำคะแนนทะลุ 1,334,829 คะแนน", "th"))
      .toBe("ทำคะแนนทะลุ หนึ่งล้านสามแสนสามหมื่นสี่พันแปดร้อยยี่สิบเก้า คะแนน");
  });

  it("converts multiple numbers in one voiceover", () => {
    const result = normalizeVoiceoverForTts("ได้ 163,701 คะแนน มีหน่วยเลือกตั้ง 6,628 หน่วย", "th");
    expect(result).toBe("ได้ หนึ่งแสนหกหมื่นสามพันเจ็ดร้อยเอ็ด คะแนน มีหน่วยเลือกตั้ง หกพันหกร้อยยี่สิบแปด หน่วย");
  });

  it("leaves small numbers and years unchanged", () => {
    expect(normalizeVoiceoverForTts("หมายเลข 9 เมื่อปี 2569", "th"))
      .toBe("หมายเลข 9 เมื่อปี 2569");
  });

  it("is a no-op for non-Thai language codes", () => {
    const text = "It reached 1,334,829 votes.";
    expect(normalizeVoiceoverForTts(text, "en")).toBe(text);
  });
});

describe("alignWordTimingsToScript", () => {
  it("replaces TTS words with script words when counts match", () => {
    const timings = [
      { word: "Hello", start: 0, end: 0.5 },
      { word: "wurld", start: 0.5, end: 1.0 },
    ];
    const result = alignWordTimingsToScript(timings, "Hello world", "en");
    expect(result.map((t) => t.word)).toEqual(["Hello", "world"]);
  });

  it("handles TTS expanding a proper noun into multiple tokens (the Vaavu Atoll case)", () => {
    // TTS renders "Vaavu Atoll" as three tokens "Vavu" "at" "home"
    const timings = [
      { word: "cave",  start: 0.0, end: 0.3 },
      { word: "in",    start: 0.3, end: 0.5 },
      { word: "Vavu",  start: 0.5, end: 0.8 },
      { word: "at",    start: 0.8, end: 1.0 },
      { word: "home",  start: 1.0, end: 1.3 },
    ];
    const result = alignWordTimingsToScript(timings, "cave in Vaavu Atoll", "en");
    expect(result.map((t) => t.word)).toEqual(["cave", "in", "Vaavu", "Atoll"]);
    // "Atoll" should cover the span of "at"+"home"
    expect(result[3].start).toBeCloseTo(0.8);
    expect(result[3].end).toBeCloseTo(1.3);
  });

  it("handles TTS having 2 extra tokens across a sentence", () => {
    const timings = [
      { word: "A",     start: 0.0, end: 0.1 },
      { word: "big",   start: 0.1, end: 0.3 },
      { word: "di",    start: 0.3, end: 0.5 },
      { word: "ve",    start: 0.5, end: 0.6 },
      { word: "found", start: 0.6, end: 0.9 },
      { word: "it",    start: 0.9, end: 1.1 },
    ];
    const result = alignWordTimingsToScript(timings, "A big dive found it", "en");
    expect(result.map((t) => t.word)).toEqual(["A", "big", "dive", "found", "it"]);
    // "dive" absorbs "di" and "ve"
    expect(result[2].start).toBeCloseTo(0.3);
    expect(result[2].end).toBeCloseTo(0.6);
  });

  it("returns original timings when diff exceeds threshold", () => {
    const timings = Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, start: i * 0.1, end: (i + 1) * 0.1 }));
    const result = alignWordTimingsToScript(timings, "one two three", "en");
    // diff=17 >> threshold, falls back to TTS words
    expect(result.map((t) => t.word)).toEqual(timings.map((t) => t.word));
  });
});

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

  it("normalizes decimal currency amounts before sending text to TTS", async () => {
    const uvMock = makeMockProvider();
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

    const ctx = makeCtx({
      voices: [{ id: "EN-ManaSD", provider: "uvoice" }],
    });
    ctx.script!.scenes[0].voiceover = "Markets erased $1.45 trillion in value.";

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalledWith(
      "Markets erased 1 point 45 trillion dollars in value.",
      "EN-ManaSD",
      expect.any(String),
    );
    expect(ctx.script!.scenes[0].voiceover).toBe("Markets erased 1 point 45 trillion dollars in value.");
  });

  it("normalizes hyphenated age phrases before sending text to TTS", async () => {
    const uvMock = makeMockProvider();
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

    const ctx = makeCtx({
      voices: [{ id: "EN-ManaSD", provider: "uvoice" }],
    });
    ctx.script!.scenes[0].voiceover = "A 28-year-old suspect was arrested.";

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalledWith(
      "A twenty eight year old suspect was arrested.",
      "EN-ManaSD",
      expect.any(String),
    );
    expect(ctx.script!.scenes[0].voiceover).toBe("A twenty eight year old suspect was arrested.");
  });

  it("normalizes under-16s age shorthand before sending text to TTS", async () => {
    const uvMock = makeMockProvider();
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);

    const ctx = makeCtx({
      voices: [{ id: "EN-ManaSD", provider: "uvoice" }],
    });
    ctx.script!.scenes[0].voiceover = "TikTok says it blocks direct messages for under-16s.";

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalledWith(
      "TikTok says it blocks direct messages for under sixteens.",
      "EN-ManaSD",
      expect.any(String),
    );
    expect(ctx.script!.scenes[0].voiceover).toBe("TikTok says it blocks direct messages for under sixteens.");
  });

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
      { word: "WorldBrief", start: 0, end: 0.4 / 1.2 },
      { word: "confirmed", start: 0.4 / 1.2, end: 0.8 / 1.2 },
    ]);
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

  it("does not cross-provider fallback when voiceId override is explicit", async () => {
    const uvMock = makeMockProvider(true); // requested uvoice fails
    const elMock = makeMockProvider(false); // should NOT be used
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);

    const ctx = makeCtx({
      voices: [
        { id: "TH-KanokwanNatural", provider: "uvoice" },
        { id: "el-voice-id", provider: "elevenlabs" },
      ],
      voicesFull: [
        { id: "TH-KanokwanNatural", provider: "uvoice" },
        { id: "el-voice-id", provider: "elevenlabs" },
      ],
    }) as ReelContext;
    ctx.voiceId = "TH-KanokwanNatural";

    const stage = new ReelStage3Voice();
    await expect(stage.run(ctx)).rejects.toThrow("Provider error");
    expect(uvMock.textToSpeechWithTimestamps).toHaveBeenCalled();
    expect(elMock.textToSpeechWithTimestamps).not.toHaveBeenCalled();
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
    const atempoFilter = atempoCall![1][atempoCall![1].indexOf("-filter:a") + 1];
    expect(atempoFilter).toContain("atempo=1.3");
  });

  it("uses per-voice gain when set on VoiceEntry", async () => {
    const elMock = makeMockProvider();
    (createElevenLabsService as ReturnType<typeof vi.fn>).mockReturnValue(elMock);
    const spawnMock = (await import("child_process")).spawnSync as ReturnType<typeof vi.fn>;

    const ctx = makeCtx({
      voices: [{ id: "JBFqnCBsd6RMkjVDRZzb", provider: "elevenlabs", gain: 1.25 }],
    });

    const stage = new ReelStage3Voice();
    await stage.run(ctx);

    const filterCall = spawnMock.mock.calls.find(
      (c: string[]) => c[0] === "ffmpeg" && c[1].includes("-filter:a"),
    );
    expect(filterCall).toBeDefined();
    const gainFilter = filterCall![1][filterCall![1].indexOf("-filter:a") + 1];
    expect(gainFilter).toContain("volume=1.25");
  });

  it("keeps original word timings when atempo fails", async () => {
    const uvMock = makeMockProvider(false, [
      { word: "Hello", start: 0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ]);
    (createUVoiceService as ReturnType<typeof vi.fn>).mockReturnValue(uvMock);
    const spawnMock = (await import("child_process")).spawnSync as ReturnType<typeof vi.fn>;
    spawnMock.mockReturnValueOnce({ status: 1, stdout: "", stderr: "ffmpeg failed" });

    const ctx = makeCtx({
      voices: [{ id: "EN-ManaSD", provider: "uvoice" }],
    });

    await new ReelStage3Voice().run(ctx);

    expect(ctx.script!.scenes[0].wordTimings).toEqual([
      { word: "Hello", start: 0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ]);
  });
});
