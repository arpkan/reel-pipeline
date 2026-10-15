export type StoryReelVoiceStyle = "informative" | "storytelling" | "tutorial" | "review" | "conversational" | "lifestyle";
export type StoryReelContentType = "lifestyle" | "tutorial" | "review" | "travel" | "food" | "story" | "opinion" | "other";
export type StoryReelAudienceLanguage = "thai" | "english" | "german";
export type StoryReelVoiceProvider = "elevenlabs" | "botnoi";
export type StoryReelMusicGenre = "upbeat" | "calm" | "neutral" | "playful" | "dramatic" | "inspirational";
export type StoryReelMusicEnergy = "low" | "medium" | "high";
export type StoryReelMusicTempo = "slow" | "medium" | "fast";
export type StoryReelClipOrientation = "vertical" | "horizontal" | "square" | "other";
export type StoryReelRunStatus = "pending" | "generating" | "delivered" | "failed" | "cancelled";

export interface StoryReelClipMetadata {
  path: string;
  sizeMb: number;
  durationSec: number;
  orientation: StoryReelClipOrientation;
  width: number;
  height: number;
}

export interface StoryReelDirectorDirection {
  inferred_voice_style: StoryReelVoiceStyle;
  inferred_content_type: StoryReelContentType;
  hook_clip: { clip_index: number; start_sec: number; end_sec: number; reason: string };
  clips: Array<{ clip_index: number; start_sec: number; end_sec: number; order: number; role: string }>;
  voiceover_script: { full_text: string; segments?: Array<{ order: number; text: string; duration_sec: number }> };
  voice_direction: { tone: string; pace: string; style?: StoryReelVoiceStyle };
  music_direction: { genre: StoryReelMusicGenre; energy: StoryReelMusicEnergy; tempo: StoryReelMusicTempo; reason: string };
  hook_text_overlay: string;
  caption_lines: string[];
  cta_text: string;
  facebook_caption: string;
  hashtags: string[];
  total_duration_sec: number;
  director_notes: string;
}

export interface StoryStageLog {
  stage: string;
  status: "ok" | "error" | "skipped";
  durationMs: number;
  error?: string;
  meta?: Record<string, unknown>;
}
