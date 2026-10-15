import fs from "fs";
import {
  buildDirectorPrompt,
  buildSummary,
  validateDirection,
  mimeTypeForClip,
  GoogleStoryReelGeminiClient,
  type StoryReelDirectorDirection,
  type StoryReelGeminiClient,
} from "../storyreel/director-poc.js";
import { calculateGeminiFlashCostUsd } from "../storyreel/cost.js";

interface LocalStoryContext {
  storyId: string;
  telegramChatId: string;
  profile: {
    id: string;
    telegramChatId: string;
    profileName: string;
    audienceLanguage: string;
    audienceDescription: string;
    preferredVoiceId: string | null;
    preferredVoiceProvider: string | null;
    createdAt: string;
    updatedAt: string;
  };
  clips: Array<{
    path: string;
    sizeMb: number;
    durationSec: number;
    orientation: string;
    width: number;
    height: number;
  }>;
  userNote?: string;
  workDir: string;
  stageLogs: Array<{
    stage: string;
    status: string;
    durationMs: number;
    error?: string;
    meta?: Record<string, unknown>;
  }>;
  status: string;
}

interface StoryStage1DirectionDeps {
  updateStoryRun: (storyId: string, data: Record<string, unknown>) => Promise<void>;
  writeFileSync?: (path: string, data: string) => void;
  mkdirSync?: (path: string, options: { recursive: boolean }) => void;
  client?: StoryReelGeminiClient;
}

export class StoryStage1Direction {
  name = "story-stage1-direction";

  private readonly updateStoryRun: StoryStage1DirectionDeps["updateStoryRun"];
  private readonly writeFileSync: (path: string, data: string) => void;
  private readonly mkdirSync: (path: string, options: { recursive: boolean }) => void;
  private readonly client: StoryReelGeminiClient;

  constructor(deps: StoryStage1DirectionDeps) {
    this.updateStoryRun = deps.updateStoryRun;
    this.writeFileSync = deps.writeFileSync ?? fs.writeFileSync.bind(fs);
    this.mkdirSync = deps.mkdirSync ?? fs.mkdirSync.bind(fs);
    this.client = deps.client ?? new GoogleStoryReelGeminiClient();
  }

  async run(ctx: LocalStoryContext): Promise<{ direction: StoryReelDirectorDirection }> {
    const dirPath = `${ctx.workDir}/director`;
    this.mkdirSync(dirPath, { recursive: true });

    const prompt = buildDirectorPrompt({
      clipCount: ctx.clips.length,
      product: ctx.userNote?.trim() || "Personal story from uploaded clips",
      note: ctx.userNote ?? "",
      language: ctx.profile.audienceLanguage as "thai" | "english" | "german",
      profile: {
        audienceLanguage: ctx.profile.audienceLanguage,
        audienceDescription: ctx.profile.audienceDescription,
      },
      clipsMetadata: ctx.clips,
    });

    const uploadedParts: Array<{ uri: string; mimeType: string }> = [];
    for (const clip of ctx.clips) {
      const part = await this.client.uploadFile(clip.path, mimeTypeForClip(clip.path));
      uploadedParts.push(part);
    }

    const maxAttempts = 2;
    let lastDirection: StoryReelDirectorDirection | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.client.generateDirection(uploadedParts, prompt);
      const raw = result.text;
      inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;

      this.writeFileSync(`${dirPath}/raw-direction.json`, raw);

      let parsed: StoryReelDirectorDirection;
      try {
        const stripped = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
        parsed = JSON.parse(stripped) as StoryReelDirectorDirection;
      } catch {
        if (attempt === maxAttempts - 1) {
          throw new Error("DIRECTION_VALIDATION_FAILED: failed to parse JSON");
        }
        continue;
      }

      const errors = validateDirection(parsed, ctx.clips.length);
      if (errors.length === 0) {
        lastDirection = parsed;
        break;
      }

      if (attempt === maxAttempts - 1) {
        throw new Error(`DIRECTION_VALIDATION_FAILED: ${errors.join(", ")}`);
      }
    }

    if (!lastDirection) {
      throw new Error("DIRECTION_VALIDATION_FAILED: no valid direction produced");
    }

    this.writeFileSync(`${dirPath}/direction.json`, JSON.stringify(lastDirection, null, 2));

    const clipPaths = ctx.clips.map((c) => c.path);
    const summary = buildSummary(lastDirection, clipPaths);
    this.writeFileSync(`${dirPath}/summary.txt`, summary);

    const costUsd = calculateGeminiFlashCostUsd(inputTokens, outputTokens);
    await this.updateStoryRun(ctx.storyId, {
      geminiInputTokens: inputTokens,
      geminiOutputTokens: outputTokens,
      geminiCostUsd: costUsd,
    });

    return { direction: lastDirection };
  }
}
