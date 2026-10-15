/**
 * Reel Pipeline Test Script
 * Run individual steps: npx tsx scripts/test-reel.ts --step 1
 * Run all steps:        npx tsx scripts/test-reel.ts --all
 * Run from step N:      npx tsx scripts/test-reel.ts --from 2
 *
 * Output saved to ./reel-test-output/
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createBedrockService } from "../src/services/bedrock.js";
import { createImageGenService } from "../src/services/image-gen.js";
import { createSearchService } from "../src/services/search.js";

const OUTPUT_DIR = "./reel-test-output";
const STATE_FILE = path.join(OUTPUT_DIR, "state.json");

// ── Config ────────────────────────────────────────────────────────────────────

const TEST_URL = "https://www.youtube.com/shorts/VYLzCBuk3jU"; // change to any URL
const BRAND_LANGUAGE: "th" | "en" = "th";
const ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const SCENE_COUNT = 4;

// ── State helpers ─────────────────────────────────────────────────────────────

interface ReelState {
  url: string;
  articleContent?: string;
  script?: ReelScript;
  audioPaths?: string[];   // one MP3 per scene
  imagePaths?: string[];   // one PNG per scene
  videoPath?: string;      // final assembled MP4
}

interface ReelScene {
  sceneNumber: number;
  voiceover: string;       // spoken text
  caption: string;         // on-screen text overlay
  imagePrompt: string;     // image generation prompt
  durationSeconds?: number; // filled in after audio generation
}

interface ReelScript {
  title: string;
  scenes: ReelScene[];
}

function loadState(): ReelState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  }
  return { url: TEST_URL };
}

function saveState(state: ReelState): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(step: number, msg: string) {
  console.log(`\n[Step ${step}] ${msg}`);
}

// ── Step 1: Fetch content ─────────────────────────────────────────────────────

async function step1_fetchContent(): Promise<void> {
  log(1, "Fetching content from URL...");
  const state = loadState();
  const search = createSearchService();

  const isYouTube = state.url.includes("youtube.com") || state.url.includes("youtu.be");

  let content: string;

  if (isYouTube) {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // Normalise YouTube URL
    let videoUrl = state.url;
    try {
      const u = new URL(state.url);
      const shorts = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shorts) videoUrl = `https://www.youtube.com/watch?v=${shorts[1]}`;
      else {
        const vid = u.searchParams.get("v");
        if (vid) videoUrl = `https://www.youtube.com/watch?v=${vid}`;
      }
    } catch { /* keep original */ }

    console.log("  YouTube URL (normalised):", videoUrl);

    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: "You are a content extractor. Transcribe and summarise the video in detail.",
        maxOutputTokens: 4096,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      },
      contents: {
        role: "user",
        parts: [
          { fileData: { fileUri: videoUrl } },
          { text: "Please provide: (1) a full transcript or detailed summary of what is said/shown, (2) key facts and figures mentioned, (3) the main topic and context. Be thorough — this will be used to write a video script." },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    content = parts.map((p: { text?: string }) => p.text ?? "").join("");
  } else {
    const results = await search.extract([state.url]);
    content = results[0]?.content ?? "";
    if (!content) throw new Error("Tavily could not extract content from URL");
  }

  console.log("  Content length:", content.length, "chars");
  console.log("  Preview:", content.slice(0, 200).replace(/\n/g, " "), "...");

  state.articleContent = content;
  saveState(state);
  console.log(`\n✅ Step 1 done — content saved to ${STATE_FILE}`);
}

// ── Step 2: Generate script ───────────────────────────────────────────────────

async function step2_generateScript(): Promise<void> {
  log(2, "Generating reel script...");
  const state = loadState();
  if (!state.articleContent) throw new Error("No content found — run step 1 first");

  const bedrock = createBedrockService();
  const lang = BRAND_LANGUAGE === "th" ? "Thai" : "English";

  const systemPrompt = `You are a social media video scriptwriter. You write short, engaging ${lang} scripts for vertical video reels (Instagram/Facebook/TikTok style).

Rules:
- Write in ${lang}
- Each voiceover should be 1-3 short sentences, natural spoken language
- Captions are short punchy text (max 8 words) shown on screen
- Image prompts should be vivid, photorealistic, vertical 9:16 composition
- Hook scene 1 immediately — first 3 seconds decide whether people keep watching
- End with a strong takeaway or call to action
- Total video should feel complete in ${SCENE_COUNT} scenes (~30-45 seconds)

Respond ONLY with valid JSON matching this exact structure:
{
  "title": "short video title",
  "scenes": [
    {
      "sceneNumber": 1,
      "voiceover": "spoken text for this scene",
      "caption": "on-screen text overlay",
      "imagePrompt": "detailed image generation prompt, vertical 9:16 framing, photorealistic"
    }
  ]
}`;

  const userMessage = `Create a ${SCENE_COUNT}-scene reel script based on this content:

${state.articleContent.slice(0, 4000)}

Source URL: ${state.url}`;

  const raw = await bedrock.converse(systemPrompt, userMessage);

  let script: ReelScript;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    script = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    throw new Error(`Failed to parse script JSON:\n${raw.slice(0, 500)}`);
  }

  console.log("\n  Title:", script.title);
  for (const scene of script.scenes) {
    console.log(`\n  Scene ${scene.sceneNumber}:`);
    console.log(`    Voiceover: ${scene.voiceover}`);
    console.log(`    Caption:   ${scene.caption}`);
    console.log(`    Prompt:    ${scene.imagePrompt.slice(0, 80)}...`);
  }

  state.script = script;
  saveState(state);
  console.log(`\n✅ Step 2 done — script saved to ${STATE_FILE}`);
}

// ── Step 3: Generate voiceover ────────────────────────────────────────────────

async function step3_generateVoiceover(): Promise<void> {
  log(3, "Generating voiceover audio (ElevenLabs)...");
  const state = loadState();
  if (!state.script) throw new Error("No script found — run step 2 first");

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set in .env");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const audioPaths: string[] = [];

  for (const scene of state.script.scenes) {
    const outPath = path.join(OUTPUT_DIR, `scene${scene.sceneNumber}.mp3`);
    console.log(`  Scene ${scene.sceneNumber}: "${scene.voiceover.slice(0, 60)}..."`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: scene.voiceover,
          model_id: "eleven_v3",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs error for scene ${scene.sceneNumber}: ${err}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    audioPaths.push(outPath);

    // Get duration via ffprobe
    const { execSync } = await import("child_process");
    try {
      const dur = execSync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outPath}"`,
        { encoding: "utf8" }
      ).trim();
      scene.durationSeconds = parseFloat(dur);
      console.log(`    → ${outPath} (${scene.durationSeconds.toFixed(1)}s)`);
    } catch {
      scene.durationSeconds = 8; // fallback
      console.log(`    → ${outPath} (duration unknown, using 8s)`);
    }
  }

  state.audioPaths = audioPaths;
  saveState(state); // also saves durationSeconds back to script.scenes
  console.log(`\n✅ Step 3 done — ${audioPaths.length} audio files saved`);
}

// ── Step 4: Generate images ───────────────────────────────────────────────────

async function step4_generateImages(): Promise<void> {
  log(4, "Generating scene images (gemini-3-pro-image-preview)...");
  const state = loadState();
  if (!state.script) throw new Error("No script found — run step 2 first");

  const imageGen = createImageGenService();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const imagePaths: string[] = [];

  for (const scene of state.script.scenes) {
    const outPath = path.join(OUTPUT_DIR, `scene${scene.sceneNumber}.png`);
    console.log(`  Scene ${scene.sceneNumber}: ${scene.imagePrompt.slice(0, 80)}...`);

    const buffer = await imageGen.generate(
      scene.imagePrompt + ", vertical 9:16 aspect ratio, photorealistic, high quality, no text",
      { width: 1080, height: 1920 },
    );

    fs.writeFileSync(outPath, buffer);
    imagePaths.push(outPath);
    console.log(`    → ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  state.imagePaths = imagePaths;
  saveState(state);
  console.log(`\n✅ Step 4 done — ${imagePaths.length} images saved`);
}

// ── Step 5: Assemble video ────────────────────────────────────────────────────

async function step5_assembleVideo(): Promise<void> {
  log(5, "Assembling video (FFmpeg)...");
  const state = loadState();
  if (!state.script) throw new Error("No script found — run steps 1-2 first");
  if (!state.audioPaths?.length) throw new Error("No audio — run step 3 first");
  if (!state.imagePaths?.length) throw new Error("No images — run step 4 first");

  const { execSync, spawnSync } = await import("child_process");
  const scenes = state.script.scenes;
  const segmentPaths: string[] = [];

  // Per-scene gravity + y-offset for FFmpeg overlay positioning (safe zone aware)
  const OVERLAY_POSITIONS: Record<number, { gravity: string; geometry: string }> = {
    1: { gravity: "North", geometry: "+0+140" },   // top — hook text
    2: { gravity: "South", geometry: "+0+300" },   // bottom — detail scene
    3: { gravity: "South", geometry: "+0+300" },   // bottom — result scene
    4: { gravity: "Center", geometry: "+0+0" },    // centre — CTA
  };

  // Render caption as PNG using Puppeteer (HTML → Chrome → PNG).
  // Chrome renders emoji, Thai, and any Unicode natively via CSS/system fonts.
  async function renderCaptionPng(text: string, outPath: string): Promise<void> {
    const nodeHtmlToImage = (await import("node-html-to-image")).default;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 980px;
      background: transparent;
      display: flex;
      justify-content: center;
      padding: 0;
    }
    .caption {
      font-size: 52px;
      font-family: 'Noto Sans Thai', 'Noto Color Emoji', Arial, sans-serif;
      font-weight: bold;
      color: white;
      background: rgba(0, 0, 0, 0.7);
      padding: 20px 32px;
      border-radius: 12px;
      text-align: center;
      line-height: 1.4;
      word-wrap: break-word;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
    }
  </style>
</head>
<body>
  <div class="caption">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;")}</div>
</body>
</html>`;

    await nodeHtmlToImage({
      output: outPath,
      html,
      transparent: true,
      puppeteerArgs: {
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      },
    });
  }

  // Build one video segment per scene using ImageMagick caption + FFmpeg overlay
  for (const scene of scenes) {
    const imgPath = state.imagePaths[scene.sceneNumber - 1];
    const audioPath = state.audioPaths[scene.sceneNumber - 1];
    const segPath = path.join(OUTPUT_DIR, `segment${scene.sceneNumber}.mp4`);
    const captionPng = path.resolve(OUTPUT_DIR, `caption${scene.sceneNumber}.png`);
    const duration = scene.durationSeconds ?? 8;
    const pos = OVERLAY_POSITIONS[scene.sceneNumber] ?? { gravity: "South", geometry: "+0+300" };

    // Step A — render caption PNG via Puppeteer (Thai + emoji rendered by Chrome)
    await renderCaptionPng(scene.caption, captionPng);

    // Step B — get caption image dimensions to compute overlay x/y
    const dimsRaw = execSync(`identify -format "%w %h" "${captionPng}"`, { encoding: "utf8" }).trim();
    const [capW, capH] = dimsRaw.split(" ").map(Number);
    const VW = 1080, VH = 1920;

    // Compute overlay x,y from gravity + geometry
    const m = pos.geometry.match(/([+-]\d+)([+-]\d+)/);
    const [geoX, geoY] = m ? [parseInt(m[1]), parseInt(m[2])] : [0, 0];
    let overlayX: number, overlayY: number;
    if (pos.gravity === "North")       { overlayX = (VW - capW) / 2 + geoX; overlayY = Math.abs(geoY); }
    else if (pos.gravity === "South")  { overlayX = (VW - capW) / 2 + geoX; overlayY = VH - capH - Math.abs(geoY); }
    else                               { overlayX = (VW - capW) / 2 + geoX; overlayY = (VH - capH) / 2 + geoY; }

    // Step C — FFmpeg: scale image to 9:16, overlay fading caption PNG
    // Caption input uses -loop 1 -t <duration> so the single frame becomes a video stream.
    // Then fade filter fades in/out — this is cleaner and more reliable than geq.
    const fadeIn = 0.3, fadeOut = 0.3;
    const filterComplex = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]`,
      `[2:v]format=rgba,fade=t=in:st=0:d=${fadeIn}:alpha=1,fade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1[cap]`,
      `[bg][cap]overlay=${Math.round(overlayX)}:${Math.round(overlayY)}`,
    ].join(";");

    const ffmpegArgs = [
      "-y",
      "-loop", "1", "-i", imgPath,
      "-i", audioPath,
      // Loop caption PNG as a video stream for the full segment duration
      "-loop", "1", "-t", String(duration), "-i", captionPng,
      "-filter_complex", filterComplex,
      "-c:v", "libx264", "-tune", "stillimage",
      "-c:a", "aac", "-b:a", "192k",
      "-t", String(duration),
      "-pix_fmt", "yuv420p",
      segPath,
    ];

    console.log(`  Building segment ${scene.sceneNumber} (${duration.toFixed(1)}s)...`);
    const ffResult = spawnSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
    if (ffResult.status !== 0) {
      throw new Error(`FFmpeg segment ${scene.sceneNumber} failed:\n${ffResult.stderr?.toString()}`);
    }
    segmentPaths.push(segPath);
    console.log(`    → ${segPath}`);
  }

  // Write concat list
  const concatFile = path.join(OUTPUT_DIR, "concat.txt");
  fs.writeFileSync(concatFile, segmentPaths.map((p) => `file '${path.resolve(p)}'`).join("\n"));

  // Concatenate segments
  const outputPath = path.join(OUTPUT_DIR, "reel.mp4");
  console.log("\n  Concatenating segments...");
  const concatResult = spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatFile,
    "-c", "copy", outputPath,
  ], { stdio: "pipe" });
  if (concatResult.status !== 0) {
    throw new Error(`FFmpeg concat failed:\n${concatResult.stderr?.toString()}`);
  }

  state.videoPath = outputPath;
  saveState(state);

  const stats = fs.statSync(outputPath);
  console.log(`\n✅ Step 5 done — video saved to ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const STEPS: Record<number, () => Promise<void>> = {
  1: step1_fetchContent,
  2: step2_generateScript,
  3: step3_generateVoiceover,
  4: step4_generateImages,
  5: step5_assembleVideo,
};

const STEP_NAMES: Record<number, string> = {
  1: "Fetch content",
  2: "Generate script",
  3: "Generate voiceover (ElevenLabs)",
  4: "Generate images (Imagen)",
  5: "Assemble video (FFmpeg)",
};

async function main() {
  const args = process.argv.slice(2);
  const stepArg = args.findIndex((a) => a === "--step");
  const fromArg = args.findIndex((a) => a === "--from");
  const allArg = args.includes("--all");

  let stepsToRun: number[] = [];

  if (allArg) {
    stepsToRun = [1, 2, 3, 4, 5];
  } else if (stepArg !== -1) {
    stepsToRun = [parseInt(args[stepArg + 1])];
  } else if (fromArg !== -1) {
    const from = parseInt(args[fromArg + 1]);
    stepsToRun = [1, 2, 3, 4, 5].filter((s) => s >= from);
  } else {
    console.log(`
Reel Pipeline Test Script
─────────────────────────
Usage:
  npx tsx scripts/test-reel.ts --step N      run only step N
  npx tsx scripts/test-reel.ts --from N      run steps N through 5
  npx tsx scripts/test-reel.ts --all         run all steps

Steps:
  1  ${STEP_NAMES[1]}
  2  ${STEP_NAMES[2]}
  3  ${STEP_NAMES[3]}
  4  ${STEP_NAMES[4]}
  5  ${STEP_NAMES[5]}

Output: ./reel-test-output/
State:  ./reel-test-output/state.json  (persists between steps)

Config (edit at top of this file):
  TEST_URL           = ${TEST_URL}
  BRAND_LANGUAGE     = ${BRAND_LANGUAGE}
  ELEVENLABS_VOICE_ID = ${ELEVENLABS_VOICE_ID}
  SCENE_COUNT        = ${SCENE_COUNT}

Required .env keys:
  GEMINI_API_KEY        ${process.env.GEMINI_API_KEY ? "✅" : "❌ missing"}
  GEMINI_IMAGE_API_KEY  ${process.env.GEMINI_IMAGE_API_KEY ? "✅" : "❌ missing"}
  ELEVENLABS_API_KEY    ${process.env.ELEVENLABS_API_KEY ? "✅" : "❌ missing"}
`);
    process.exit(0);
  }

  for (const step of stepsToRun) {
    const fn = STEPS[step];
    if (!fn) { console.error(`Unknown step: ${step}`); process.exit(1); }
    console.log(`\n${"─".repeat(50)}`);
    console.log(`Running Step ${step}: ${STEP_NAMES[step]}`);
    console.log("─".repeat(50));
    try {
      await fn();
    } catch (err) {
      console.error(`\n❌ Step ${step} failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.log("\n🎉 All requested steps completed.");
  console.log(`   Output directory: ${path.resolve(OUTPUT_DIR)}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
