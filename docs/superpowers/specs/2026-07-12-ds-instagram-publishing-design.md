# DS Instagram Publishing — Design Spec

**Date:** 2026-07-12
**Status:** Approved
**Author:** Agent

## Problem

The DS (ThaiDaily) brand publishes reels to Facebook but not to Instagram, even though DS now has an Instagram Business Account linked to its Facebook Page. The NS (WorldBrief) brand already publishes to both platforms. DS should be consistent with NS.

## Context

The Instagram publishing infrastructure is fully built and production-proven via NS. Two publishing code paths exist, and both already check `brand.instagramEnabled` and handle the full IG publishing flow:

1. **Manual publish** (`!reel approve` command) — `src/pipeline/command-listener.ts:1422`
2. **Scheduled publish** (cron, every minute) — `bin/server.ts:264`

Both paths:
- Publish to Facebook first via `meta.publishFacebookReel`
- Then, if `brand.instagramEnabled`, fetch the IG Business Account ID from the FB Page via `meta.getInstagramUserId(brand.metaPageId, brand.metaPageToken)`
- Publish the reel to Instagram via `meta.publishInstagramReel`
- If `brand.postSourceAsComment`, post the source URL as a first comment on both FB and IG via `meta.addFirstComment`
- Isolate failures: an IG failure does not roll back a successful FB publish

No new services, env vars, or code paths are required. The IG user ID is discovered dynamically at publish time from the FB Page's `instagram_business_account` field, reusing `DS_META_PAGE_ID` and `DS_META_PAGE_TOKEN`.

## Current State

| Flag | `ns.ts` | `ds.ts` |
|------|---------|---------|
| `instagramEnabled` | `true` | *(missing — defaults to undefined/falsy)* |
| `postSourceAsComment` | `true` | *(missing — defaults to undefined/falsy)* |

## Change

Add two flags to `src/brands/ds.ts` after `metaPageToken` (line 54), matching `ns.ts` field ordering:

```typescript
metaPageId: process.env.DS_META_PAGE_ID ?? "",
metaPageToken: process.env.DS_META_PAGE_TOKEN ?? "",
instagramEnabled: true,
postSourceAsComment: true,
tikTokEnabled: false,
```

### Behavioral Impact of `postSourceAsComment: true`

Currently DS includes the source URL in the reel caption. After this change, the source URL is posted as a first comment on both Facebook and Instagram instead. This matches NS behavior. The `buildReelCaption` function (`src/pipeline/reel-runner.ts`) returns `{ caption, sourceComment }` — when `postSourceAsComment` is true, `sourceComment` contains the URL and `caption` excludes it.

## What Happens After Deployment

### Manual Publish (`!reel approve`)
1. FB reel published → `fbPostId` stored
2. If `sourceComment`, first comment added to FB post
3. IG Business Account ID fetched from DS FB Page
4. IG reel container created → polled until FINISHED → published
5. If `sourceComment`, first comment added to IG media
6. Telegram notification includes both `FB: <id>` and `IG: <permalink>`

### Scheduled Publish (cron, every minute)
Same flow. The reel is marked `status: "publishing"` before publishing begins, preventing duplicate cron ticks during the IG polling window (which can take up to 5 minutes). Notification sent to all enabled channels (Telegram for DS).

### Failure Handling
- IG failure does not affect FB publish — reel is still marked `published` with `facebookPostId` set
- Manual path: sends `⚠️ Facebook ok, Instagram failed: <message>` to Telegram
- Scheduled path: logs error, reports `❌ Instagram — failed` in notification
- If `getInstagramUserId` returns null (IG account not linked), IG publish is silently skipped

## Prerequisites

- DS Instagram account is a Business/Creator account — **confirmed by user**
- DS Instagram account is linked to the DS Facebook Page (`DS_META_PAGE_ID`) — **confirmed by user**
- `DS_META_PAGE_ID` and `DS_META_PAGE_TOKEN` env vars are set and validated at startup — **already in place** (`config.ts:95-96`)

## Testing

- `--dry-run` does not exercise publishing; it cannot verify this change
- **Verification:** `npm run build` → `pm2 restart pipeline` → trigger `!reel approve` on a ready DS reel → confirm IG permalink appears in Telegram response
- Confirm source URL appears as a first comment (not in caption) on both FB and IG

## Out of Scope

- TikTok publishing (DS has `tikTokEnabled: false`, unchanged)
- LINE channel (DS has LINE disabled due to API quota, unchanged)
- Any changes to NS configuration
- Any changes to the Meta service, publishing code paths, or database schema
