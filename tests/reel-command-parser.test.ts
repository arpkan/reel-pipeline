import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/queries.js", () => ({
  getLineEventsAfter: vi.fn(),
  getLatestLineEventId: vi.fn(),
  getActiveRunForBrand: vi.fn(),
  getThemeWeights: vi.fn(),
  setThemeWeight: vi.fn(),
  getRunById: vi.fn(),
  getRecentRuns: vi.fn(),
  getPostsByRun: vi.fn(),
  getLatestPendingRunForBrand: vi.fn(),
  getDuePostsForPublishing: vi.fn(),
  getRecentReels: vi.fn(),
  getReelById: vi.fn(),
  getReelByShortId: vi.fn(),
  updateReel: vi.fn(),
}));

vi.mock("../src/pipeline/runner.js", () => ({
  PipelineRunner: class PipelineRunner {},
  requestCancelRun: vi.fn(),
  resolveScheduledDatetime: vi.fn(),
}));

vi.mock("../src/pipeline/reel-runner.js", () => ({
  ReelRunner: class ReelRunner {},
  isReelRunning: vi.fn(() => false),
  setSkipNextReel: vi.fn(),
  cancelSkipNextReel: vi.fn(),
  isSkipNextReel: vi.fn(() => 0),
  requestCancelReel: vi.fn(),
}));

let parseReelRebuildCommand: typeof import("../src/pipeline/command-listener.js")["parseReelRebuildCommand"];

beforeAll(async () => {
  ({ parseReelRebuildCommand } = await import("../src/pipeline/command-listener.js"));
});

describe("parseReelRebuildCommand", () => {
  it("parses re-voice with optional id", () => {
    expect(parseReelRebuildCommand("re-voice")).toEqual({
      part: "voice",
    });
    expect(parseReelRebuildCommand("re-voice abcd1234")).toEqual({
      part: "voice",
      reelShortId: "abcd1234",
    });
  });

  it("parses a single non-short-id re-voice argument as a voice id", () => {
    expect(parseReelRebuildCommand("re-voice JBFqnCBsd6RMkjVDRZzb")).toEqual({
      part: "voice",
      voiceIdOverride: "JBFqnCBsd6RMkjVDRZzb",
    });
  });

  it("parses re-images with optional id and optional -nostock", () => {
    expect(parseReelRebuildCommand("re-images")).toEqual({
      part: "images",
    });
    expect(parseReelRebuildCommand("re-images abcd1234")).toEqual({
      part: "images",
      reelShortId: "abcd1234",
    });
    expect(parseReelRebuildCommand("re-images -nostock")).toEqual({
      part: "images",
      useStockImagesOverride: false,
    });
    expect(parseReelRebuildCommand("re-images abcd1234 -nostock")).toEqual({
      part: "images",
      reelShortId: "abcd1234",
      useStockImagesOverride: false,
    });
  });

  it("parses re-music with optional id and optional selector", () => {
    expect(parseReelRebuildCommand("re-music")).toEqual({
      part: "music",
    });
    expect(parseReelRebuildCommand("re-music 2")).toEqual({
      part: "music",
      musicTrackSelector: "2",
    });
    expect(parseReelRebuildCommand("re-music abcdef12")).toEqual({
      part: "music",
      reelShortId: "abcdef12",
    });
    expect(parseReelRebuildCommand("re-music abcdef12 breaking-news-2.mp3")).toEqual({
      part: "music",
      reelShortId: "abcdef12",
      musicTrackSelector: "breaking-news-2.mp3",
    });
  });

  it("parses single rebuild values without treating them as reel ids", () => {
    expect(parseReelRebuildCommand("re-music breaking-news-2.mp3")).toEqual({
      part: "music",
      musicTrackSelector: "breaking-news-2.mp3",
    });
    expect(parseReelRebuildCommand("re-effect zoom_in")).toEqual({
      part: "video",
      cameraEffectOverride: "zoom_in",
    });
    expect(parseReelRebuildCommand("re-effect cinematic_drift")).toEqual({
      part: "video",
      cameraPresetOverride: "cinematic_drift",
    });
  });

  it("rejects -nostock on re-voice and re-music", () => {
    expect(() => parseReelRebuildCommand("re-voice -nostock")).toThrow(
      "-nostock is only supported with re-images",
    );
    expect(() => parseReelRebuildCommand("re-music -nostock")).toThrow(
      "-nostock is only supported with re-images",
    );
  });
});
