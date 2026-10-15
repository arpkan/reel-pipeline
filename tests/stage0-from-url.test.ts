import { describe, it, expect, vi } from "vitest";
import { Stage0FromUrl } from "../src/stages/stage0-from-url.js";
import type { RunContext, Services } from "../src/types.js";
import { getBrand } from "../src/brands/index.js";

function makeCtx(): RunContext {
  return {
    runId: "test-run",
    brand: getBrand("ns"),
    runDate: "2026-04-26",
    stories: [],
    posts: [],
    stageLogs: [],
    status: "running",
  };
}

// Long enough (>3000 chars, unique sentences) to pass the scraper-block,
// thin-stub and thin-extract checks so the extract is used directly.
function articleBody(marker: string): string {
  const sentences = Array.from({ length: 50 }, (_, i) =>
    `Sentence ${i} of the ${marker} article describes one distinct reported detail.`);
  return `${marker}\n\n${sentences.join(" ")}`;
}

describe("Stage0FromUrl", () => {
  it("uses extract content that matches the requested URL", async () => {
    const requestedUrl = "https://example.com/right-story";
    const stage = new Stage0FromUrl([requestedUrl]);

    const services = {
      search: {
        extract: vi.fn(async () => ([
          { url: "https://example.com/wrong-story", content: articleBody("WRONG_CONTENT"), isYouTube: false },
          { url: requestedUrl, content: articleBody("RIGHT_CONTENT"), isYouTube: false },
        ])),
      },
      gemini: {
        generate: vi.fn(async (_system: string, prompt: string) => {
          const picksRight = prompt.includes("RIGHT_CONTENT");
          return {
            source: "native",
            text: JSON.stringify({
              headline: picksRight ? "Right headline" : "Wrong headline",
              snippet: "Snippet",
              selectionReason: "Reason",
            }),
          };
        }),
      },
    } as unknown as Services;

    const result = await stage.run(makeCtx(), services);
    expect(result.stories?.[0]?.headline).toBe("Right headline");
  });
});
