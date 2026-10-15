import { describe, expect, it } from "vitest";
import {
  computeStoryIntakeExpiry,
  formatClipAcceptedMessage,
  formatClipLimitError,
  parseStoryCommand,
  validateAudienceDescription,
  validateMusicGenreInput,
  validateStoryProfileSetup,
} from "../src/pipeline/story-intake.js";

describe("StoryReel intake helpers", () => {
  it("validates setup audience description length", () => {
    expect(validateAudienceDescription("People who want practical and honest short videos.")).toBeNull();
  });

  it("accepts empty audience description", () => {
    expect(validateAudienceDescription("")).toBeNull();
  });

  it("accepts setup without audience description", () => {
    expect(validateStoryProfileSetup({ profileName: "DogWalks", language: "german" })).toBeNull();
  });

  it("accepts setup with blank audience description", () => {
    const result = validateStoryProfileSetup({
      profileName: "MyBrand",
      language: "english",
      audienceDescription: "",
    });
    expect(result).toBeNull();
  });

  it("formats clip intake messages", () => {
    expect(formatClipAcceptedMessage(1, 5, 134, 38)).toBe(
      "Clip 1/5 received (2m14s, 38MB). Send more or !run to start.",
    );
    expect(formatClipLimitError("count", { count: 5 })).toBe(
      "You've already sent 5 clips. Use !run to start or !cancel to clear.",
    );
  });

  it("formats size and duration limit errors", () => {
    expect(formatClipLimitError("size", { maxMb: 500 })).toBe(
      "Total size exceeds 500MB limit. Use !run to start or !cancel to clear.",
    );
    expect(formatClipLimitError("duration", { maxSec: 300 })).toBe(
      "Total duration exceeds 300s limit. Use !run to start or !cancel to clear.",
    );
  });

  it("parses !run command with optional note", () => {
    expect(parseStoryCommand("!run")).toEqual({ type: "run" });
    expect(parseStoryCommand("!run make it formal")).toEqual({ type: "run", note: "make it formal" });
  });

  it("parses !story command", () => {
    expect(parseStoryCommand("!story")).toEqual({ type: "story" });
  });

  it("parses !story resume <id>", () => {
    expect(parseStoryCommand("!story resume abc123")).toEqual({ type: "resume", id: "abc123" });
  });

  it("parses !story rebuild <id> <stage>", () => {
    expect(parseStoryCommand("!story rebuild abc123 3")).toEqual({ type: "rebuild", id: "abc123", stage: 3 });
  });

  it("parses !story rebuild <stage> with optional id", () => {
    expect(parseStoryCommand("!story rebuild 3")).toEqual({ type: "rebuild", stage: 3 });
  });

  it("parses !cancel command", () => {
    expect(parseStoryCommand("!cancel")).toEqual({ type: "cancel" });
  });

  it("parses !profile command", () => {
    expect(parseStoryCommand("!profile")).toEqual({ type: "profile" });
  });

  it("parses !music command", () => {
    expect(parseStoryCommand("!music calm")).toEqual({ type: "music", genre: "calm" });
  });

  it("parses !tweak command with optional note", () => {
    expect(parseStoryCommand("!tweak")).toEqual({ type: "tweak" });
    expect(parseStoryCommand("!tweak make it shorter")).toEqual({ type: "tweak", note: "make it shorter" });
  });

  it("parses !setup command with arguments", () => {
    expect(parseStoryCommand("!setup")).toEqual({ type: "setup" });
    expect(parseStoryCommand("!setup DogWalking english People who love dogs")).toEqual({
      type: "setup",
      profileName: "DogWalking",
      language: "english",
      audienceDescription: "People who love dogs",
    });
  });

  it("parses !admin approval commands", () => {
    expect(parseStoryCommand("!admin pending")).toEqual({ type: "admin", action: "pending" });
    expect(parseStoryCommand("!admin approve")).toEqual({ type: "admin", action: "approve" });
    expect(parseStoryCommand("!admin approve -100123")).toEqual({ type: "admin", action: "approve", chatId: "-100123" });
    expect(parseStoryCommand("!admin reject")).toEqual({ type: "admin", action: "reject" });
    expect(parseStoryCommand("!admin reject -100123")).toEqual({ type: "admin", action: "reject", chatId: "-100123" });
  });

  it("returns unknown for unrecognized commands", () => {
    expect(parseStoryCommand("!foo bar")).toEqual({ type: "unknown", raw: "!foo bar" });
  });

  it("validates music genre input", () => {
    expect(validateMusicGenreInput("ambient")).toBe(
      "Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational",
    );
    expect(validateMusicGenreInput("calm")).toBeNull();
    expect(validateMusicGenreInput("UPBEAT")).toBeNull();
  });

  it("computes a 24-hour intake session expiry", () => {
    expect(computeStoryIntakeExpiry(new Date("2026-05-17T12:00:00.000Z"))).toBe("2026-05-18T12:00:00.000Z");
  });
});
