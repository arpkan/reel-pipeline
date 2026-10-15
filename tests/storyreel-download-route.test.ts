import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoryRunById: vi.fn(),
}));

vi.mock("../src/db/queries.js", () => ({
  getStoryRunById: mocks.getStoryRunById,
}));

describe("StoryReel download route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("streams the StoryReel video with attachment headers", async () => {
    mocks.getStoryRunById.mockReturnValue({
      id: "story-1",
      videoGcsUrl: "https://storage.googleapis.com/bucket/story-1/video.mp4",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("video-bytes", {
      status: 200,
      headers: { "content-type": "video/mp4" },
    })));

    const { storyreelDownloadRouter } = await import("../api/routes/storyreel-download.js");
    const res = await storyreelDownloadRouter.request(new Request("http://localhost/storyreel/story-1/download"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="storyreel-story-1.mp4"');
    expect(await res.text()).toBe("video-bytes");
  });

  it("returns 404 when the story has no video", async () => {
    mocks.getStoryRunById.mockReturnValue({ id: "story-1", videoGcsUrl: null });

    const { storyreelDownloadRouter } = await import("../api/routes/storyreel-download.js");
    const res = await storyreelDownloadRouter.request(new Request("http://localhost/storyreel/story-1/download"));

    expect(res.status).toBe(404);
  });
});
