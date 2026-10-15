import path from "path";
import type { BrandConfig, ReelCategory } from "../types.js";

export interface ResolveReelMusicFileInput {
  brand: BrandConfig;
  category?: ReelCategory;
  selector?: string;
  existsFn?: (filePath: string) => boolean;
  randomFn?: () => number;
}

export interface ResolvedReelMusicFile {
  path: string;
  fileName: string;
}

export function pickMusicFile(
  musicFiles: string[],
  selector?: string,
  randomFn: () => number = Math.random,
): string {
  if (musicFiles.length === 0) {
    throw new Error("No music files available");
  }

  if (selector === undefined) {
    const idx = Math.floor(randomFn() * musicFiles.length);
    if (!Number.isInteger(idx) || idx < 0 || idx >= musicFiles.length) {
      return musicFiles[0];
    }
    return musicFiles[idx];
  }

  const n = Number(selector);
  if (!Number.isNaN(n) && Number.isInteger(n)) {
    const idx = n - 1;
    if (idx >= 0 && idx < musicFiles.length) {
      return musicFiles[idx];
    }
  } else {
    const byName = musicFiles.find((f) => path.basename(f) === selector);
    if (byName) {
      return byName;
    }
  }

  const names = musicFiles.map((f) => path.basename(f)).join(", ");
  throw new Error(
    `Invalid music track selector: ${selector}. Available tracks: ${names}`,
  );
}

export function resolveReelMusicFile(input: ResolveReelMusicFileInput): ResolvedReelMusicFile | undefined {
  const existsFn = input.existsFn ?? (() => true);
  const categoryPool = input.category ? (input.brand.reels?.musicByCategory?.[input.category] ?? []) : [];
  const fallbackPool = input.brand.reels?.musicFiles ?? [];
  const rawPool = categoryPool.length > 0 ? categoryPool : fallbackPool;
  let musicFiles = rawPool.filter((filePath) => existsFn(filePath));

  if (musicFiles.length === 0 && categoryPool.length > 0) {
    musicFiles = fallbackPool.filter((filePath) => existsFn(filePath));
  }
  if (musicFiles.length === 0) return undefined;

  const selected = pickMusicFile(musicFiles, input.selector, input.randomFn);
  return { path: selected, fileName: path.basename(selected) };
}
