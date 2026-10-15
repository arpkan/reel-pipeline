import * as queries from "../db/queries.js";
import type { StoryReelClipMetadata, StoryReelMusicGenre } from "../storyreel/types.js";

export interface SetStoryIntakeSessionInput {
  chatId: string;
  clips: StoryReelClipMetadata[];
  totalSizeMb: number;
  totalDurationSec: number;
  pendingMusicOverride?: StoryReelMusicGenre | null;
  expiresAt: string;
}

export function setStoryIntakeSession(input: SetStoryIntakeSessionInput): void {
  queries.upsertStoryIntakeSession(input);
}

export function getStoryIntakeSession(chatId: string) {
  return queries.getStoryIntakeSession(chatId);
}

export function clearStoryIntakeSession(chatId: string): void {
  queries.clearStoryIntakeSession(chatId);
}

export function consumeStoryMusicOverride(chatId: string): StoryReelMusicGenre | undefined {
  const session = queries.getStoryIntakeSession(chatId);
  const raw = session?.pendingMusicOverride;
  const override = raw ? (raw as StoryReelMusicGenre) : undefined;
  if (session) {
    queries.upsertStoryIntakeSession({
      chatId,
      clips: session.clips,
      totalSizeMb: session.totalSizeMb,
      totalDurationSec: session.totalDurationSec,
      pendingMusicOverride: null,
      expiresAt: session.expiresAt,
    });
  }
  return override;
}
