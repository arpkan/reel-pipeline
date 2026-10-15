import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseAudioRoughCutArgs, runStoryReelAudioRoughCutPoc } from "../src/storyreel/audio-rough-cut-poc.js";
import type { StoryReelDirectorDirection } from "../src/storyreel/director-poc.js";

function sampleDirection(): StoryReelDirectorDirection {
  return {
    hook_clip: { clip_index: 0, start_sec: 1, end_sec: 3, reason: "discount reveal" },
    clips: [
      { clip_index: 0, start_sec: 1, end_sec: 3, order: 0, role: "hook" },
      { clip_index: 1, start_sec: 0, end_sec: 4, order: 1, role: "completion" },
    ],
    voiceover_script: { full_text: "รู้ยัง เต่าบินลดห้าบาท", segments: [{ order: 0, text: "รู้ยัง", duration_sec: 2 }] },
    hook_text_overlay: "เต่าบินลด 5 บาท!",
    caption_lines: ["วิธีประหยัด", "ทำตามนี้"],
    cta_text: "ติดตามสำหรับเทคนิคดีๆ แบบนี้",
    facebook_caption: "ทิปเต่าบินง่ายๆ",
    hashtags: ["#เต่าบิน"],
    total_duration_sec: 6,
    director_notes: "test",
    inferred_voice_style: "tutorial",
    inferred_content_type: "lifestyle",
    music_direction: { genre: "playful", energy: "medium", tempo: "medium", suggested_search_terms: ["cheerful ukulele"], volume: 0.25, reason: "light tip" },
    voice_direction: { tone: "friendly", pace: "medium", style: "tutorial", language_code: "th", reason: "friendly tutorial" },
  };
}

describe("StoryReel audio rough cut POC", () => {
  it("uses the audio rough-cut output directory by default", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-parse-"));
    const clip = path.join(sourceDir, "clip1.mp4");
    const music = path.join(sourceDir, "music.mp3");
    fs.writeFileSync(clip, "clip1");
    fs.writeFileSync(music, "music");

    expect(parseAudioRoughCutArgs(["--run-dir", "run", "--clips", clip, "--music", music]).outputBaseDir)
      .toBe("work/storyreel-poc/audio-rough-cuts");
  });

  it("rejects missing or non-file music paths while parsing", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-parse-"));
    const clip = path.join(sourceDir, "clip1.mp4");
    const missingMusic = path.join(sourceDir, "missing.mp3");
    const musicDir = path.join(sourceDir, "music-dir.mp3");
    fs.writeFileSync(clip, "clip1");
    fs.mkdirSync(musicDir);

    expect(() => parseAudioRoughCutArgs(["--run-dir", "run", "--clips", clip])).toThrow("Missing --music");
    expect(() => parseAudioRoughCutArgs(["--run-dir", "run", "--clips", clip, "--music", missingMusic])).toThrow("Music file not found");
    expect(() => parseAudioRoughCutArgs(["--run-dir", "run", "--clips", clip, "--music", musicDir])).toThrow("Music path is not a file");
  });

  it("parses Botnoi voice provider and requires a voice id", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-parse-"));
    const clip = path.join(sourceDir, "clip1.mp4");
    const music = path.join(sourceDir, "music.mp3");
    fs.writeFileSync(clip, "clip1");
    fs.writeFileSync(music, "music");

    expect(parseAudioRoughCutArgs([
      "--run-dir", "run",
      "--clips", clip,
      "--music", music,
      "--voice-provider", "botnoi",
      "--voice-id", "2",
    ])).toEqual(expect.objectContaining({ voiceProvider: "botnoi", voiceId: "2" }));
    expect(() => parseAudioRoughCutArgs([
      "--run-dir", "run",
      "--clips", clip,
      "--music", music,
      "--voice-provider", "botnoi",
    ])).toThrow("--voice-id is required when --voice-provider botnoi is used");
  });

  it("runs with injected FFmpeg, Hyperframes, voice search, and TTS", async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-source-"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-run-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-out-"));
    const clip1 = path.join(sourceDir, "clip1.mp4");
    const clip2 = path.join(sourceDir, "clip2.mp4");
    const music = path.join(sourceDir, "music.mp3");
    fs.writeFileSync(clip1, "clip1");
    fs.writeFileSync(clip2, "clip2");
    fs.writeFileSync(music, "music");
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(sampleDirection()));
    const ffmpegCalls: string[][] = [];

    const result = await runStoryReelAudioRoughCutPoc([
      "--run-dir", runDir,
      "--clips", clip1, clip2,
      "--music", music,
      "--output-dir", outDir,
    ], {
      now: new Date("2026-05-15T09:00:00Z"),
      ffmpegExecutor(args) {
        ffmpegCalls.push(args);
        fs.mkdirSync(path.dirname(args[args.length - 1]), { recursive: true });
        fs.writeFileSync(args[args.length - 1], "ffmpeg-output");
        return { status: 0, stderr: Buffer.from("") };
      },
      async hyperframesRenderer({ outputPath }) {
        fs.writeFileSync(outputPath, "silent-video");
      },
      sharedVoiceSearch: async () => [{ voice_id: "voice-1", name: "Friendly", cloned_by_count: 10, verified_languages: [] }],
      tts: async () => ({ audio: Buffer.from("voice"), wordTimings: [{ word: "รู้ยัง", start: 0, end: 0.5 }] }),
    });

    expect(result.outputDir).toBe(path.join(outDir, "storyreel-audio-roughcut-20260515-090000"));
    expect(fs.existsSync(path.join(result.outputDir, "rough-cut-with-audio.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "rough-cut-silent.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "voiceover.mp3"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "word-timings.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "final-audio.m4a"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "voice-selection.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "assembly-plan.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "assembly-log.txt"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "hyperframes", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "hyperframes", "assets", "segment-001.mp4"))).toBe(true);
    const audioCalls = ffmpegCalls.filter((args) => ["final-audio.m4a", "rough-cut-with-audio.mp4"].includes(path.basename(args[args.length - 1])));
    expect(audioCalls.map((args) => path.basename(args[args.length - 1]))).toEqual(["final-audio.m4a", "rough-cut-with-audio.mp4"]);
    expect(audioCalls[0].join(" ")).toContain("volume=0.25");
  });

  it("reports audio direction validation errors clearly", async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-source-"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-run-"));
    const clip1 = path.join(sourceDir, "clip1.mp4");
    const clip2 = path.join(sourceDir, "clip2.mp4");
    const music = path.join(sourceDir, "music.mp3");
    fs.writeFileSync(clip1, "clip1");
    fs.writeFileSync(clip2, "clip2");
    fs.writeFileSync(music, "music");
    const direction = sampleDirection() as Partial<StoryReelDirectorDirection>;
    delete direction.voice_direction;
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(direction));

    await expect(runStoryReelAudioRoughCutPoc([
      "--run-dir", runDir,
      "--clips", clip1, clip2,
      "--music", music,
    ])).rejects.toThrow("Audio rough-cut direction failed validation:\n- voice_direction must be an object");
  });

  it("uses Botnoi voice id without ElevenLabs shared voice search", async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-source-"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-run-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-audio-out-"));
    const clip1 = path.join(sourceDir, "clip1.mp4");
    const clip2 = path.join(sourceDir, "clip2.mp4");
    const music = path.join(sourceDir, "music.mp3");
    fs.writeFileSync(clip1, "clip1");
    fs.writeFileSync(clip2, "clip2");
    fs.writeFileSync(music, "music");
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(sampleDirection()));

    const result = await runStoryReelAudioRoughCutPoc([
      "--run-dir", runDir,
      "--clips", clip1, clip2,
      "--music", music,
      "--output-dir", outDir,
      "--voice-provider", "botnoi",
      "--voice-id", "2",
    ], {
      now: new Date("2026-05-15T09:00:00Z"),
      ffmpegExecutor(args) {
        fs.mkdirSync(path.dirname(args[args.length - 1]), { recursive: true });
        fs.writeFileSync(args[args.length - 1], "ffmpeg-output");
        return { status: 0, stderr: Buffer.from("") };
      },
      async hyperframesRenderer({ outputPath }) {
        fs.writeFileSync(outputPath, "silent-video");
      },
      sharedVoiceSearch: async () => {
        throw new Error("shared voice search should not run for Botnoi");
      },
      tts: async ({ voiceId, modelId }) => ({
        audio: Buffer.from(`${modelId}:${voiceId}`),
        wordTimings: [{ word: "รู้ยัง", start: 0, end: 0.5 }],
      }),
    });

    const selection = JSON.parse(fs.readFileSync(path.join(result.outputDir, "voice-selection.json"), "utf8"));
    expect(selection).toEqual(expect.objectContaining({ voiceId: "2", provider: "botnoi" }));
    expect(fs.readFileSync(path.join(result.outputDir, "voiceover.mp3"), "utf8")).toBe("botnoi:2");
  });
});
