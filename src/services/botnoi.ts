import type { VoiceProvider } from "./voice-provider.js";
import type { WordTiming } from "../types.js";
import { WhisperService, createWhisperService } from "./whisper.js";
import type { StoryReelVoiceDirection } from "../storyreel/director-poc.js";
import type { SelectedSharedVoice } from "../storyreel/audio-poc.js";

interface BotnoiGenerateResponse {
  text?: string;
  audio_url?: string;
  point?: number;
  user_monthly_point?: number;
}

export interface BotnoiSpeaker {
  speaker_id: string;
  eng_name: string;
  thai_name: string;
  eng_speech_style: string[];
  eng_voice_style: string[];
  eng_gender: string;
  eng_speed: string;
  language: string;
  available_language: string[];
  audio: string;
  price: number;
}

export class BotnoiService implements VoiceProvider {
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
    const response = await fetch("https://api-voice.botnoi.ai/openapi/v1/generate_audio_v2", {
      method: "POST",
      headers: {
        "Botnoi-Token": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        speaker: voiceId,
        volume: 1,
        speed: 1,
        type_media: "mp3",
        save_file: "false",
        language,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Botnoi API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as BotnoiGenerateResponse;
    if (!data.audio_url) {
      throw new Error(`Botnoi: missing audio_url in response`);
    }

    const audioRes = await fetch(data.audio_url);
    if (!audioRes.ok) {
      throw new Error(`Botnoi audio download failed ${audioRes.status}`);
    }
    const audio = Buffer.from(await audioRes.arrayBuffer());

    const wordTimings = await this.whisper.transcribe(audio, language, text, undefined);

    return { audio, wordTimings };
  }
}

export function createBotnoiService(): BotnoiService {
  const apiKey = process.env.BOTNOI_API_KEY;
  if (!apiKey) throw new Error("BOTNOI_API_KEY is not set");
  return new BotnoiService(apiKey);
}

export async function fetchBotnoiSpeakers(): Promise<BotnoiSpeaker[]> {
  const apiKey = process.env.BOTNOI_API_KEY;
  if (!apiKey) throw new Error("BOTNOI_API_KEY is not set");
  const response = await fetch("https://api-voice.botnoi.ai/openapi/v1/get_speaker_data", {
    headers: { "Botnoi-Token": apiKey },
  });
  if (!response.ok) throw new Error(`Botnoi get_speaker_data failed: ${response.status}`);
  return response.json() as Promise<BotnoiSpeaker[]>;
}

const STYLE_PREFERENCE = ["News Reading", "Narrating", "Storytelling"];

export async function selectBotnoiVoice(direction: StoryReelVoiceDirection): Promise<SelectedSharedVoice & { provider: "botnoi" }> {
  const speakers = await fetchBotnoiSpeakers();

  const thaiSpeakers = speakers.filter((s) => s.available_language.includes("th"));

  let candidates = thaiSpeakers.filter((s) =>
    s.eng_speech_style.some((style) => STYLE_PREFERENCE.includes(style)),
  );
  if (candidates.length === 0) candidates = thaiSpeakers;

  const selected = candidates[0];
  if (!selected) throw new Error("No Botnoi Thai speakers found");

  return {
    voiceId: selected.speaker_id,
    name: selected.eng_name,
    searchQuery: "botnoi get_speaker_data Thai news/narrating",
    verifiedLanguages: [],
    previewUrl: selected.audio,
    reason: `Botnoi auto-select: ${selected.eng_speech_style.join(", ")}`,
    provider: "botnoi",
  };
}
