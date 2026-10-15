import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  releaseAssemblyLock: vi.fn(),
}));

vi.mock("../src/db/queries.js", () => ({}));
vi.mock("../src/services/gcs.js", () => ({ createGcsService: vi.fn() }));
vi.mock("../src/pipeline/reel-runner.js", () => ({
  acquireAssemblyLock: vi.fn(async () => {}),
  releaseAssemblyLock: state.releaseAssemblyLock,
}));

describe("StoryReel runtime helpers", () => {
  it("copies intake clips into the story work directory and rewrites metadata paths", async () => {
    const { copyStoryIntakeClipsToWorkDir } = await import("../src/pipeline/story-runtime.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-runtime-"));
    const intake = path.join(dir, "intake", "clip-1.mp4");
    fs.mkdirSync(path.dirname(intake), { recursive: true });
    fs.writeFileSync(intake, "clip");

    const copied = copyStoryIntakeClipsToWorkDir([
      { path: intake, sizeMb: 1, durationSec: 2, orientation: "vertical", width: 1080, height: 1920 },
    ], path.join(dir, "story"));

    expect(copied).toEqual([
      expect.objectContaining({ path: path.join(dir, "story", "clips", "clip-1.mp4") }),
    ]);
    expect(fs.readFileSync(copied[0].path, "utf8")).toBe("clip");
  });

  it("releases the shared assembly lock through the reel runner lock", async () => {
    const { releaseStoryAssemblyLock } = await import("../src/pipeline/story-runner.js");

    await releaseStoryAssemblyLock();

    expect(state.releaseAssemblyLock).toHaveBeenCalled();
  });
});
