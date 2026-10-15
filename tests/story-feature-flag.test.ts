import { describe, expect, it } from "vitest";
import { getStoryReelGeminiModel, isStoryReelEnabled } from "../src/config.js";

describe("StoryReel feature flag", () => {
  it("defaults to disabled", () => {
    delete process.env.STORYREEL_ENABLED;
    expect(isStoryReelEnabled()).toBe(false);
  });

  it("enables on true", () => {
    process.env.STORYREEL_ENABLED = "true";
    expect(isStoryReelEnabled()).toBe(true);
  });

  it("uses configurable StoryReel Gemini model with production default", () => {
    delete process.env.STORYREEL_GEMINI_MODEL;
    expect(getStoryReelGeminiModel()).toBe("gemini-2.5-flash");
    process.env.STORYREEL_GEMINI_MODEL = "gemini-test-model";
    expect(getStoryReelGeminiModel()).toBe("gemini-test-model");
  });
});
