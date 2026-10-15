# NS Studio — TikTok App Review Demo Page

**Date**: 2026-04-14
**Status**: Planned
**URL**: `https://pipeline.example.com/studio`

---

## Context

TikTok requires a demo video to approve the app for `video.publish` (Direct Post) and `user.info.basic` scopes. The demo shows:
1. A branded web page at `pipeline.example.com/studio` with a "Connect TikTok" button
2. The full Login Kit OAuth flow — user authorizes, page shows their avatar + username
3. A news reel card with a "Publish to TikTok" button that publishes an existing reel
4. The resulting private video appearing on the TikTok profile (private tab)

No new DNS, nginx, or SSL needed — served from the existing `pipeline.example.com` server.

---

## Demo Video Script

**Shot 1 (0:00–0:10)** — Open browser to `https://pipeline.example.com/studio`. Hover over address bar so the domain is visible. Page shows NS Studio header + "Connect TikTok" button + reel card.

**Shot 2 (0:10–0:30)** — Click "Connect TikTok". TikTok OAuth page appears showing `video.publish` and `user.info.basic` permissions. Hover mouse over the permission text. Click Authorize. Redirects back to studio showing user avatar + username.

**Shot 3 (0:30–0:50)** — Click "Publish to TikTok" button on the reel card. Spinner appears while uploading. Success banner shows with `publish_id`.

**Shot 4 (0:50–1:15)** — Click "View on TikTok" button → TikTok profile opens in new tab. Click the Private tab (padlock icon). The freshly published news video appears in the private feed.

---

## Prerequisites (User Must Do Before Implementation)

1. **TikTok Developer Portal → Login Kit**:
   - Add redirect URI: `https://pipeline.example.com/studio/callback`
   - Enable `user.info.basic` scope

---

## Files

| File | Change |
|---|---|
| `api/routes/studio.ts` | **Create** — all studio routes + inline HTML + in-memory stores |
| `bin/server.ts` | Add `studioRouter` import + `app.route("/", studioRouter)` mount |

---

## Routes (`api/routes/studio.ts`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/studio` | Serve the HTML demo page |
| `GET` | `/studio/connect` | Redirect to TikTok OAuth with `video.publish,user.info.basic` scopes |
| `GET` | `/studio/callback` | Exchange code → fetch user info → store session → redirect to `/studio?session=<id>` |
| `GET` | `/studio/session` | `?id=<nonce>` → returns `{ displayName, avatarUrl }` JSON |
| `GET` | `/studio/reel` | Returns most recent NS reel with `videoGcsUrl` set (JSON) |
| `POST` | `/studio/publish` | Body `{ reelId }` → async publish → returns `{ jobId }` immediately |
| `GET` | `/studio/publish/status` | `?jobId=<id>` → returns `{ status, publishId?, error? }` |

---

## In-Memory Stores

```typescript
// CSRF states for OAuth: nonce → brand
const studioOAuthStates = new Map<string, string>();

// Demo sessions (Login Kit result): sessionId → { accessToken, avatarUrl, displayName, createdAt }
interface StudioSession { accessToken: string; avatarUrl: string; displayName: string; createdAt: number; }
const studioSessions = new Map<string, StudioSession>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Async publish jobs: jobId → { status, publishId?, error? }
interface PublishJob { status: "pending" | "done" | "failed"; publishId?: string; error?: string; }
const publishJobs = new Map<string, PublishJob>();
```

---

## Key Implementation Details

### `/studio/connect`
- Scope: `"video.publish,user.info.basic"` (comma-separated)
- Redirect URI: `https://pipeline.example.com/studio/callback`
- Uses existing `TIKTOK_CLIENT_KEY` — no new credentials

### `/studio/callback`
After token exchange (same pattern as existing `/auth/tiktok/callback`):
```typescript
const userRes = await fetch(
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name",
  { headers: { "Authorization": `Bearer ${accessToken}` } }
);
const user = (await userRes.json() as any).data?.user;
// Store session → redirect to /studio?session=<nonce>
```

### `/studio/publish`
- Uses `new TikTokService(process.env.NS_TIKTOK_ACCESS_TOKEN)` — production token, no session needed for publishing
- Fire-and-forget async: returns `{ jobId }` immediately, job polled via `/studio/publish/status`
- Avoids nginx timeout (TikTok upload + polling can take minutes)
- Reuses `getRecentReels("ns", 20)` and `getReelById()` from `src/db/queries.ts`
- Reuses `TikTokService` from `src/services/tiktok.ts` — no changes to that file

---

## HTML Page Layout

```
┌────────────────────────────────────────────┐
│  📺 NS Studio                              │  dark header
├────────────────────────────────────────────┤
│  TikTok Connection                          │
│  [pre-auth]  [ Connect TikTok ]            │
│  [post-auth] [avatar] @DisplayName  ✓      │
├────────────────────────────────────────────┤
│  Reel Card                                  │
│  [BREAKING]  Headline text...              │
│  [ 🚀 Publish to TikTok ]                 │  disabled until connected
├────────────────────────────────────────────┤
│  ✅ Published! publish_id: xxx             │
│  [ View on TikTok → ]                     │  → opens tiktok.com/@username
│  "Video is private — Profile → Private tab"│
└────────────────────────────────────────────┘
```

**Inline JS flow:**
1. On load: read `?session=` param → `GET /studio/session?id=<x>` → show avatar + username; enable Publish button
2. On load: `GET /studio/reel` → render reel card; store `reelId`
3. "Connect TikTok" → `window.location.href = "/studio/connect"`
4. "Publish" → `POST /studio/publish { reelId }` → `{ jobId }` → poll `/studio/publish/status?jobId=<id>` every 3s → on `done`: show success with `publish_id` + "View on TikTok" button linking to `https://www.tiktok.com/@{displayName}`

---

## `bin/server.ts` Changes

```typescript
// Add with other imports:
import { studioRouter } from "../api/routes/studio.js";

// Add with other app.route() calls:
app.route("/", studioRouter);
```

---

## Verification

1. `https://pipeline.example.com/studio` → page loads, shows "Connect TikTok" button + reel card
2. Click "Connect TikTok" → TikTok OAuth page with both scopes → authorize → return with avatar + username
3. Click "Publish to TikTok" → spinner → success banner with `publish_id`
4. Click "View on TikTok" → TikTok profile opens → Private tab shows the new video
5. `npm run build` — no TypeScript errors
