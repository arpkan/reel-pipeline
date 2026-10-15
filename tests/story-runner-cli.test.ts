import { beforeEach, describe, expect, it, vi } from "vitest";

describe("StoryReel admin CLI", () => {
  beforeEach(() => {
    delete process.env.STORYREEL_ENABLED;
  });

  it("parses local clip, profile, language, audience, and note arguments", async () => {
    const { parseStoryRunnerArgs } = await import("../scripts/story-runner.js");

    expect(parseStoryRunnerArgs([
      "--chat-id", "local-chat",
      "--profile-name", "DogWalks",
      "--language", "german",
      "--audience", "German dog owners who want practical daily walking advice.",
      "--clip", "/clips/a.mp4",
      "--clip", "/clips/b.mp4",
      "--note", "make it punchy",
    ])).toEqual({
      chatId: "local-chat",
      profileName: "DogWalks",
      language: "german",
      audienceDescription: "German dog owners who want practical daily walking advice.",
      clipPaths: ["/clips/a.mp4", "/clips/b.mp4"],
      note: "make it punchy",
    });
  });

  it("gates execution behind STORYREEL_ENABLED", async () => {
    const { runStoryRunnerCli } = await import("../scripts/story-runner.js");
    process.env.STORYREEL_ENABLED = "false";

    await expect(runStoryRunnerCli([
      "--chat-id", "local-chat",
      "--profile-name", "DogWalks",
      "--language", "german",
      "--audience", "German dog owners who want practical daily walking advice.",
      "--clip", "/clips/a.mp4",
    ], {
      upsertStoryProfile: vi.fn(),
      createRunner: vi.fn(),
    })).rejects.toThrow("StoryReel is disabled. Set STORYREEL_ENABLED=true to run this command.");
  });

  it("creates a profile and runs local clips through StoryRunner", async () => {
    const { runStoryRunnerCli } = await import("../scripts/story-runner.js");
    process.env.STORYREEL_ENABLED = "true";
    const profile = { id: "profile-1", telegramChatId: "local-chat" };
    const runner = { runFromLocalClips: vi.fn().mockResolvedValue({ storyId: "story-1" }) };
    const upsertStoryProfile = vi.fn(() => profile);

    const result = await runStoryRunnerCli([
      "--chat-id", "local-chat",
      "--profile-name", "DogWalks",
      "--language", "german",
      "--audience", "German dog owners who want practical daily walking advice.",
      "--clip", "/clips/a.mp4",
      "--note", "make it punchy",
    ], {
      upsertStoryProfile,
      createRunner: vi.fn(() => runner),
    });

    expect(upsertStoryProfile).toHaveBeenCalledWith({
      telegramChatId: "local-chat",
      profileName: "DogWalks",
      audienceLanguage: "german",
      audienceDescription: "German dog owners who want practical daily walking advice.",
    });
    expect(runner.runFromLocalClips).toHaveBeenCalledWith({
      chatId: "local-chat",
      clipPaths: ["/clips/a.mp4"],
      note: "make it punchy",
      profile,
    });
    expect(result.storyId).toBe("story-1");
  });
});
