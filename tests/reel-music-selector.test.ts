import { describe, it, expect } from "vitest";
import type { BrandConfig } from "../src/types.js";
import { pickMusicFile, resolveReelMusicFile } from "../src/stages/reel-music-selector.js";

const files = [
  "/music/breaking-news-1.mp3",
  "/music/breaking-news-2.mp3",
  "/music/breaking-news-3.mp3",
];

function brand(): BrandConfig {
  return {
    id: "ns",
    name: "WorldBrief",
    language: "en",
    timezone: "Europe/Berlin",
    postTimes: [],
    weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true },
    pillars: [],
    trustedSources: [],
    geographicFocus: "Europe",
    captionRules: {},
    themeWeights: {},
    viralCheck: false,
    gcsPrefix: "nscontent",
    metaPageId: "",
    metaPageToken: "",
    channels: {},
    useStockImages: true,
    reels: {
      enabled: true,
      voiceId: "voice",
      sceneCount: 4,
      reelTimes: [],
      musicFiles: ["/music/fallback.mp3"],
      musicByCategory: { business: ["/music/business-1.mp3", "/music/business-2.mp3"] },
    },
  };
}

describe("pickMusicFile", () => {
  it("picks random when selector is undefined", () => {
    const result = pickMusicFile(files, undefined, () => 0.99);
    expect(result).toBe("/music/breaking-news-3.mp3");
  });

  it("falls back to a valid file when randomFn returns invalid value", () => {
    const result = pickMusicFile(files, undefined, () => Number.NaN);
    expect(result).toBe("/music/breaking-news-1.mp3");
  });

  it("supports 1-based numeric index selector", () => {
    expect(pickMusicFile(files, "2")).toBe("/music/breaking-news-2.mp3");
  });

  it("supports basename selector", () => {
    expect(pickMusicFile(files, "breaking-news-1.mp3")).toBe(
      "/music/breaking-news-1.mp3",
    );
  });

  it("rejects empty string selector", () => {
    expect(() => pickMusicFile(files, "")).toThrow(
      "Invalid music track selector: . Available tracks: breaking-news-1.mp3, breaking-news-2.mp3, breaking-news-3.mp3",
    );
  });

  it("throws with available basenames for invalid selector", () => {
    expect(() => pickMusicFile(files, "9")).toThrow(
      "Available tracks: breaking-news-1.mp3, breaking-news-2.mp3, breaking-news-3.mp3",
    );
  });

  it("throws when pool is empty", () => {
    expect(() => pickMusicFile([], undefined)).toThrow(
      "No music files available",
    );
  });
});

describe("resolveReelMusicFile", () => {
  it("prefers category pool and returns basename", () => {
    const result = resolveReelMusicFile({
      brand: brand(),
      category: "business",
      existsFn: () => true,
      randomFn: () => 0.75,
    });

    expect(result).toEqual({ path: "/music/business-2.mp3", fileName: "business-2.mp3" });
  });

  it("falls back when category files are unavailable", () => {
    const result = resolveReelMusicFile({
      brand: brand(),
      category: "business",
      existsFn: (file) => file === "/music/fallback.mp3",
      randomFn: () => 0,
    });

    expect(result).toEqual({ path: "/music/fallback.mp3", fileName: "fallback.mp3" });
  });
});
