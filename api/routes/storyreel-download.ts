import { Hono } from "hono";
import { getStoryRunById } from "../../src/db/queries.js";

export const storyreelDownloadRouter = new Hono();

storyreelDownloadRouter.get("/storyreel/:storyId/download", async (c) => {
  const storyId = c.req.param("storyId");
  const run = getStoryRunById(storyId) as { videoGcsUrl?: string | null } | null;
  if (!run?.videoGcsUrl) return c.json({ error: "StoryReel video not found" }, 404);

  const upstream = await fetch(run.videoGcsUrl);
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: "StoryReel video unavailable" }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      "Content-Disposition": `attachment; filename="storyreel-${storyId}.mp4"`,
      "Cache-Control": "private, max-age=300",
    },
  });
});
