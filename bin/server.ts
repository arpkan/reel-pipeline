import "dotenv/config";
import { randomBytes } from "crypto";
import { validateEnv } from "../src/config.js";

// Prevent unhandled rejections from killing the process silently
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException:", err.stack ?? err);
});
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import cron from "node-cron";
import { ReelRunner, isReelRunning, consumeSkipNextReel } from "../src/pipeline/reel-runner.js";
import { getBrand } from "../src/brands/index.js";
import { startCommandListeners, startStoryReelListener } from "../src/pipeline/command-listener.js";
import { createTelegramService } from "../src/services/telegram.js";
import { createLineService } from "../src/services/line.js";
import { getEnabledChannels } from "../src/services/messaging.js";
import { getDueScheduledReels, updateReel, getStaleGeneratingReels, getStaleRunningRuns, updateRunStatus, getBlockingReelCount, acquireReelScheduleSlot, releaseReelScheduleSlot } from "../src/db/queries.js";
import { runsRouter } from "../api/routes/runs.js";
import { reviewRouter } from "../api/routes/review.js";
import { approvalRouter } from "../api/routes/approval.js";
import { lineWebhookRouter } from "../api/routes/line-webhook.js";
import { studioRouter } from "../api/routes/studio.js";
import { workerRouter } from "../api/routes/worker.js";
import { dashboardRouter } from "../api/routes/dashboard.js";
import { storyreelDownloadRouter } from "../api/routes/storyreel-download.js";
import type { BrandId } from "../src/types.js";

validateEnv(); // check all brands at server startup

const app = new Hono();
app.use("*", logger());

// Mount routers
app.route("/", runsRouter);
app.route("/", reviewRouter);
app.route("/", approvalRouter);
app.route("/", lineWebhookRouter);
app.route("/", studioRouter);
app.route("/", workerRouter);
app.route("/", dashboardRouter);
app.route("/", storyreelDownloadRouter);

// Health check
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));


// ─── TikTok webhook — verification challenge + event sink ────────────────────
// Register https://pipeline.example.com/webhook/tiktok in the TikTok Developer
// Portal → Webhooks. TikTok sends a GET with ?challenge=xxx to verify the URL;
// we echo it back. POST events are logged (we use polling, so no action needed).
app.get("/webhook/tiktok", (c) => {
  const challenge = c.req.query("challenge");
  if (challenge) return c.text(challenge);
  return c.text("ok");
});

app.post("/webhook/tiktok", async (c) => {
  try {
    const body = await c.req.json();
    console.log("[tiktok-webhook] event:", JSON.stringify(body));
  } catch { /* ignore malformed body */ }
  return c.text("ok");
});

// ─── TikTok OAuth — PKCE flow, one-time token acquisition per brand account ───
// Step 1: visit /auth/tiktok/start?brand=ds (or brand=ns) — generates PKCE pair,
//         stores code_verifier in memory, redirects to TikTok authorize URL.
// ─── TikTok OAuth — Web flow, one-time token acquisition per brand account ───
// Step 1: visit /auth/tiktok/start?brand=ds (or brand=ns) — generates CSRF state,
//         redirects to TikTok authorize URL (no PKCE needed for Web platform).
// Step 2: TikTok redirects to /auth/tiktok/callback?code=xxx — exchanges code
//         for access token using client_secret, displays result.

const tikTokStates = new Map<string, string>(); // nonce → brand

app.get("/auth/tiktok/start", (c) => {
  const brand = c.req.query("brand") ?? "ds";
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ?? "https://pipeline.example.com/auth/tiktok/callback";
  const clientKey = process.env.TIKTOK_CLIENT_KEY ?? "";

  const nonce = randomBytes(8).toString("hex");
  tikTokStates.set(nonce, brand);
  console.log(`[tiktok-oauth] start brand=${brand} nonce=${nonce}`);

  const url = new URL("https://www.tiktok.com/v2/auth/authorize");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", "video.publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", nonce);

  return c.redirect(url.toString());
});

app.get("/auth/tiktok/callback", async (c) => {
  const code = c.req.query("code");
  const nonce = c.req.query("state") ?? "";
  const error = c.req.query("error");
  if (error || !code) return c.text(`TikTok auth error: ${error ?? "no code"}`, 400);

  const state = tikTokStates.get(nonce) ?? "ds";
  tikTokStates.delete(nonce);
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ?? "https://pipeline.example.com/auth/tiktok/callback";
  console.log(`[tiktok-oauth] callback nonce=${nonce} brand=${state}`);

  const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const raw = await resp.json() as any;
  console.log("[tiktok-oauth] token response:", JSON.stringify(raw));
  const token = raw.data ?? raw;
  const envVar = state === "ns" ? "NS_TIKTOK_ACCESS_TOKEN" : "DS_TIKTOK_ACCESS_TOKEN";
  return c.html(`<pre>Brand: ${state}\nAccess token: ${token.access_token}\nRefresh token: ${token.refresh_token}\nExpires in: ${token.expires_in}s\n\nAdd to .env:\n${envVar}=${token.access_token}\n\nFull response:\n${JSON.stringify(raw, null, 2)}</pre>`);
});

// ─── Meta (Facebook/Instagram) OAuth — one-time token acquisition per brand ────
// Step 1: visit /auth/meta/start?brand=ds (or brand=ns)
//         Redirects to Facebook OAuth dialog with Instagram + Pages scopes.
// Step 2: Facebook redirects to /auth/meta/callback?code=xxx — exchanges code
//         for a user token, then fetches the page token (with inherited IG
//         scopes) for the brand's Facebook Page. Displays the page token to
//         copy into .env as DS_META_PAGE_TOKEN or NS_META_PAGE_TOKEN.
//
// Requires META_APP_ID, META_APP_SECRET and META_REDIRECT_URI env vars (from Meta Developer Dashboard).

const META_APP_ID = process.env.META_APP_ID ?? "";
const META_APP_SECRET = process.env.DS_META_APP_SECRET ?? process.env.META_APP_SECRET ?? "";
const META_REDIRECT_URI = process.env.META_REDIRECT_URI ?? "";
const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_engagement",
  "business_management",
].join(",");

const metaStates = new Map<string, string>(); // nonce → brand

app.get("/auth/meta/start", (c) => {
  if (!META_APP_SECRET) {
    return c.text("META_APP_SECRET env var is not set. Add it to .env first (find it in Meta Developer Dashboard → your app → Settings → Basic → App Secret).", 500);
  }
  if (!META_APP_ID || !META_REDIRECT_URI) {
    return c.text("META_APP_ID and META_REDIRECT_URI env vars must be set in .env.", 500);
  }
  const brand = c.req.query("brand") ?? "ds";
  const nonce = randomBytes(8).toString("hex");
  metaStates.set(nonce, brand);
  console.log(`[meta-oauth] start brand=${brand} nonce=${nonce}`);

  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("scope", META_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", nonce);
  return c.redirect(url.toString());
});

app.get("/auth/meta/callback", async (c) => {
  const code = c.req.query("code");
  const nonce = c.req.query("state") ?? "";
  const error = c.req.query("error");
  if (error || !code) return c.text(`Meta auth error: ${error ?? "no code"}`, 400);
  if (!META_APP_SECRET) return c.text("META_APP_SECRET env var is not set.", 500);

  const brand = metaStates.get(nonce) ?? "ds";
  metaStates.delete(nonce);
  console.log(`[meta-oauth] callback nonce=${nonce} brand=${brand}`);

  // Step 1: exchange code for user access token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?` +
    new URLSearchParams({
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      redirect_uri: META_REDIRECT_URI,
      code,
    })
  );
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    return c.html(`<pre>Token exchange failed: ${tokenRes.status}\n${errText}</pre>`, 500);
  }
  const tokenData = await tokenRes.json() as { access_token: string; token_type: string; expires_in: number };
  const userToken = tokenData.access_token;

  // Step 2: get all pages with their page tokens and IG business accounts
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{username}&access_token=${userToken}`
  );
  if (!pagesRes.ok) {
    const errText = await pagesRes.text();
    return c.html(`<pre>Failed to fetch pages: ${pagesRes.status}\n${errText}</pre>`, 500);
  }
  const pagesData = await pagesRes.json() as {
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  };

  // Step 3: find the brand's page
  const brandPrefix = brand.toUpperCase();
  const targetPageId = process.env[`${brandPrefix}_META_PAGE_ID`] ?? "";
  const page = pagesData.data.find((p) => p.id === targetPageId) ?? pagesData.data[0];

  if (!page) {
    return c.html(`<pre>No pages found for this account.\n\nAll pages:\n${JSON.stringify(pagesData.data.map(p => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.username ?? "none" })), null, 2)}</pre>`, 404);
  }

  const igLinked = page.instagram_business_account
    ? `✅ IG linked: @${page.instagram_business_account.username ?? page.instagram_business_account.id}`
    : `❌ NO Instagram Business Account linked to this page — link it in Meta Business Suite first`;

  // Step 4: verify the page token has Instagram scopes
  const debugRes = await fetch(
    `https://graph.facebook.com/v21.0/debug_token?input_token=${page.access_token}&access_token=${page.access_token}`
  );
  const debugData = await debugRes.json() as any;
  const pageScopes: string[] = debugData.data?.scopes ?? [];
  const igScopes = pageScopes.filter((s) => s.startsWith("instagram"));

  const envVar = `${brandPrefix}_META_PAGE_TOKEN`;
  const html = `<pre>Brand: ${brand}
Page: ${page.name} (${page.id})
Instagram: ${igLinked}

Page token scopes:
  Instagram: ${igScopes.length ? igScopes.join(", ") : "NONE ❌"}
  All: ${pageScopes.join(", ")}

${igScopes.length > 0 ? "✅" : "⚠️"} Add to .env:
${envVar}=${page.access_token}

${page.instagram_business_account ? "" : "⚠️  IMPORTANT: Instagram is NOT linked to this page yet.\n   Go to Meta Business Suite → Settings → Instagram → Connect Account\n   Then re-run this OAuth flow."}
</pre>`;

  console.log(`[meta-oauth] brand=${brand} page=${page.name} ig_linked=${!!page.instagram_business_account} ig_scopes=${igScopes.length}`);
  return c.html(html);
});

// Post pipeline cron scheduler — retired

// ─── Reel cron scheduler ──────────────────────────────────────────────────────

const REEL_LEAD_MINS = 30; // fire this many minutes before target post time

function scheduledReelSlotKey(timezone: string, targetTime: string): string {
  const targetInstant = new Date(Date.now() + REEL_LEAD_MINS * 60_000);
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(targetInstant);
  return `${datePart} ${targetTime}`;
}

function scheduleReels(brandId: BrandId) {
  const brand = getBrand(brandId);
  if (!brand.reels?.enabled || !brand.reels?.scheduleEnabled) return;

  const register = (slots: typeof brand.reels.reelTimes, dayOfWeek: string) => {
    for (const slot of slots) {
      const time     = typeof slot === "string" ? slot : slot.time;
      const category = typeof slot === "string" ? undefined : slot.category;
      const slotTheme = typeof slot === "string" ? undefined : slot.theme;
      const [h, m] = time.split(":").map(Number);
      const total  = h * 60 + m - REEL_LEAD_MINS;
      const tH     = Math.floor(((total % 1440) + 1440) % 1440 / 60);
      const tM     = ((total % 60) + 60) % 60;
      const expr   = `${tM} ${tH} * * ${dayOfWeek}`;

      cron.schedule(expr, async () => {
        if (consumeSkipNextReel(brandId)) {
          console.log(`[reel-cron:${brandId}] skipping ${time} slot (skip requested)`);
          const channels = getEnabledChannels(brand, telegram, line);
          await Promise.all(channels.map((ch) =>
            ch.send(`⏭ Reel run skipped — ${brand.name}`).catch(() => {})
          ));
          return;
        }
        if (isReelRunning(brandId)) {
          console.log(`[reel-cron:${brandId}] already running — skipping ${time} slot`);
          return;
        }
        if (getBlockingReelCount(brandId) > 0) {
          console.log(`[reel-cron:${brandId}] active reel exists (DB guard) — skipping ${time} slot`);
          return;
        }
        const slotKey = scheduledReelSlotKey(brand.timezone, time);
        const scheduleRunId = `${brandId}:${slotKey}`;
        if (!acquireReelScheduleSlot(brandId, slotKey, scheduleRunId)) {
          console.log(`[reel-cron:${brandId}] slot already started (${slotKey}) — skipping duplicate`);
          return;
        }
        console.log(`[reel-cron:${brandId}] starting reel (target: ${time} ${brand.timezone}${category ? ` category=${category}` : ""}${slotTheme ? ` theme=${slotTheme}` : ""})`);
        const reelOpts = { category, theme: slotTheme, categorySource: "scheduled" as const };
        const isUrlHallucination = (e: unknown) =>
          e instanceof Error && e.message.includes("submitted URL was not found in search results");
        ReelRunner.run(brandId, reelOpts).catch(async (err: unknown) => {
          if (isUrlHallucination(err)) {
            console.warn(`[reel-cron:${brandId}] URL hallucination — retrying once`);
            return ReelRunner.run(brandId, reelOpts).catch(async (err2: unknown) => {
              const msg = err2 instanceof Error ? err2.message : String(err2);
              releaseReelScheduleSlot(brandId, slotKey, scheduleRunId);
              console.error(`[reel-cron:${brandId}] failed after retry:`, msg);
              const channels = getEnabledChannels(brand, telegram, line);
              await Promise.all(channels.map((ch) =>
                ch.send(`❌ Reel failed — ${brand.name}\n${msg}`).catch(() => {})
              ));
            });
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "Reel cancelled by user") return;
          releaseReelScheduleSlot(brandId, slotKey, scheduleRunId);
          console.error(`[reel-cron:${brandId}] failed:`, msg);
          const channels = getEnabledChannels(brand, telegram, line);
          await Promise.all(channels.map((ch) =>
            ch.send(`❌ Reel failed — ${brand.name}\n${msg}`).catch(() => {})
          ));
        });
      }, { timezone: brand.timezone });

      console.log(`[reel-cron] ${brandId} reel at ${String(tH).padStart(2,"0")}:${String(tM).padStart(2,"0")} ${brand.timezone} (${dayOfWeek === "1-5" ? "weekday" : "weekend"} → post at ${time}${category ? ` [${category}]` : ""}${slotTheme ? ` [${slotTheme}]` : ""})`);
    }
  };

  register(brand.reels.reelTimes,                          "1-5");
  register(brand.reels.reelTimesWeekend ?? brand.reels.reelTimes, "0,6");
}

scheduleReels("ds");
scheduleReels("ns");
scheduleReels("ts");

// ─── Scheduled reel publisher — fires every minute ────────────────────────────

cron.schedule("* * * * *", async () => {
  for (const brandId of ["ds", "ns", "ts"] as BrandId[]) {
    const brand = getBrand(brandId);

    // Get current "YYYY-MM-DD HH:MM" in brand timezone
    const now = new Date();
    const datePart = new Intl.DateTimeFormat("en-CA", {
      timeZone: brand.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);  // "2026-04-05"
    const timePart = new Intl.DateTimeFormat("en-GB", {
      timeZone: brand.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(now).replace(",", "").trim();  // "07:00"
    const nowStr = `${datePart} ${timePart}`;  // "2026-04-05 07:00"

    const due = getDueScheduledReels(brandId, nowStr);
    for (const reel of due) {
      console.log(`[reel-scheduler:${brandId}] publishing scheduled reel ${reel.id.slice(0, 8)} (${nowStr})`);
      // Mark as "publishing" immediately so next scheduler tick won't pick it up again
      // (Instagram polling can take >60s, which spans multiple 1-min cron ticks)
      updateReel(reel.id, { status: "publishing" });
      try {
        const { createMetaService } = await import("../src/services/meta.js");
        const { buildReelCaption } = await import("../src/pipeline/reel-runner.js");
        const meta = createMetaService();
        const script   = JSON.parse(reel.script ?? "{}");
        const hashtags = script.hashtags?.length ? script.hashtags : [];
        const { caption, sourceComment } = buildReelCaption(reel.headline, hashtags, reel.sourceUrl, brand.postSourceAsComment ?? false);
        let fbPostId: string | undefined;

        try {
          fbPostId = await meta.publishFacebookReel(brand.metaPageId, brand.metaPageToken, reel.videoGcsUrl!, caption);
          if (fbPostId && sourceComment) {
            await meta.addFirstComment(fbPostId, brand.metaPageToken, sourceComment).catch((err) =>
              console.error(`[reel-scheduler:${brandId}] Facebook source comment failed:`, err instanceof Error ? err.message : err)
            );
          }
        } catch (err) {
          console.error(`[reel-scheduler:${brandId}] Facebook failed:`, err instanceof Error ? err.message : err);
        }
        let igResult: { id: string; permalink?: string } | undefined;
        if (brand.instagramEnabled) {
          try {
            const igUserId = await meta.getInstagramUserId(brand.metaPageId, brand.metaPageToken);
            if (igUserId) igResult = await meta.publishInstagramReel(igUserId, brand.metaPageToken, reel.videoGcsUrl!, caption);
            if (igResult && sourceComment) {
              await meta.addFirstComment(igResult.id, brand.metaPageToken, sourceComment).catch((err) =>
                console.error(`[reel-scheduler:${brandId}] Instagram source comment failed:`, err instanceof Error ? err.message : err)
              );
            }
          } catch (err) {
            console.error(`[reel-scheduler:${brandId}] Instagram failed:`, err instanceof Error ? err.message : err);
          }
        }

        let tikTokPostId: string | undefined;
        if (brand.tikTokEnabled && brand.tikTokAccessToken) {
          try {
            const { TikTokService } = await import("../src/services/tiktok.js");
            const tiktok = new TikTokService(brand.tikTokAccessToken);
            const tikResult = await tiktok.publishReel(reel.videoGcsUrl!, caption);
            tikTokPostId = tikResult.publishId;
            console.log(`[reel-scheduler:${brandId}] TikTok published: ${tikTokPostId}`);
          } catch (err) {
            console.error(`[reel-scheduler:${brandId}] TikTok failed (non-fatal):`, err instanceof Error ? err.message : err);
          }
        }

        updateReel(reel.id, {
          status: fbPostId ? "published" : "failed",
          ...(fbPostId ? { facebookPostId: fbPostId, publishedAt: new Date().toISOString() } : {}),
          ...(tikTokPostId ? { tikTokPostId } : {}),
        });

        const notifyLines: string[] = [`${fbPostId ? "📤" : "❌"} Reel ${fbPostId ? "published" : "failed"} — ${reel.headline.slice(0, 60)}`];
        if (fbPostId) {
          notifyLines.push(`✅ Facebook — <a href="https://www.facebook.com/reel/${fbPostId}">View post</a>`);
        } else {
          notifyLines.push(`❌ Facebook — failed`);
        }
        if (brand.instagramEnabled) {
          if (igResult) {
            notifyLines.push(igResult.permalink
              ? `✅ Instagram — <a href="${igResult.permalink}">${igResult.id}</a>`
              : `✅ Instagram — ${igResult.id}`);
          } else {
            notifyLines.push(`❌ Instagram — failed`);
          }
        }
        if (brand.tikTokEnabled) {
          if (tikTokPostId) {
            notifyLines.push(`✅ TikTok — publish_id: ${tikTokPostId}`);
          } else {
            notifyLines.push(`❌ TikTok — failed`);
          }
        }
        const channels = getEnabledChannels(brand, telegram, line);
        await Promise.all(channels.map((ch) =>
          ch.send(notifyLines.join("\n")).catch(() => {})
        ));
      } catch (err) {
        console.error(`[reel-scheduler:${brandId}] unexpected error:`, err instanceof Error ? err.message : err);
        updateReel(reel.id, { status: "failed" });
      }
    }
  }
});

// ─── Stuck-reel heartbeat — fires every minute ────────────────────────────────
// If a reel has been "generating" with no DB update for 25+ minutes, it is
// either crashed or hung. Mark it failed and notify so nothing silently rots.

cron.schedule("* * * * *", async () => {
  const stale = getStaleGeneratingReels(25);
  for (const reel of stale) {
    console.warn(`[reel-heartbeat] stale reel detected: ${reel.id.slice(0, 8)} brand=${reel.brand} stage=${reel.currentStage ?? "unknown"} last_updated=${reel.updatedAt}`);
    updateReel(reel.id, { status: "failed", currentStage: null });

    const brand = getBrand(reel.brand as BrandId);
    const channels = getEnabledChannels(brand, telegram, line);
    await Promise.all(channels.map((ch) =>
      ch.send(`⚠️ Reel timed out — ${brand.name}\n<code>${reel.id.slice(0, 8)}</code> stuck at stage: ${reel.currentStage ?? "unknown"}\nMarked as failed.`).catch(() => {})
    ));
  }
});

// ─── Stuck-post heartbeat — fires every minute ──────────────────────────────────
cron.schedule("* * * * *", async () => {
  const stale = getStaleRunningRuns(30);
  for (const run of stale) {
    console.warn(`[post-heartbeat] stale run: ${run.id.slice(0, 8)} brand=${run.brand} last_updated=${run.updatedAt}`);
    updateRunStatus(run.id, "failed");
    const brand = getBrand(run.brand as BrandId);
    const channels = getEnabledChannels(brand, telegram, line);
    await Promise.all(channels.map((ch) =>
      ch.send(`⚠️ Pipeline timed out — ${brand.name}\n<code>${run.id.slice(0, 8)}</code>\nMarked as failed.`).catch(() => {})
    ));
  }
});

// ─── Performance metrics collection — every 6 hours at minute 7 ────────────────
import { collectMetrics } from "../src/services/metrics-collector.js";
cron.schedule("7 */6 * * *", async () => {
  for (const brandId of ["ds", "ns", "ts"] as BrandId[]) {
    try {
      await collectMetrics(brandId);
    } catch (err) {
      console.error(`[metrics-cron] failed for ${brandId}:`, err instanceof Error ? err.message : err);
    }
  }
});

// ─── Daily follower snapshot — 01:00 UTC (08:00 Bangkok) ─────────────────────
import { collectFollowerSnapshot } from "../src/services/follower-fetch.js";
cron.schedule("0 1 * * *", async () => {
  for (const brandId of ["ds", "ns", "ts"] as BrandId[]) {
    try {
      await collectFollowerSnapshot(brandId);
    } catch (err) {
      console.error(`[followers-cron] failed for ${brandId}:`, err instanceof Error ? err.message : err);
    }
  }
});

// ─── Always-on Telegram command listeners ─────────────────────────────────────

const telegram = createTelegramService();
const line = createLineService();
startCommandListeners(["ds", "ns", "ts"], telegram, line ?? undefined);

startStoryReelListener().catch((err) => console.error(`[storyreel-listener] failed to start: ${err.message}`));


// ─── Start server ─────────────────────────────────────────────────────────────

const port = parseInt(process.env.PIPELINE_PORT ?? "3100");

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
  console.log(`[server] routes: POST /run/:brand | GET /runs/:brand | GET /runs/:brand/:runId`);
});

// ─── Graceful shutdown on SIGTERM (PM2 restart / deploy) ──────────────────────
// Without this, old processes survive restarts and their cron jobs fire duplicate reels.
process.on("SIGTERM", () => {
  console.log("[server] SIGTERM — stopping cron jobs and shutting down");
  cron.getTasks().forEach((task) => task.stop());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000); // force-exit if close hangs
});
