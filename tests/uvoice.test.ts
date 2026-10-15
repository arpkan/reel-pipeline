import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { UVoiceService, createUVoiceService } from "../src/services/uvoice.js";

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
    try {
      expect(() => createUVoiceService()).toThrow("UVOICE_API_KEY is not set");
    } finally {
      if (saved !== undefined) process.env.UVOICE_API_KEY = saved;
    }
  });
});
