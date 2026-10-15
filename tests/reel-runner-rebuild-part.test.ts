import { beforeAll, describe, expect, it, vi } from "vitest";
import path from "path";

vi.mock("../src/db/queries.js", () => ({}));
vi.mock("../src/services/telegram.js", () => ({ createTelegramService: vi.fn() }));
vi.mock("../src/services/line.js", () => ({ createLineService: vi.fn() }));
vi.mock("../src/services/messaging.js", () => ({ getEnabledChannels: vi.fn(() => []) }));
vi.mock("../src/services/gcs.js", () => ({ createGcsService: vi.fn() }));
vi.mock("../src/services/stock-image.js", () => ({ createStockImageService: vi.fn() }));
vi.mock("../src/services/search.js", () => ({ createSearchService: vi.fn() }));
vi.mock("../src/services/gemini.js", () => ({ createGeminiService: vi.fn() }));
vi.mock("../src/services/bedrock.js", () => ({ createBedrockService: vi.fn() }));
vi.mock("../src/services/image-gen.js", () => ({ createImageGenService: vi.fn() }));
vi.mock("../src/services/meta.js", () => ({ createMetaService: vi.fn() }));
vi.mock("../src/config.js", () => ({ isReelAssemblyOffloadEnabled: () => false }));

let getRebuildPartArtifacts: typeof import("../src/pipeline/reel-runner.js")["getRebuildPartArtifacts"];

beforeAll(async () => {
  ({ getRebuildPartArtifacts } = await import("../src/pipeline/reel-runner.js"));
});

describe("getRebuildPartArtifacts", () => {
  const workDir = "/tmp/reel-work";
  const sceneCount = 3;

  const allFiles = [
    path.join(workDir, "scene1.mp3"),
    path.join(workDir, "scene2.mp3"),
    path.join(workDir, "scene3.mp3"),
    path.join(workDir, "scene1.png"),
    path.join(workDir, "scene2.png"),
    path.join(workDir, "scene3.png"),
  ];

  const existsOnly = (files: string[]) => {
    const set = new Set(files);
    return (filePath: string) => set.has(filePath);
  };

  it("returns image paths for voice part", () => {
    const artifacts = getRebuildPartArtifacts(workDir, sceneCount, "voice", existsOnly(allFiles));
    expect(artifacts.audioPaths).toBeUndefined();
    expect(artifacts.imagePaths).toEqual([
      path.join(workDir, "scene1.png"),
      path.join(workDir, "scene2.png"),
      path.join(workDir, "scene3.png"),
    ]);
  });

  it("returns audio paths for images part", () => {
    const artifacts = getRebuildPartArtifacts(workDir, sceneCount, "images", existsOnly(allFiles));
    expect(artifacts.audioPaths).toEqual([
      path.join(workDir, "scene1.mp3"),
      path.join(workDir, "scene2.mp3"),
      path.join(workDir, "scene3.mp3"),
    ]);
    expect(artifacts.imagePaths).toBeUndefined();
  });

  it("returns both paths for music part", () => {
    const artifacts = getRebuildPartArtifacts(workDir, sceneCount, "music", existsOnly(allFiles));
    expect(artifacts.audioPaths).toEqual([
      path.join(workDir, "scene1.mp3"),
      path.join(workDir, "scene2.mp3"),
      path.join(workDir, "scene3.mp3"),
    ]);
    expect(artifacts.imagePaths).toEqual([
      path.join(workDir, "scene1.png"),
      path.join(workDir, "scene2.png"),
      path.join(workDir, "scene3.png"),
    ]);
  });

  it("throws clear error when voice part is missing images", () => {
    expect(() =>
      getRebuildPartArtifacts(
        workDir,
        sceneCount,
        "voice",
        existsOnly(allFiles.filter((f) => !f.endsWith("scene2.png"))),
      ),
    ).toThrow("rebuildPart(voice) requires existing scene images: scene2.png");
  });

  it("throws clear error when images part is missing audio", () => {
    expect(() =>
      getRebuildPartArtifacts(
        workDir,
        sceneCount,
        "images",
        existsOnly(allFiles.filter((f) => !f.endsWith("scene1.mp3"))),
      ),
    ).toThrow("rebuildPart(images) requires existing scene audio: scene1.mp3");
  });

  it("throws clear error when music part is missing both audio and images", () => {
    expect(() =>
      getRebuildPartArtifacts(
        workDir,
        sceneCount,
        "music",
        existsOnly(allFiles.filter((f) => !f.endsWith("scene1.mp3") && !f.endsWith("scene3.png"))),
      ),
    ).toThrow("rebuildPart(music) requires existing scene artifacts: audio (scene1.mp3); images (scene3.png)");
  });
});
