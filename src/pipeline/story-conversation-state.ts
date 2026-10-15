import type { StoryReelAudienceLanguage } from "../storyreel/types.js";

export type WizardType = "setup" | "run" | "run-options" | "tweak" | "cancel" | "music";

export interface ConversationState {
  wizard: WizardType;
  step: number;
  data: Partial<{
    language: StoryReelAudienceLanguage;
    profileName: string;
    audienceDescription: string;
    note: string;
    voiceEnabled: boolean;
    musicEnabled: boolean;
    captionsEnabled: boolean;
    chatTitle: string;
    chatType: string;
    chatUsername: string;
  }>;
  promptMessageId?: number;
}

interface StoredState {
  state: ConversationState;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, StoredState>();

export function setConversationState(chatId: string, state: ConversationState): void {
  store.set(chatId, { state, expiresAt: Date.now() + TTL_MS });
}

export function getConversationState(chatId: string): ConversationState | null {
  const entry = store.get(chatId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(chatId);
    return null;
  }
  return entry.state;
}

export function clearConversationState(chatId: string): void {
  store.delete(chatId);
}
