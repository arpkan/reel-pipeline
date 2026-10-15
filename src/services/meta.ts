const GRAPH_API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface PublishOptions {
  scheduled?: boolean;
  scheduledTime?: number; // Unix timestamp
  draft?: boolean;
}

export class MetaService {
  async publishPhoto(
    pageId: string,
    token: string,
    imageUrl: string,
    caption: string,
    options: PublishOptions = {}
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      url: imageUrl,
      caption,
      access_token: token,
    };

    if (options.draft) {
      params.published = false;
    } else if (options.scheduled && options.scheduledTime) {
      params.published = false;
      params.scheduled_publish_time = options.scheduledTime;
    }

    const response = await fetch(`${BASE_URL}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Meta publishPhoto failed: ${response.status} ${err}`);
    }

    const data = await response.json() as { id: string; post_id?: string };
    return data.post_id ?? data.id;
  }

  async addFirstComment(postId: string, token: string, message: string): Promise<void> {
    const response = await fetch(`${BASE_URL}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Meta addFirstComment failed: ${response.status} ${err}`);
    }
  }

  /** Get the Instagram Business Account User ID linked to a Facebook Page */
  async getInstagramUserId(pageId: string, token: string): Promise<string | null> {
    const res = await fetch(
      `${BASE_URL}/${pageId}?` + `fields=instagram_business_account&access_token=${token}`
    );
    if (!res.ok) return null;
    const data = await res.json() as { instagram_business_account?: { id: string } };
    return data.instagram_business_account?.id ?? null;
  }

  /**
   * Publish a video as a Facebook Reel on a Page.
   * Uses the 3-step video_reels API: start → transfer (via URL) → finish.
   */
  async publishFacebookReel(
    pageId: string,
    token: string,
    videoUrl: string,
    description: string,
  ): Promise<string> {
    // Step 1: start — get video_id and upload_url
    const startRes = await fetch(`${BASE_URL}/${pageId}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", access_token: token }),
    });
    if (!startRes.ok) throw new Error(`FB Reel start failed: ${startRes.status} ${await startRes.text()}`);
    const { video_id, upload_url } = await startRes.json() as { video_id: string; upload_url: string };

    // Step 2: download video bytes then POST binary to upload_url
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
    const videoBuffer = await videoRes.arrayBuffer();

    const uploadRes = await fetch(upload_url, {
      method: "POST",
      headers: {
        "Authorization": `OAuth ${token}`,
        "offset": "0",
        "file_size": String(videoBuffer.byteLength),
      },
      body: videoBuffer,
    });
    if (!uploadRes.ok) throw new Error(`FB Reel upload failed: ${uploadRes.status} ${await uploadRes.text()}`);

    // Step 3: finish / publish
    const finishRes = await fetch(`${BASE_URL}/${pageId}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_phase: "finish",
        video_id,
        video_state: "PUBLISHED",
        description,
        access_token: token,
      }),
    });
    if (!finishRes.ok) {
      const errText = await finishRes.text();
      // Facebook sometimes returns errors on finish even though the reel was published.
      // Verify the video status before treating this as a real failure.
      console.warn(`[meta] FB Reel finish returned ${finishRes.status} — verifying video status...`);
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const statusRes = await fetch(`${BASE_URL}/${video_id}?fields=status&access_token=${token}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json() as { status?: { video_status?: string } };
          const videoStatus = statusData.status?.video_status;
          console.warn(`[meta] FB video ${video_id} status: ${videoStatus}`);
          if (videoStatus === "ready") return video_id;
        }
      } catch { /* verification failed, fall through to throw */ }
      throw new Error(`FB Reel finish failed: ${finishRes.status} ${errText}`);
    }
    return video_id;
  }

  /**
   * Publish a video as an Instagram Reel.
   * Flow: create container → poll until FINISHED → publish.
   */
  async publishInstagramReel(
    igUserId: string,
    token: string,
    videoUrl: string,
    caption: string,
  ): Promise<{ id: string; permalink?: string }> {
    // Step 1: create media container
    const createRes = await fetch(`${BASE_URL}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: token }),
    });
    if (!createRes.ok) throw new Error(`IG Reel create failed: ${createRes.status} ${await createRes.text()}`);
    const { id: containerId } = await createRes.json() as { id: string };

    // Step 2: poll until status = FINISHED (up to 5 min)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 8000));
      const statusRes = await fetch(
        `${BASE_URL}/${containerId}?fields=status_code,status,error_message&access_token=${token}`
      );
      if (!statusRes.ok) continue;
      const data = await statusRes.json() as { 
        status_code: string; 
        status?: string;
        error_message?: string;
      };
      if (data.status_code === "FINISHED") break;
      if (data.status_code === "ERROR") {
        const details = data.error_message || data.status || "unknown error";
        throw new Error(`IG Reel container error for ${containerId}: ${details}`);
      }
    }

    // Step 3: publish
    const pubRes = await fetch(`${BASE_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: token }),
    });
    if (!pubRes.ok) throw new Error(`IG Reel publish failed: ${pubRes.status} ${await pubRes.text()}`);
    const { id: mediaId } = await pubRes.json() as { id: string };

    // Step 4: fetch permalink
    let permalink: string | undefined;
    try {
      const plRes = await fetch(`${BASE_URL}/${mediaId}?fields=permalink&access_token=${token}`);
      if (plRes.ok) {
        const plData = await plRes.json() as { permalink?: string };
        permalink = plData.permalink;
      }
    } catch { /* non-fatal */ }

    return { id: mediaId, permalink };
  }

  async fetchReelInsights(videoId: string, pageId: string, token: string): Promise<{
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    watchTimeSec: number | null;
    totalWatchTimeSec: number | null;
    followersGained: number | null;
  }> {
    const pagePostId = `${pageId}_${videoId}`;
    const result = {
      views: null as number | null, likes: null as number | null,
      comments: null as number | null, shares: null as number | null,
      saves: null as number | null, reach: null as number | null,
      watchTimeSec: null as number | null, totalWatchTimeSec: null as number | null,
      followersGained: null as number | null,
    };

    // Reel-specific metrics: play count, watch time, followers gained.
    // `reach` stays null — Meta deprecated post_impressions_unique (Reels Unique
    // Impressions) on 2026-06-15 with no replacement metric; requesting it made
    // the whole batched call fail with "(#100) The value must be a valid insights metric".
    try {
      const videoInsightsRes = await fetch(
        `${BASE_URL}/${videoId}/video_insights?metric=blue_reels_play_count,post_video_avg_time_watched,post_video_view_time,post_video_followers&access_token=${token}`
      );
      if (videoInsightsRes.ok) {
        const data = await videoInsightsRes.json() as { data: Array<{ name: string; values: Array<{ value: number }> }>; error?: { code: number; message: string } };
        if (data.error) {
          console.warn(`[meta] video_insights error for ${videoId}: ${data.error.code} ${data.error.message}`);
        } else {
          for (const metric of data.data) {
            const val = metric.values?.[0]?.value ?? null;
            if (metric.name === "blue_reels_play_count") result.views = val;
            if (metric.name === "post_video_avg_time_watched") result.watchTimeSec = val != null ? val / 1000 : null;
            if (metric.name === "post_video_view_time") result.totalWatchTimeSec = val != null ? val / 1000 : null;
            if (metric.name === "post_video_followers") result.followersGained = val;
          }
        }
      } else {
        const errText = await videoInsightsRes.text();
        console.warn(`[meta] video_insights HTTP ${videoInsightsRes.status} for ${videoId}: ${errText.slice(0, 200)}`);
      }
    } catch { /* non-fatal */ }

    // Engagement: reactions, comments, shares
    try {
      const postRes = await fetch(
        `${BASE_URL}/${pagePostId}?fields=reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count),shares&access_token=${token}`
      );
      if (postRes.ok) {
        const post = await postRes.json() as {
          reactions?: { summary: { total_count: number } };
          comments?: { summary: { total_count: number } };
          shares?: { count: number };
        };
        result.likes = post.reactions?.summary?.total_count ?? null;
        result.comments = post.comments?.summary?.total_count ?? null;
        result.shares = post.shares?.count ?? null;
      }
    } catch { /* non-fatal */ }

    return result;
  }

  async fetchFollowerCount(pageId: string, token: string): Promise<number> {
    const url = `${BASE_URL}/${pageId}?fields=fan_count&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fetchFollowerCount failed: ${res.status} ${err}`);
    }
    const data = await res.json() as { fan_count: number };
    return data.fan_count;
  }
}

export function createMetaService(): MetaService {
  return new MetaService();
}
