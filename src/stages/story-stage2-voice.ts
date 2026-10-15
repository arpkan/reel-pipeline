interface StoryVoiceContext {
  storyId: string;
  telegramChatId: string;
  profile: {
    id: string;
    telegramChatId: string;
    profileName: string;
    audienceLanguage: string;
    audienceDescription: string;
    preferredVoiceId: string | null;
    preferredVoiceProvider: string | null;
    createdAt: string;
    updatedAt: string;
  };
  clips: Array<{
    path: string;
    sizeMb: number;
    durationSec: number;
    orientation: string;
    width: number;
    height: number;
  }>;
  direction: {
    inferred_voice_style: string;
    inferred_content_type: string;
    hook_clip: { clip_index: number; start_sec: number; end_sec: number; reason: string };
    clips: Array<{
      clip_index: number;
      start_sec: number;
      end_sec: number;
      order: number;
      role: string;
    }>;
    voiceover_script: {
      full_text: string;
      segments?: Array<{ order: number; text: string; duration_sec: number }>;
    };
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

interface VoiceResult {
  voiceoverPath: string;
  wordTimingsPath: string;
}

interface StoryStage2VoiceDeps {
  generateVoiceover: (params: {
    voiceId: string;
    provider: string;
    text: string;
    outputDir: string;
  }) => Promise<{ voiceoverPath: string; wordTimingsPath: string }>;
  updateStoryRun: (
    storyId: string,
    data: {
      voiceIdUsed: string;
      voiceProviderUsed: string;
      voiceoverPath: string;
    },
  ) => Promise<void>;
  updateStoryProfileVoice?: (
    profileId: string,
    voiceId: string,
    provider: string,
  ) => Promise<void>;
  getStoryVoices: (
    language: string,
    style: string,
  ) => Array<{ voiceId: string; provider: string }>;
  selectSharedVoice?: (params: {
    language: string | undefined;
    style: string;
  }) => Promise<{ voiceId: string; provider: string; name: string }>;
}

export class StoryStage2Voice {
  name = "story-stage2-voice";

  private deps: StoryStage2VoiceDeps;

  constructor(deps: StoryStage2VoiceDeps) {
    this.deps = deps;
  }

  async run(ctx: StoryVoiceContext): Promise<VoiceResult> {
    const { profile, direction } = ctx;
    let voiceId: string;
    let provider: string;

    if (profile.preferredVoiceId) {
      voiceId = profile.preferredVoiceId;
      provider = profile.preferredVoiceProvider ?? "elevenlabs";
    } else {
      const dbVoices = this.deps.getStoryVoices(
        profile.audienceLanguage,
        direction.inferred_voice_style,
      );

      if (dbVoices.length > 0) {
        voiceId = dbVoices[0].voiceId;
        provider = dbVoices[0].provider;
        if (this.deps.updateStoryProfileVoice) {
          await this.deps.updateStoryProfileVoice(
            profile.id,
            voiceId,
            provider,
          );
        }
      } else if (this.deps.selectSharedVoice) {
        const language =
          profile.audienceLanguage === "thai"
            ? undefined
            : profile.audienceLanguage;
        const shared = await this.deps.selectSharedVoice({
          language,
          style: direction.inferred_voice_style,
        });
        voiceId = shared.voiceId;
        provider = shared.provider;
      } else {
        throw new Error("No voice available: no DB voices and no shared voice fallback");
      }
    }

    const { voiceoverPath, wordTimingsPath } =
      await this.deps.generateVoiceover({
        voiceId,
        provider,
        text: direction.voiceover_script.full_text,
        outputDir: ctx.workDir,
      });

    await this.deps.updateStoryRun(ctx.storyId, {
      voiceIdUsed: voiceId,
      voiceProviderUsed: provider,
      voiceoverPath,
    });

    return { voiceoverPath, wordTimingsPath };
  }
}
