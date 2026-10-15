import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "fs";

const TEST_DB_PATH = `/tmp/test-storyreel-db-${process.pid}-${Date.now()}.db`;
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
process.env.PIPELINE_DB_PATH = TEST_DB_PATH;

const q = await import("../src/db/queries.js");

describe("StoryReel DB", () => {
  beforeEach(() => {
    q.clearStoryIntakeSession("chat-1");
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it("creates and updates a channel profile by Telegram chat id", () => {
    const profile = q.upsertStoryProfile({
      telegramChatId: "chat-1",
      profileName: "Dog Walking",
      audienceLanguage: "german",
      audienceDescription: "German dog owners who want practical walking tips.",
    });

    expect(profile.telegramChatId).toBe("chat-1");
    expect(q.getStoryProfileByChatId("chat-1")?.audienceLanguage).toBe("german");

    q.updateStoryProfileVoice(profile.id, "eleven-1", "elevenlabs");
    expect(q.getStoryProfileByChatId("chat-1")?.preferredVoiceId).toBe("eleven-1");
  });

  it("persists StoryReel intake sessions with clips and one-shot music override", () => {
    q.upsertStoryIntakeSession({
      chatId: "chat-1",
      clips: [{ path: "/tmp/a.mp4", sizeMb: 12, durationSec: 30, orientation: "vertical", width: 1080, height: 1920 }],
      totalSizeMb: 12,
      totalDurationSec: 30,
      pendingMusicOverride: "calm",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const session = q.getStoryIntakeSession("chat-1");
    expect(session?.clips).toHaveLength(1);
    expect(session?.pendingMusicOverride).toBe("calm");
  });

  it("expires StoryReel intake sessions", () => {
    q.upsertStoryIntakeSession({
      chatId: "chat-1",
      clips: [{ path: "/tmp/old.mp4", sizeMb: 1, durationSec: 2, orientation: "vertical", width: 1080, height: 1920 }],
      totalSizeMb: 1,
      totalDurationSec: 2,
      pendingMusicOverride: null,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    expect(q.getStoryIntakeSession("chat-1")).toBeNull();
  });

  it("finds seeded voices by language and inferred voice style", () => {
    q.createStoryVoice({
      id: "voice-row-1",
      voiceId: "eleven-voice-1",
      name: "Warm Guide",
      provider: "elevenlabs",
      language: "english",
      styles: ["storytelling", "conversational"],
      description: "Warm natural voice",
    });

    expect(q.getStoryVoices("english", "storytelling")).toEqual([
      expect.objectContaining({ voiceId: "eleven-voice-1", provider: "elevenlabs" }),
    ]);
    expect(q.getStoryVoices("german", "storytelling")).toEqual([]);
  });

  it("creates story runs and updates checkpoints", () => {
    const profile = q.upsertStoryProfile({
      telegramChatId: "chat-1",
      profileName: "Travel Clips",
      audienceLanguage: "english",
      audienceDescription: "English speaking viewers who like honest travel clips.",
    });

    q.createStoryRun({
      id: "story-1",
      profileId: profile.id,
      telegramChatId: "chat-1",
      sourceClipsMetadata: [{ path: "/tmp/a.mp4", sizeMb: 10, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 }],
      clipCount: 1,
      totalClipsSizeMb: 10,
      totalSourceDurationSec: 20,
      userNote: "make it practical",
      workDir: "/tmp/story-1",
    });

    q.updateStoryRun("story-1", {
      currentStage: "story-stage1-direction",
      directionJson: { inferred_voice_style: "tutorial", inferred_content_type: "travel" },
      geminiInputTokens: 100,
      geminiOutputTokens: 40,
      geminiCostUsd: 0.00003,
    });

    const run = q.getStoryRunById("story-1");
    expect(run?.status).toBe("generating");
    expect(JSON.parse(run!.directionJson!).inferred_voice_style).toBe("tutorial");
  });

  it("persists pending StoryReel setup requests for admin approval", () => {
    q.upsertStorySetupRequest({
      chatId: "chat-admin-1",
      chatTitle: "Dog Walkers Berlin",
      chatType: "supergroup",
      chatUsername: "dogwalkersberlin",
      profileName: "DogWalks",
      audienceLanguage: "english",
      audienceDescription: "People who want practical dog walking videos.",
    });

    expect(q.getStorySetupRequestByChatId("chat-admin-1")).toEqual(expect.objectContaining({
      chatTitle: "Dog Walkers Berlin",
      status: "pending",
      profileName: "DogWalks",
    }));
    expect(q.getPendingStorySetupRequests()).toEqual([expect.objectContaining({ chatId: "chat-admin-1" })]);
    expect(q.resolveLatestPendingStorySetupRequest()).toEqual(expect.objectContaining({ chatId: "chat-admin-1" }));

    q.markStorySetupRequestRejected("chat-admin-1");
    expect(q.getStorySetupRequestByChatId("chat-admin-1")?.status).toBe("rejected");
    expect(q.resolveLatestPendingStorySetupRequest()).toBeNull();

    q.deleteStorySetupRequest("chat-admin-1");
    expect(q.getStorySetupRequestByChatId("chat-admin-1")).toBeNull();
  });
});
