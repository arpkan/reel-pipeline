import type { BrandConfig } from "../types.js";
import { assetPath } from "../paths.js";
import type { VoiceEntry } from "../services/voice-provider.js";

export const ts: BrandConfig = {
  id: "ts",
  name: "TagesBrief",
  language: "de",
  timezone: "Europe/Berlin",
  postTimes: ["08:00", "20:00"],
  weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false },

  trustedSources: [
    "spiegel.de",
    "zeit.de",
    "faz.net",
    "sueddeutsche.de",
    "tagesschau.de",
    "deutschlandfunk.de",
    "dw.com/de",
    "handelsblatt.com",
    "wiwo.de",
    "manager-magazin.de",
    "bild.de",
    "rtl.de",
    "n-tv.de",
    "stern.de",
    "focus.de",
    "orf.at",
    "derstandard.at",
    "nzz.ch",
    "admin.ch",
  ],

  geographicFocus: "DACH region (Germany, Austria, Switzerland) — prioritize German-language stories with direct relevance to German-speaking audiences. Fall back to broader European stories only if no strong DACH story exists.",

  viralCheck: false,
  trendingConfig: {
    googleNewsGeos: ["DE", "AT", "CH"],
    googleNewsLang: "de",
    youtubeRegionCode: "DE",
    youtubeQuery: "deutsche nachrichten heute",
  },
  gcsPrefix: "tscontent",
  metaPageId: process.env.TS_META_PAGE_ID ?? "",
  metaPageToken: process.env.TS_META_PAGE_TOKEN ?? "",
  instagramEnabled: false,
  postSourceAsComment: true,
  tikTokEnabled: false,
  tikTokAccessToken: process.env.TS_TIKTOK_ACCESS_TOKEN ?? "",
  channels: {
    telegram: { enabled: true, chatIdEnvVar: "TELEGRAM_TS_CHAT_ID" },
    line: { enabled: false, groupIdEnvVar: "LINE_TS_GROUP_ID" },
  },
  reels: {
    enabled: true,
    scheduleEnabled: true,
    voiceId: process.env.TS_REEL_VOICE_ID ?? "",
    voiceIds: [process.env.TS_REEL_VOICE_ID ?? ""],
    voices: [
      { id: process.env.TS_REEL_VOICE_ID ?? "", provider: "elevenlabs" as const },
    ] satisfies VoiceEntry[],
    voicesFull: [
      { id: process.env.TS_REEL_VOICE_ID ?? "", provider: "elevenlabs" as const },
    ] satisfies VoiceEntry[],
    sceneCount: 4,
    reelTimes: [
      { time: "07:30", category: "trending" },
      { time: "12:00", category: "business" },
      { time: "16:30", category: "trending" },
      { time: "21:00", category: "trending" },
    ],
    reelTimesWeekend: [
      { time: "09:30", category: "trending" },
      { time: "14:30", category: "business" },
      { time: "18:30", category: "trending" },
      { time: "22:00", category: "trending" },
    ],
    musicByCategory: {
      breaking:       [assetPath("music", "breaking-news-1.mp3"), assetPath("music", "breaking-news-2.mp3"), assetPath("music", "breaking-news-3.mp3"), assetPath("music", "breaking-news-4.mp3"), assetPath("music", "breaking-news-6.mp3")],
      trending:       [assetPath("music", "trending-1.mp3"), assetPath("music", "trending-2.mp3"), assetPath("music", "trending-3.mp3"), assetPath("music", "trending-5.mp3")],
      human_interest: [assetPath("music", "human-interest-1.mp3"), assetPath("music", "human-interest-2.mp3"), assetPath("music", "human-interest-3.mp3"), assetPath("music", "human-interest-4.mp3"), assetPath("music", "human-interest-5.mp3"), assetPath("music", "human-interest-6.mp3"), assetPath("music", "human-interest-7.mp3"), assetPath("music", "human-interest-8.mp3")],
      business:       [assetPath("music", "business-1.mp3"), assetPath("music", "business-2.mp3"), assetPath("music", "business-3.mp3"), assetPath("music", "business-4.mp3")],
      open:           [assetPath("music", "open-1.mp3"), assetPath("music", "open-2.mp3"), assetPath("music", "open-3.mp3"), assetPath("music", "open-4.mp3")],
    },
    cameraEffectByCategory: {
      breaking:       "zoom_in",
      trending:       "ken_burns",
      human_interest: "pan_left",
      business:       "zoom_in",
      open:           "ken_burns",
    },
    cameraPresetByCategory: {
      breaking:       "urgent_push",
      trending:       "cinematic_drift",
      human_interest: "documentary_slide",
      business:       "slow_reveal",
      open:           "cinematic_drift",
    },
    musicFiles: [
      assetPath("music", "breaking-news-1.mp3"),
      assetPath("music", "breaking-news-2.mp3"),
      assetPath("music", "upbeat-1.mp3"),
    ],
    musicVolume: 0.20,
    stage5Renderer: "hyperframes",
    stage5Template: "enhanced-default",
    stage5Performance: {
      effectQuality: "balanced",
    },
  },
  useStockImages: false,
};
