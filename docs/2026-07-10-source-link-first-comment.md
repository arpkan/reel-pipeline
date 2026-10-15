# Post Source Link as First Comment Instead of In-Caption

## Problem

Reel captions currently embed the source URL directly in the caption body (`bin/server.ts:250`, `command-listener.ts:1405-1408`). There's a common (if unverified) belief that external links in the caption body suppress organic reach on Facebook/Instagram. Regardless of the exact mechanism, moving the link to a first comment is a low-risk, easily-reversible change worth testing — but it should be gated per brand so it can be A/B'd rather than rolled out blind.

Note: the specific reach-penalty percentages and "dashboard warning" claims that prompted this haven't been independently verified and shouldn't be treated as established fact — this is being shipped as an experiment, not a proven fix.

## Fix

Add a per-brand flag `postSourceAsComment`. When enabled:
- The caption omits the source line entirely (headline + hashtags only).
- After a successful Facebook publish, the source URL is posted as a comment on the new post via the **existing but currently unused** `MetaService.addFirstComment()` (`src/services/meta.ts:46-57`).
- Instagram: `addFirstComment` is generic on `postId`, so the same call is reused with the IG media id returned by `publishInstagramReel`. Comment is posted after IG publish succeeds (IG requires the media to be fully published first).
- If posting the comment fails, log a warning but don't fail the whole publish (the reel is already live; a missing comment isn't worth failing the run over).

When the flag is off (or unset), behavior is unchanged — caption keeps the inline source line exactly as today.

## Files changed

### 1. `src/types.ts` (~line 65)
Add flag to `BrandConfig`, following the existing `instagramEnabled`/`tikTokEnabled` convention:
```ts
postSourceAsComment?: boolean; // post source link as first comment instead of in caption
```

### 2. `src/brands/ns.ts`
Set `postSourceAsComment: true` — WorldBrief is the brand this is being tested on first.

### 3. `src/brands/ds.ts`
Leave unset (off) — keeps ThaiDaily on the current known-good caption format while NS is A/B tested.

### 4. `src/pipeline/reel-runner.ts`
Add one shared exported helper (currently this logic is duplicated and slightly inconsistent between `bin/server.ts` and `command-listener.ts`):
```ts
export function buildReelCaption(
  headline: string,
  hashtags: string[],
  sourceUrl: string,
  postSourceAsComment: boolean
): { caption: string; sourceComment: string | null } {
  const sourceLine = /^https?:\/\//i.test(sourceUrl) ? `🔗 ${sourceUrl}` : `Source: ${sourceUrl}`;
  const caption = postSourceAsComment
    ? `${headline}\n\n${hashtags.join(" ")}`.trim().slice(0, 2200)
    : `${headline}\n\n${hashtags.join(" ")}\n${sourceLine}`.trim().slice(0, 2200);
  return { caption, sourceComment: postSourceAsComment ? sourceLine : null };
}
```
This also fixes the existing inconsistency where `server.ts` always used the `🔗` prefix and `command-listener.ts` branched on whether `sourceUrl` looked like a real URL — both call sites now share one implementation.

### 5. `bin/server.ts` (~line 247-266)
Replace inline caption build with `buildReelCaption(reel.headline, hashtags, reel.sourceUrl, brand.postSourceAsComment ?? false)`. After a successful `fbPostId`, if `sourceComment` is set, call `meta.addFirstComment(fbPostId, brand.metaPageToken, sourceComment).catch(err => console.error(...))`. Same after a successful `igResult`, using `igResult.id`.

### 6. `src/pipeline/command-listener.ts` (~line 1404-1426)
Same substitution: replace inline `sourceLine`/`caption` build with `buildReelCaption(...)`, then post the comment after FB publish and after IG publish (each independently, non-fatal on failure).

### 7. `src/review/reel-html-builder.ts` (~line 16-21, 360-369)
This file had its own duplicate copy of the caption-building logic (used for the human review/approval preview page) that was missed in the initial pass. Fixed to call the same `buildReelCaption()` helper, so the preview now matches what's actually posted. When `sourceComment` is set, the caption card also shows a "Will post as first comment" note with the source link, so reviewers aren't confused by its absence from the caption body.

## Behavior after fix

| Brand | Flag | Caption | Source link |
|---|---|---|---|
| WorldBrief (ns) | `postSourceAsComment: true` | headline + hashtags only | posted as first comment on FB and IG after publish |
| ThaiDaily (ds) | unset | headline + hashtags + source line (unchanged) | inline, as today |

## No schema changes, no new dependencies

`addFirstComment` already exists and is already tested indirectly via the Meta service; no new Graph API surface. `MetaService` is reused as-is.
