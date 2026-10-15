import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildAudioMixArgs,
  buildAudioMuxArgs,
  buildSharedVoiceSearchQuery,
  elevenLabsTtsWithTimestamps,
  generateVoiceover,
  mixVoiceAndMusic,
  muxVideoAndAudio,
  selectSharedVoice,
  writeVoiceArtifacts,
  type SelectedSharedVoice,
} from "../src/storyreel/audio-poc.js";
import type { StoryReelVoiceDirection } from "../src/storyreel/director-poc.js";

function voiceDirection(overrides: Partial<StoryReelVoiceDirection> = {}): StoryReelVoiceDirection {
  return {
    tone: "friendly",
    pace: "medium",
    style: "tutorial",
    language_code: "th",
    reason: "friendly tutorial voice",
    ...overrides,
  };
}

describe("StoryReel audio POC", () => {
  it("builds shared voice search queries from direction tone and style", () => {
    expect(buildSharedVoiceSearchQuery(voiceDirection())).toEqual({
      search: "friendly",
      gender: "female",
    });
    expect(buildSharedVoiceSearchQuery(voiceDirection({ tone: "enthusiastic", style: "review" })).search)
      .toBe("energetic");
  });

  it("writes voice artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-voice-artifacts-"));
    const voice: SelectedSharedVoice = {
      voiceId: "voice-1",
      name: "Friendly Voice",
      searchQuery: "friendly warm natural tutorial",
      verifiedLanguages: [{ language: "en", model_id: "eleven_v3" }],
      previewUrl: "https://example.com/preview.mp3",
      reason: "highest cloned_by_count among matching shared voices",
    };

    writeVoiceArtifacts({
      outputDir: dir,
      voiceoverAudio: Buffer.from("audio"),
      wordTimings: [{ word: "รู้", start: 0, end: 0.2 }],
      selectedVoice: voice,
    });

    expect(fs.readFileSync(path.join(dir, "voiceover.mp3"))).toEqual(Buffer.from("audio"));
    expect(JSON.parse(fs.readFileSync(path.join(dir, "word-timings.json"), "utf8"))[0].word).toBe("รู้");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "voice-selection.json"), "utf8")).voiceId).toBe("voice-1");
  });

  it("selects the most cloned shared voice from search results", async () => {
    const selected = await selectSharedVoice(voiceDirection(), async () => [
      { voice_id: "low", name: "Low", cloned_by_count: 1, verified_languages: [] },
      { voice_id: "high", name: "High", cloned_by_count: 10, verified_languages: [{ language: "en" }] },
    ]);

    expect(selected).toEqual(expect.objectContaining({
      voiceId: "high",
      name: "High",
      searchQuery: "friendly",
      verifiedLanguages: [{ language: "en" }],
    }));
  });

  it("reports empty shared voice search clearly", async () => {
    await expect(selectSharedVoice(voiceDirection({ tone: "calm" }), async () => []))
      .rejects.toThrow("No ElevenLabs shared voices found for search query: calm");
  });

  it("generates voiceover with an injected TTS function", async () => {
    const result = await generateVoiceover({
      text: "รู้ยัง? ตู้เต่าบินมีส่วนลด",
      voice: {
        voiceId: "voice-1",
        name: "Voice One",
        searchQuery: "friendly warm natural tutorial",
        verifiedLanguages: [],
        reason: "test",
      },
      tts: async ({ text, voiceId, modelId }) => ({
        audio: Buffer.from(`${voiceId}:${modelId}:${text}`),
        wordTimings: [{ word: "รู้ยัง", start: 0, end: 0.5 }],
      }),
    });

    expect(result.audio.toString()).toBe("voice-1:eleven_v3:รู้ยัง? ตู้เต่าบินมีส่วนลด");
    expect(result.wordTimings[0].word).toBe("รู้ยัง");
  });

  it("calls ElevenLabs TTS with timestamps and marks alignment-derived timings", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const fetchTts: typeof fetch = async (url, init) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          audio_base64: Buffer.from("audio").toString("base64"),
          alignment: {
            characters: ["h", "i"],
            character_start_times_seconds: [0, 0.4],
            character_end_times_seconds: [0.4, 0.8],
          },
        }),
      } as Response;
    };

    const result = await generateVoiceover({
      text: "hello world",
      voice: {
        voiceId: "voice-1",
        name: "Voice One",
        searchQuery: "friendly warm natural tutorial",
        verifiedLanguages: [],
        reason: "test",
      },
      tts: (input) => elevenLabsTtsWithTimestamps(input, "test-key", fetchTts),
    });

    expect(requestedUrl).toContain("/v1/text-to-speech/voice-1/with-timestamps");
    expect(requestedBody).toEqual({ text: "hello world", model_id: "eleven_v3" });
    expect(result.audio.toString()).toBe("audio");
    expect(result.wordTimings[0]).toEqual(expect.objectContaining({ word: "hello", source: "elevenlabs_alignment" }));
  });

  it("reports invalid ElevenLabs TTS JSON clearly", async () => {
    const fetchTts: typeof fetch = async () => ({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    } as Response);

    await expect(elevenLabsTtsWithTimestamps({ text: "hello", voiceId: "voice-1", modelId: "eleven_v3" }, "test-key", fetchTts))
      .rejects.toThrow("Invalid ElevenLabs TTS JSON response: Unexpected token <");
  });

  it("reports missing ElevenLabs TTS audio clearly", async () => {
    const fetchTts: typeof fetch = async () => ({
      ok: true,
      json: async () => ({ audio_base64: 123 }),
    } as Response);

    await expect(elevenLabsTtsWithTimestamps({ text: "hello", voiceId: "voice-1", modelId: "eleven_v3" }, "test-key", fetchTts))
      .rejects.toThrow("ElevenLabs TTS response did not include audio_base64");
  });

  it("marks timings as estimated when ElevenLabs alignment is unusable", async () => {
    const fetchTts: typeof fetch = async () => ({
      ok: true,
      json: async () => ({
        audio_base64: Buffer.from("audio").toString("base64"),
        alignment: { character_end_times_seconds: [0, "bad"] },
      }),
    } as Response);

    const result = await elevenLabsTtsWithTimestamps({ text: "hello world", voiceId: "voice-1", modelId: "eleven_v3" }, "test-key", fetchTts);

    expect(result.wordTimings[0]).toEqual(expect.objectContaining({ word: "hello", source: "estimated" }));
  });

  it("marks timings as estimated when ElevenLabs alignment only includes end times", async () => {
    const fetchTts: typeof fetch = async () => ({
      ok: true,
      json: async () => ({
        audio_base64: Buffer.from("audio").toString("base64"),
        alignment: { character_end_times_seconds: [0.2, 0.4] },
      }),
    } as Response);

    const result = await elevenLabsTtsWithTimestamps({ text: "hello world", voiceId: "voice-1", modelId: "eleven_v3" }, "test-key", fetchTts);

    expect(result.wordTimings[0]).toEqual(expect.objectContaining({ word: "hello", source: "estimated" }));
  });

  it("reports empty ElevenLabs TTS audio clearly", async () => {
    const fetchTts: typeof fetch = async () => ({
      ok: true,
      json: async () => ({ audio_base64: "" }),
    } as Response);

    await expect(elevenLabsTtsWithTimestamps({ text: "hello", voiceId: "voice-1", modelId: "eleven_v3" }, "test-key", fetchTts))
      .rejects.toThrow("ElevenLabs TTS response contained empty audio");
  });

  it("builds FFmpeg args for mixing voice and music", () => {
    const args = buildAudioMixArgs({
      voicePath: "/tmp/voiceover.mp3",
      musicPath: "/tmp/music.mp3",
      outputPath: "/tmp/final-audio.m4a",
      durationSec: 27,
      musicVolume: 0.25,
    });

    expect(args).toContain("-stream_loop");
    expect(args).toContain("-filter_complex");
    expect(args.join(" ")).toContain("volume=0.25");
    expect(args.join(" ")).toContain("afade=t=in:st=0:d=1");
    expect(args.join(" ")).toContain("afade=t=out:st=25:d=2");
    expect(args.join(" ")).toContain("amix=inputs=2:duration=longest:dropout_transition=0");
    expect(args.join(" ")).toContain("loudnorm=I=-14:TP=-1:LRA=9");
    expect(args).toEqual(expect.arrayContaining(["-ar", "48000", "-ac", "2"]));
    expect(args[args.length - 1]).toBe("/tmp/final-audio.m4a");
  });

  it("clamps FFmpeg audio mix fade-out start for short durations", () => {
    const args = buildAudioMixArgs({
      voicePath: "/tmp/voiceover.mp3",
      musicPath: "/tmp/music.mp3",
      outputPath: "/tmp/final-audio.m4a",
      durationSec: 1,
      musicVolume: 0.25,
    });

    expect(args.join(" ")).toContain("afade=t=out:st=0:d=2");
  });

  it("builds FFmpeg args for muxing video and audio", () => {
    expect(buildAudioMuxArgs({
      videoPath: "/tmp/silent.mp4",
      audioPath: "/tmp/final-audio.m4a",
      outputPath: "/tmp/with-audio.mp4",
    })).toEqual([
      "-y",
      "-i", "/tmp/silent.mp4",
      "-i", "/tmp/final-audio.m4a",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-ar", "48000",
      "-ac", "2",
      "-shortest",
      "/tmp/with-audio.mp4",
    ]);
  });

  it("runs mix and mux helpers with output existence checks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-ffmpeg-"));
    const mixOut = path.join(dir, "final-audio.m4a");
    const muxOut = path.join(dir, "rough-cut-with-audio.mp4");
    const calls: string[][] = [];
    const executor = (args: string[]) => {
      calls.push(args);
      fs.writeFileSync(args[args.length - 1], "out");
      return { status: 0, stderr: Buffer.from("") };
    };

    mixVoiceAndMusic({ voicePath: "voice.mp3", musicPath: "music.mp3", outputPath: mixOut, durationSec: 27, musicVolume: 0.25 }, executor);
    muxVideoAndAudio({ videoPath: "silent.mp4", audioPath: mixOut, outputPath: muxOut }, executor);

    expect(calls).toHaveLength(2);
    expect(fs.existsSync(mixOut)).toBe(true);
    expect(fs.existsSync(muxOut)).toBe(true);
  });

  it("reports missing FFmpeg output after successful status", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-missing-output-"));
    const mixOut = path.join(dir, "final-audio.m4a");

    expect(() => mixVoiceAndMusic(
      { voicePath: "voice.mp3", musicPath: "music.mp3", outputPath: mixOut, durationSec: 27, musicVolume: 0.25 },
      () => ({ status: 0, stderr: Buffer.from("") }),
    )).toThrow("succeeded but output file missing");
  });

  it("reports FFmpeg failures with truncated stderr", () => {
    const longStderr = `${"x".repeat(500)}tail`;

    expect(() => mixVoiceAndMusic(
      { voicePath: "voice.mp3", musicPath: "music.mp3", outputPath: "out.m4a", durationSec: 27, musicVolume: 0.25 },
      () => ({ status: 1, stderr: Buffer.from(longStderr), signal: null }),
    )).toThrow(`FFmpeg audio mix failed: status=1 signal=null stderr=${"x".repeat(500)}`);
    expect(() => mixVoiceAndMusic(
      { voicePath: "voice.mp3", musicPath: "music.mp3", outputPath: "out.m4a", durationSec: 27, musicVolume: 0.25 },
      () => ({ status: 1, stderr: Buffer.from(longStderr), signal: null }),
    )).not.toThrow(/tail/);
  });

  it("reports FFmpeg spawn failures with error details", () => {
    expect(() => mixVoiceAndMusic(
      { voicePath: "voice.mp3", musicPath: "music.mp3", outputPath: "out.m4a", durationSec: 27, musicVolume: 0.25 },
      () => ({ status: null, stderr: Buffer.from(""), error: new Error("spawn ffmpeg ENOENT"), signal: null }),
    )).toThrow(/FFmpeg audio mix failed: status=null signal=null error=spawn ffmpeg ENOENT/);
  });
});
