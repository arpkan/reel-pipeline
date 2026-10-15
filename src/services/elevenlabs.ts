import { spawnSync } from "child_process";
import type { WordTiming } from "../types.js";
import type { VoiceProvider } from "./voice-provider.js";

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export class ElevenLabsService implements VoiceProvider {
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor(apiKey: string, modelId = process.env.TEST_ELEVENLABS_MODEL ?? "eleven_v3") {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  private isThaiText(text: string): boolean {
    const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) ?? []).length;
    const nonSpace = text.replace(/\s/g, "").length;
    return nonSpace > 0 && thaiChars / nonSpace > 0.4;
  }

  private tokenizeThai(text: string): string[] {
    const script = [
      "import sys, json",
      "from pythainlp.tokenize import word_tokenize",
      "text = sys.stdin.read()",
      "words = [w for w in word_tokenize(text, engine='newmm') if w.strip()]",
      "print(json.dumps(words, ensure_ascii=False))",
    ].join("\n");
    const result = spawnSync("python3", ["-c", script], {
      input: text,
      encoding: "utf8",
      timeout: 15000,
    });
    if (result.status === 0 && result.stdout) {
      try { return JSON.parse(result.stdout.trim()); } catch { /* fall through */ }
    }
    // Fallback: 5-char chunks
    const clean = text.replace(/\s+/g, "");
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 5) chunks.push(clean.slice(i, i + 5));
    return chunks;
  }

  private extractThaiWordTimings(alignment: ElevenLabsAlignment, text: string): WordTiming[] {
    const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
    const thaiWords = this.tokenizeThai(text);
    const wordTimings: WordTiming[] = [];
    let charIdx = 0;

    for (const word of thaiWords) {
      // Skip whitespace in ElevenLabs character stream
      while (charIdx < characters.length && /\s/.test(characters[charIdx])) charIdx++;

      const wordStartIdx = charIdx;
      const wordEndIdx   = charIdx + word.length - 1;

      if (wordStartIdx < character_start_times_seconds.length) {
        wordTimings.push({
          word,
          start: character_start_times_seconds[wordStartIdx],
          end:   character_end_times_seconds[Math.min(wordEndIdx, character_end_times_seconds.length - 1)],
        });
      }
      charIdx += word.length;
    }
    return wordTimings;
  }

  async textToSpeechWithTimestamps(
    text: string,
    voiceId: string,
    languageCode?: string,
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          ...(languageCode ? { language_code: languageCode } : {}),
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs TTS error: ${err}`);
    }

    const data = await response.json() as { audio_base64: string; alignment: ElevenLabsAlignment };
    const audio = Buffer.from(data.audio_base64, "base64");
    const wordTimings = this.extractWordTimings(data.alignment, text);
    return { audio, wordTimings };
  }

  private extractWordTimings(alignment: ElevenLabsAlignment, text: string): WordTiming[] {
    if (this.isThaiText(text)) return this.extractThaiWordTimings(alignment, text);

    const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
    const wordTimings: WordTiming[] = [];
    const separators = new Set([" ", "\n", "\t", ".", ",", "!", "?", ":", ";", "—", "-"]);

    let charIdx = 0;
    for (const rawWord of text.split(/\s+/)) {
      if (!rawWord) continue;
      // strip punctuation from the word to find its core characters
      const word = rawWord.replace(/[.,!?:;—\-]+$/, "");
      if (!word) continue;

      // skip whitespace in character stream
      while (charIdx < characters.length && separators.has(characters[charIdx])) charIdx++;

      const startCharIdx = charIdx;
      // advance through the word's characters
      while (charIdx < characters.length && !separators.has(characters[charIdx])) charIdx++;
      const endCharIdx = charIdx - 1;

      if (startCharIdx < character_start_times_seconds.length) {
        wordTimings.push({
          word: rawWord,
          start: character_start_times_seconds[startCharIdx],
          end: character_end_times_seconds[Math.min(endCharIdx, character_end_times_seconds.length - 1)],
        });
      }
    }
    return wordTimings;
  }
}

export function createElevenLabsService(): ElevenLabsService {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  return new ElevenLabsService(apiKey);
}
