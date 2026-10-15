import { describe, expect, it, vi } from "vitest";
import { StoryStage4Publish } from "../src/stages/story-stage4-publish.js";

describe("StoryStage4Publish", () => {
  it("extracts thumbnail, uploads video and thumbnail, and notifies Telegram", async () => {
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const sendPhotoWithButtons = vi.fn().mockResolvedValue(undefined);
    const updateStoryRun = vi.fn();
    const extractThumbnail = vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg");
    const stage = new StoryStage4Publish({
      extractThumbnail,
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn().mockResolvedValue("https://gcs/video.mp4"), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto, sendPhotoWithButtons },
      updateStoryRun,
      baseUrl: "https://pipeline.example.com",
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoPath: "/tmp/final.mp4",
      musicAttribution: "Music: A by Artist (CC BY 4.0)",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(result.videoGcsUrl).toBe("https://gcs/video.mp4");
    expect(extractThumbnail).toHaveBeenCalledWith("/tmp/final.mp4", "/tmp/story-1/rough-cut/thumbnail.jpg");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendPhotoWithButtons).toHaveBeenCalledWith(
      "chat-1",
      Buffer.from("/tmp/story-1/rough-cut/thumbnail.jpg"),
      expect.not.stringContaining("https://gcs/video.mp4"),
      [[
        { text: "View", url: "https://gcs/video.mp4" },
        { text: "Download", url: "https://pipeline.example.com/storyreel/story-1/download" },
      ]],
    );
    const caption = sendPhotoWithButtons.mock.calls[0][2] as string;
    expect(caption).toContain("Your StoryReel is ready.");
    expect(caption).toContain("Music: A by Artist (CC BY 4.0)");
    expect(caption).not.toContain("/tweak");
    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ status: "delivered", videoGcsUrl: "https://gcs/video.mp4" }));
  });

  it("escapes Telegram HTML in the photo caption", async () => {
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const stage = new StoryStage4Publish({
      extractThumbnail: vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg"),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn().mockResolvedValue("https://gcs/video.mp4?a=1&b=2"), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto },
      updateStoryRun: vi.fn(),
      baseUrl: "https://pipeline.example.com",
    });

    await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoPath: "/tmp/final.mp4",
      musicAttribution: "Music: Lucid Dreaming by FSM Team feat. < e s c p > (CC BY 4.0)",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    const caption = sendPhoto.mock.calls[0][2] as string;
    expect(caption).toContain("Your StoryReel is ready.");
    expect(caption).toContain("FSM Team feat. &lt; e s c p &gt;");
    expect(caption).not.toContain("/tweak");
    expect(caption).not.toContain("https://gcs/video.mp4");
  });

  it("skips video upload and reuses existing thumbnail on notification retry", async () => {
    const uploadVideo = vi.fn();
    const extractThumbnail = vi.fn();
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const stage = new StoryStage4Publish({
      extractThumbnail,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo, uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto },
      updateStoryRun: vi.fn(),
      baseUrl: "https://pipeline.example.com",
    });

    const result = await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoGcsUrl: "https://gcs/existing-video.mp4",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(uploadVideo).not.toHaveBeenCalled();
    expect(extractThumbnail).not.toHaveBeenCalled();
    expect(result.videoGcsUrl).toBe("https://gcs/existing-video.mp4");
    expect(sendPhoto).toHaveBeenCalledWith("chat-1", expect.anything(), expect.stringContaining("Your StoryReel is ready."));
  });

  it("falls back to plain photo when Telegram photo buttons are unavailable", async () => {
    const updateStoryRun = vi.fn();
    const sendPhoto = vi.fn().mockResolvedValue(undefined);
    const stage = new StoryStage4Publish({
      extractThumbnail: vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg"),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn().mockResolvedValue("https://gcs/video.mp4"), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto },
      updateStoryRun,
      baseUrl: "https://pipeline.example.com",
    });

    await expect(stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoPath: "/tmp/final.mp4",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    })).resolves.toEqual({ videoGcsUrl: "https://gcs/video.mp4" });

    expect(updateStoryRun).toHaveBeenCalledWith("story-1", expect.objectContaining({ status: "delivered" }));
    expect(sendPhoto).toHaveBeenCalledWith("chat-1", expect.any(Buffer), expect.not.stringContaining("https://gcs/video.mp4"));
  });

  it("re-extracts thumbnail in notification retry when thumbnail file is missing", async () => {
    const extractThumbnail = vi.fn().mockReturnValue("/tmp/story-1/rough-cut/thumbnail.jpg");
    const stage = new StoryStage4Publish({
      extractThumbnail,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn((p: string) => Buffer.from(p)),
      gcs: { uploadVideo: vi.fn(), uploadFile: vi.fn().mockResolvedValue("https://gcs/thumb.jpg") },
      telegram: { sendPhoto: vi.fn().mockResolvedValue(undefined) },
      updateStoryRun: vi.fn(),
      baseUrl: "https://pipeline.example.com",
    });

    await stage.run({
      storyId: "story-1",
      telegramChatId: "chat-1",
      profile: {} as any,
      clips: [],
      videoGcsUrl: "https://gcs/existing-video.mp4",
      workDir: "/tmp/story-1",
      stageLogs: [],
      status: "generating",
    });

    expect(extractThumbnail).toHaveBeenCalledWith(
      "/tmp/story-1/rough-cut/rough-cut-with-audio.mp4",
      "/tmp/story-1/rough-cut/thumbnail.jpg",
    );
  });
});
