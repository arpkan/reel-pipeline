import { describe, it, expect } from "vitest";
import { createStage1GeminiMockReply } from "../test/runner.js";

describe("createStage1GeminiMockReply", () => {
  it("returns a Gemini generate-style JSON text response", () => {
    const reply = createStage1GeminiMockReply();
    const response = reply();

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text as string;
    expect(text).toBeTruthy();

    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("selectedIndex");
    expect(parsed).toHaveProperty("headline");
    expect(parsed).toHaveProperty("theme");
    expect(parsed).toHaveProperty("selectionReason");
  });
});
