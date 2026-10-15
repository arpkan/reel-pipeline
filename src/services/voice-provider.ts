import type { WordTiming } from "../types.js";

export type VoiceProviderName = "elevenlabs" | "uvoice" | "minimax" | "botnoi";

export interface VoiceEntry {
  id: string;
  provider: VoiceProviderName;
  speed?: number; // atempo override for this specific voice; falls back to brand voiceSpeed ?? 1.2
  gain?: number; // volume multiplier for this specific voice; defaults to 1.0
}

export interface VoiceProvider {
  textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
}
