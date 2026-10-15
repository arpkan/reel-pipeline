import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/stages/reel-subtitle-blocks.js";
import type { WordTiming } from "../src/types.js";

function timings(words: string[]): WordTiming[] {
  return words.map((word, index) => ({ word, start: index * 0.2, end: index * 0.2 + 0.2 }));
}

describe("splitIntoBlocks", () => {
  it("uses eight words as the default English block target", () => {
    const blocks = splitIntoBlocks(timings(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]));

    expect(blocks.map((block) => block.map((word) => word.word))).toEqual([
      ["one", "two", "three", "four", "five", "six", "seven", "eight"],
      ["nine", "ten"],
    ]);
  });

  it("borrows a word from the previous English block to avoid one-word orphans", () => {
    const blocks = splitIntoBlocks(timings(["Police", "confirmed", "an", "arrest", "after", "the", "late", "night", "raid."]));

    expect(blocks.map((block) => block.map((word) => word.word))).toEqual([
      ["Police", "confirmed", "an", "arrest", "after", "the", "late"],
      ["night", "raid."],
    ]);
  });
});
