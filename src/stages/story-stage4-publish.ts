import { execSync } from "child_process";
import fs from "fs";
import path from "path";

interface StoryPublishContext {
  storyId: string;
  telegramChatId: string;
  profile: Record<string, unknown>;
  clips: unknown[];
  videoPath?: string;
  videoGcsUrl?: string;
  musicAttribution?: string;
  workDir: string;
  stageLogs: Array<{ stage: string; status: string; durationMs: number }>;
  status: string;
}

interface StoryPublishResult {
  videoGcsUrl: string;
}

interface StoryStage4PublishDeps {
  extractThumbnail?: (videoPath: string, outputPath: string) => string;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string) => Buffer;
  gcs: {
    uploadVideo: (...args: unknown[]) => Promise<string>;
    uploadFile: (...args: unknown[]) => Promise<string>;
  };
  telegram: {
    sendPhoto: (chatId: string, buffer: Buffer, caption: string) => Promise<void>;
    sendPhotoWithButtons?: (
      chatId: string,
      buffer: Buffer,
      caption: string,
      buttons: Array<Array<{ text: string; url: string }>>,
    ) => Promise<void>;
  };
  updateStoryRun: (storyId: string, data: Record<string, unknown>) => Promise<void>;
  baseUrl: string;
}

function defaultExtractThumbnail(videoPath: string, outputPath: string): string {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  execSync(`ffmpeg -ss 00:00:03 -i "${videoPath}" -frames:v 1 "${outputPath}" -y`, {
    timeout: 15_000,
    stdio: "pipe",
  });
  return outputPath;
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function joinUrl(baseUrl: string, pathPart: string): string {
  return `${baseUrl.replace(/\/$/, "")}${pathPart}`;
}

export class StoryStage4Publish {
  name = "story-stage4-publish";

  private deps: StoryStage4PublishDeps;

  constructor(deps: StoryStage4PublishDeps) {
    this.deps = deps;
  }

  async run(ctx: StoryPublishContext): Promise<StoryPublishResult> {
    const {
      extractThumbnail = defaultExtractThumbnail,
      existsSync = fs.existsSync,
      readFileSync = (p: string) => fs.readFileSync(p),
      gcs,
      telegram,
      updateStoryRun,
    } = this.deps;

    const thumbnailPath = path.join(ctx.workDir, "rough-cut", "thumbnail.jpg");
    let videoGcsUrl: string;
    let videoBuffer: Buffer | undefined;

    if (ctx.videoGcsUrl) {
      videoGcsUrl = ctx.videoGcsUrl;
      if (existsSync(thumbnailPath)) {
        const thumbBuffer = readFileSync(thumbnailPath);
        await gcs.uploadFile("storyreel", ctx.storyId, "thumbnail.jpg", thumbBuffer, "image/jpeg");
      } else {
        const fallbackVideo = path.join(ctx.workDir, "rough-cut", "rough-cut-with-audio.mp4");
        extractThumbnail(fallbackVideo, thumbnailPath);
        const thumbBuffer = readFileSync(thumbnailPath);
        await gcs.uploadFile("storyreel", ctx.storyId, "thumbnail.jpg", thumbBuffer, "image/jpeg");
      }
    } else {
      videoBuffer = readFileSync(ctx.videoPath!);
      videoGcsUrl = await gcs.uploadVideo("storyreel", ctx.storyId, "video.mp4", videoBuffer);
      extractThumbnail(ctx.videoPath!, thumbnailPath);
      const thumbBuffer = readFileSync(thumbnailPath);
      await gcs.uploadFile("storyreel", ctx.storyId, "thumbnail.jpg", thumbBuffer, "image/jpeg");
    }

    const thumbBuffer = readFileSync(thumbnailPath);

    const captionParts: string[] = ["Your StoryReel is ready."];
    if (ctx.musicAttribution) {
      captionParts.push(escapeTelegramHtml(ctx.musicAttribution));
    }
    const caption = captionParts.join("\n");
    const downloadUrl = this.deps.baseUrl
      ? joinUrl(this.deps.baseUrl, `/storyreel/${encodeURIComponent(ctx.storyId)}/download`)
      : videoGcsUrl;

    if (telegram.sendPhotoWithButtons) {
      await telegram.sendPhotoWithButtons(ctx.telegramChatId, thumbBuffer, caption, [[
        { text: "View", url: videoGcsUrl },
        { text: "Download", url: downloadUrl },
      ]]);
    } else {
      await telegram.sendPhoto(ctx.telegramChatId, thumbBuffer, caption);
    }

    await updateStoryRun(ctx.storyId, { status: "delivered", videoGcsUrl });

    return { videoGcsUrl };
  }
}
