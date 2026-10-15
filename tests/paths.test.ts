import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { PROJECT_ROOT, assetPath } from "../src/paths.js";
import { ds } from "../src/brands/ds.js";
import { ns } from "../src/brands/ns.js";
import { ts } from "../src/brands/ts.js";

describe("paths", () => {
  it("finds the repo root", () => {
    expect(PROJECT_ROOT).toBe(path.resolve(import.meta.dirname, ".."));
    expect(existsSync(path.join(PROJECT_ROOT, "package.json"))).toBe(true);
  });

  it("builds asset paths under the repo root", () => {
    expect(assetPath("music", "open-1.mp3")).toBe(path.join(PROJECT_ROOT, "assets", "music", "open-1.mp3"));
  });

  it("brand music tracks resolve under assets/music", () => {
    const musicDir = path.join(PROJECT_ROOT, "assets", "music") + path.sep;
    for (const brand of [ds, ns, ts]) {
      const tracks = [
        ...(brand.reels?.musicFiles ?? []),
        ...Object.values(brand.reels?.musicByCategory ?? {}).flat(),
      ];
      expect(tracks.length).toBeGreaterThan(0);
      for (const t of tracks) expect(t.startsWith(musicDir)).toBe(true);
    }
  });
});
