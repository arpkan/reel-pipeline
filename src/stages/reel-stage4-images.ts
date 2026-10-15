import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { ReelContext, ReelStage, ImageSource } from "../types.js";
import { createImageGenService, ImageSafetyError } from "../services/image-gen.js";
import { createAzureImageGenService } from "../services/azure-image-gen.js";
import { createStockImageService } from "../services/stock-image.js";
import { createBedrockService } from "../services/bedrock.js";

import type { ImageGenOptions } from "../types.js";

type ImageGenResult = { buffer: Buffer; source: import("../types.js").ApiProvider; model: string };

type ImageProvider = {
  generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult>;
  modelName: string;
};

function wrapWithModel(svc: { generate(prompt: string, options?: ImageGenOptions): Promise<{ buffer: Buffer; source: import("../types.js").ApiProvider }>; modelName: string }): ImageProvider {
  return {
    modelName: svc.modelName,
    async generate(prompt, options) {
      const result = await svc.generate(prompt, options);
      return { ...result, model: svc.modelName };
    },
  };
}

function buildImageProvider(): ImageProvider {
  const mode = (process.env.IMAGE_PROVIDER ?? "gemini").toLowerCase();
  if (mode === "azure") return wrapWithModel(createAzureImageGenService());
  if (mode === "azure+gemini") {
    const azure = createAzureImageGenService();
    const gemini = createImageGenService();
    return {
      modelName: `${azure.modelName}+${gemini.modelName}`,
      async generate(prompt, options) {
        try {
          const result = await azure.generate(prompt, options);
          return { ...result, model: azure.modelName };
        } catch (err) {
          console.warn(`    [image] Azure failed (${err instanceof Error ? err.message : err}) — falling back to Gemini`);
          const result = await gemini.generate(prompt, options);
          return { ...result, model: gemini.modelName };
        }
      },
    };
  }
  return wrapWithModel(createImageGenService());
}

const REBUILD_VARIATIONS = [
  "Wide sweeping aerial drone shot from far above. ",
  "Extreme close-up macro shot focused on fine textures. ",
  "Low angle shot looking upward with dramatic perspective. ",
  "Silhouette style, backlit against bright background. ",
  "Monochromatic desaturated tones, muted color palette. ",
  "Split-tone color grading, teal and orange palette. ",
  "Deep shadows and high contrast film noir aesthetic. ",
  "Bright overexumed high-key lighting, ethereal glow. ",
  "Symmetrical centered composition, mirror-like balance. ",
  "Dutch angle tilted frame, off-kilter dynamic energy. ",
];

// Plural forms added for the simple pluralizable single-word alternatives (and the
// last word of "prime minister" / "party leader") so e.g. "German politicians" is
// still guarded — the bare \b word boundary never matches before a trailing "s".
// "mp" / "member of parliament" and "head of state" are left singular-only: MP's
// plural form is ambiguous/rare enough in prompt text to skip, and "heads of state"
// is irregular (the "s" isn't on the last word) so it's not worth the added regex
// complexity here.
const POLITICAL_ROLE_RE =
  /\b(politicians?|presidents?|prime\s+ministers?|premiers?|chancellors?|ministers?|secretary\s+of\s+state|senators?|governors?|mayors?|mp|member\s+of\s+parliament|parliamentarians?|cabinet|head\s+of\s+state|party\s+leaders?|diplomats?|ambassadors?|officials?)\b/i;

// Generic person words ("a woman", "two people") never match POLITICAL_ROLE_RE, so a
// scene about a real politician described without a role noun slipped past the guard
// entirely (see 2026-08-23 fix doc). Gated on POLITICAL_SCENE_RE co-occurrence rather
// than firing on any person mention, since the underlying failure — a generic prompt
// resolving to an overrepresented real face — is specific to public figures in
// political/campaign scenes, not to generic people in general.
const GENERIC_PERSON_RE = /\b(wom[ae]n|men|man|person|people|figures?|individuals?|candidates?)\b/i;

const POLITICAL_SCENE_RE =
  /\b(rally|rallies|campaign|elections?|primary|primaries|runoff|caucus|debate\s+stage|podium|polling|senate|congress|parliament|government|governor'?s\s+race|convention\s+center)\b/i;

// ASCII-only by construction: accented names/places (e.g. "Jürgen Müller", "Élysée")
// never match this sequence regex, so they're handled only via the "no 2-word
// capitalized sequence matched" fallback path (i.e. over-anonymized), not via the
// TITLE_STOPWORDS list below. A Unicode-aware rewrite is out of scope here.
const CAPITALIZED_SEQUENCE_RE = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g;

const TITLE_STOPWORDS = new Set([
  // titles / nationalities
  "prime", "minister", "president", "chancellor", "secretary", "state",
  "senator", "governor", "mayor", "premier", "cabinet", "parliament",
  "congress", "house", "representatives", "foreign", "interior", "defense",
  "finance", "justice", "the", "of", "german", "thai", "american", "british",
  "french", "russian", "chinese", "european",
  // places / institutions (added after spec review — otherwise e.g. "White House"
  // reads as a real name and the guard wrongly skips anonymization)
  "white", "street", "downing", "palace", "capitol", "hill", "commission",
  "reichstag", "bundestag", "kremlin", "building", "square",
  "avenue", "hall",
]);

function hasRealNameSequence(prompt: string): boolean {
  const matches = prompt.match(CAPITALIZED_SEQUENCE_RE) ?? [];
  return matches.some((seq) =>
    seq
      .toLowerCase()
      .split(/\s+/)
      .some((word) => !TITLE_STOPWORDS.has(word))
  );
}

const ANONYMIZATION_CLAUSE =
  " Any person shown should have generic, invented facial features — not resembling any real, named, or identifiable public figure, living or dead.";

export function guardAgainstRealPersonLikeness(prompt: string): string {
  const hasRoleKeyword = POLITICAL_ROLE_RE.test(prompt);
  const hasGenericPersonInPoliticalScene = GENERIC_PERSON_RE.test(prompt) && POLITICAL_SCENE_RE.test(prompt);
  if (!hasRoleKeyword && !hasGenericPersonInPoliticalScene) return prompt;
  if (hasRealNameSequence(prompt)) return prompt;
  return `${prompt}${ANONYMIZATION_CLAUSE}`;
}

// Before anonymizing a generic political-scene prompt, try to resolve the specific real
// person from the scene's voiceover so the model can attempt the correct likeness instead
// of either a generic invented face or (pre-fix) the wrong real face. Returns null — and
// the caller falls back to anonymization — whenever the voiceover names no one, names
// multiple plausible people, or the resolution call fails; ambiguity defaults to the safe
// direction (over-anonymize), same principle as the rest of this guard.
export async function resolveNamedPersonFromVoiceover(
  voiceover: string,
  genericPrompt: string,
): Promise<string | null> {
  try {
    const bedrock = createBedrockService();
    const systemPrompt =
      "You identify whether an image description refers to one specific, real, named person mentioned in an accompanying voiceover. " +
      "Respond with ONLY that person's full name, or the literal string NONE if: no real name is mentioned in the voiceover, " +
      "multiple people are plausible referents for the image description, or the image description refers to an unnamed " +
      "bystander, crowd, or ambiguous figure. Do not explain your answer.";
    const userMessage = `Voiceover: ${voiceover}\n\nImage description: ${genericPrompt}`;
    const { text } = await bedrock.converse(systemPrompt, userMessage);
    const name = text.trim();
    if (!name || name.toUpperCase() === "NONE") return null;
    return name;
  } catch {
    return null;
  }
}

export class ReelStage4Images implements ReelStage {
  name = "reel-stage4-images";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script — run reel-stage1-script first");

    const imageGen = buildImageProvider();
    const stockService = createStockImageService();
    const tmpDir = ctx.workDir!;
    fs.mkdirSync(tmpDir, { recursive: true });

    const imageSourceMap: Record<number, ImageSource> = {};

    const shuffledVariations = ctx.isImageRebuild
      ? [...REBUILD_VARIATIONS].sort(() => Math.random() - 0.5)
      : null;

    const sceneResults = await Promise.all(
      ctx.script.scenes.map(async (scene) => {
        const outPath = path.join(tmpDir, `scene${scene.sceneNumber}.png`);
        let prompt = scene.imagePrompt;
        if (shuffledVariations) {
          const variation = shuffledVariations[scene.sceneNumber % shuffledVariations.length];
          const tag = `v${Math.random().toString(36).slice(2, 6)}`;
          prompt = `${variation}${prompt} (${tag})`;
        }
        console.log(`  Scene ${scene.sceneNumber}: ${prompt.slice(0, 80)}...`);

        let buffer: Buffer;

        const stockResult = ctx.useStockImages !== false
          ? await stockService.tryStockImage(prompt, "portrait")
          : null;

        if (stockResult) {
          console.log(`    → stock image found (${stockResult.provider})`);
          buffer = stockResult.buffer;
          imageSourceMap[scene.sceneNumber] = { type: "stock", provider: stockResult.provider };
        } else {
          const genPrompt = guardAgainstRealPersonLikeness(prompt);
          let mainPrompt = genPrompt;
          if (genPrompt !== prompt) {
            // guard fired — try to resolve the real person from the voiceover and let the
            // model attempt the correct likeness instead of anonymizing
            const resolvedName = await resolveNamedPersonFromVoiceover(scene.voiceover, prompt);
            if (resolvedName) mainPrompt = `${resolvedName}, ${prompt}`;
          }
          try {
            const genResult = await imageGen.generate(mainPrompt, { aspectRatio: "9:16" });
            buffer = genResult.buffer;
            imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
          } catch (err) {
            const isSafetyBlock = err instanceof ImageSafetyError
              || (err instanceof Error && /moderation|safety/i.test(err.message));
            if (isSafetyBlock) {
              // Strip banned words from the original `prompt`, not `genPrompt` — if the
              // guard fired, `genPrompt` already has ANONYMIZATION_CLAUSE appended, and
              // stripping "person" from that clause text mangles it (double space, word
              // dropped). Re-append the clause afterward, only if the guard actually fired.
              const strippedPrompt = prompt.replace(/\b(child|kid|boy|girl|man|woman|person|people|minor|\d+-year-old)\b/gi, "").trim();
              const guardFired = genPrompt !== prompt;
              const safePrompt = `Cinematic news photo, no people visible: ${strippedPrompt}${guardFired ? ANONYMIZATION_CLAUSE : ""}. Dramatic lighting, photorealistic.`;
              console.log(`    ⚠️ Safety block — retrying with safe prompt`);
              const genResult = await imageGen.generate(safePrompt, { aspectRatio: "9:16" });
              buffer = genResult.buffer;
              imageSourceMap[scene.sceneNumber] = { type: "ai", model: genResult.model, provider: genResult.source };
            } else {
              throw err;
            }
          }
        }
        fs.writeFileSync(outPath, buffer);

        const probeResult = spawnSync("ffprobe", [
          "-v", "error", "-select_streams", "v:0",
          "-show_entries", "stream=width,height",
          "-of", "csv=p=0", outPath,
        ], { encoding: "utf8" });
        const [w, h] = (probeResult.stdout ?? "").trim().split(",").map(Number);
        if (w && h && w >= h) {
          console.log(`    ⚠️ Landscape detected (${w}x${h}) — cropping to portrait`);
          const targetW = Math.floor(h * 9 / 16);
          const x = Math.floor((w - targetW) / 2);
          const croppedPath = outPath.replace(".png", "_portrait.png");
          spawnSync("ffmpeg", [
            "-i", outPath,
            "-vf", `crop=${targetW}:${h}:${x}:0`,
            "-y", croppedPath,
          ]);
          fs.renameSync(croppedPath, outPath);
        }

        const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
        console.log(`    → ${outPath} (${kb} KB)`);
        return { sceneNumber: scene.sceneNumber, outPath };
      }),
    );

    const imagePaths = sceneResults
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map((r) => r.outPath);

    const anyAi = Object.values(imageSourceMap).find(s => s.type === "ai");
    const imagesProvider = anyAi && "provider" in anyAi ? anyAi.provider : undefined;

    return { imagePaths, imageSourceMap, apiSourceMap: { ...ctx.apiSourceMap, images: imagesProvider } };
  }
}
