import { pathToFileURL } from "node:url";
import type { ReelContext, ReelScene, WordTiming, HyperframesCameraPreset } from "../../types.js";
import { splitIntoBlocks } from "../reel-subtitle-blocks.js";
import { buildSceneMotion } from "../../effects/hyperframes-presets.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const HOOK_DURATION_SECONDS = 2;
const LAST_SCENE_TAIL_PADDING_SECONDS = 0.6;
const DEFAULT_SCENE_AUDIO_DURATION_SECONDS = 8;

const MOTION_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

interface BuildEnhancedDefaultHyperframesHtmlOptions {
  ctx: ReelContext;
  cameraPreset?: HyperframesCameraPreset;
  musicPath?: string;
  assetSrc?: (filePath: string) => string;
  watermarkPath?: string;
  preMixedAudioPath?: string;
}

interface TimedScene {
  scene: ReelScene;
  index: number;
  start: number;
  duration: number;
  audioStart: number;
  audioDuration: number;
  imagePath: string;
  audioPath: string;
}

export function getEnhancedDefaultDuration(ctx: ReelContext): number {
  const scenes = validateScenes(ctx);
  return roundSeconds(scenes.reduce((total, scene, index) => total + getSceneDuration(scene, index === scenes.length - 1), 0));
}

export function buildEnhancedDefaultHyperframesHtml({ ctx, cameraPreset, musicPath, assetSrc, watermarkPath, preMixedAudioPath }: BuildEnhancedDefaultHyperframesHtmlOptions): string {
  const timedScenes = buildTimedScenes(ctx);
  const preset = cameraPreset ?? "locked_frame";
  const sceneMotionStyles = timedScenes.length > 0 && preset !== "locked_frame"
    ? timedScenes.map(({ index }, i) => {
        const motion = buildSceneMotion(preset, i, timedScenes.length);
        return `@keyframes scene-motion-${index + 1} { from { transform: translate3d(${motion.translateXStart}, ${motion.translateYStart}, 0) scale(${motion.scaleStart}); } to { transform: translate3d(${motion.translateXEnd}, ${motion.translateYEnd}, 0) scale(${motion.scaleEnd}); } }`;
      }).join("\n      ")
    : "";
  const totalDuration = getEnhancedDefaultDuration(ctx);
  const resolveAssetSrc = (filePath: string) => assetSrc?.(filePath) ?? toAssetUrl(filePath);
  const fontFamily = ctx.brand.language === "th"
    ? "'Noto Sans Thai', 'Noto Sans', Arial, 'Noto Color Emoji', sans-serif"
    : "Inter, Arial, 'Noto Color Emoji', sans-serif";
  const lineHeight = ctx.brand.language === "th" ? "1.5" : "1.15";
  const title = ctx.script?.title ?? "";
  const musicVolume = ctx.brand.reels?.musicVolume ?? 0.13;

  const sceneClips = timedScenes.map(({ index, start, duration, imagePath }) => `
      <section class="clip scene scene-${index + 1}" data-start="${start}" data-duration="${duration}" data-track-index="0">
        ${preset !== "locked_frame" ? `<div class="scene-image-wrapper"><img class="scene-image" src="${escapeAttr(resolveAssetSrc(imagePath))}" alt="" style="animation: scene-motion-${index + 1} ${duration}s ${MOTION_EASE} ${start}s both;" /></div>` : `<img class="scene-image" src="${escapeAttr(resolveAssetSrc(imagePath))}" alt="" />`}
        <div class="scrim"></div>
      </section>`).join("");

  const hookClips = timedScenes.map(({ scene, index, start }) => `
      <div class="clip hook-copy hook-${index + 1}" data-start="${start}" data-duration="${Math.min(HOOK_DURATION_SECONDS, getSceneDuration(scene, index === timedScenes.length - 1))}" data-track-index="3">
        <span class="hook-accent"></span>
        <span class="hook-text">${escapeHtml(scene.caption)}</span>
      </div>`).join("");

  const voiceClips = preMixedAudioPath
    ? ""
    : timedScenes.map(({ index, audioStart, audioDuration, audioPath }) => `
      <audio id="voice-${index + 1}" class="clip voice voice-${index + 1}" data-start="${audioStart}" data-end="${roundSeconds(audioStart + audioDuration)}" data-duration="${audioDuration}" data-track-index="1" src="${escapeAttr(resolveAssetSrc(audioPath))}"></audio>`).join("");

  const subtitleClips = timedScenes.map((timedScene) => buildSubtitleLayer(timedScene, totalDuration)).join("");

  const watermarkClip = watermarkPath ? `
      <div class="clip watermark-layer" data-start="0" data-duration="${totalDuration}" data-track-index="6">
        <img class="watermark-logo" src="${escapeAttr(watermarkPath)}" alt="${escapeAttr(ctx.brand.name)}" />
      </div>` : "";

  const aiBadgeClips = timedScenes
    .filter(({ scene }) => ctx.imageSourceMap?.[scene.sceneNumber]?.type === "ai")
    .map(({ start, duration }) =>
      `\n      <div class="clip ai-badge-layer" data-start="${start}" data-duration="${duration}" data-track-index="7">✨ AI</div>`)
    .join("");

  const musicClip = preMixedAudioPath
    ? ""
    : musicPath
      ? `
      <audio id="music" class="clip music" data-start="0" data-end="${totalDuration}" data-duration="${totalDuration}" data-volume="${musicVolume}" data-track-index="2" src="${escapeAttr(resolveAssetSrc(musicPath))}"></audio>`
      : "";

  const preMixedClip = preMixedAudioPath
    ? `
      <audio id="audio-mixed" class="clip audio-mixed" data-start="0" data-end="${totalDuration}" data-duration="${totalDuration}" data-track-index="1" src="${escapeAttr(resolveAssetSrc(preMixedAudioPath))}"></audio>`
    : "";

  return `<!doctype html>
<html lang="${escapeAttr(ctx.brand.language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ${fontFamily};
        line-height: ${lineHeight};
      }
      body {
        margin: 0;
        background: #05070d;
      }
      .composition {
        position: relative;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        overflow: hidden;
        background: #05070d;
      }
      .clip {
        position: absolute;
        inset: 0;
      }
      .scene-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .scene-image-wrapper {
        position: absolute;
        inset: -6%;
        overflow: visible;
      }
      .scene-image-wrapper .scene-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(5, 7, 13, 0.1), rgba(5, 7, 13, 0.84));
      }
      .hook-copy {
        position: absolute;
        inset: auto;
        left: 72px;
        right: 120px;
        top: 360px;
        display: flex;
        align-items: stretch;
        gap: 24px;
        pointer-events: none;
        filter: drop-shadow(0 8px 28px rgba(0, 0, 0, 0.7));
        animation: hook-enter 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .hook-accent {
        display: block;
        width: 6px;
        min-height: 100%;
        border-radius: 999px;
        background: #b01934;
        box-shadow: 0 0 28px rgba(176, 25, 52, 0.55);
      }
      .hook-text {
        margin: 0;
        color: #fff;
        font-size: 64px;
        font-weight: 900;
        line-height: 1.1;
        letter-spacing: -0.03em;
        text-wrap: balance;
      }
      .watermark-layer {
        position: absolute;
        inset: auto;
        left: 68px;
        top: 68px;
        right: auto;
        bottom: auto;
        pointer-events: none;
      }
      .watermark-logo {
        display: block;
        width: 256px;
        height: auto;
        aspect-ratio: 1 / 1;
        object-fit: contain;
        opacity: 0.78;
        filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.48));
      }
      ${aiBadgeClips ? `.ai-badge-layer {
        position: absolute;
        inset: auto;
        left: 68px;
        top: 270px;
        right: auto;
        bottom: auto;
        font-size: 36px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.65);
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
        letter-spacing: 0.04em;
        pointer-events: none;
        line-height: 1;
      }` : ""}
      audio.clip {
        display: none;
      }
      .subtitle-layer {
        position: absolute;
        inset: auto;
        left: 72px;
        right: 72px;
        bottom: 280px;
        pointer-events: none;
      }
      .subtitle-phrase {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: center;
        gap: 8px 12px;
        padding: 14px 20px;
        border-radius: 18px;
        background: rgba(0, 0, 0, 0.5);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.38);
      }
      .subtitle-word {
        display: inline-block;
        color: rgba(255, 255, 255, 0.74);
        font-size: 48px;
        font-weight: 900;
        line-height: ${lineHeight};
        text-shadow: 0 5px 18px rgba(0, 0, 0, 0.62);
      }
      .subtitle-word.active-word {
        color: #ffd24a;
        text-shadow: 0 0 18px rgba(255, 210, 74, 0.68), 0 5px 18px rgba(0, 0, 0, 0.62);
      }
      @keyframes hook-enter {
        from {
          opacity: 0;
          transform: translate3d(-60px, 0, 0);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }
      ${sceneMotionStyles}
    </style>
  </head>
  <body>
    <main class="composition" data-composition-id="${escapeAttr(ctx.runId)}" data-width="${WIDTH}" data-height="${HEIGHT}" data-duration="${totalDuration}">${sceneClips}${hookClips}${voiceClips}${subtitleClips}${musicClip}${preMixedClip}${watermarkClip}${aiBadgeClips}
    </main>
    <script>
      window.gsap = window.gsap || {
        timeline: function () {
          var currentTime = 0;
          var maxDuration = 0;
          function asNumber(value, fallback) {
            return typeof value === "number" && isFinite(value) ? value : fallback;
          }
          function positionValue(position) {
            return asNumber(position, currentTime);
          }
          function remember(position, duration) {
            var end = positionValue(position) + asNumber(duration, 0);
            if (end > maxDuration) maxDuration = end;
          }
          return {
            to(target, vars, position) {
              remember(position, vars && vars.duration);
              return this;
            },
            set(target, vars, position) {
              remember(position, 0);
              return this;
            },
            fromTo(target, fromVars, toVars, position) {
              remember(position, toVars && toVars.duration);
              return this;
            },
            seek(value) {
              currentTime = asNumber(value, currentTime);
              return this;
            },
            time(value) {
              if (arguments.length === 0) return currentTime;
              currentTime = asNumber(value, currentTime);
              return this;
            },
            progress(value) {
              if (arguments.length === 0) return maxDuration > 0 ? currentTime / maxDuration : 0;
              currentTime = maxDuration * asNumber(value, 0);
              return this;
            },
            pause() { return this; },
            play() { return this; },
            eventCallback() { return this; },
            duration() { return maxDuration; },
            totalDuration() { return maxDuration; }
          };
        },
        set: function () {}
      };
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.set({}, {}, ${totalDuration});
      window.__timelines[${toScriptJsonString(ctx.runId)}] = tl;
    </script>
  </body>
</html>`;
}

function buildSubtitleLayer(timedScene: TimedScene, totalDuration: number): string {
  const phrases = splitIntoBlocks(timedScene.scene.wordTimings ?? [])
    .map((block) => buildSubtitlePhrase(timedScene, totalDuration, block))
    .filter((phrase): phrase is string => phrase !== null)
    .join("");

  if (!phrases) {
    return "";
  }

  return phrases;
}

function buildSubtitlePhrase(timedScene: TimedScene, totalDuration: number, block: WordTiming[]): string | null {
  const timedWords = block
    .map((wordTiming) => buildTimedWord(timedScene, totalDuration, wordTiming))
    .filter((word): word is TimedWord => word !== null);
  if (timedWords.length === 0) return null;

  const timedPhrases = timedWords
    .map((activeWord, activeIndex) => {
      const nextWord = timedWords[activeIndex + 1];
      const displayEnd = nextWord ? nextWord.start : activeWord.end;
      const duration = roundSeconds(Math.max(0.08, displayEnd - activeWord.start));
      return `<div class="clip subtitle-layer" data-start="${activeWord.start}" data-duration="${duration}" data-track-index="4"><div class="subtitle-phrase">${timedWords.map((word, wordIndex) => `<span class="subtitle-word${wordIndex === activeIndex ? " active-word" : ""}">${escapeHtml(word.text)}</span>`).join("")}</div>
        </div>`;
    })
    .join("");

  return timedPhrases;
}

interface TimedWord {
  text: string;
  start: number;
  end: number;
  duration: number;
}

function buildTimedWord(timedScene: TimedScene, totalDuration: number, wordTiming: WordTiming): TimedWord | null {
  if (!Number.isFinite(wordTiming.start) || !Number.isFinite(wordTiming.end) || wordTiming.end <= wordTiming.start) {
    return null;
  }
  if (wordTiming.start >= timedScene.audioDuration) {
    return null;
  }

  const rawStart = timedScene.audioStart + wordTiming.start;
  const rawEnd = timedScene.audioStart + wordTiming.end;
  const start = roundSeconds(Math.max(timedScene.audioStart, rawStart));
  const endBound = Math.min(
    timedScene.audioStart + timedScene.audioDuration,
    timedScene.start + timedScene.duration,
    totalDuration,
  );
  const end = roundSeconds(Math.min(endBound, rawEnd));

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  let duration = roundSeconds(end - start);
  if (duration <= 0) {
    return null;
  }
  if (duration < 0.08) {
    if (roundSeconds(endBound - start) < 0.08) {
      return null;
    }
    duration = 0.08;
  }

  return { text: wordTiming.word, start, end: roundSeconds(start + duration), duration };
}

export interface SceneTiming {
  start: number;
  audioStart: number;
  audioDuration: number;
  duration: number;
}

export function calculateSceneTimings(scenes: ReelScene[]): SceneTiming[] {
  let start = 0;
  return scenes.map((scene, index) => {
    const audioDuration = getAudioDuration(scene);
    const duration = getSceneDuration(scene, index === scenes.length - 1);
    const result: SceneTiming = {
      start: roundSeconds(start),
      audioStart: roundSeconds(start + HOOK_DURATION_SECONDS),
      audioDuration,
      duration,
    };
    start = roundSeconds(start + duration);
    return result;
  });
}

function buildTimedScenes(ctx: ReelContext): TimedScene[] {
  const scenes = validateScenes(ctx);
  const imagePaths = validatePaths(ctx.imagePaths, scenes.length, "imagePaths");
  const audioPaths = validatePaths(ctx.audioPaths, scenes.length, "audioPaths");
  const timings = calculateSceneTimings(scenes);

  return scenes.map((scene, index) => {
    const assetIndex = getSceneAssetIndex(scene);
    const imagePath = imagePaths[assetIndex];
    const audioPath = audioPaths[assetIndex];

    if (!imagePath) {
      throw new Error(`Missing image for scene ${scene.sceneNumber}`);
    }
    if (!audioPath) {
      throw new Error(`Missing audio for scene ${scene.sceneNumber}`);
    }

    return {
      scene,
      index,
      ...timings[index],
      imagePath,
      audioPath,
    };
  });
}

function validateScenes(ctx: ReelContext): ReelScene[] {
  if (!ctx.script?.scenes?.length) {
    throw new Error("Enhanced default Hyperframes template requires ctx.script.scenes");
  }
  const seenSceneNumbers = new Set<number>();
  for (const [index, scene] of ctx.script.scenes.entries()) {
    const sceneNumber = scene.sceneNumber;
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      throw new Error(`Invalid scene number: ${sceneNumber}`);
    }
    if (seenSceneNumbers.has(sceneNumber)) {
      throw new Error(`Duplicate scene number: ${sceneNumber}`);
    }
    seenSceneNumbers.add(sceneNumber);
    if (sceneNumber !== index + 1) {
      throw new Error("Scene numbers must be ordered from 1 to N");
    }
  }
  return ctx.script.scenes;
}

function validatePaths(paths: string[] | undefined, sceneCount: number, label: "imagePaths" | "audioPaths"): string[] {
  if (!paths || paths.length < sceneCount) {
    throw new Error(`Enhanced default Hyperframes template requires ${label} for every scene`);
  }
  return paths;
}

function getSceneDuration(scene: ReelScene, isLastScene: boolean): number {
  return roundSeconds(HOOK_DURATION_SECONDS + getAudioDuration(scene) + (isLastScene ? LAST_SCENE_TAIL_PADDING_SECONDS : 0));
}

function getAudioDuration(scene: ReelScene): number {
  if (scene.durationSeconds === undefined) {
    return DEFAULT_SCENE_AUDIO_DURATION_SECONDS;
  }
  if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds <= 0) {
    throw new Error(`Invalid duration for scene ${scene.sceneNumber}`);
  }
  return roundSeconds(scene.durationSeconds);
}

function getSceneAssetIndex(scene: ReelScene): number {
  if (!Number.isInteger(scene.sceneNumber) || scene.sceneNumber < 1) {
    throw new Error(`Invalid scene number: ${scene.sceneNumber}`);
  }
  return scene.sceneNumber - 1;
}

function toAssetUrl(value: string): string {
  if (/^(?:https?:|file:|data:|blob:)/u.test(value)) {
    return value;
  }
  return pathToFileURL(value).href;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function toScriptJsonString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}
