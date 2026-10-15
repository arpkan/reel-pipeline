import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import type { WordTiming } from "../types.js";

export function spawnAsync(
  cmd: string,
  args: string[],
  options: { timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: options.timeout });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
    proc.on("error", reject);
  });
}

export class WhisperService {
  private readonly model: string;

  constructor(model = "tiny") {
    this.model = model;
  }

  /**
   * Transcribe audio buffer to word-level timings using whisper-timestamped.
   * Falls back to even distribution if whisper fails.
   *
   * @param audio      Raw audio buffer (MP3 or WAV)
   * @param language   Language code e.g. "en", "th"
   * @param text       Original text (used only for fallback even distribution)
   * @param duration   Audio duration in seconds (used only for fallback)
   */
  async transcribe(
    audio: Buffer,
    language: string,
    text?: string,
    duration?: number,
  ): Promise<WordTiming[]> {
    const tmpFile = path.join(os.tmpdir(), `whisper-in-${randomUUID()}.mp3`);
    try {
      fs.writeFileSync(tmpFile, audio);

      const script = [
        "import sys, json, whisper_timestamped as whisper",
        `model = whisper.load_model(${JSON.stringify(this.model)})`,
        `result = whisper.transcribe(model, ${JSON.stringify(tmpFile)}, language=${JSON.stringify(language)})`,
        "print(json.dumps(result))",
      ].join("\n");

      let result: { stdout: string; stderr: string; exitCode: number | null };
      try {
        result = await spawnAsync("python3", ["-c", script], { timeout: 30_000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`    ⚠️ whisper transcription failed — using even word distribution (${msg.slice(0, 120)})`);
        return this.evenDistribution(text ?? "", duration ?? 8);
      }

      if (result.exitCode === 0 && result.stdout) {
        try {
          const data = JSON.parse(result.stdout.trim()) as {
            segments: Array<{ words: Array<{ text: string; start: number; end: number }> }>;
          };
          const timings: WordTiming[] = [];
          for (const segment of data.segments) {
            for (const w of segment.words) {
              const word = w.text.trim();
              if (word) timings.push({ word, start: w.start, end: w.end });
            }
          }
          if (timings.length > 0) return this.normalizeThaiTimings(timings, language, text);
        } catch {
          // fall through to fallback
        }
      }

      console.warn(`    ⚠️ whisper transcription failed — using even word distribution (${result.stderr?.slice(0, 120) ?? "no details"})`);
      return this.evenDistribution(text ?? "", duration ?? 8);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  private normalizeThaiTimings(timings: WordTiming[], language: string, text?: string): WordTiming[] {
    if (!language.toLowerCase().startsWith("th") || !text || timings.length === 0) return timings;

    const words = this.segmentThaiWords(text);
    if (words.length === 0) return timings;

    // Only re-tokenize when Whisper output is clearly too fragmented.
    if (timings.length <= Math.ceil(words.length * 1.4)) return timings;

    let timingIdx = 0;
    const merged: WordTiming[] = [];

    for (const word of words) {
      const targetLen = word.replace(/\s+/g, "").length;
      if (targetLen === 0) continue;

      while (timingIdx < timings.length && timings[timingIdx].word.trim().length === 0) timingIdx++;
      if (timingIdx >= timings.length) break;

      const start = timings[timingIdx].start;
      let end = timings[timingIdx].end;
      let consumed = 0;

      while (timingIdx < timings.length && consumed < targetLen) {
        const token = timings[timingIdx].word.replace(/\s+/g, "");
        consumed += token.length;
        end = timings[timingIdx].end;
        timingIdx++;
      }

      merged.push({ word, start, end });
    }

    return merged.length > 0 ? merged : timings;
  }

  private segmentThaiWords(text: string): string[] {
    try {
      const segmenter = new Intl.Segmenter("th", { granularity: "word" });
      return Array.from(segmenter.segment(text))
        .map((s) => s.segment.trim())
        .filter(Boolean);
    } catch {
      return text.split(/\s+/).filter(Boolean);
    }
  }

  private evenDistribution(text: string, duration: number): WordTiming[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const perWord = duration / words.length;
    return words.map((word, i) => ({
      word,
      start: i * perWord,
      end: (i + 1) * perWord,
    }));
  }
}

export function createWhisperService(): WhisperService {
  return new WhisperService(process.env.WHISPER_MODEL ?? "tiny");
}
