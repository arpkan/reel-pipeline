import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import type { ReelContext, ReelStage, WordTiming } from "../types.js";
import type { VoiceEntry, VoiceProvider } from "../services/voice-provider.js";
import { createElevenLabsService } from "../services/elevenlabs.js";
import { createUVoiceService } from "../services/uvoice.js";
import { createMinimaxService } from "../services/minimax.js";
import { createBotnoiService } from "../services/botnoi.js";

const DEFAULT_ATEMPO = 1.2;

function numberToThai(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 0) return "ศูนย์";
  if (n >= 1000000) {
    const millions = Math.floor(n / 1000000);
    const remainder = n % 1000000;
    const millionStr = numberToThai(millions) + "ล้าน";
    return remainder === 0 ? millionStr : millionStr + numberToThai(remainder);
  }
  const ones = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  let result = "";
  let remaining = n;
  for (const { value, word } of [
    { value: 100000, word: "แสน" },
    { value: 10000,  word: "หมื่น" },
    { value: 1000,   word: "พัน" },
    { value: 100,    word: "ร้อย" },
  ]) {
    if (remaining >= value) {
      result += ones[Math.floor(remaining / value)] + word;
      remaining %= value;
    }
  }
  if (remaining >= 10) {
    const tens = Math.floor(remaining / 10);
    result += tens === 1 ? "สิบ" : tens === 2 ? "ยี่สิบ" : ones[tens] + "สิบ";
    remaining %= 10;
  }
  if (remaining > 0) {
    result += remaining === 1 && result.length > 0 ? "เอ็ด" : ones[remaining];
  }
  return result;
}

export function normalizeVoiceoverForTts(text: string, languageCode: string): string {
  if (languageCode === "th") {
    return text.replace(/\d{1,3}(?:,\d{3})+/g, (match) => {
      const num = parseInt(match.replace(/,/g, ""), 10);
      return isNaN(num) ? match : numberToThai(num);
    });
  }

  if (languageCode !== "en") return text;

  return text
    .replace(/\s*[—–]\s*/gu, ", ")
    .replace(/\$(\d+)\.(\d+)\s+(million|billion|trillion)\b/giu, (_match, dollars: string, cents: string, scale: string) => {
      return `${dollars} point ${cents} ${scale.toLowerCase()} dollars`;
    })
    .replace(/\b(\d{1,2})-year-old\b/giu, (_match, age: string) => {
      return `${numberToEnglishUnder100(Number(age))} year old`;
    })
    .replace(/\bunder-(\d{1,2})s\b/giu, (_match, age: string) => {
      const words = numberToEnglishUnder100(Number(age));
      if (words === age) return _match;
      return `under ${words}s`;
    })
    .replace(/\b(\d+)-([a-z]+)\b/giu, (_match, num: string, unit: string) => {
      const words = numberToEnglishUnder100(Number(num));
      if (words === num) return _match;
      return `${words}-${unit}`;
    });
}

export function alignWordTimingsToScript(whisperTimings: WordTiming[], scriptText: string, languageCode: string): WordTiming[] {
  if (languageCode !== "en" || whisperTimings.length === 0) return whisperTimings;
  const scriptWords = tokenizeScriptWords(normalizeVoiceoverForTts(scriptText, languageCode));
  if (scriptWords.length === 0) return whisperTimings;

  if (scriptWords.length === whisperTimings.length) {
    return whisperTimings.map((timing, index) => ({ ...timing, word: scriptWords[index] }));
  }

  if (scriptWords.length === whisperTimings.length - 1) {
    const merged = tryMergeOneExtraWhisperToken(whisperTimings, scriptWords);
    if (merged) return merged;
  }

  const diff = Math.abs(scriptWords.length - whisperTimings.length);
  const maxDiff = Math.max(5, Math.floor(scriptWords.length * 0.25));
  if (diff <= maxDiff) {
    return alignWithSequenceMatching(whisperTimings, scriptWords);
  }

  return whisperTimings;
}

function alignWithSequenceMatching(ttsTimings: WordTiming[], scriptWords: string[]): WordTiming[] {
  const m = scriptWords.length;
  const n = ttsTimings.length;

  // DP: dp[i][j] = min cost to align scriptWords[0..i-1] with ttsTimings[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(1e9));
  dp[0][0] = 0;
  for (let j = 1; j <= n; j++) dp[0][j] = dp[0][j - 1] + 0.5;  // absorb extra TTS tokens
  for (let i = 1; i <= m; i++) dp[i][0] = dp[i - 1][0] + 2;    // script word with no TTS match

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const subCost = normalizeTokenForCompare(scriptWords[i - 1]) === normalizeTokenForCompare(ttsTimings[j - 1].word) ? 0 : 0.5;
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + subCost,  // align script[i-1] with tts[j-1]
        dp[i][j - 1] + 0.5,          // extra TTS token: merge into current script word
        dp[i - 1][j] + 2,            // script word with no TTS match: interpolate
      );
    }
  }

  // Traceback — prefer tts_skip on ties so extra TTS tokens land after their matched script word
  type Op =
    | { type: "match"; si: number; ti: number }
    | { type: "tts_extra"; ti: number }
    | { type: "script_extra"; si: number };
  const ops: Op[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i === 0) {
      ops.push({ type: "tts_extra", ti: j - 1 });
      j--;
    } else if (j === 0) {
      ops.push({ type: "script_extra", si: i - 1 });
      i--;
    } else {
      const subCost = normalizeTokenForCompare(scriptWords[i - 1]) === normalizeTokenForCompare(ttsTimings[j - 1].word) ? 0 : 0.5;
      const fromSub      = dp[i - 1][j - 1] + subCost;
      const fromTtsSkip  = dp[i][j - 1] + 0.5;
      const fromScriptSkip = dp[i - 1][j] + 2;
      if (fromTtsSkip <= fromSub && fromTtsSkip <= fromScriptSkip) {
        ops.push({ type: "tts_extra", ti: j - 1 });
        j--;
      } else if (fromSub <= fromScriptSkip) {
        ops.push({ type: "match", si: i - 1, ti: j - 1 });
        i--; j--;
      } else {
        ops.push({ type: "script_extra", si: i - 1 });
        i--;
      }
    }
  }
  ops.reverse();

  // Group TTS tokens by script word
  const groups: Array<{ scriptIdx: number; ttiList: number[] }> =
    scriptWords.map((_, idx) => ({ scriptIdx: idx, ttiList: [] }));
  let pending: number[] = [];
  for (const op of ops) {
    if (op.type === "tts_extra") {
      pending.push(op.ti);
    } else if (op.type === "match") {
      groups[op.si].ttiList.push(...pending, op.ti);
      pending = [];
    } else {
      groups[op.si].ttiList.push(...pending);
      pending = [];
    }
  }
  if (pending.length > 0) groups[groups.length - 1].ttiList.push(...pending);

  // Build WordTiming[] — interpolate for script words with no TTS match
  const totalStart = ttsTimings[0].start;
  const avgDur = (ttsTimings[n - 1].end - totalStart) / m;
  const result: WordTiming[] = [];
  for (const { scriptIdx, ttiList } of groups) {
    const word = scriptWords[scriptIdx];
    if (ttiList.length > 0) {
      result.push({
        word,
        start: Math.min(...ttiList.map((ti) => ttsTimings[ti].start)),
        end:   Math.max(...ttiList.map((ti) => ttsTimings[ti].end)),
      });
    } else {
      const prevEnd = result.length > 0 ? result[result.length - 1].end : totalStart;
      result.push({ word, start: prevEnd, end: prevEnd + avgDur });
    }
  }
  return result;
}

function tokenizeScriptWords(text: string): string[] {
  return text
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter(Boolean);
}

function normalizeTokenForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/giu, "");
}

function tryMergeOneExtraWhisperToken(whisperTimings: WordTiming[], scriptWords: string[]): WordTiming[] | null {
  for (let i = 0; i < scriptWords.length; i++) {
    const before = scriptWords.slice(0, i).every((word, index) => normalizeTokenForCompare(word) === normalizeTokenForCompare(whisperTimings[index].word));
    const after = scriptWords.slice(i + 1).every((word, offset) => {
      const scriptIndex = i + 1 + offset;
      const whisperIndex = scriptIndex + 1;
      return normalizeTokenForCompare(word) === normalizeTokenForCompare(whisperTimings[whisperIndex].word);
    });
    if (!before || !after) continue;

    return [
      ...whisperTimings.slice(0, i).map((timing, index) => ({ ...timing, word: scriptWords[index] })),
      { ...whisperTimings[i], word: scriptWords[i], end: whisperTimings[i + 1].end },
      ...whisperTimings.slice(i + 2).map((timing, offset) => ({ ...timing, word: scriptWords[i + 1 + offset] })),
    ];
  }

  return null;
}

function numberToEnglishUnder100(value: number): string {
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (!Number.isInteger(value) || value < 0 || value >= 100) return String(value);
  if (value < 20) return small[value];
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  return unit === 0 ? tens[ten] : `${tens[ten]} ${small[unit]}`;
}

function buildVoicePool(ctx: ReelContext): VoiceEntry[] {
  const reels = ctx.brand.reels;
  if (!reels) throw new Error("brand.reels is not configured");

  // New explicit provider-tagged pool
  if (reels.voices && reels.voices.length > 0) return reels.voices;

  // Legacy fallback: voiceIds / voiceId — all treated as elevenlabs
  const ids = reels.voiceIds ?? (reels.voiceId ? [reels.voiceId] : []);
  if (ids.length === 0) throw new Error("brand.reels.voiceId is not configured");
  return ids.map((id) => ({
    id,
    provider: "elevenlabs" as const,
    speed: reels.voiceSpeeds?.[id],
  }));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createProvider(entry: VoiceEntry): VoiceProvider {
  if (entry.provider === "uvoice") return createUVoiceService();
  if (entry.provider === "minimax") return createMinimaxService();
  if (entry.provider === "botnoi") return createBotnoiService();
  return createElevenLabsService();
}

function fallbackVoices(pool: VoiceEntry[], usedEntry: VoiceEntry): VoiceEntry[] {
  return pool.filter((v) => v.provider !== usedEntry.provider);
}

export class ReelStage3Voice implements ReelStage {
  name = "reel-stage3-voice";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    if (!ctx.script) throw new Error("No script — run reel-stage2-script first");

    const pool = buildVoicePool(ctx);
    const LANGUAGE_CODE_MAP: Record<string, string> = { th: "th", de: "de", en: "en" };
    const languageCode = LANGUAGE_CODE_MAP[ctx.brand.language] ?? "en";
    const tmpDir = ctx.workDir!;
    fs.mkdirSync(tmpDir, { recursive: true });

    const audioPaths: string[] = [];
    let lastVoiceId: string | undefined;
    let lastVoiceProvider: string | undefined;
    let lastVoiceSpeed: number | undefined;

    let entry: VoiceEntry;
    if (ctx.voiceId) {
      const fullPool = ctx.brand.reels?.voicesFull ?? pool;
      const voiceEntry = fullPool.find((v) => v.id === ctx.voiceId);
      if (!voiceEntry) throw new Error(`Voice "${ctx.voiceId}" not found in brand voice pool. Available: ${fullPool.map((v) => v.id).join(", ")}`);
      entry = voiceEntry;
    } else {
      entry = pickRandom(pool);
    }

    // generateWithEntry attempts all scenes using a single voice entry.
    // If any scene fails and triedProviders still has candidates, it cleans up
    // already-written files and retries ALL scenes from scratch with a fallback
    // entry — ensuring every scene in the final video uses the same provider.
    const generateWithEntry = async (
      currentEntry: VoiceEntry,
      triedProviders: Set<string>,
    ): Promise<void> => {
      const generatedPaths: string[] = [];

      for (const scene of ctx.script!.scenes) {
        const normalizedVoiceover = normalizeVoiceoverForTts(scene.voiceover, languageCode);
        if (normalizedVoiceover !== scene.voiceover) scene.voiceover = normalizedVoiceover;

        const outPath = path.join(tmpDir, `scene${scene.sceneNumber}.mp3`);
        console.log(`  Scene ${scene.sceneNumber}: "${scene.voiceover.slice(0, 60)}..."`);
        console.log(`  Voice: ${currentEntry.id} (provider: ${currentEntry.provider}, lang: ${languageCode})`);
        ctx.progressNote = `scene ${scene.sceneNumber}: ${currentEntry.provider}/${currentEntry.id}`;

        let audio: Buffer;
        let wordTimings: { word: string; start: number; end: number }[];

        try {
          ({ audio, wordTimings } = await createProvider(currentEntry).textToSpeechWithTimestamps(
            scene.voiceover, currentEntry.id, languageCode,
          ));
        } catch (err) {
          if (ctx.voiceId) throw err;

          // Clean up any files written in this attempt before restarting
          for (const p of generatedPaths) { try { fs.unlinkSync(p); } catch { /* ignore */ } }

          const candidates = fallbackVoices(pool, currentEntry)
            .filter((v) => !triedProviders.has(v.provider))
            .sort(() => Math.random() - 0.5);

          const deduped: VoiceEntry[] = [];
          const seen = new Set<string>();
          for (const v of candidates) {
            if (!seen.has(v.provider)) { seen.add(v.provider); deduped.push(v); }
          }

          if (deduped.length === 0) {
            throw new Error(`Voice synthesis failed on all providers (tried: ${[...triedProviders].join(", ")}). Last error: ${err}`);
          }

          const nextEntry = deduped[0];
          console.warn(`    ⚠️ ${currentEntry.provider} failed — restarting all scenes with ${nextEntry.provider}/${nextEntry.id}`);
          triedProviders.add(currentEntry.provider);
          return generateWithEntry(nextEntry, triedProviders);
        }

        const atempo = ctx.voiceSpeed ?? currentEntry.speed ?? ctx.brand.reels?.voiceSpeed ?? DEFAULT_ATEMPO;
        const gain = currentEntry.gain ?? 1.0;

        fs.writeFileSync(outPath, audio);

        const fastPath = outPath.replace(".mp3", "_fast.mp3");
        const atempoResult = spawnSync("ffmpeg", [
          "-y", "-i", outPath, "-filter:a", `atempo=${atempo},volume=${gain}`, fastPath,
        ], { stdio: "pipe" });
        const atempoApplied = atempoResult.status === 0;
        if (atempoApplied) {
          fs.renameSync(fastPath, outPath);
        } else {
          console.warn(`    ⚠️ atempo failed, using original speed`);
        }

        const alignedTimings = alignWordTimingsToScript(wordTimings, scene.voiceover, languageCode);
        const timingScale = atempoApplied ? atempo : 1;
        scene.wordTimings = alignedTimings.map((wt) => ({
          word: wt.word,
          start: wt.start / timingScale,
          end: wt.end / timingScale,
        }));

        try {
          const dur = execSync(
            `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outPath}"`,
            { encoding: "utf8" },
          ).trim();
          scene.durationSeconds = parseFloat(dur);
          console.log(`    → ${scene.durationSeconds.toFixed(2)}s, ${wordTimings.length} words`);
        } catch {
          scene.durationSeconds = 8;
        }

        generatedPaths.push(outPath);
        audioPaths.push(outPath);
        lastVoiceId = currentEntry.id;
        lastVoiceProvider = currentEntry.provider;
        lastVoiceSpeed = atempo;
      }
    };

    await generateWithEntry(entry, new Set([]));

    return { audioPaths, usedVoiceId: lastVoiceId, usedVoiceProvider: lastVoiceProvider, usedVoiceSpeed: lastVoiceSpeed };
  }
}
