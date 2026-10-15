import { describe, expect, it, vi } from "vitest";
import { StoryRunner, isStoryRunning, requestCancelStory, resolveStoryResumeStage } from "../src/pipeline/story-runner.js";

describe("StoryRunner", () => {
  it("resolves resume stage from checkpoints", () => {
    expect(resolveStoryResumeStage({ directionJson: null, voiceoverPath: null, videoGcsUrl: null })).toBe(1);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: null, videoGcsUrl: null })).toBe(2);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: "/tmp/voice.mp3", videoGcsUrl: null })).toBe(3);
    expect(resolveStoryResumeStage({ directionJson: "{}", voiceoverPath: "/tmp/voice.mp3", videoGcsUrl: "https://gcs/video.mp4" })).toBe(4);
  });

  it("runs stages in order and persists stage logs", async () => {
    const updateStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [
        { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: { ok: true } }) },
        { name: "story-stage2-voice", run: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3" }) },
      ] as any,
      updateStoryRun,
      createStoryRun: vi.fn(),
      getStoryRunById: vi.fn(),
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.runFromContext({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.voiceoverPath).toBe("/tmp/voice.mp3");
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ currentStage: "story-stage1-direction" }));
  });

  it("carries one-shot music override from intake into the run context and clears it", async () => {
    const consumeStoryMusicOverride = vi.fn().mockReturnValue("calm");
    const runner = new StoryRunner({
      stages: [{ name: "story-stage3-assembly", run: vi.fn().mockResolvedValue({ videoPath: "/tmp/final.mp4" }) }] as any,
      updateStoryRun: vi.fn(),
      createStoryRun: vi.fn(),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [], totalSizeMb: 0, totalDurationSec: 0, pendingMusicOverride: "calm" }),
      consumeStoryMusicOverride,
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.run("chat-1", { profile: {} as any });

    expect(result.pendingMusicOverride).toBe("calm");
    expect(consumeStoryMusicOverride).toHaveBeenCalledWith("chat-1");
  });

  it("consumes one-shot music override for tweak runs too", async () => {
    const consumeStoryMusicOverride = vi.fn().mockReturnValue("dramatic");
    const createStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [{ name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) }] as any,
      updateStoryRun: vi.fn(),
      createStoryRun,
      getLatestStoryRunForChat: vi.fn().mockReturnValue({
        id: "old",
        profileId: "profile-1",
        sourceClipsMetadata: JSON.stringify([
          { path: "/work/stories/old/clips/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 },
          { path: "/work/stories/old/clips/clip-2.mp4", sizeMb: 6, durationSec: 12, orientation: "vertical", width: 1080, height: 1920 },
        ]),
      }),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [], totalSizeMb: 0, totalDurationSec: 0, pendingMusicOverride: "dramatic" }),
      consumeStoryMusicOverride,
      copyClipsToWorkDir: vi.fn().mockReturnValue([]),
    });

    const result = await runner.tweak("chat-1", "make it warmer");

    expect(result.pendingMusicOverride).toBe("dramatic");
    expect(consumeStoryMusicOverride).toHaveBeenCalledWith("chat-1");
    expect(createStoryRun).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "profile-1",
      clipCount: 2,
      totalClipsSizeMb: 10,
      totalSourceDurationSec: 22,
      sourceClipsMetadata: [
        expect.objectContaining({ path: "/work/stories/old/clips/clip-1.mp4" }),
        expect.objectContaining({ path: "/work/stories/old/clips/clip-2.mp4" }),
      ],
      userNote: "make it warmer",
    }));
  });

  it("resumes from stage 2 when direction exists but voice is missing", async () => {
    const stage1 = { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) };
    const stage2 = { name: "story-stage2-voice", run: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3" }) };
    const runner = new StoryRunner({
      stages: [stage1, stage2] as any,
      updateStoryRun: vi.fn(),
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: null,
        videoGcsUrl: null,
        workDir: "/tmp/story-1",
        userNote: "resume me",
        status: "failed",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    });

    await runner.resume("story-1");

    expect(stage1.run).not.toHaveBeenCalled();
    expect(stage2.run).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1", direction: expect.objectContaining({ inferred_voice_style: "tutorial" }) }));
  });

  it("runs local clips through a temporary intake session for the admin CLI", async () => {
    const setStoryIntakeSession = vi.fn();
    const run = vi.fn().mockResolvedValue({ storyId: "story-local" });
    const runner = new StoryRunner({
      setStoryIntakeSession,
      run,
      probeClipMetadata: vi.fn().mockReturnValue({ path: "/clips/a.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }),
      copyLocalClipToIntake: vi.fn().mockReturnValue("/work/stories/intake/chat-1/clip-1.mp4"),
      computeStoryIntakeExpiry: vi.fn().mockReturnValue("2099-01-01T00:00:00.000Z"),
    } as any);

    const result = await runner.runFromLocalClips({ chatId: "chat-1", clipPaths: ["/clips/a.mp4"], note: "formal", profile: {} as any });

    expect(setStoryIntakeSession).toHaveBeenCalledWith(expect.objectContaining({ chatId: "chat-1", clips: [expect.objectContaining({ path: "/work/stories/intake/chat-1/clip-1.mp4" })] }));
    expect(run).toHaveBeenCalledWith("chat-1", expect.objectContaining({ note: "formal" }));
    expect(result.storyId).toBe("story-local");
  });

  it("runs local clips through the runner when no injected run dependency exists", async () => {
    const stage = { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) };
    const runner = new StoryRunner({
      stages: [stage] as any,
      updateStoryRun: vi.fn(),
      createStoryRun: vi.fn(),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [{ path: "/work/stories/intake/chat-1/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }], totalSizeMb: 4, totalDurationSec: 10 }),
      setStoryIntakeSession: vi.fn(),
      consumeStoryMusicOverride: vi.fn(),
      clearStoryIntakeSession: vi.fn(),
      copyClipsToWorkDir: vi.fn().mockReturnValue([{ path: "/work/stories/story-local/clips/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }]),
      copyLocalClipToIntake: vi.fn().mockReturnValue("/work/stories/intake/chat-1/clip-1.mp4"),
      probeClipMetadata: vi.fn().mockReturnValue({ path: "/work/stories/intake/chat-1/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }),
      computeStoryIntakeExpiry: vi.fn().mockReturnValue("2099-01-01T00:00:00.000Z"),
      removeIntakeFiles: vi.fn(),
    });

    const result = await runner.runFromLocalClips({ chatId: "chat-1", clipPaths: ["/clips/a.mp4"], profile: { id: "profile-1" } as any, note: "formal" });

    expect(stage.run).toHaveBeenCalledWith(expect.objectContaining({ clips: [expect.objectContaining({ path: "/work/stories/story-local/clips/clip-1.mp4" })] }));
    expect(result.storyId).not.toBe("unknown");
  });

  it("marks active chats while running and cancels before the next stage", async () => {
    requestCancelStory("chat-cancel");
    const updateStoryRun = vi.fn();
    const stage = { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({}) };
    const runner = new StoryRunner({ stages: [stage] as any, updateStoryRun });

    await expect(runner.runFromContext({
      storyId: "story-cancel",
      telegramChatId: "chat-cancel",
      profile: {} as any,
      clips: [],
      workDir: "/tmp/story-cancel",
      stageLogs: [],
      status: "generating",
    })).rejects.toThrow("Story cancelled by user");

    expect(stage.run).not.toHaveBeenCalled();
    expect(updateStoryRun).toHaveBeenCalledWith("story-cancel", expect.objectContaining({ status: "cancelled", currentStage: null }));
    expect(isStoryRunning("chat-cancel")).toBe(false);
  });

  it("deletes the intake temp directory after clips are copied into the story work dir", async () => {
    const removeIntakeFiles = vi.fn();
    const runner = new StoryRunner({
      stages: [] as any,
      updateStoryRun: vi.fn(),
      createStoryRun: vi.fn(),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [{ path: "/work/stories/intake/chat-1/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }], totalSizeMb: 4, totalDurationSec: 10 }),
      consumeStoryMusicOverride: vi.fn(),
      copyClipsToWorkDir: vi.fn().mockReturnValue([{ path: "/work/stories/story-1/clips/clip-1.mp4", sizeMb: 4, durationSec: 10, orientation: "vertical", width: 1080, height: 1920 }]),
      clearStoryIntakeSession: vi.fn(),
      removeIntakeFiles,
    });

    await runner.run("chat-1", { profile: {} as any, storyId: "story-1" });

    expect(removeIntakeFiles).toHaveBeenCalledWith("chat-1");
  });

  it("rebuilds from stage 2 by clearing voice and later checkpoints before rerunning", async () => {
    const updateStoryRun = vi.fn();
    const runFromContext = vi.fn().mockResolvedValue({ storyId: "story-1" });
    const runner = new StoryRunner({
      updateStoryRun,
      runFromContext,
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: "/work/stories/story-1/voice/voiceover.mp3",
        videoGcsUrl: "https://gcs/video.mp4",
        reviewUrl: "https://pipeline/story/story-1",
        workDir: "/work/stories/story-1",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    } as any);

    await runner.rebuild("story-1", 2);

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      voiceoverPath: null,
      voiceIdUsed: null,
      voiceProviderUsed: null,
      musicGenreUsed: null,
      musicPath: null,
      musicTitle: null,
      musicArtist: null,
      durationUsedSec: null,
      videoGcsUrl: null,
      reviewUrl: null,
      error: null,
      status: "generating",
    }));
    expect(runFromContext).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1" }), { fromStage: 2 });
  });

  it("rebuilds from stage 1 by clearing direction and all later checkpoints before rerunning", async () => {
    const updateStoryRun = vi.fn();
    const runFromContext = vi.fn().mockResolvedValue({ storyId: "story-1" });
    const runner = new StoryRunner({
      updateStoryRun,
      runFromContext,
      getStoryRunById: vi.fn().mockReturnValue({
        id: "story-1",
        telegramChatId: "chat-1",
        profileId: "profile-1",
        sourceClipsMetadata: "[]",
        directionJson: JSON.stringify({ inferred_voice_style: "tutorial", inferred_content_type: "travel" }),
        voiceoverPath: "/work/stories/story-1/voice/voiceover.mp3",
        videoGcsUrl: "https://gcs/video.mp4",
        reviewUrl: "https://pipeline/story/story-1",
        workDir: "/work/stories/story-1",
        stageLogs: "[]",
      }),
      getStoryProfileById: vi.fn().mockReturnValue({ id: "profile-1", telegramChatId: "chat-1", audienceLanguage: "english" }),
    } as any);

    await runner.rebuild("story-1", 1);

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      directionJson: null,
      voiceoverPath: null,
      voiceIdUsed: null,
      voiceProviderUsed: null,
      musicGenreUsed: null,
      musicPath: null,
      musicTitle: null,
      musicArtist: null,
      durationUsedSec: null,
      videoGcsUrl: null,
      reviewUrl: null,
      error: null,
      status: "generating",
    }));
    expect(runFromContext).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-1" }), { fromStage: 1 });
  });

  it("marks story run failed when any stage throws", async () => {
    const updateStoryRun = vi.fn();
    const runner = new StoryRunner({
      stages: [
        { name: "story-stage1-direction", run: vi.fn().mockResolvedValue({ direction: {} }) },
        { name: "story-stage2-voice", run: vi.fn().mockRejectedValue(new Error("voice quota exceeded")) },
      ] as any,
      updateStoryRun,
    });

    await expect(runner.runFromContext({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    })).rejects.toThrow("voice quota exceeded");

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({
      status: "failed",
      currentStage: null,
      error: "voice quota exceeded",
    }));
  });
});
