# TagesBrief (`ts`) — German Brand Addition Design Spec

**Date:** 2026-07-13
**Status:** Pending user review
**Author:** Agent

## Problem

The pipeline supports two brands — `ds` (ThaiDaily, Thai) and `ns` (WorldBrief, English). We want to add a third brand **TagesBrief** (`ts`), a German-language sibling targeting the DACH + EU region. It mirrors the same concept as `ds` and `ns`: short-form video reels with voiceover, sourced from trusted news outlets, published to Facebook (and Instagram later if enabled).

## Context

The pipeline is brand-multi-tenant: a `BrandConfig` object (`src/brands/<id>.ts`) drives scheduling, sources, voice, channels, and downstream behaviour. `BrandId` is a string union type used throughout the codebase. Most user-facing strings (LLM prompts, TTS rules, review-page labels, Telegram messages) are currently localized only for Thai via ad-hoc `isThai = language === "th"` ternaries — a binary pattern that does not accommodate a third language.

Adding `ts` therefore has two coupled pieces:

1. **Register the new brand** (config, types, env validation, dashboard, assets).
2. **Refactor the binary `isThai` localization pattern into a lookup table** so German gets the same coverage Thai has, without leaving a worse structure behind.

## Approach

**Approach chosen: localize-by-lookup-table (refactor while adding).**

Replace ad-hoc `isThai ? X : Y` ternaries with small lookup modules (`src/i18n/reel-strings.ts`, `src/i18n/ui-strings.ts`). Thai strings are **moved, not changed** — `ds` behaviour is bit-for-bit identical. German strings are added as a new column. A future fourth language becomes a one-line addition.

This was chosen over "three-way branches everywhere" (Approach A) because it doesn't leave the binary-ternary mess for the next person, and over "config-driven strings" (Approach C) because `BrandConfig` should not become a localization dump.

## Name rationale

"TagesBrief" uses the German genitive prefix *Tages-* (as in *Tagesschau*, *Tageszeitung*, *Tagesbild*). The intended meaning is **"the day's snapshot" / "capture of the day"** — not "daily recurring snap". The genitive form is grammatically required for this possessive sense; the bare root *Tag-* (*TagesBrief*) would read as "day-shift snap" or "snap during the day" and lose the meaning. Note: *TagesBrief* literally translates to *ThaiDaily*, creating a translation collision with `ds`; the user has accepted this trade-off deliberately.

## Changes

### 1. New files

#### `src/brands/ts.ts`
German brand config. Cloned structurally from `ns.ts` (Berlin timezone, European focus) with the following German-specific values:

- `id: "ts"`, `name: "TagesBrief"`, `language: "de"`
- `timezone: "Europe/Berlin"`
- `trustedSources`: German national news (spiegel.de, zeit.de, faz.net, sueddeutsche.de, tagesschau.de, deutschlandfunk.de, dw.com/de), business (handelsblatt.com, wiwo.de, manager-magazin.de), mass-market (bild.de, rtl.de, n-tv.de), magazines (stern.de, focus.de), DACH neighbours (orf.at, derstandard.at, nzz.ch, admin.ch)
- `geographicFocus`: "DACH region (Germany, Austria, Switzerland) — prioritize German-language stories with direct relevance to German-speaking audiences. Fall back to broader European stories only if no strong DACH story exists."
- `trendingConfig`: `googleNewsGeos: ["DE","AT","CH"]`, `googleNewsLang: "de"`, `youtubeRegionCode: "DE"`, `youtubeQuery: "deutsche nachrichten heute"`
- `gcsPrefix: "tscontent"`
- `metaPageId: process.env.TS_META_PAGE_ID`, `metaPageToken: process.env.TS_META_PAGE_TOKEN`
- `instagramEnabled: false`, `postSourceAsComment: true`, `tikTokEnabled: false`
- `channels.telegram.enabled: true` (`TELEGRAM_TS_CHAT_ID`), `channels.line.enabled: false`
- `reels.voiceId: process.env.TS_REEL_VOICE_ID ?? ""` (German ElevenLabs voice — user-provided at runtime via env var). Unlike `ns`/`ds` which fall back to a known English voice (`JBFqnCBsd6RMkjVDRZzb`), `ts` has no sensible default because the fallback voice is English-only. The empty-string fallback means the voice pipeline will fail loudly if `TS_REEL_VOICE_ID` is unset — this is intentional and forces correct setup before first run.
- `reels.reelTimes` / `reelTimesWeekend`: mirror `ns` schedule (07:30/12:00/16:30/21:00 weekday; 09:30/14:30/18:30/22:00 weekend, CET/CEST)
- All music, `cameraEffectByCategory`, `cameraPresetByCategory`, `stage5Renderer`, `stage5Template`, `stage5Performance`: identical to `ns` (shared asset pool)
- `useStockImages: false`

#### `src/i18n/reel-strings.ts`
Lookup table for script-generation strings. Replaces inline `isThai` ternaries in `src/stages/reel-stage2-script.ts`.

```typescript
export type ReelLang = "th" | "en" | "de";

export interface ReelStringSet {
  langLabel: string;            // "Thai" | "English" | "German"  — fed to LLM
  languageLine: string;         // instructs LLM which language to write in
  hooksBlock?: string;          // engagement hook examples (empty for en)
  ctaBlock: string;             // CTA instructions and examples
  wordCountBlock: string;       // per-scene word count rules
  ttsBlock?: string;            // TTS-specific gotchas (empty for en)
  ctaSignals: RegExp[];         // regexes detecting an existing CTA in last scene
  ctaAppends: string[];         // CTA strings to append when none detected
}

export const REEL_STRINGS: Record<ReelLang, ReelStringSet> = {
  th: { /* values moved verbatim from reel-stage2-script.ts */ },
  en: { /* values moved verbatim from reel-stage2-script.ts */ },
  de: { /* German equivalents — first-pass copy, refinable later */ },
};
```

Thai (`th`) values are moved **verbatim** from the existing inline strings — no behaviour change for `ds`. English (`en`) values moved verbatim from the existing fallback branch — no behaviour change for `ns`. German (`de`) values are newly written.

German CTA appends will reference "TagesBrief" explicitly (e.g. " Folge TagesBrief, um keine Nachricht zu verpassen.").

#### `src/i18n/ui-strings.ts`
Lookup table for review-page UI labels. Replaces `isThai` ternaries in `src/review/utils.ts`, `src/review/reel-html-builder.ts`, and `src/pipeline/command-listener.ts` (Telegram messages).

```typescript
export interface UiStringSet {
  statusLabels: Record<RunStatus, { label: string }>;   // e.g. AWAITING APPROVAL → "AUF FREIGABE WARTEND"
  footerText: Record<RunStatus, string>;                 // status footer copy
  stageLogsLabel: string;                                // "Stage Logs" → "Ablaufprotokoll"
  reelReview: string;                                    // "Review page" → "Review-Seite"
  latestReel: string;                                    // "Latest reel" → "Neuestes Reel"
  status: string;                                        // "Status" → "Status"
  category: string;                                      // "Category" → "Kategorie"
  voice: string;                                         // "Voice" → "Stimme"
  voiceSpeed: string;                                    // "Voice speed" → "Sprechgeschwindigkeit"
  scenes: string;                                        // "Scenes" → "Szenen"
  musicVolume: string;                                   // "Music volume" → "Musiklautstärke"
  music: string;                                         // "Music" → "Musik"
  noneLabel: string;                                     // "None" → "Keine"
  language: string;                                      // "Language" → "Sprache"
  cameraEffect: string;                                  // "Camera effect" → "Kameraeffekt"
  hookCaption: string;                                   // "Hook caption"
  voiceover: string;                                     // "Voiceover" → "Voiceover"
  subtitleBlocks: string;                                // "Subtitle blocks" → "Untertitel-Blöcke"
  scene: string;                                         // "Scene" → "Szene"
  noTimings: string;                                     // "No word timings" → "Keine Word-Timings"
  postCaption: string;                                   // "Post Caption" → "Beitragsbeschriftung"
  willPostAsFirstComment: string;                        // first-comment note
  discoveryBias: string;                                 // "Discovery bias"
  selectionReason: string;                               // "Selection reason" → "Auswahlgrund"
  topicsAvoided: string;                                 // "Topics avoided" → "Vermiedene Themen"
  reelScript: string;                                    // "Reel Script" → "Reel-Skript"
  apiSources: string;                                    // "API Sources"
  captions: string;                                      // "Captions" → "Beschriftungen"
  images: string;                                        // "Images" → "Bilder"
}

export const UI_STRINGS: Record<"th" | "en" | "de", UiStringSet> = { ... };
```

Thai values are moved verbatim from the existing inline ternaries; English values from the fallback branches; German values are newly written.

### 2. Type system — `src/types.ts`

- L6: `export type BrandId = "ds" | "ns";` → `export type BrandId = "ds" | "ns" | "ts";`
- L45: `language: "th" | "en";` → `language: "th" | "en" | "de";`

The widening of `BrandId` will cause TypeScript compile errors at every literal-type hardcode (e.g. `"ds" | "ns"` in `reel-intake.ts`, `reel-assembly-worker.ts`) — these compile errors are desirable and force us to find and fix every touchpoint.

### 3. Brand registration

- `src/brands/index.ts` — import `ts`, add to `brands: Record<BrandId, BrandConfig>` map and named exports.
- `src/config.ts` L2, L4 — import `ts`, add to `ALL_BRANDS` array (drives server-startup env validation across all brands).

### 4. i18n refactor (consumers)

Each file below stops using inline `isThai` ternaries and instead reads from the i18n tables via the brand's `language` field.

- `src/stages/reel-stage2-script.ts`
  - `buildSystemPrompt` (L157-254): replace inline ternaries with `const S = REEL_STRINGS[ctx.brand.language];` then reference `S.langLabel`, `S.languageLine`, `S.hooksBlock`, `S.ctaBlock`, `S.wordCountBlock`, `S.ttsBlock`.
  - `ensureCTA` (L296-310): replace `CTA_SIGNALS_TH`/`CTA_SIGNALS_EN` and `CTA_APPENDS_TH`/`CTA_APPENDS_EN` arrays with `REEL_STRINGS[language].ctaSignals` and `.ctaAppends`. Remove the four now-unused const arrays.
- `src/stages/stage1-discover.ts`
  - L219, L419: `${brand.language === "th" ? "Thai" : "English"}` → `${REEL_STRINGS[brand.language].langLabel}`
  - L232-233: add `ts` rule for DACH+EU — `${brand.id === "ts" ? "- Prioritize German-language stories with direct relevance to DACH (Germany, Austria, Switzerland); fall back to broader European stories only if no strong DACH story exists" : ""}`
  - L433-436: same `ts` branch.
- `src/stages/stage0-from-url.ts` L109 — `ctx.brand.language === "th" ? "Thai" : "English"` → `REEL_STRINGS[ctx.brand.language].langLabel`.
- `src/stages/reel-stage3-voice.ts` L271 — language code lookup: `th → "th"`, `de → "de"`, default `"en"`. Implement as a small map or inline ternary on `language`.
- `src/review/utils.ts`
  - L12-13: add `const TS_LOGO_B64 = loadLogoBase64("tagesbrief_logo.png");`
  - L15-19 `brandLogoHtml`: switch from `brandId === "ds" ? DS_LOGO_B64 : NS_LOGO_B64` to a brand-keyed map: `{ ds: DS_LOGO_B64, ns: NS_LOGO_B64, ts: TS_LOGO_B64 }[brandId]`.
  - L21-26 `brandThemeCss`: add a `ts` branch with a distinct accent colour (proposed: deep green `#0E7C3A` with bright `#16A34A`, evoking freshness without colliding with ns red or ds blue). Final palette refinable.
  - L38-50 `statusBadgeHtml`, L52-69 `statusFooterText`, L78-97 `stageLogsHtml`: change signature from `isThai: boolean` to `language: "th" | "en" | "de"`, read labels from `UI_STRINGS[language]`. All call sites updated correspondingly.
- `src/review/reel-html-builder.ts` — replace `const isThai = ctx.brand.language === "th"` with `const S = UI_STRINGS[ctx.brand.language]` and update all `isThai ? "Thai string" : "English string"` ternaries to use the lookup. Pass `language` (not `isThai`) to child builders.
- `src/pipeline/command-listener.ts` L941 — same pattern: `const S = UI_STRINGS[brand.language]`; update Telegram message ternaries accordingly.

### 5. Dashboard

- `src/review/dashboard-html-builder.ts`
  - L69: `data.brandId === "ds" ? "ThaiDaily" : "WorldBrief"` → brand-label map: `{ ds: "ThaiDaily", ns: "WorldBrief", ts: "TagesBrief" }[data.brandId]`.
  - L103-104: add a third nav link: `<a href="/dashboard?brand=ts" class="${brandId === "ts" ? "active" : ""}">TagesBrief</a>`.

### 6. Type-literal hardcodes (surfaced by widening `BrandId`)

- `src/pipeline/reel-intake.ts` L5 — `brand: "ds" | "ns"` → `brand: BrandId` (import `BrandId` from `../types.js`).
- `src/workers/reel-assembly-worker.ts` L175 — `reel.brand as "ds" | "ns"` → `reel.brand as BrandId`.

### 7. Renderer asset map

- `src/stages/reel-stage5-hyperframes-renderer.ts`
  - L24-25 logo paths map: add `ts: path.join("assets", "brands", "tagesbrief_logo_white_transparent.png")`.
  - L281 hardcoded `assetName = "worldbrief_logo_white_transparent.png"` — refactor to brand-aware lookup using the same map.

### 8. Cosmetic

- `src/db/schema.ts` L5 — comment `// "ds" | "ns"` → `// "ds" | "ns" | "ts"`. *(Comment only — schema column is free-text `TEXT`, no migration needed.)*

### 9. Assets (user-provided)

- `assets/brands/tagesbrief_logo.png` — for review-page header (`brandLogoHtml`)
- `assets/brands/tagesbrief_logo_white_transparent.png` — for reel watermark overlay (hyperframes renderer)

Both must exist before stage5 render works for `ts`. The pipeline will still start without them (the logo loader already `try/catch`es missing files).

### 10. Environment variables (user sets in `.env`)

- `TS_META_PAGE_ID` *(required for publish)*
- `TS_META_PAGE_TOKEN` *(required for publish)*
- `TS_REEL_VOICE_ID` *(German ElevenLabs voice — required for voiceover)*
- `TELEGRAM_TS_CHAT_ID` *(required for approval flow)*
- `TS_TIKTOK_ACCESS_TOKEN` *(only if TikTok enabled later)*
- `LINE_TS_GROUP_ID` *(only if LINE enabled later)*

These are validated automatically by `validateEnv()` in `src/config.ts` because the loop iterates `ALL_BRANDS` and reads the `TS_` prefix. No new validation code needed.

## What doesn't change

- No DB migration (the `brand` column is `TEXT`, not enum-constrained).
- No new external services (Tavily, Gemini, ElevenLabs, GCS, Meta, Telegram all reused).
- No change to `ds` or `ns` user-facing behaviour — Thai and English strings move location but keep identical values.
- No change to reel-stage5 music or camera presets — `ts` reuses the shared asset pool.
- `useStockImages: false` — same as `ns` and `ds`.

## Testing

### Unit tests (Vitest)

1. **`tests/i18n/reel-strings.test.ts`** (new)
   - Verify `REEL_STRINGS.th` matches the previously-inline Thai strings byte-for-byte (regression guard for `ds`).
   - Verify `REEL_STRINGS.de` has all required keys populated and all `ctaSignals` regexes are valid.
   - Verify `REEL_STRINGS.en` has all required keys.
2. **`tests/i18n/ui-strings.test.ts`** (new)
   - Verify `UI_STRINGS.th`, `UI_STRINGS.en`, `UI_STRINGS.de` all expose the full `UiStringSet` shape.
3. **`tests/brands/ts.test.ts`** (new)
   - `getBrand("ts")` returns config with `id: "ts"`, `language: "de"`, non-empty `trustedSources`, `voiceId` from env, valid `reelTimes`/`reelTimesWeekend`.
4. Existing brand and reel tests must still pass.

### Type-level verification

- `npm run build` must succeed with zero TypeScript errors. The widened `BrandId` union will surface any missed touchpoint as a compile error — these must all be resolved before merging.

### Smoke test (post-deploy)

1. `npm run cli ts --dry-run --stage 1` — confirm German discovery prompt fires, German sources are queried, returned story is German-language and DACH-relevant.
2. `npm run cli ts --dry-run` (full dry run) — confirm German script generation, German TTS voice selection, German caption rendering all work end-to-end without publishing.
3. Set env vars, then `pm2 restart pipeline`. Trigger a real `ts` reel via Telegram approval flow on the `TELEGRAM_TS_CHAT_ID` chat. Confirm Facebook publish succeeds.

## Rollout

1. `npm run build`
2. `npm test`
3. Set env vars in `.env`
4. Place logo assets in `assets/brands/`
5. `pm2 restart pipeline` (never `pkill` or `nohup` — per `AGENTS.md` §2)
6. Smoke test with `npm run cli ts --dry-run --stage 1`
7. First real run via Telegram

## Prerequisites (user confirmations still needed)

- [x] Brand name: **TagesBrief** (genitive form for "capture of the day" meaning)
- [x] Localization scope: **parity with `ds`** (every Thai branch gets a German equivalent)
- [x] Instagram: **disabled** (matches `ns`)
- [x] Geographic focus: **DACH primary, EU fallback**
- [x] Approach: **B** (localize-by-lookup-table refactor)
- [ ] **German ElevenLabs voice ID** — user to provide, or leave `TS_REEL_VOICE_ID` env stub empty and configure at runtime
- [ ] **Logo assets** — `tagesbrief_logo.png` and `tagesbrief_logo_white_transparent.png` to be placed in `assets/brands/`
- [ ] **Meta page credentials** — `TS_META_PAGE_ID`, `TS_META_PAGE_TOKEN` for the TagesBrief Facebook page
- [ ] **Telegram chat** — `TELEGRAM_TS_CHAT_ID` for the approval channel
