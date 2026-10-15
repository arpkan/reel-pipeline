import { describe, expect, it, vi } from "vitest";
import { StoryStage3Assembly } from "../src/stages/story-stage3-assembly.js";

describe("StoryStage3Assembly", () => {
  it("uses one-shot music override before director genre and persists final outputs", async () => {
    const updateStoryRun = vi.fn();
    const pickMusicTrack = vi.fn().mockReturnValue({
      path: "/music/calm/a.mp3",
      title: "A",
      artist: "Artist",
      genre: "calm",
      attribution: "Music: A by Artist (CC BY 4.0)",
    });
    const stage = new StoryStage3Assembly({
      acquireAssemblyLock: vi.fn().mockResolvedValue(undefined),
      releaseAssemblyLock: vi.fn(),
      pickMusicTrack,
      buildAssemblyPlan: vi.fn().mockReturnValue({
        segments: [],
        totalDurationSec: 12,
      }),
      buildRoughCutHtml: vi.fn().mockReturnValue("<html></html>"),
      renderWithHyperframes: vi
        .fn()
        .mockResolvedValue("/tmp/video-only.mp4"),
      mixVoiceAndMusic: vi.fn().mockResolvedValue("/tmp/audio.m4a"),
      muxVideoAndAudio: vi.fn().mockResolvedValue("/tmp/final.mp4"),
      updateStoryRun,
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: { audienceLanguage: "english" } as any,
      clips: [],
      direction: {
        music_direction: { genre: "dramatic", energy: "high", tempo: "fast", reason: "test" },
        total_duration_sec: 12,
      } as any,
      voiceoverPath: "/tmp/voice.mp3",
      pendingMusicOverride: "calm",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.videoPath).toBe("/tmp/final.mp4");
    expect(result.musicAttribution).toBe("Music: A by Artist (CC BY 4.0)");
    expect(pickMusicTrack).toHaveBeenCalledWith({
      genre: "calm",
      energy: "high",
      tempo: "fast",
    });
    expect(updateStoryRun).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ musicGenreUsed: "calm", durationUsedSec: 12 }),
    );
  });

  it("pads video and mixes audio to the voiceover duration when narration exceeds the visual plan", async () => {
    const renderWithHyperframes = vi.fn().mockResolvedValue("/tmp/video-only.mp4");
    const padVideoToDuration = vi.fn().mockResolvedValue("/tmp/video-padded.mp4");
    const mixVoiceAndMusic = vi.fn().mockResolvedValue("/tmp/audio.m4a");
    const muxVideoAndAudio = vi.fn().mockResolvedValue("/tmp/final.mp4");
    const updateStoryRun = vi.fn();
    const stage = new StoryStage3Assembly({
      acquireAssemblyLock: vi.fn().mockResolvedValue(undefined),
      releaseAssemblyLock: vi.fn(),
      pickMusicTrack: vi.fn().mockReturnValue({
        path: "/music/calm/a.mp3",
        title: "A",
        artist: "Artist",
        genre: "calm",
        attribution: "Music: A by Artist (CC BY 4.0)",
      }),
      buildAssemblyPlan: vi.fn().mockReturnValue({
        segments: [],
        totalDurationSec: 8,
      }),
      buildRoughCutHtml: vi.fn().mockReturnValue("<html></html>"),
      renderWithHyperframes,
      getAudioDurationSec: vi.fn().mockReturnValue(10.998),
      padVideoToDuration,
      mixVoiceAndMusic,
      muxVideoAndAudio,
      updateStoryRun,
    });

    await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: { audienceLanguage: "english" } as any,
      clips: [],
      direction: {
        music_direction: { genre: "calm", energy: "low", tempo: "medium", reason: "test" },
        total_duration_sec: 8,
      } as any,
      voiceoverPath: "/tmp/voice.mp3",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(padVideoToDuration).toHaveBeenCalledWith("/tmp/video-only.mp4", "/tmp/story-1", 11);
    expect(mixVoiceAndMusic).toHaveBeenCalledWith("/tmp/voice.mp3", "/music/calm/a.mp3", "/tmp/story-1", 11, 0.25);
    expect(muxVideoAndAudio).toHaveBeenCalledWith("/tmp/video-padded.mp4", "/tmp/audio.m4a", "/tmp/story-1");
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ durationUsedSec: 11 }));
  });
});
