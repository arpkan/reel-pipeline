import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const compareStage = vi.fn(() => ({ passed: true, stage: "0", added: [], removed: [], changed: [] }));
  const dbGet = vi.fn(() => ({ id: "reel-from-db", brand: "ns", run_date: "2026-04-21" }));
  const dbPrepare = vi.fn(() => ({ get: dbGet }));
  const dbClose = vi.fn();
  const dbCtor = vi.fn(() => ({ prepare: dbPrepare, close: dbClose }));
  const stage0Run = vi.fn(async () => ({}));
  const nockCleanAll = vi.fn();

  return {
    compareStage,
    dbGet,
    dbPrepare,
    dbClose,
    dbCtor,
    stage0Run,
    nockCleanAll,
  };
});

vi.mock("../test/compare.js", () => ({
  compareStage: mocks.compareStage,
}));

vi.mock("better-sqlite3", () => ({
  default: mocks.dbCtor,
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn((brand: string) => ({ id: brand })),
}));

vi.mock("../src/services/search.js", () => ({ createSearchService: vi.fn(() => ({})) }));
vi.mock("../src/services/bedrock.js", () => ({ createBedrockService: vi.fn(() => ({})) }));
vi.mock("../src/services/gemini.js", () => ({ createGeminiService: vi.fn(() => ({})) }));
vi.mock("../src/services/image-gen.js", () => ({ createImageGenService: vi.fn(() => ({})) }));
vi.mock("../src/services/gcs.js", () => ({ createGcsService: vi.fn(() => ({})) }));
vi.mock("../src/services/telegram.js", () => ({ createTelegramService: vi.fn(() => ({})) }));
vi.mock("../src/services/line.js", () => ({ createLineService: vi.fn(() => ({})) }));
vi.mock("../src/services/meta.js", () => ({ createMetaService: vi.fn(() => ({})) }));
vi.mock("../src/services/stock-image.js", () => ({ createStockImageService: vi.fn(() => ({})) }));

vi.mock("../src/stages/stage0-pillar-balance.js", () => ({
  Stage0PillarBalance: class {
    run = mocks.stage0Run;
  },
}));

vi.mock("nock", () => ({
  default: {
    cleanAll: mocks.nockCleanAll,
  },
}));

describe("runReelStage reel selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => "" as never);
  });

  it("uses provided reelId instead of first row by brand", async () => {
    const { runReelStage } = await import("../test/runner.js");

    await expect(runReelStage("0", "ns", false, false, "reel-explicit-id")).resolves.toBeDefined();

    expect(mocks.dbPrepare).toHaveBeenCalledWith("SELECT * FROM reels WHERE id = ? AND brand = ? LIMIT 1");
    expect(mocks.dbGet).toHaveBeenCalledWith("reel-explicit-id", "ns");
  });
});
