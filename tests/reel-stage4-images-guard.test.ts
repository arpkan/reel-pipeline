import { describe, expect, it, vi, beforeEach } from "vitest";
import { guardAgainstRealPersonLikeness, resolveNamedPersonFromVoiceover } from "../src/stages/reel-stage4-images.js";

const converseMock = vi.hoisted(() => vi.fn());
vi.mock("../src/services/bedrock.js", () => ({
  createBedrockService: () => ({ converse: converseMock }),
}));

const ANONYMIZATION_CLAUSE =
  " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead.";

describe("guardAgainstRealPersonLikeness", () => {
  it("appends the anonymization clause to a generic political-role prompt with no name (regression: run ea0e9945-433a-4fd5-aa81-6652f517a0d1, scene 3 — nationality adjective 'German' must not count as a real name)", () => {
    const prompt =
      "German politician at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("leaves a prompt unchanged when a real name is present alongside a role keyword", () => {
    const prompt =
      "German Minister Carsten Schneider at a podium press conference, serious expression, microphones in front, blurred Bundestag building in background, dramatic natural lighting, vertical 9:16 portrait composition, photorealistic, journalistic style";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt);
  });

  it("triggers on a title-only phrase with no attached name", () => {
    const prompt =
      "The Prime Minister addressing parliament, serious expression, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("leaves a prompt unchanged when there is no political-role language at all", () => {
    const prompt =
      "Wide dry sandbars emerging from the Rhine river near Duisburg Germany, dramatic low water levels, cracked dry riverbed visible, industrial city skyline faint in background, golden afternoon light, vertical 9:16 portrait composition, photorealistic, cinematic atmosphere";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt);
  });

  it("treats 'A German official' as a title phrase, not a real name, and triggers", () => {
    const prompt = "A German official speaking to reporters, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("treats a place/institution name (White House) as not a real name, and triggers", () => {
    const prompt = "German politician speaking outside the White House, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("accepted limitation: over-anonymizes a bare single-word surname with no first name", () => {
    // Merkel is a real, specific person, but the 2+-word name check can't tell a
    // lone capitalized surname apart from any other single capitalized word (a
    // place, a building, a brand). Loosening the check to count single words as
    // names would reopen the White House-style false negative above. This test
    // documents the accepted trade-off, not a bug to fix.
    const prompt = "German chancellor Merkel speaking at a podium, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("triggers on a plural role word", () => {
    const prompt = "German politicians arguing in a parliamentary chamber, vertical 9:16 portrait composition, photorealistic";
    const result = guardAgainstRealPersonLikeness(prompt);
    expect(result).not.toBe(prompt);
  });

  it("regression: run 45b741e4 scene 4 ('Two politicians...') still guarded via the role-keyword path", () => {
    const prompt =
      "Two politicians sharing a handshake on a campaign stage in front of a massive cheering crowd, American flags and bright spotlights, emotional and celebratory atmosphere, vertical 9:16 portrait composition, photorealistic, cinematic wide shot";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("regression: run d531b39f scene 4 ('two people... rally stage') now guarded via generic-person + political-scene co-occurrence", () => {
    const prompt =
      "Photorealistic vertical 9:16 portrait, two people standing together on a brightly lit rally stage, American flags and cheering crowd in background, emotional and triumphant atmosphere, confetti or balloons in the air, indoor convention center, patriotic red-white-blue color palette";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });

  it("does not trigger on a generic person mention with no political-scene cue (e.g. human_interest)", () => {
    const prompt = "A woman cooking in her kitchen, warm afternoon light, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt);
  });

  it("triggers on generic person + political scene with no role noun", () => {
    const prompt = "A man at a campaign rally podium, cheering crowd behind him, vertical 9:16 portrait composition, photorealistic";
    expect(guardAgainstRealPersonLikeness(prompt)).toBe(prompt + ANONYMIZATION_CLAUSE);
  });
});

describe("resolveNamedPersonFromVoiceover", () => {
  beforeEach(() => {
    converseMock.mockReset();
  });

  it("returns the resolved name when the model identifies exactly one real person", async () => {
    converseMock.mockResolvedValue({ text: "Darline Graham", source: "native" });
    const result = await resolveNamedPersonFromVoiceover(
      "Darline Graham joined Trump on stage, thanking him for his friendship with her late brother.",
      "two people standing together on a brightly lit rally stage",
    );
    expect(result).toBe("Darline Graham");
  });

  it("falls back to null when the model returns NONE (ambiguous / multiple people)", async () => {
    converseMock.mockResolvedValue({ text: "NONE", source: "native" });
    const result = await resolveNamedPersonFromVoiceover(
      "Darline Graham joined Trump on stage.",
      "two people standing together on a brightly lit rally stage",
    );
    expect(result).toBeNull();
  });

  it("falls back to null when the resolution call throws", async () => {
    converseMock.mockRejectedValue(new Error("bedrock unavailable"));
    const result = await resolveNamedPersonFromVoiceover("Darline Graham joined Trump on stage.", "two people on a stage");
    expect(result).toBeNull();
  });
});
