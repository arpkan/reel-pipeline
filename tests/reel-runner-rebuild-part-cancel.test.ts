import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { voiceRunMock, imagesRunMock, assembleRunMock } = vi.hoisted(() => ({
  voiceRunMock: vi.fn(async () => {
    throw new Error("stage should not run");
  }),
  imagesRunMock: vi.fn(async () => ({})),
  assembleRunMock: vi.fn(async () => ({})),
}));

vi.mock("../src/db/queries.js", () => ({
  getReelById: vi.fn(),
  updateReel: vi.fn(),
}));

vi.mock("../src/stages/reel-stage3-voice.js", () => ({
  ReelStage3Voice: class {
    name = "reel-stage3-voice";

    run(ctx: unknown) {
      return voiceRunMock(ctx);
    }
  },
}));

vi.mock("../src/stages/reel-stage4-images.js", () => ({
  ReelStage4Images: class {
    name = "reel-stage4-images";

    run(ctx: unknown) {
      return imagesRunMock(ctx);
    }
  },
}));

vi.mock("../src/stages/reel-stage5-assemble.js", () => ({
  ReelStage5Assemble: class {
    name = "reel-stage5-assemble";

    run(ctx: unknown) {
      return assembleRunMock(ctx);
    }
  },
}));

import * as queries from "../src/db/queries.js";
import { ReelRunner, isCancelRequested, isReelRunning, requestCancelReel } from "../src/pipeline/reel-runner.js";

describe("ReelRunner.rebuildPart cancellation", () => {
  const workDir = path.join(process.cwd(), "work", "reels", "reel-1");

  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(workDir, { recursive: true });
    for (let i = 1; i <= 4; i += 1) {
      fs.writeFileSync(path.join(workDir, `scene${i}.png`), "img");
    }

    vi.mocked(queries.getReelById).mockReturnValue({
      id: "reel-1",
      brand: "ns",
      runDate: "2026-04-23",
      category: "politics",
      headline: "Test headline",
      sourceUrl: "https://example.com/story",
      snippet: "Test snippet",
      script: JSON.stringify({
        title: "Test reel",
        scenes: [{ sceneNumber: 1, voiceover: "hi", caption: "c", imagePrompt: "p" }],
        hashtags: [],
      }),
      context: null,
    } as never);
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("marks rebuildPart runs cancelled and releases lock when cancel requested", async () => {
    requestCancelReel("ns");

    await expect(ReelRunner.rebuildPart("reel-1", "ns", "voice")).rejects.toThrow("Reel cancelled by user");

    expect(isReelRunning("ns")).toBe(false);
    expect(isCancelRequested("ns")).toBe(false);
    expect(voiceRunMock).not.toHaveBeenCalled();
    expect(queries.updateReel).toHaveBeenCalledWith("reel-1", expect.objectContaining({
      status: "cancelled",
      currentStage: null,
    }));
    expect(queries.updateReel).not.toHaveBeenCalledWith("reel-1", expect.objectContaining({ status: "failed" }));
  });
});
