import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { STORY_MUSIC_GENRES, loadStoryMusicIndex } from "../src/storyreel/music.js";

// MP3s are not committed (see music/storyreel/README.md); only the index is.
const baseDir = path.resolve("music/storyreel");
const tracksDownloaded = loadStoryMusicIndex(baseDir).some((track) =>
  fs.existsSync(path.join(baseDir, track.filename)));

describe("StoryReel music library index", () => {
  it("has at least three indexed tracks per genre with attribution metadata", () => {
    const index = loadStoryMusicIndex(baseDir);
    for (const genre of STORY_MUSIC_GENRES) {
      const tracks = index.filter((track) => track.genre === genre);
      expect(tracks.length, genre).toBeGreaterThanOrEqual(3);
      for (const track of tracks) {
        expect(track.title.length).toBeGreaterThan(0);
        expect(track.artist.length).toBeGreaterThan(0);
        expect(["low", "medium", "high"], `${track.filename} energy`).toContain(track.energy);
        expect(["slow", "medium", "fast"], `${track.filename} tempo`).toContain(track.tempo);
        expect(track.licenseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it.skipIf(!tracksDownloaded)("every indexed track file exists once downloaded", () => {
    for (const track of loadStoryMusicIndex(baseDir)) {
      expect(fs.existsSync(path.join(baseDir, track.filename)), track.filename).toBe(true);
    }
  });
});
