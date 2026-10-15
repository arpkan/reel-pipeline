import { describe, expect, it } from "vitest";

process.env.PIPELINE_DB_PATH = ":memory:";

const { parseReelCommandFlags } = await import("../src/pipeline/command-listener.js");

describe("parseReelCommandFlags", () => {
  it("parses renderer and template flags while preserving command text", () => {
    expect(parseReelCommandFlags("trending ken_burns -hf -template enhanced-default -stock")).toEqual({
      cleaned: "trending ken_burns",
      useStockImages: true,
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    });
  });

  it("keeps -ffmpeg in cleaned text and does not set renderer", () => {
    expect(parseReelCommandFlags("business -ffmpeg")).toEqual({
      cleaned: "business -ffmpeg",
      useStockImages: undefined,
      stage5Renderer: undefined,
      stage5Template: undefined,
    });
  });

  it("preserves unsupported template values in command text", () => {
    expect(parseReelCommandFlags("trending -template ken_burns")).toEqual({
      cleaned: "trending -template ken_burns",
      useStockImages: undefined,
      stage5Renderer: undefined,
      stage5Template: undefined,
    });
  });

  it("preserves template flag when its value is missing", () => {
    expect(parseReelCommandFlags("trending -template")).toEqual({
      cleaned: "trending -template",
      useStockImages: undefined,
      stage5Renderer: undefined,
      stage5Template: undefined,
    });
  });
});
