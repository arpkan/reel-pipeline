import { describe, expect, it } from "vitest";
import {
  pickStoryMusicTrack,
  validateMusicGenre,
} from "../src/storyreel/music.js";

describe("StoryReel music", () => {
  it("validates genres", () => {
    expect(validateMusicGenre("calm")).toBe("calm");
    expect(() =>
      validateMusicGenre("ambient"),
    ).toThrow(
      "Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational",
    );
  });

  it("selects a track from the requested genre", () => {
    const track = pickStoryMusicTrack({
      genre: "calm",
      baseDir: "/repo/music/storyreel",
      index: [
        {
          genre: "calm",
          filename: "calm/wanderlust.mp3",
          title: "Wanderlust",
          artist: "Scott Buckley",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        },
      ],
      randomFn: () => 0,
    });
    expect(track.path).toBe("/repo/music/storyreel/calm/wanderlust.mp3");
    expect(track.attribution).toBe(
      "Music: Wanderlust by Scott Buckley (CC BY 4.0)",
    );
  });

  it("prefers tracks matching genre, energy, and tempo", () => {
    const track = pickStoryMusicTrack({
      genre: "dramatic",
      energy: "high",
      tempo: "fast",
      baseDir: "/repo/music/storyreel",
      index: [
        {
          genre: "dramatic",
          energy: "low",
          tempo: "slow",
          filename: "dramatic/slow.mp3",
          title: "Slow Drama",
          artist: "Artist A",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        },
        {
          genre: "dramatic",
          energy: "high",
          tempo: "fast",
          filename: "dramatic/fast.mp3",
          title: "Fast Drama",
          artist: "Artist B",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        },
      ],
      randomFn: () => 0,
    });

    expect(track.path).toBe("/repo/music/storyreel/dramatic/fast.mp3");
  });

  it("falls back to genre-only selection when energy and tempo do not match", () => {
    const track = pickStoryMusicTrack({
      genre: "calm",
      energy: "high",
      tempo: "fast",
      baseDir: "/repo/music/storyreel",
      index: [
        {
          genre: "calm",
          energy: "low",
          tempo: "slow",
          filename: "calm/slow.mp3",
          title: "Slow Calm",
          artist: "Artist C",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        },
      ],
      randomFn: () => 0,
    });

    expect(track.path).toBe("/repo/music/storyreel/calm/slow.mp3");
  });
});
