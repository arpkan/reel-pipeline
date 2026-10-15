import { describe, expect, it, vi } from "vitest";
import { StoryStage2Voice } from "../src/stages/story-stage2-voice.js";

interface LocalStoryContext {
  storyId: string;
  telegramChatId: string;
  profile: { id: string; telegramChatId: string; profileName: string; audienceLanguage: string; audienceDescription: string; preferredVoiceId: string | null; preferredVoiceProvider: string | null; createdAt: string; updatedAt: string };
  clips: Array<{ path: string; sizeMb: number; durationSec: number; orientation: string; width: number; height: number }>;
  direction: {
    inferred_voice_style: string;
    inferred_content_type: string;
    hook_clip: { clip_index: number; start_sec: number; end_sec: number; reason: string };
    clips: Array<{ clip_index: number; start_sec: number; end_sec: number; order: number; role: string }>;
    voiceover_script: { full_text: string; segments?: Array<{ order: number; text: string; duration_sec: number }> };
    voice_direction: { tone: string; pace: string; style: string };
    music_direction: { genre: string; energy: string; tempo: string; reason: string };
    hook_text_overlay: string;
    caption_lines: string[];
    cta_text: string;
    facebook_caption: string;
    hashtags: string[];
    total_duration_sec: number;
    director_notes: string;
  };
  userNote?: string;
  workDir: string;
  stageLogs: Array<{ stage: string; status: string; durationMs: number }>;
  status: string;
}

function ctx(overrides: Partial<LocalStoryContext> = {}): LocalStoryContext {
  return {
    storyId: "story-1",
    telegramChatId: "chat-1",
    profile: { id: "profile-1", telegramChatId: "chat-1", profileName: "Test", audienceLanguage: "english", audienceDescription: "Useful clips for travellers.", preferredVoiceId: null, preferredVoiceProvider: null, createdAt: "now", updatedAt: "now" },
    clips: [],
    direction: {
      inferred_voice_style: "conversational",
      inferred_content_type: "travel",
      hook_clip: { clip_index: 0, start_sec: 0, end_sec: 3, reason: "motion" },
      clips: [],
      voiceover_script: { full_text: "Hello story" },
      voice_direction: { tone: "warm", pace: "medium", style: "conversational" },
      music_direction: { genre: "calm", energy: "medium", tempo: "medium", reason: "soft" },
      hook_text_overlay: "Hello",
      caption_lines: ["Hello"],
      cta_text: "Follow",
      facebook_caption: "Hello.",
      hashtags: ["#Hello"],
      total_duration_sec: 8,
      director_notes: "Warm tone.",
    },
    userNote: undefined,
    workDir: "/tmp/story-1",
    stageLogs: [],
    status: "generating",
    ...overrides,
  };
}

describe("StoryStage2Voice", () => {
  it("uses preferred profile voice before querying DB", async () => {
    const generateVoiceover = vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" });
    const stage = new StoryStage2Voice({ generateVoiceover, updateStoryRun: vi.fn(), getStoryVoices: vi.fn() });
    const result = await stage.run(ctx({ profile: { ...ctx().profile, preferredVoiceId: "preferred-1", preferredVoiceProvider: "elevenlabs" } }));
    expect(generateVoiceover).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "preferred-1" }));
    expect(result.voiceoverPath).toBe("/tmp/voice.mp3");
  });

  it("stores first DB voice as sticky profile preference", async () => {
    const updateStoryProfileVoice = vi.fn();
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice,
      getStoryVoices: vi.fn().mockReturnValue([{ voiceId: "db-voice", provider: "elevenlabs" }]),
    });
    await stage.run(ctx());
    expect(updateStoryProfileVoice).toHaveBeenCalledWith("profile-1", "db-voice", "elevenlabs");
  });

  it("drops the language filter for Thai ElevenLabs shared voice fallback", async () => {
    const selectSharedVoice = vi.fn().mockResolvedValue({ voiceId: "shared-th", provider: "elevenlabs", name: "Shared Thai" });
    const getStoryVoices = vi.fn().mockReturnValue([]);
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice: vi.fn(),
      getStoryVoices,
      selectSharedVoice,
    });

    await stage.run(ctx({ profile: { ...ctx().profile, audienceLanguage: "thai" } }));

    expect(getStoryVoices).toHaveBeenCalledWith("thai", "conversational");
    expect(selectSharedVoice).toHaveBeenCalledWith(expect.objectContaining({ language: undefined, style: "conversational" }));
  });

  it("passes English language filter to ElevenLabs shared voice fallback", async () => {
    const selectSharedVoice = vi.fn().mockResolvedValue({ voiceId: "shared-en", provider: "elevenlabs", name: "Shared English" });
    const getStoryVoices = vi.fn().mockReturnValue([]);
    const stage = new StoryStage2Voice({
      generateVoiceover: vi.fn().mockResolvedValue({ voiceoverPath: "/tmp/voice.mp3", wordTimingsPath: "/tmp/word-timings.json" }),
      updateStoryRun: vi.fn(),
      updateStoryProfileVoice: vi.fn(),
      getStoryVoices,
      selectSharedVoice,
    });

    await stage.run(ctx({ profile: { ...ctx().profile, audienceLanguage: "english" } }));

    expect(getStoryVoices).toHaveBeenCalledWith("english", "conversational");
    expect(selectSharedVoice).toHaveBeenCalledWith(expect.objectContaining({ language: "english", style: "conversational" }));
  });
});
