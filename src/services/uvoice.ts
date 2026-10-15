import type { VoiceProvider } from "./voice-provider.js";
import type { WordTiming } from "../types.js";
import { WhisperService, createWhisperService } from "./whisper.js";

export class UVoiceService implements VoiceProvider {
  private readonly apiKey: string;
  private readonly whisper: WhisperService;

  constructor(apiKey: string, whisper?: WhisperService) {
    this.apiKey = apiKey;
    this.whisper = whisper ?? createWhisperService();
  }

  async textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const response = await fetch("https://api.uvoice.ai/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          voiceID: voiceId,
          text,
          outputFormat: "mp3",
          autoBreak: false,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`uvoice API error ${response.status}: ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    // duration unknown from uvoice API — fallback will use default 8s if whisper fails
    const wordTimings = await this.whisper.transcribe(audio, language, text, undefined);

    return { audio, wordTimings };
  }
}

export function createUVoiceService(): UVoiceService {
  const apiKey = process.env.UVOICE_API_KEY;
  if (!apiKey) throw new Error("UVOICE_API_KEY is not set");
  return new UVoiceService(apiKey);
}
