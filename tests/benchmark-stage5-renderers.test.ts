import { describe, expect, it } from "vitest";
import { benchmarkUrlForRenderer } from "../scripts/benchmark-stage5-renderers.js";

describe("benchmarkUrlForRenderer", () => {
  it("adds renderer-specific benchmark query params without changing the original URL shape", () => {
    expect(benchmarkUrlForRenderer("https://example.com/story?utm=abc#section", "ffmpeg")).toBe(
      "https://example.com/story?utm=abc&_stage5_benchmark=ffmpeg#section",
    );

    expect(benchmarkUrlForRenderer("https://example.com/story?utm=abc#section", "hyperframes")).toBe(
      "https://example.com/story?utm=abc&_stage5_benchmark=hyperframes#section",
    );
  });

  it("rejects invalid source URLs", () => {
    expect(() => benchmarkUrlForRenderer("not a url", "ffmpeg")).toThrow("Invalid source URL: not a url");
  });
});
