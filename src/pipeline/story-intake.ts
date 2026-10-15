import type { StoryReelMusicGenre } from "../storyreel/types.js";

export function computeStoryIntakeExpiry(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function formatClipAcceptedMessage(
  clipNum: number,
  maxClips: number,
  durationSec: number,
  sizeMb: number,
): string {
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const duration = `${mins}m${String(secs).padStart(2, "0")}s`;
  return `Clip ${clipNum}/${maxClips} received (${duration}, ${sizeMb}MB). Send more or !run to start.`;
}

export function formatClipLimitError(
  type: "count" | "size" | "duration",
  params: Record<string, number>,
): string {
  if (type === "count") {
    return `You've already sent ${params.count} clips. Use !run to start or !cancel to clear.`;
  }
  if (type === "size") {
    return `Total size exceeds ${params.maxMb}MB limit. Use !run to start or !cancel to clear.`;
  }
  return `Total duration exceeds ${params.maxSec}s limit. Use !run to start or !cancel to clear.`;
}

export type StoryCommand =
  | { type: "run"; note?: string }
  | { type: "story" }
  | { type: "setup"; profileName?: string; language?: string; audienceDescription?: string }
  | { type: "profile" }
  | { type: "music"; genre: string }
  | { type: "cancel" }
  | { type: "tweak"; note?: string }
  | { type: "admin"; action: "approve" | "reject" | "pending"; chatId?: string }
  | { type: "resume"; id?: string }
  | { type: "rebuild"; id?: string; stage: number }
  | { type: "help" }
  | { type: "unknown"; raw: string };

export function parseStoryCommand(text: string): StoryCommand {
  const trimmed = text.trim();
  const adminMatch = trimmed.match(/^!admin\s+(approve|reject|pending)(?:\s+(\S+))?$/);
  if (adminMatch) return { type: "admin", action: adminMatch[1] as "approve" | "reject" | "pending", chatId: adminMatch[2] };

  if (trimmed === "!story") return { type: "story" };

  const storyResumeMatch = trimmed.match(/^!story\s+resume(?:\s+(\S+))?$/);
  if (storyResumeMatch) return { type: "resume", id: storyResumeMatch[1] };

  const storyRebuildMatch = trimmed.match(/^!story\s+rebuild\s+(\S+)\s+(\d+)$/);
  if (storyRebuildMatch) return { type: "rebuild", id: storyRebuildMatch[1], stage: parseInt(storyRebuildMatch[2], 10) };

  const storyRebuildLatestMatch = trimmed.match(/^!story\s+rebuild\s+(\d+)$/);
  if (storyRebuildLatestMatch) return { type: "rebuild", stage: parseInt(storyRebuildLatestMatch[1], 10) };

  if (trimmed === "!cancel") return { type: "cancel" };

  const runMatch = trimmed.match(/^!run(?:\s+(.*))?$/s);
  if (runMatch) {
    const note = runMatch[1]?.trim();
    return { type: "run", note: note || undefined };
  }

  const setupMatch = trimmed.match(/^!setup(?:\s+(.*))?$/s);
  if (setupMatch) {
    const rest = setupMatch[1]?.trim();
    if (!rest) return { type: "setup" };
    const parts = rest.split(/\s+/);
    return {
      type: "setup",
      profileName: parts[0],
      language: parts[1],
      audienceDescription: parts.slice(2).join(" ") || undefined,
    };
  }

  if (trimmed === "!profile") return { type: "profile" };

  const musicMatch = trimmed.match(/^!music(?:\s+(.+))?$/);
  if (musicMatch) return { type: "music", genre: (musicMatch[1] ?? "").trim() };

  const tweakMatch = trimmed.match(/^!tweak(?:\s+(.*))?$/s);
  if (tweakMatch) {
    const note = tweakMatch[1]?.trim();
    return { type: "tweak", note: note || undefined };
  }

  if (trimmed === "!help") return { type: "help" };

  return { type: "unknown", raw: trimmed };
}

const VALID_MUSIC_GENRES: StoryReelMusicGenre[] = ["upbeat", "calm", "neutral", "playful", "dramatic", "inspirational"];

export function validateMusicGenreInput(input: string): string | null {
  if ((VALID_MUSIC_GENRES as string[]).includes(input.toLowerCase())) return null;
  return `Valid genres: ${VALID_MUSIC_GENRES.join(", ")}`;
}

export function validateAudienceDescription(_text: string): string | null {
  return null; // blank is allowed — omitted from director prompt
}

export function validateStoryProfileSetup(params: {
  profileName?: string;
  language?: string;
  audienceDescription?: string;
}): string | null {
  const validLanguages = ["thai", "english", "german"];
  if (!params.profileName) return "Profile name is required. Usage: !setup <name> <language> <audience description>";
  if (!params.language || !validLanguages.includes(params.language.toLowerCase())) {
    return `Language must be one of: ${validLanguages.join(", ")}. Usage: !setup <name> <language> <audience description>`;
  }
  return null;
}
