import { Hono } from "hono";
import { randomBytes } from "crypto";
import { getRecentReels, getReelById } from "../../src/db/queries.js";
import { TikTokService } from "../../src/services/tiktok.js";

// ─── In-memory stores ─────────────────────────────────────────────────────────

const studioOAuthStates = new Map<string, string>(); // nonce → brand

interface StudioSession {
  accessToken: string;
  avatarUrl: string;
  displayName: string;
  createdAt: number;
}
const studioSessions = new Map<string, StudioSession>();
const SESSION_TTL_MS = 60 * 60 * 1000;

interface PublishJob {
  status: "pending" | "done" | "failed";
  publishId?: string;
  error?: string;
}
const publishJobs = new Map<string, PublishJob>();

function pruneStudioSessions() {
  const now = Date.now();
  for (const [k, v] of studioSessions) {
    if (now - v.createdAt > SESSION_TTL_MS) studioSessions.delete(k);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const studioRouter = new Hono();

// GET /studio — serve demo HTML page
studioRouter.get("/studio", (c) => {
  const session = c.req.query("session") ?? "";
  return c.html(buildStudioHtml(session));
});

// GET /studio/connect — redirect to TikTok OAuth
studioRouter.get("/studio/connect", (c) => {
  const nonce = randomBytes(8).toString("hex");
  studioOAuthStates.set(nonce, "ns");

  const redirectUri = "https://pipeline.example.com/studio/callback";
  const url = new URL("https://www.tiktok.com/v2/auth/authorize");
  url.searchParams.set("client_key",    process.env.TIKTOK_CLIENT_KEY ?? "");
  url.searchParams.set("scope",         "video.publish,user.info.basic");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("state",         nonce);

  console.log(`[studio] OAuth start nonce=${nonce}`);
  return c.redirect(url.toString());
});

// GET /studio/callback — exchange code, fetch user info, store session
studioRouter.get("/studio/callback", async (c) => {
  const code  = c.req.query("code");
  const nonce = c.req.query("state") ?? "";
  const error = c.req.query("error");

  if (error || !code) {
    return c.text(`TikTok auth error: ${error ?? "no code"}`, 400);
  }

  if (!studioOAuthStates.has(nonce)) {
    return c.text("Invalid or expired state. Please try connecting again.", 400);
  }
  studioOAuthStates.delete(nonce);

  // Exchange code for token
  const tokenResp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY ?? "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
      code,
      grant_type:    "authorization_code",
      redirect_uri:  "https://pipeline.example.com/studio/callback",
    }),
  });
  const tokenRaw = await tokenResp.json() as any;
  const accessToken: string = (tokenRaw.data ?? tokenRaw).access_token;
  console.log(`[studio] OAuth callback — token exchange: ${tokenResp.status}`);

  if (!accessToken) {
    return c.text(`Token exchange failed: ${JSON.stringify(tokenRaw)}`, 500);
  }

  // Fetch user info
  let avatarUrl  = "";
  let displayName = "Unknown";
  try {
    const userResp = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name",
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    const userRaw = await userResp.json() as any;
    const user = userRaw.data?.user;
    avatarUrl   = user?.avatar_url  ?? "";
    displayName = user?.display_name ?? "Unknown";
    console.log(`[studio] user info: ${displayName}`);
  } catch (err) {
    console.warn("[studio] user info fetch failed (non-fatal):", err);
  }

  // Store session
  const sessionId = randomBytes(16).toString("hex");
  studioSessions.set(sessionId, { accessToken, avatarUrl, displayName, createdAt: Date.now() });

  return c.redirect(`/studio?session=${sessionId}`);
});

// GET /studio/session — return session user info as JSON
studioRouter.get("/studio/session", (c) => {
  pruneStudioSessions();
  const id = c.req.query("id") ?? "";
  const session = studioSessions.get(id);
  if (!session) return c.json({ error: "not found" }, 404);
  return c.json({ displayName: session.displayName, avatarUrl: session.avatarUrl });
});

// GET /studio/reel — return most recent NS reel with videoGcsUrl
studioRouter.get("/studio/reel", (c) => {
  const reels = getRecentReels("ns", 20);
  const reel = reels.find(r => r.videoGcsUrl);
  if (!reel) return c.json({ error: "No reel available" }, 404);
  return c.json({
    id:          reel.id,
    headline:    reel.headline,
    category:    reel.category ?? "open",
    videoGcsUrl: reel.videoGcsUrl,
  });
});

// POST /studio/publish — fire-and-forget async publish, returns jobId
studioRouter.post("/studio/publish", async (c) => {
  const { reelId } = await c.req.json() as { reelId: string };

  const reel = getReelById(reelId);
  if (!reel)           return c.json({ error: "Reel not found" }, 404);
  if (!reel.videoGcsUrl) return c.json({ error: "Reel has no video" }, 400);

  const token = process.env.NS_TIKTOK_ACCESS_TOKEN;
  if (!token) return c.json({ error: "NS_TIKTOK_ACCESS_TOKEN not set" }, 500);

  const jobId = randomBytes(8).toString("hex");
  publishJobs.set(jobId, { status: "pending" });

  // Fire and forget — do not await
  (async () => {
    try {
      const tiktok = new TikTokService(token);
      const result = await tiktok.publishReel(reel.videoGcsUrl!, reel.headline);
      console.log(`[studio] publish done: ${result.publishId}`);
      publishJobs.set(jobId, { status: "done", publishId: result.publishId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[studio] publish failed: ${msg}`);
      publishJobs.set(jobId, { status: "failed", error: msg });
    }
  })();

  return c.json({ jobId });
});

// GET /studio/publish/status — poll publish job
studioRouter.get("/studio/publish/status", (c) => {
  const jobId = c.req.query("jobId") ?? "";
  const job = publishJobs.get(jobId);
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildStudioHtml(sessionParam: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NS Studio</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f0f0f;
      color: #f0f0f0;
      min-height: 100vh;
    }

    header {
      background: #111;
      border-bottom: 1px solid #222;
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    header .logo { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    header .logo span { color: #fe2c55; }
    header .tag {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #666;
      margin-top: 2px;
    }

    .container { max-width: 560px; margin: 48px auto; padding: 0 24px; }

    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 20px;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #666;
      margin-bottom: 20px;
    }

    /* TikTok connect button */
    .btn-tiktok {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #fff;
      color: #000;
      border: none;
      border-radius: 10px;
      padding: 13px 22px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      text-decoration: none;
    }
    .btn-tiktok:hover { opacity: 0.88; }
    .btn-tiktok svg { width: 22px; height: 22px; flex-shrink: 0; }

    /* Connected state */
    .connected {
      display: none;
      align-items: center;
      gap: 14px;
    }
    .connected.visible { display: flex; }
    .connected img {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #333;
    }
    .connected-info .name { font-size: 16px; font-weight: 600; }
    .connected-info .check {
      font-size: 13px;
      color: #4ade80;
      margin-top: 2px;
    }
    #connect-btn.hidden { display: none; }

    /* Category badge */
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 3px 9px;
      border-radius: 6px;
      margin-bottom: 12px;
    }
    .badge-breaking  { background: #fe2c55; color: #fff; }
    .badge-trending  { background: #f59e0b; color: #000; }
    .badge-business  { background: #3b82f6; color: #fff; }
    .badge-human_interest { background: #8b5cf6; color: #fff; }
    .badge-open      { background: #333; color: #ccc; }

    .reel-headline {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 20px;
      color: #f0f0f0;
    }

    .reel-video {
      width: 100%;
      max-height: 480px;
      border-radius: 10px;
      background: #000;
      display: block;
      margin-bottom: 20px;
      object-fit: contain;
    }

    #reel-loading { color: #555; font-size: 14px; }

    /* Publish button */
    .btn-publish {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #fe2c55;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 13px 22px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn-publish:disabled {
      background: #333;
      color: #555;
      cursor: not-allowed;
    }
    .btn-publish:not(:disabled):hover { opacity: 0.88; }

    /* Status area */
    #status { display: none; margin-top: 20px; }
    #status.visible { display: block; }

    .status-pending {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #aaa;
      font-size: 14px;
    }
    .spinner {
      width: 18px; height: 18px;
      border: 2px solid #444;
      border-top-color: #fe2c55;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .status-success {
      background: #052e16;
      border: 1px solid #166534;
      border-radius: 12px;
      padding: 20px;
    }
    .status-success .success-title {
      font-size: 15px;
      font-weight: 600;
      color: #4ade80;
      margin-bottom: 8px;
    }
    .status-success .publish-id {
      font-family: monospace;
      font-size: 12px;
      color: #86efac;
      margin-bottom: 16px;
      word-break: break-all;
    }
    .btn-view {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #fff;
      color: #000;
      text-decoration: none;
      border-radius: 8px;
      padding: 9px 16px;
      font-size: 13px;
      font-weight: 600;
    }
    .btn-view:hover { opacity: 0.88; }
    .status-hint {
      font-size: 12px;
      color: #555;
      margin-top: 10px;
    }

    .status-error {
      background: #2d0a0a;
      border: 1px solid #7f1d1d;
      border-radius: 12px;
      padding: 16px;
      font-size: 13px;
      color: #fca5a5;
    }
  </style>
</head>
<body>

<header>
  <div>
    <div class="logo"><span>NS</span> Studio</div>
    <div class="tag">Content Publishing Platform</div>
  </div>
</header>

<div class="container">

  <!-- TikTok Connection Card -->
  <div class="card">
    <div class="card-title">TikTok Integration</div>

    <a id="connect-btn" class="btn-tiktok" href="/studio/connect">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
      </svg>
      Connect TikTok
    </a>

    <div id="connected-state" class="connected">
      <img id="avatar" src="" alt="avatar">
      <div class="connected-info">
        <div class="name" id="display-name"></div>
        <div class="check">✓ Connected to TikTok</div>
      </div>
    </div>
  </div>

  <!-- Reel Card -->
  <div class="card">
    <div class="card-title">Ready to Publish</div>
    <div id="reel-loading">Loading reel...</div>
    <div id="reel-content" style="display:none">
      <div id="reel-badge" class="badge"></div>
      <div id="reel-headline" class="reel-headline"></div>
      <video id="reel-video" class="reel-video" controls preload="metadata" style="display:none"></video>
      <button id="publish-btn" class="btn-publish" disabled>
        🚀 Publish to TikTok
      </button>
    </div>

    <div id="status">
      <div id="status-pending" class="status-pending" style="display:none">
        <div class="spinner"></div>
        <span>Uploading to TikTok… this may take a minute</span>
      </div>
      <div id="status-success" class="status-success" style="display:none">
        <div class="success-title">✅ Published to TikTok</div>
        <div class="publish-id" id="publish-id-text"></div>
        <a id="view-btn" class="btn-view" href="#" target="_blank">
          View on TikTok →
        </a>
        <div class="status-hint">Video is private — go to Profile → Private tab (🔒) to view</div>
      </div>
      <div id="status-error" class="status-error" style="display:none"></div>
    </div>
  </div>

</div>

<script>
  const SESSION_ID = ${JSON.stringify(sessionParam)};
  let reelId = null;
  let displayName = null;
  let pollTimer = null;

  // ── Load session (avatar + username) ──────────────────────────────────────
  async function loadSession() {
    if (!SESSION_ID) return;
    try {
      const res = await fetch('/studio/session?id=' + SESSION_ID);
      if (!res.ok) return;
      const data = await res.json();
      displayName = data.displayName;

      document.getElementById('connect-btn').classList.add('hidden');
      const state = document.getElementById('connected-state');
      state.classList.add('visible');
      document.getElementById('display-name').textContent = '@' + data.displayName;
      const avatar = document.getElementById('avatar');
      if (data.avatarUrl) {
        avatar.src = data.avatarUrl;
      } else {
        avatar.style.display = 'none';
      }

      // Enable publish button if reel is loaded
      if (reelId) document.getElementById('publish-btn').disabled = false;
    } catch (e) {
      console.error('Session load failed:', e);
    }
  }

  // ── Load reel ─────────────────────────────────────────────────────────────
  async function loadReel() {
    try {
      const res = await fetch('/studio/reel');
      if (!res.ok) {
        document.getElementById('reel-loading').textContent = 'No reel available';
        return;
      }
      const data = await res.json();
      reelId = data.id;

      document.getElementById('reel-loading').style.display = 'none';
      document.getElementById('reel-content').style.display = 'block';

      const badge = document.getElementById('reel-badge');
      const cat = data.category || 'open';
      badge.textContent = cat.replace('_', ' ').toUpperCase();
      badge.className = 'badge badge-' + cat;

      document.getElementById('reel-headline').textContent = data.headline;

      if (data.videoGcsUrl) {
        const video = document.getElementById('reel-video');
        video.src = data.videoGcsUrl;
        video.style.display = 'block';
      }

      // Enable publish only if session is also loaded
      if (SESSION_ID && displayName) {
        document.getElementById('publish-btn').disabled = false;
      }
    } catch (e) {
      document.getElementById('reel-loading').textContent = 'Failed to load reel';
    }
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    loadSession();
    loadReel();

    document.getElementById('publish-btn').addEventListener('click', async () => {
      if (!reelId) return;

      document.getElementById('publish-btn').disabled = true;
      document.getElementById('status').classList.add('visible');
      document.getElementById('status-pending').style.display = 'flex';
      document.getElementById('status-success').style.display = 'none';
      document.getElementById('status-error').style.display = 'none';

      try {
        const res = await fetch('/studio/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reelId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Publish failed');
        pollStatus(data.jobId);
      } catch (e) {
        showError(e.message);
      }
    });
  });

  function pollStatus(jobId) {
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/studio/publish/status?jobId=' + jobId);
        const job = await res.json();
        if (job.status === 'done') {
          clearInterval(pollTimer);
          showSuccess(job.publishId);
        } else if (job.status === 'failed') {
          clearInterval(pollTimer);
          showError(job.error || 'Publish failed');
        }
      } catch (e) { /* keep polling */ }
    }, 3000);
  }

  function showSuccess(publishId) {
    document.getElementById('status-pending').style.display = 'none';
    const el = document.getElementById('status-success');
    el.style.display = 'block';
    document.getElementById('publish-id-text').textContent = 'publish_id: ' + publishId;
    const viewBtn = document.getElementById('view-btn');
    if (displayName) {
      viewBtn.href = 'https://www.tiktok.com/@' + displayName;
    } else {
      viewBtn.style.display = 'none';
    }
  }

  function showError(msg) {
    document.getElementById('status-pending').style.display = 'none';
    document.getElementById('publish-btn').disabled = false;
    const el = document.getElementById('status-error');
    el.style.display = 'block';
    el.textContent = '❌ ' + msg;
  }
</script>
</body>
</html>`;
}
