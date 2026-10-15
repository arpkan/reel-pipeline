const BASE_URL = "https://open.tiktokapis.com/v2";

export class TikTokService {
  constructor(private readonly accessToken: string) {}

  async publishReel(videoGcsUrl: string, title: string): Promise<{ publishId: string }> {
    // Step 1: query creator info → get first available privacy level
    const creatorRes = await fetch(`${BASE_URL}/post/publish/creator_info/query/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({}),
    });
    if (!creatorRes.ok) {
      throw new Error(`TikTok creator_info failed: ${creatorRes.status} ${await creatorRes.text()}`);
    }
    const creatorData = await creatorRes.json() as {
      data?: { creator_avatar_url?: string; privacy_level_options?: string[] };
      error?: { code: string; message: string };
    };
    if (creatorData.error?.code && creatorData.error.code !== "ok") {
      throw new Error(`TikTok creator_info error: ${creatorData.error.code} — ${creatorData.error.message}`);
    }
    // Prefer SELF_ONLY for unaudited apps; fall back to first available option
    const options = creatorData.data?.privacy_level_options ?? [];
    const privacyLevel = options.includes("SELF_ONLY") ? "SELF_ONLY" : (options[0] ?? "SELF_ONLY");

    // Step 2: download video from GCS
    const videoRes = await fetch(videoGcsUrl);
    if (!videoRes.ok) throw new Error(`TikTok: failed to download video: ${videoRes.status}`);
    const videoBuffer = await videoRes.arrayBuffer();
    const videoSize = videoBuffer.byteLength;

    // Step 3: init upload
    const initRes = await fetch(`${BASE_URL}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: title.slice(0, 2200),
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    });
    if (!initRes.ok) {
      throw new Error(`TikTok init upload failed: ${initRes.status} ${await initRes.text()}`);
    }
    const initData = await initRes.json() as {
      data?: { publish_id: string; upload_url: string };
      error?: { code: string; message: string };
    };
    if (initData.error?.code && initData.error.code !== "ok") {
      throw new Error(`TikTok init error: ${initData.error.code} — ${initData.error.message}`);
    }
    const { publish_id, upload_url } = initData.data!;

    // Step 4: PUT binary to upload_url
    const uploadRes = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoSize),
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      body: videoBuffer,
    });
    if (uploadRes.status !== 201) {
      throw new Error(`TikTok upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }

    // Step 5: poll status until PUBLISH_COMPLETE (5s interval, 5min timeout)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await fetch(`${BASE_URL}/post/publish/status/fetch/`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id }),
      });
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json() as {
        data?: { status: string; fail_reason?: string };
        error?: { code: string; message: string };
      };
      const status = statusData.data?.status;
      if (status === "PUBLISH_COMPLETE") return { publishId: publish_id };
      if (status === "FAILED") {
        throw new Error(`TikTok publish failed: ${statusData.data?.fail_reason ?? "unknown"}`);
      }
    }

    throw new Error(`TikTok publish timed out after 5 minutes (publish_id=${publish_id})`);
  }
}

export function createTikTokService(accessToken: string): TikTokService {
  return new TikTokService(accessToken);
}
