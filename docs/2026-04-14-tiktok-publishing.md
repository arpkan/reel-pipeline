# TikTok Publishing Platform

**Date**: 2026-04-14
**Status**: Live (NS enabled, sandbox tested)
**Scope**: `src/services/tiktok.ts` (new), `src/types.ts`, `src/brands/ds.ts`, `src/brands/ns.ts`, `src/db/schema.ts`, `src/db/queries.ts`, `src/pipeline/command-listener.ts`, `bin/server.ts`

---

## Context

Reels are published to Facebook (always) and Instagram (optional, per brand). This adds TikTok as a third optional platform using the same pattern — brand config toggle, separate service, called in both the manual approval flow and the scheduled publish cron.

**Current state**: NS is enabled (`tikTokEnabled: true`) and has a working access token. DS remains disabled. Until the TikTok Developer app passes audit, all posts are published as **private (SELF_ONLY)**.

---

## TikTok API Overview

**Base URL**: `https://open.tiktokapis.com/v2/`  
**Auth**: OAuth 2.0 — `Authorization: Bearer {accessToken}`, scope `video.publish`  
**Video format**: MP4 H.264 — already what the pipeline produces (1080×1920, AAC audio)  
**Max size**: 4 GB / **Max duration**: 10 min — reels are well within both

**Upload approach: FILE_UPLOAD** (not PULL_FROM_URL)  
PULL_FROM_URL requires domain ownership verification of `storage.googleapis.com` — not viable. FILE_UPLOAD downloads from GCS and PUTs binary directly to TikTok — same pattern already used for Facebook.

**Publish flow (4 steps):**
1. **Query creator info** — `POST /v2/post/publish/creator_info/query/` → get `privacy_level_options` for this account
2. **Init upload** — `POST /v2/post/publish/video/init/` with `source: "FILE_UPLOAD"`, `video_size`, `chunk_size`, `privacy_level`, `title` → returns `publish_id` + `upload_url`
3. **Upload video** — `PUT {upload_url}` with binary body + headers `Content-Type: video/mp4`, `Content-Length`, `Content-Range: bytes 0-{n-1}/{n}` → 201 = complete
4. **Poll status** — `POST /v2/post/publish/status/fetch/` with `{ publish_id }` every 5s until `PUBLISH_COMPLETE` or `FAILED` (5min timeout)

**Privacy level**: `tiktok.ts` prefers `SELF_ONLY` (private) for unaudited apps. After audit, TikTok will make `PUBLIC_TO_EVERYONE` available and the service will automatically use it.

---

## Files Changed

| File | Change |
|---|---|
| `src/services/tiktok.ts` | **Created** — `TikTokService` with `publishReel()` |
| `src/types.ts` | Added `tikTokEnabled?` and `tikTokAccessToken?` to `BrandConfig` |
| `src/brands/ds.ts` | Added TikTok config (disabled) |
| `src/brands/ns.ts` | Added TikTok config (**enabled**) |
| `src/db/schema.ts` | Added `tikTokPostId` column to `reels` table |
| `src/db/queries.ts` | `updateReel()` accepts `tikTokPostId` |
| `src/pipeline/command-listener.ts` | TikTok publish block in manual `!reel approve` flow |
| `bin/server.ts` | TikTok publish block in scheduled cron + OAuth callback route + webhook route |

---

## DB Migration

Already applied:

```sql
ALTER TABLE reels ADD COLUMN tik_tok_post_id TEXT;
```

---

## Environment Variables

**App credentials** (one set, from TikTok Developer Portal):
```
TIKTOK_CLIENT_KEY=<your-value>
TIKTOK_CLIENT_SECRET=<your-value>
TIKTOK_REDIRECT_URI=https://pipeline.example.com/auth/tiktok/callback
```

**Per-brand access tokens**:
```
NS_TIKTOK_ACCESS_TOKEN=<set>        # NS active
DS_TIKTOK_ACCESS_TOKEN=             # DS not yet set up
NS_TIKTOK_REFRESH_TOKEN=<set>       # for manual token refresh
```

**Token expiry**: TikTok access tokens expire. If publishing starts failing with auth errors, re-run the OAuth flow or use the refresh token (see Token Refresh section below).

---

## TikTok Developer Portal Setup

### App configuration

- **Platform type**: Web (important — Web apps do not require PKCE in the OAuth flow)
- **Products enabled**: Direct Post (required for `video.publish` scope), Login Kit
- **Login Kit redirect URI**: `https://pipeline.example.com/auth/tiktok/callback`
- **Webhooks callback URL**: `https://pipeline.example.com/webhook/tiktok`

### Audit status

Until the app passes TikTok's audit, all posts are published as **private**. Submit for review in the Developer Portal → app → **Submit for review**.

---

## OAuth — Token Acquisition

The OAuth flow uses the **Web platform** flow (no PKCE required). The `/auth/tiktok/start` route generates a CSRF nonce, redirects to TikTok, and the callback exchanges the code for a token using `client_secret`.

**To get a new token for a brand**, visit in a browser while logged in as that brand's TikTok account:

```
https://pipeline.example.com/auth/tiktok/start?brand=ns
```
or
```
https://pipeline.example.com/auth/tiktok/start?brand=ds
```

TikTok redirects back to the callback, and the page displays the access token. Add it to `.env` and restart:

```bash
pm2 restart pipeline --update-env
```

---

## Token Refresh

TikTok access tokens expire (duration depends on app audit status). When publishing fails with an auth error, either:

**Option A — Re-run OAuth flow** (gets a fresh token):
Visit `https://pipeline.example.com/auth/tiktok/start?brand=ns` again.

**Option B — Use refresh token**:
```bash
curl -X POST https://open.tiktokapis.com/v2/oauth/token/ \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_key=sbaw06vq9yl8d4tvzb&client_secret=MXafEylN379Idocg1I9Uz9BdnCcLwhzT&grant_type=refresh_token&refresh_token=<NS_TIKTOK_REFRESH_TOKEN>"
```

Update `NS_TIKTOK_ACCESS_TOKEN` in `.env` with the new `access_token`, then restart.

---

## How Publishing Works

### Manual flow (`!reel approve`)

After Facebook and Instagram, the command listener runs:

```typescript
if (brand.tikTokEnabled && brand.tikTokAccessToken) {
  const tiktok = new TikTokService(brand.tikTokAccessToken);
  const result = await tiktok.publishReel(videoUrl, caption);
  // tikTokPublishId stored in DB, shown in Telegram notification
}
```

Failures are non-fatal. Telegram notification includes:
- Success: `✅ TikTok — publish_id: <id>`
- Failure: `❌ TikTok publish failed`

### Scheduled cron

Same block runs in the reel scheduler after Facebook and Instagram. `tik_tok_post_id` is saved to the `reels` DB row on success.

### TikTokService internals (`src/services/tiktok.ts`)

```
publishReel(videoGcsUrl, title):
  1. POST /v2/post/publish/creator_info/query/ → pick SELF_ONLY or first available privacy level
  2. fetch(videoGcsUrl) → ArrayBuffer
  3. POST /v2/post/publish/video/init/ → { publish_id, upload_url }
  4. PUT upload_url (binary, single chunk, Content-Range: bytes 0-N/N) → expect 201
  5. Poll POST /v2/post/publish/status/fetch/ every 5s → PUBLISH_COMPLETE or throw
```

---

## Enabling TikTok Per Brand

In `src/brands/ds.ts` (or `ns.ts`):

```typescript
tikTokEnabled: true,
```

Then rebuild and restart:
```bash
npm run build && pm2 restart pipeline --update-env
```

---

## Verification Checklist

- [x] DNS updated: `pipeline.example.com` → `<server-ip>`
- [x] TikTok Developer app created, Direct Post + Login Kit enabled
- [x] Login Kit redirect URI set: `https://pipeline.example.com/auth/tiktok/callback`
- [x] Webhook URL set and verified: `https://pipeline.example.com/webhook/tiktok`
- [x] `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` in `.env`
- [x] OAuth flow completed for NS → `NS_TIKTOK_ACCESS_TOKEN` in `.env`
- [x] `tikTokEnabled: true` in `ns.ts`
- [x] First video posted successfully (sandbox — private)
- [ ] NS OAuth flow repeated for DS when ready
- [ ] App submitted for TikTok audit → posts become public after approval
