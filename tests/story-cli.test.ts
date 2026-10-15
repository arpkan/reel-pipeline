import { describe, expect, it } from "vitest";
import { getStoryReelGeminiModel, isStoryReelEnabled } from "../src/config.js";

describe("StoryReel CLI readiness", () => {
  it("flag gates story mode off by default", () => {
    delete process.env.STORYREEL_ENABLED;
    expect(isStoryReelEnabled()).toBe(false);
  });

  it("flag gates story mode on when enabled", () => {
    process.env.STORYREEL_ENABLED = "true";
    expect(isStoryReelEnabled()).toBe(true);
    delete process.env.STORYREEL_ENABLED;
  });

  it("provides default Gemini model for story stages", () => {
    delete process.env.STORYREEL_GEMINI_MODEL;
    expect(getStoryReelGeminiModel()).toBe("gemini-2.5-flash");
  });

  it("respects model override", () => {
    process.env.STORYREEL_GEMINI_MODEL = "gemini-2.5-pro";
    expect(getStoryReelGeminiModel()).toBe("gemini-2.5-pro");
    delete process.env.STORYREEL_GEMINI_MODEL;
  });
});
