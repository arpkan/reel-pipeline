import type { VoiceProvider } from "./voice-provider.js";
import type { WordTiming } from "../types.js";
import { WhisperService, createWhisperService } from "./whisper.js";

export class MinimaxService implements VoiceProvider {
  private readonly apiKey: string;
  private readonly groupId: string;
  private readonly whisper: WhisperService;

  constructor(apiKey: string, groupId: string, whisper?: WhisperService) {
    this.apiKey = apiKey;
    this.groupId = groupId;
    this.whisper = whisper ?? createWhisperService();
  }

  async textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    language: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const response = await fetch("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        group_id: this.groupId,
        model: "speech-2.8-hd",
        text,
        stream: false,
        output_format: "hex",
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Minimax API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as {
      data?: {
        audio: string;
      };
      extra_info?: {
        audio_length: number;
      };
      base_resp?: {
        status_msg: string;
      };
    };

    if (!data.data?.audio) {
      throw new Error(`Minimax: no audio in response (${data.base_resp?.status_msg ?? "unknown error"})`);
    }

    // Decode hex-encoded audio to buffer
    const audio = Buffer.from(data.data.audio, "hex");

    // Duration in milliseconds from Minimax, convert to seconds for Whisper
    const durationSeconds = data.extra_info?.audio_length ? data.extra_info.audio_length / 1000 : undefined;
    const wordTimings = await this.whisper.transcribe(audio, language, text, durationSeconds);

    return { audio, wordTimings };
  }
}

export function createMinimaxService(): MinimaxService {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!apiKey) throw new Error("MINIMAX_API_KEY is not set");
  if (!groupId) throw new Error("MINIMAX_GROUP_ID is not set");
  return new MinimaxService(apiKey, groupId);
}
