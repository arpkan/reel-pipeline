import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process.spawn before importing WhisperService
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { spawn } from "child_process";
import { WhisperService } from "../src/services/whisper.js";

const mockSpawn = spawn as ReturnType<typeof vi.fn>;

/** Build a fake child_process return value that resolves with given stdout/exitCode */
function makeProc(exitCode: number, stdout: string, stderr = ""): ReturnType<typeof spawn> {
  const proc = new EventEmitter() as ReturnType<typeof spawn>;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();

  // Emit data and close asynchronously so the Promise chain works
  setImmediate(() => {
    if (stdout) (proc as any).stdout.emit("data", Buffer.from(stdout));
    if (stderr) (proc as any).stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });

  return proc;
}

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

    mockSpawn.mockReturnValue(makeProc(0, whisperOutput));

    const result = await service.transcribe(Buffer.from("fake-audio"), "en");

    expect(result).toEqual([
      { word: "Hello", start: 0.0, end: 0.4 },
      { word: "world", start: 0.5, end: 0.9 },
    ]);
  });

  it("falls back to even distribution when whisper fails", async () => {
    mockSpawn.mockReturnValue(makeProc(1, "", "error"));

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
    mockSpawn.mockReturnValue(makeProc(0, "not-json"));

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

    mockSpawn.mockReturnValue(makeProc(0, whisperOutput));

    const result = await service.transcribe(Buffer.from("fake-audio"), "en");

    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("Hello");
  });

  it("normalizes Thai fragmented timings into words", async () => {
    const text = "เกิดเหตุกราดยิง";
    const chars = Array.from(text).map((ch, i) => ({ text: ch, start: i * 0.1, end: (i + 1) * 0.1 }));
    const whisperOutput = JSON.stringify({
      segments: [{ words: chars }],
    });

    mockSpawn.mockReturnValue(makeProc(0, whisperOutput));

    const result = await service.transcribe(Buffer.from("fake-audio"), "th", text, 1.2);

    expect(result.length).toBeLessThan(chars.length);
    expect(result[0].start).toBeCloseTo(0);
    expect(result[result.length - 1].end).toBeCloseTo(chars[chars.length - 1].end);
    expect(result.map((w) => w.word).join("")).toBe(text);
  });
});
