import fs from "fs";
import path from "path";

export const STORY_MUSIC_GENRES = [
  "upbeat",
  "calm",
  "neutral",
  "playful",
  "dramatic",
  "inspirational",
] as const;

export type StoryMusicGenre = (typeof STORY_MUSIC_GENRES)[number];
export type StoryMusicEnergy = "low" | "medium" | "high";
export type StoryMusicTempo = "slow" | "medium" | "fast";

export interface MusicIndexEntry {
  genre: string;
  energy?: StoryMusicEnergy;
  tempo?: StoryMusicTempo;
  filename: string;
  title: string;
  artist: string;
  licenseUrl: string;
  sourceUrl?: string;
}

export interface PickTrackParams {
  genre: string;
  energy?: string;
  tempo?: string;
  baseDir: string;
  index: MusicIndexEntry[];
  randomFn: () => number;
}

export interface PickedTrack {
  path: string;
  title: string;
  artist: string;
  genre: string;
  attribution: string;
}

export function validateMusicGenre(input: string): string {
  if ((STORY_MUSIC_GENRES as readonly string[]).includes(input)) {
    return input;
  }
  throw new Error(
    "Valid genres: " + (STORY_MUSIC_GENRES as readonly string[]).join(", "),
  );
}

export function loadStoryMusicIndex(baseDir = path.resolve("music/storyreel")): MusicIndexEntry[] {
  return JSON.parse(fs.readFileSync(path.join(baseDir, "index.json"), "utf8")) as MusicIndexEntry[];
}

export function pickStoryMusicTrack(params: PickTrackParams): PickedTrack {
  const { genre, energy, tempo, baseDir, index, randomFn } = params;
  const matches = index.filter((e) => e.genre === genre);
  if (matches.length === 0) {
    throw new Error(`No music tracks found for genre "${genre}"`);
  }
  const exactMatches = matches.filter((e) => e.energy === energy && e.tempo === tempo);
  const energyMatches = matches.filter((e) => e.energy === energy);
  const tempoMatches = matches.filter((e) => e.tempo === tempo);
  const candidates = exactMatches.length > 0
    ? exactMatches
    : energyMatches.length > 0
      ? energyMatches
      : tempoMatches.length > 0
        ? tempoMatches
        : matches;
  const entry = candidates[Math.floor(randomFn() * candidates.length)];
  return {
    path: `${baseDir}/${entry.filename}`,
    title: entry.title,
    artist: entry.artist,
    genre: entry.genre,
    attribution: `Music: ${entry.title} by ${entry.artist} (CC BY 4.0)`,
  };
}
