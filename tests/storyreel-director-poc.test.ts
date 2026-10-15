import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildDirectorPrompt,
  buildSummary,
  createRunId,
  parseArgs,
  parseDirectorJson,
  runStoryReelDirectorPoc,
  validateDirection,
  waitForActiveFile,
  validateClipPaths,
  writeArtifacts,
  type StoryReelDirectorDirection,
} from "../src/storyreel/director-poc.js";
import { calculateGeminiFlashCostUsd } from "../src/storyreel/cost.js";

function sampleDirection(): StoryReelDirectorDirection {
  const direction = {
    hook_clip: { clip_index: 0, start_sec: 1, end_sec: 4, reason: "clear reveal" },
    clips: [
      { clip_index: 0, start_sec: 1, end_sec: 4, order: 0, role: "hook" },
      { clip_index: 1, start_sec: 2, end_sec: 8, order: 1, role: "demo" },
    ],
    voiceover_script: { full_text: "สคริปต์ทดสอบ" },
    music_direction: {
      genre: "upbeat",
      energy: "medium",
      tempo: "fast",
      suggested_search_terms: ["upbeat product reveal", "bright lifestyle pop"],
      volume: 0.35,
      reason: "matches the energetic reveal",
    },
    voice_direction: {
      tone: "friendly",
      pace: "medium",
      style: "informative",
      language_code: "th-TH",
      reason: "keeps the explanation approachable",
    },
    hook_text_overlay: "คุ้มไหม",
    caption_lines: ["เริ่มจากจุดนี้", "ดูผลลัพธ์"],
    cta_text: "ติดตามต่อ",
    facebook_caption: "แคปชั่นทดสอบ",
    hashtags: ["#Test", "#StoryReel"],
    total_duration_sec: 9,
    director_notes: "ใช้ช่วงเปิดกล่อง",
    inferred_voice_style: "storytelling",
    inferred_content_type: "review",
  };
  return direction as StoryReelDirectorDirection;
}

describe("StoryReel director POC", () => {
  it("parses required CLI arguments", () => {
    const args = parseArgs([
      "--clips", "clip1.mp4", "clip2.mov",
      "--product", "Testing story",
      "--note", "surprising value from Germany",
      "--language", "thai",
    ]);

    expect(args).toEqual({
      clips: ["clip1.mp4", "clip2.mov"],
      product: "Testing story",
      note: "surprising value from Germany",
      language: "thai",
      outputBaseDir: "work/storyreel-poc",
    });
  });

  it("defaults language, note, product, and output directory", () => {
    const args = parseArgs(["--clips", "clip1.mp4"]);

    expect(args).toEqual({
      clips: ["clip1.mp4"],
      product: "Testing story",
      note: "",
      language: "thai",
      outputBaseDir: "work/storyreel-poc",
    });
  });

  it("rejects missing clips", () => {
    expect(() => parseArgs(["--product", "Testing story"])).toThrow("Usage:");
  });

  it("builds a strict director prompt", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 2,
      product: "Dyson Airwrap",
      note: "focus on the packaging",
      language: "thai",
    });

    expect(prompt).toContain("CONTENT: 2 raw clip(s) of: Dyson Airwrap");
    expect(prompt).toContain("CREATOR'S NOTE");
    expect(prompt).toContain("focus on the packaging");
    expect(prompt).toContain("LANGUAGE: Thai");
    expect(prompt).toContain("Return ONLY valid JSON");
    expect(prompt).toContain("\"hook_clip\"");
    expect(prompt).toContain("\"voiceover_script\"");
    expect(prompt).toContain("\"music_direction\"");
    expect(prompt).toContain("\"voice_direction\"");
    expect(prompt).toContain("\"order\": 0");
    expect(prompt).toContain("IMPORTANT: Include hook_clip as order=0 in clips array too");
    expect(prompt).toContain("CTA must match content context");
    expect(prompt).toContain("voiceover_script.segments[].order must match clips[].order");
    expect(prompt).toContain("ติดตามสำหรับเทคนิคดีๆ แบบนี้");
    expect(prompt).toContain('"language_code": "th"');
  });

  it("parses German language option", () => {
    const args = parseArgs(["--clips", "clip1.mp4", "--language", "german"]);

    expect(args.language).toBe("german");
  });

  it("builds a German director prompt", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 1,
      product: "personal dog walking",
      note: "Warm personal lifestyle moment, no product selling.",
      language: "german",
    });

    expect(prompt).toContain("LANGUAGE: German voiceover, captions, hook, CTA, and Facebook caption.");
    expect(prompt).toContain('"language_code": "de"');
    expect(prompt).toContain("Folge für mehr persönliche Momente wie diesen");
  });

  it("rejects unsupported language options", () => {
    expect(() => parseArgs(["--clips", "clip1.mp4", "--language", "french"])).toThrow("Invalid --language: french");
  });

  it("uses practical English CTA examples in director prompts", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 1,
      product: "Dyson Airwrap",
      note: "",
      language: "english",
    });

    expect(prompt).toContain("Follow for more practical tips like this");
    expect(prompt).toContain('"language_code": "en"');
  });

  it("parses Gemini JSON wrapped in markdown fences", () => {
    const raw = "```json\n" +
      "{\"hook_clip\":{\"clip_index\":0,\"start_sec\":1,\"end_sec\":4,\"reason\":\"clear reveal\"},\"clips\":[{\"clip_index\":0,\"start_sec\":1,\"end_sec\":4,\"order\":1,\"role\":\"hook\"}],\"voiceover_script\":{\"full_text\":\"สคริปต์ทดสอบ\"},\"hook_text_overlay\":\"คุ้มไหม\",\"caption_lines\":[\"เริ่มจากจุดนี้\"],\"cta_text\":\"ติดตามต่อ\",\"facebook_caption\":\"แคปชั่นทดสอบ\",\"hashtags\":[\"#Test\"],\"total_duration_sec\":3,\"director_notes\":\"ใช้ช่วงเปิดกล่อง\"}\n" +
      "```";
    const direction = parseDirectorJson(raw);

    expect(direction.hook_clip.reason).toBe("clear reveal");
    expect(direction.voiceover_script.full_text).toBe("สคริปต์ทดสอบ");
  });

  it("validates usable direction", () => {
    const direction = sampleDirection();

    expect(validateDirection(direction, 2)).toEqual([]);
  });

  it("reports invalid clip indices and timestamps", () => {
    const direction = sampleDirection();
    direction.clips[0].clip_index = 3;
    direction.clips[0].end_sec = direction.clips[0].start_sec;

    expect(validateDirection(direction, 2)).toEqual([
      "clips[0].clip_index 3 is outside uploaded clip range 0-1",
      "clips[0].end_sec must be greater than start_sec",
    ]);
  });

  it("builds a readable summary", () => {
    const summary = buildSummary(sampleDirection(), ["clip1.mp4", "clip2.mp4"]);

    expect(summary).toContain("StoryReel Director POC Summary");
    expect(summary).toContain("Hook: clip 1 1.00s-4.00s");
    expect(summary).toContain("0. clip 1 1.00s-4.00s [hook]");
    expect(summary).toContain("Voiceover Script");
    expect(summary).toContain("Music Direction: upbeat, medium energy, fast tempo");
    expect(summary).toContain("Music Search Terms: upbeat product reveal, bright lifestyle pop");
    expect(summary).toContain("Voice Direction: friendly, medium pace, informative");
    expect(summary).toContain("Facebook Caption");
  });

  it("validates missing or malformed music direction", () => {
    const direction = sampleDirection() as unknown as Record<string, unknown>;
    direction.music_direction = {
      genre: "",
      energy: "",
      tempo: "",
      suggested_search_terms: ["valid", ""],
      volume: "loud",
      reason: "",
    };

    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toEqual([
      "music_direction.genre must be non-empty",
      "music_direction.energy must be non-empty",
      "music_direction.tempo must be non-empty",
      "music_direction.suggested_search_terms must be an array of strings",
      "music_direction.volume must be numeric",
      "music_direction.reason must be non-empty",
    ]);

    delete direction.music_direction;
    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toContain("music_direction must be an object");
  });

  it("validates missing or malformed voice direction", () => {
    const direction = sampleDirection() as unknown as Record<string, unknown>;
    direction.voice_direction = {
      tone: "",
      pace: "",
      style: "",
      language_code: "",
      reason: "",
    };

    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toEqual([
      "voice_direction.tone must be non-empty",
      "voice_direction.pace must be non-empty",
      "voice_direction.style must be non-empty",
      "voice_direction.language_code must be non-empty",
      "voice_direction.reason must be non-empty",
    ]);

    delete direction.voice_direction;
    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toContain("voice_direction must be an object");
  });

  it("rejects music direction values outside declared options", () => {
    const direction = sampleDirection() as unknown as Record<string, unknown>;
    direction.music_direction = {
      genre: "cinematic",
      energy: "extreme",
      tempo: "rushed",
      suggested_search_terms: [],
      volume: 0.35,
      reason: "matches the edit",
    };

    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toEqual([
      "music_direction.genre must be one of: upbeat, calm, neutral, playful, dramatic, inspirational",
      "music_direction.energy must be one of: low, medium, high",
      "music_direction.tempo must be one of: slow, medium, fast",
      "music_direction.suggested_search_terms must be an array of strings",
    ]);
  });

  it("accepts conversational and lifestyle voice direction styles", () => {
    const direction = sampleDirection();
    (direction.voice_direction as unknown as Record<string, string>).style = "conversational";
    expect(validateDirection(direction, 2)).toEqual([]);

    (direction.voice_direction as unknown as Record<string, string>).style = "lifestyle";
    expect(validateDirection(direction, 2)).toEqual([]);
  });

  it("saves raw Gemini response before validation so failures are debuggable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-raw-"));
    const clip1 = path.join(dir, "clip1.mp4");
    const clip2 = path.join(dir, "clip2.mp4");
    fs.writeFileSync(clip1, "fake video 1");
    fs.writeFileSync(clip2, "fake video 2");
    const rawJson = JSON.stringify(sampleDirection());

    await runStoryReelDirectorPoc(["--clips", clip1, clip2, "--product", "Testing", "--output-dir", dir], {
      now: new Date("2026-05-15T00:00:00Z"),
      client: {
        async uploadFile(_filePath, mimeType) { return { uri: "gemini://test", mimeType }; },
        async generateDirection() { return { text: rawJson }; },
      },
    });

    const rawFile = path.join(dir, "storyreel-20260515-000000", "raw-direction.json");
    expect(fs.existsSync(rawFile)).toBe(true);
    expect(fs.readFileSync(rawFile, "utf8")).toBe(rawJson);
  });

  it("saves raw response and names run dir in validation error", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-fail-raw-"));
    const clip1 = path.join(dir, "clip1.mp4");
    const clip2 = path.join(dir, "clip2.mp4");
    fs.writeFileSync(clip1, "fake video 1");
    fs.writeFileSync(clip2, "fake video 2");
    const bad = { ...sampleDirection() };
    (bad.voice_direction as unknown as Record<string, string>).style = "lifestyle_blogger";

    await expect(
      runStoryReelDirectorPoc(["--clips", clip1, clip2, "--product", "Testing", "--output-dir", dir], {
        now: new Date("2026-05-15T00:00:00Z"),
        client: {
          async uploadFile(_filePath, mimeType) { return { uri: "gemini://test", mimeType }; },
          async generateDirection() { return { text: JSON.stringify(bad) }; },
        },
      }),
    ).rejects.toThrow("raw-direction.json");

    const rawFile = path.join(dir, "storyreel-20260515-000000", "raw-direction.json");
    expect(fs.existsSync(rawFile)).toBe(true);
  });

  it("rejects voice direction values outside declared options", () => {
    const direction = sampleDirection() as unknown as Record<string, unknown>;
    direction.voice_direction = {
      tone: "serious",
      pace: "rushed",
      style: "sales",
      language_code: "th",
      reason: "matches the edit",
    };

    expect(validateDirection(direction as unknown as StoryReelDirectorDirection, 2)).toEqual([
      "voice_direction.tone must be one of: friendly, enthusiastic, calm, authoritative, conversational, excited",
      "voice_direction.pace must be one of: slow, medium, fast",
      "voice_direction.style must be one of: informative, storytelling, tutorial, review, conversational, lifestyle",
    ]);
  });

  it("validates local clip paths and extensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-test-"));
    const clip = path.join(dir, "clip1.mp4");
    fs.writeFileSync(clip, "fake video");

    expect(validateClipPaths([clip])).toEqual([clip]);
    expect(() => validateClipPaths([path.join(dir, "missing.mp4")])).toThrow("Clip not found");
    expect(() => validateClipPaths([path.join(dir, "notes.txt")])).toThrow("Unsupported clip extension");
  });

  it("writes direction, prompt, and summary artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-artifacts-"));
    const direction = sampleDirection();
    const summary = buildSummary(direction, ["clip1.mp4", "clip2.mp4"]);

    const result = writeArtifacts({
      outputBaseDir: dir,
      runId: "storyreel-test",
      prompt: "prompt text",
      direction,
      summary,
    });

    expect(result.runDir).toBe(path.join(dir, "storyreel-test"));
    expect(fs.readFileSync(path.join(result.runDir, "prompt.txt"), "utf8")).toBe("prompt text");
    expect(JSON.parse(fs.readFileSync(path.join(result.runDir, "direction.json"), "utf8"))).toEqual(direction);
    expect(fs.readFileSync(path.join(result.runDir, "summary.txt"), "utf8")).toBe(summary);
  });

  it("creates sortable run ids", () => {
    expect(createRunId(new Date("2026-05-14T12:34:56Z"))).toBe("storyreel-20260514-123456");
  });

  it("runs the POC with an injected Gemini client", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-run-"));
    const clip1 = path.join(dir, "clip1.mp4");
    const clip2 = path.join(dir, "clip2.mp4");
    fs.writeFileSync(clip1, "fake video 1");
    fs.writeFileSync(clip2, "fake video 2");

    const uploads: string[] = [];
    const result = await runStoryReelDirectorPoc([
      "--clips", clip1, clip2,
      "--product", "Testing story",
      "--note", "make it honest",
      "--language", "thai",
      "--output-dir", dir,
    ], {
      now: new Date("2026-05-14T12:34:56Z"),
      client: {
        async uploadFile(filePath, mimeType) {
          uploads.push(`${path.basename(filePath)}:${mimeType}`);
          return { uri: `gemini://${path.basename(filePath)}`, mimeType };
        },
        async generateDirection(parts, prompt) {
          expect(parts).toEqual([
            { uri: "gemini://clip1.mp4", mimeType: "video/mp4" },
            { uri: "gemini://clip2.mp4", mimeType: "video/mp4" },
          ]);
          expect(prompt).toContain("make it honest");
          return { text: JSON.stringify(sampleDirection()) };
        },
      },
    });

    expect(uploads).toEqual(["clip1.mp4:video/mp4", "clip2.mp4:video/mp4"]);
    expect(result.runDir).toBe(path.join(dir, "storyreel-20260514-123456"));
    expect(result.summary).toContain("StoryReel Director POC Summary");
    expect(fs.existsSync(path.join(result.runDir, "direction.json"))).toBe(true);
  });

  it("waits for Gemini uploaded files to become active", async () => {
    const states = ["PROCESSING", "PROCESSING", "ACTIVE"];
    const file = await waitForActiveFile(
      { name: "files/clip1", uri: "gemini://clip1", mimeType: "video/mp4", state: "PROCESSING" },
      async () => ({ name: "files/clip1", uri: "gemini://clip1", mimeType: "video/mp4", state: states.shift() }),
      { intervalMs: 0, timeoutMs: 1000 },
    );

    expect(file.state).toBe("ACTIVE");
  });

  it("reports Gemini file processing failures", async () => {
    await expect(waitForActiveFile(
      { name: "files/clip1", uri: "gemini://clip1", mimeType: "video/mp4", state: "PROCESSING" },
      async () => ({ name: "files/clip1", uri: "gemini://clip1", mimeType: "video/mp4", state: "FAILED", error: { message: "bad video" } }),
      { intervalMs: 0, timeoutMs: 1000 },
    )).rejects.toThrow("Gemini file processing failed for files/clip1: bad video");
  });

  it("builds a production prompt with precedence, profile context, and source-audio stripping", () => {
    const prompt = buildDirectorPrompt({
      clipCount: 2,
      product: "Personal clips",
      note: "make this formal for a vet clinic",
      language: "english",
      profile: {
        audienceLanguage: "english",
        audienceDescription: "Dog owners who want practical veterinary advice.",
      },
      clipsMetadata: [
        { path: "/tmp/a.mp4", sizeMb: 10, durationSec: 30, orientation: "horizontal", width: 1920, height: 1080 },
        { path: "/tmp/b.mp4", sizeMb: 8, durationSec: 20, orientation: "vertical", width: 1080, height: 1920 },
      ],
    });

    expect(prompt).toContain("If a user note is provided, it takes priority over all profile preferences for this video only. Treat the profile as permanent context and the user note as a per-video override.");
    expect(prompt).toContain("Source clip audio will be removed in Phase 1. Do not plan segments around dialogue, reactions, ambient sound, or any source audio being heard.");
    expect(prompt).toContain("Audience description: Dog owners who want practical veterinary advice.");
    expect(prompt).toContain("Clip 1: horizontal 1920x1080, 30s, 10MB");
  });

  it("requires independent inferred voice style and content type fields", () => {
    const direction = sampleDirection();
    direction.inferred_voice_style = "tutorial" as never;
    direction.inferred_content_type = "travel" as never;

    expect(validateDirection(direction, 2)).toEqual([]);

    delete (direction as unknown as Record<string, unknown>).inferred_content_type;
    expect(validateDirection(direction, 2)).toContain("inferred_content_type must be one of lifestyle, tutorial, review, travel, food, story, opinion, other");
  });

  it("calculates Gemini Flash cost from token counts", () => {
    expect(calculateGeminiFlashCostUsd(1000, 2000)).toBe(0.0053);
  });
});
