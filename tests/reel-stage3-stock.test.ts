import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReelStage4Images } from "../src/stages/reel-stage4-images.js";
import type { ReelContext, ReelScene } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";
import fs from "fs";
import path from "path";
import os from "os";

const { stockTryMock, generateMock } = vi.hoisted(() => ({
  stockTryMock: vi.fn(),
  generateMock: vi.fn().mockResolvedValue({
    buffer: Buffer.from("ai-image"),
    source: "imagen" as const,
  }),
}));

vi.mock("../src/services/image-gen.js", () => ({
  createImageGenService: () => ({
    modelName: "gemini-test-model",
    generate: generateMock,
  }),
  ImageSafetyError: class extends Error {
    constructor() {
      super("IMAGE_SAFETY");
      this.name = "ImageSafetyError";
    }
  },
}));

vi.mock("../src/services/stock-image.js", () => ({
  createStockImageService: () => ({
    tryStockImage: stockTryMock,
  }),
}));

vi.mock("child_process", () => ({
  spawnSync: () => ({ stdout: "800,1400" }),
}));

const DEFAULT_SCENES: ReelScene[] = [
  { sceneNumber: 1, voiceover: "Hello", caption: "Hi", imagePrompt: "Berlin cityscape at dusk, photorealistic" },
  { sceneNumber: 2, voiceover: "World", caption: "Wow", imagePrompt: "futuristic robot assembly line, neon lights" },
];

function makeReelCtx(workDir: string, scenes: ReelScene[] = DEFAULT_SCENES): ReelContext {
  return {
    runId: "test-reel",
    brand: getBrand("ns"),
    runDate: "2026-04-21",
    workDir,
    script: {
      title: "Test reel",
      scenes,
      hashtags: [],
    },
    stageLogs: [],
    status: "running",
  };
}

describe("ReelStage4Images stock integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-"));
    stockTryMock.mockReset();
    generateMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses stock image when available", async () => {
    stockTryMock.mockResolvedValue({
      buffer: Buffer.from("stock-photo-data"),
      provider: "unsplash",
    });

    const stage = new ReelStage4Images();
    const result = await stage.run(makeReelCtx(tmpDir));

    expect(result.imagePaths).toHaveLength(2);
    for (const p of result.imagePaths!) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it("falls back to Imagen when stock returns nothing", async () => {
    stockTryMock.mockResolvedValue(null);

    const stage = new ReelStage4Images();
    const result = await stage.run(makeReelCtx(tmpDir));

    expect(result.imagePaths).toHaveLength(2);
    for (const p of result.imagePaths!) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});

describe("ReelStage4Images political-figure image guard", () => {
  let tmpDir: string;
  const politicalPrompt =
    "German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-"));
    stockTryMock.mockReset();
    stockTryMock.mockResolvedValue(null);
    generateMock.mockClear();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sends the anonymization-guarded prompt to the image generator but the original prompt to stock search", async () => {
    const scenes: ReelScene[] = [
      { sceneNumber: 1, voiceover: "test", caption: "test", imagePrompt: politicalPrompt },
    ];
    const stage = new ReelStage4Images();
    await stage.run(makeReelCtx(tmpDir, scenes));

    expect(stockTryMock).toHaveBeenCalledWith(politicalPrompt, "portrait");

    const [sentPrompt] = generateMock.mock.calls[0];
    expect(sentPrompt).not.toBe(politicalPrompt);
    expect(sentPrompt).toBe(
      politicalPrompt +
        " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead."
    );
  });
});

describe("ReelStage4Images safety-retry fallback", () => {
  let tmpDir: string;
  const politicalPrompt =
    "German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-"));
    stockTryMock.mockReset();
    stockTryMock.mockResolvedValue(null);
    generateMock.mockReset();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds a clean, unmangled safe prompt from the original prompt and re-appends the clause when the guard fired", async () => {
    class TestImageSafetyError extends Error {
      constructor() {
        super("IMAGE_SAFETY");
        this.name = "ImageSafetyError";
      }
    }
    generateMock
      .mockRejectedValueOnce(new TestImageSafetyError())
      .mockResolvedValueOnce({ buffer: Buffer.from("ai-image"), source: "imagen" });

    const scenes: ReelScene[] = [
      { sceneNumber: 1, voiceover: "test", caption: "test", imagePrompt: politicalPrompt },
    ];
    const stage = new ReelStage4Images();
    await stage.run(makeReelCtx(tmpDir, scenes));

    expect(generateMock).toHaveBeenCalledTimes(2);
    const [safePrompt] = generateMock.mock.calls[1];

    // no double spaces / mangled text from stripping "person" out of the clause
    expect(safePrompt).not.toMatch(/  /);
    expect(safePrompt.startsWith("Cinematic news photo, no people visible: ")).toBe(true);
    // guard fired for this prompt (political-role keyword, no real name) so the
    // clause should be re-appended cleanly after stripping
    expect(safePrompt).toContain(
      "Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead."
    );
  });

  it("does not append the clause to the safe prompt when the guard never fired", async () => {
    class TestImageSafetyError extends Error {
      constructor() {
        super("IMAGE_SAFETY");
        this.name = "ImageSafetyError";
      }
    }
    generateMock
      .mockRejectedValueOnce(new TestImageSafetyError())
      .mockResolvedValueOnce({ buffer: Buffer.from("ai-image"), source: "imagen" });

    // Deliberately free of the stripped-word list (child/kid/boy/girl/man/woman/
    // person/people/minor/N-year-old) so this test isolates the clause-omission
    // behavior from the unrelated, pre-existing double-space-on-word-strip
    // behavior of the regex (not in scope for this fix).
    const nonPoliticalPrompt = "A futuristic city skyline at sunset, photorealistic, cinematic atmosphere";
    const scenes: ReelScene[] = [
      { sceneNumber: 1, voiceover: "test", caption: "test", imagePrompt: nonPoliticalPrompt },
    ];
    const stage = new ReelStage4Images();
    await stage.run(makeReelCtx(tmpDir, scenes));

    expect(generateMock).toHaveBeenCalledTimes(2);
    const [safePrompt] = generateMock.mock.calls[1];

    expect(safePrompt).not.toMatch(/  /);
    expect(safePrompt).not.toContain("Any person shown should have generic");
  });
});
