import { describe, expect, it, vi } from "vitest";
import { StoryStage1Direction } from "../src/stages/story-stage1-direction.js";

interface StoryContext {
  storyId: string;
  telegramChatId: string;
  profile: { id: string; telegramChatId: string; profileName: string; audienceLanguage: string; audienceDescription: string; preferredVoiceId: string | null; preferredVoiceProvider: string | null; createdAt: string; updatedAt: string };
  clips: Array<{ path: string; sizeMb: number; durationSec: number; orientation: string; width: number; height: number }>;
  userNote?: string;
  workDir: string;
  stageLogs: Array<{ stage: string; status: string; durationMs: number; error?: string; meta?: Record<string, unknown> }>;
  status: string;
}

function makeCtx(overrides: Partial<StoryContext> = {}): StoryContext {
  return {
    storyId: "story-1",
    telegramChatId: "chat-1",
    profile: { id: "profile-1", telegramChatId: "chat-1", profileName: "Test", audienceLanguage: "english", audienceDescription: "People who want useful clips.", preferredVoiceId: null, preferredVoiceProvider: null, createdAt: "now", updatedAt: "now" },
    clips: [{ path: "/tmp/a.mp4", sizeMb: 10, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 }],
    userNote: "make it practical",
    workDir: "/tmp/story-1",
    stageLogs: [],
    status: "generating",
    ...overrides,
  };
}

describe("StoryStage1Direction", () => {
  it("saves raw response before validation and retries once on validation failure", async () => {
    const updateStoryRun = vi.fn();
    const writeFileSync = vi.fn();
    let calls = 0;
    const stage = new StoryStage1Direction({
      updateStoryRun,
      writeFileSync,
      mkdirSync: vi.fn(),
      client: {
        async uploadFile() { return { uri: "gemini://a", mimeType: "video/mp4" }; },
        async generateDirection() {
          calls++;
          if (calls === 1) return { text: "{}", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } };
          return { text: JSON.stringify({
            inferred_voice_style: "tutorial",
            inferred_content_type: "travel",
            hook_clip: { clip_index: 0, start_sec: 0, end_sec: 3, reason: "motion" },
            clips: [{ clip_index: 0, start_sec: 0, end_sec: 7, order: 1, role: "hook" }],
            voiceover_script: { full_text: "A practical tip." },
            voice_direction: { tone: "calm", pace: "medium", style: "tutorial", language_code: "en", reason: "fits content" },
            music_direction: { genre: "calm", energy: "medium", tempo: "medium", suggested_search_terms: ["calm acoustic"], volume: 0.35, reason: "soft" },
            hook_text_overlay: "Tip",
            caption_lines: ["Tip"],
            cta_text: "Follow",
            facebook_caption: "Tip.",
            hashtags: ["#Tip"],
            total_duration_sec: 7,
            director_notes: "Use first clip.",
          }), usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 50 } };
        },
      },
    });

    const result = await stage.run(makeCtx());
    expect(result.direction?.inferred_voice_style).toBe("tutorial");
    expect(calls).toBe(2);
    expect(writeFileSync).toHaveBeenCalledWith("/tmp/story-1/director/summary.txt", expect.stringContaining("StoryReel Director"));
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ geminiInputTokens: 120, geminiOutputTokens: 50 }));
  });
});
