interface StoryAssemblyContext {
  storyId: string;
  telegramChatId: string;
  profile: {
    id: string;
    audienceLanguage: string;
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
    music_direction: { genre: string; energy: string; tempo: string; reason: string };
    total_duration_sec: number;
  };
  voiceoverPath?: string;
  pendingMusicOverride?: string;
  voiceEnabled?: boolean;
  musicEnabled?: boolean;
  captionsEnabled?: boolean;
  workDir: string;
  stageLogs: Array<{ stage: string; status: string; durationMs: number }>;
  status: string;
}

interface AssemblyPlan {
  segments: unknown[];
  totalDurationSec: number;
}

interface StoryStage3AssemblyDeps {
  acquireAssemblyLock: (storyId: string) => Promise<void>;
  releaseAssemblyLock: (storyId: string) => Promise<void>;
  pickMusicTrack: (criteria: { genre: string; energy?: string; tempo?: string }) => {
    path: string;
    title: string;
    artist: string;
    genre: string;
    attribution: string;
  };
  buildAssemblyPlan: (ctx: StoryAssemblyContext) => AssemblyPlan;
  buildRoughCutHtml: (plan: AssemblyPlan) => string;
  renderWithHyperframes: (plan: AssemblyPlan, workDir: string) => Promise<string>;
  mixVoiceAndMusic: (
    voicePath: string,
    musicPath: string,
    workDir: string,
    durationSec: number,
    musicVolume: number,
  ) => Promise<string>;
  getAudioDurationSec?: (audioPath: string) => number;
  padVideoToDuration?: (
    videoPath: string,
    workDir: string,
    durationSec: number,
  ) => Promise<string>;
  muxVideoAndAudio: (
    videoPath: string,
    audioPath: string,
    workDir: string,
  ) => Promise<string>;
  mixMusicOnly?: (
    musicPath: string,
    workDir: string,
    durationSec: number,
    musicVolume: number,
  ) => Promise<string>;
  muxVoiceOnly?: (
    voicePath: string,
    workDir: string,
    durationSec: number,
  ) => Promise<string>;
  updateStoryRun: (
    storyId: string,
    data: {
      musicGenreUsed: string;
      musicPath: string;
      musicTitle: string;
      musicArtist: string;
      durationUsedSec: number;
    },
  ) => Promise<void>;
}

interface AssemblyResult {
  videoPath: string;
  musicAttribution: string;
}

export class StoryStage3Assembly {
  name = "story-stage3-assembly";

  private deps: StoryStage3AssemblyDeps;

  constructor(deps: StoryStage3AssemblyDeps) {
    this.deps = deps;
  }

  async run(ctx: StoryAssemblyContext): Promise<AssemblyResult> {
    await this.deps.acquireAssemblyLock(ctx.storyId);
    try {
      const hasVoice = ctx.voiceEnabled !== false && ctx.voiceoverPath;
      const hasMusic = ctx.musicEnabled !== false;

      const genre =
        ctx.pendingMusicOverride ?? ctx.direction.music_direction.genre;
      let track: { path: string; title: string; artist: string; genre: string; attribution: string } | undefined;
      if (hasMusic) {
        track = this.deps.pickMusicTrack({
          genre,
          energy: ctx.direction.music_direction.energy,
          tempo: ctx.direction.music_direction.tempo,
        });
      }

      const assemblyCtx = { ...ctx };
      if (ctx.captionsEnabled === false) {
        (assemblyCtx.direction as Record<string, unknown>).hook_text_overlay = "";
        (assemblyCtx.direction as Record<string, unknown>).caption_lines = [];
      }
      const plan = this.deps.buildAssemblyPlan(assemblyCtx);
      this.deps.buildRoughCutHtml(plan);

      const videoOnly = await this.deps.renderWithHyperframes(
        plan,
        ctx.workDir,
      );

      let finalVideo: string;
      let finalDurationSec = plan.totalDurationSec;

      if (!hasVoice && !hasMusic) {
        finalVideo = videoOnly;
      } else {
        const voiceoverDurationSec = hasVoice && ctx.voiceoverPath
          ? (this.deps.getAudioDurationSec?.(ctx.voiceoverPath) ?? plan.totalDurationSec)
          : 0;
        finalDurationSec = Math.max(plan.totalDurationSec, Math.ceil(voiceoverDurationSec));
        const videoForMux = finalDurationSec > plan.totalDurationSec && this.deps.padVideoToDuration
          ? await this.deps.padVideoToDuration(videoOnly, ctx.workDir, finalDurationSec)
          : videoOnly;

        if (hasVoice && hasMusic && ctx.voiceoverPath && track) {
          const audioTrack = await this.deps.mixVoiceAndMusic(
            ctx.voiceoverPath,
            track.path,
            ctx.workDir,
            finalDurationSec,
            0.25,
          );
          finalVideo = await this.deps.muxVideoAndAudio(videoForMux, audioTrack, ctx.workDir);
        } else if (hasVoice && ctx.voiceoverPath) {
          if (this.deps.muxVoiceOnly) {
            const audioTrack = await this.deps.muxVoiceOnly(ctx.voiceoverPath, ctx.workDir, finalDurationSec);
            finalVideo = await this.deps.muxVideoAndAudio(videoForMux, audioTrack, ctx.workDir);
          } else {
            finalVideo = await this.deps.muxVideoAndAudio(videoForMux, ctx.voiceoverPath, ctx.workDir);
          }
        } else if (hasMusic && track) {
          if (this.deps.mixMusicOnly) {
            const audioTrack = await this.deps.mixMusicOnly(track.path, ctx.workDir, finalDurationSec, 0.25);
            finalVideo = await this.deps.muxVideoAndAudio(videoForMux, audioTrack, ctx.workDir);
          } else {
            const audioTrack = await this.deps.mixVoiceAndMusic(
              "",
              track.path,
              ctx.workDir,
              finalDurationSec,
              0.25,
            );
            finalVideo = await this.deps.muxVideoAndAudio(videoForMux, audioTrack, ctx.workDir);
          }
        } else {
          finalVideo = videoForMux;
        }
      }

      await this.deps.updateStoryRun(ctx.storyId, {
        musicGenreUsed: hasMusic ? genre : "",
        musicPath: track?.path ?? "",
        musicTitle: track?.title ?? "",
        musicArtist: track?.artist ?? "",
        durationUsedSec: finalDurationSec,
      });

      return {
        videoPath: finalVideo,
        musicAttribution: track?.attribution ?? "",
      };
    } finally {
      await this.deps.releaseAssemblyLock(ctx.storyId);
    }
  }
}
