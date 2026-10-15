import type { VoiceEntry } from "./services/voice-provider.js";
import type { Stage5PerformanceConfig } from "./stages/reel-stage5-performance.js";

// ─── Brand ───────────────────────────────────────────────────────────────────

export type BrandId = "ds" | "ns" | "ts";

export type ReelCategory = "breaking" | "trending" | "human_interest" | "business" | "open";

export type CameraEffectType = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "ken_burns" | "none";

export type HyperframesCameraPreset =
  | "cinematic_drift"
  | "urgent_push"
  | "slow_reveal"
  | "documentary_slide"
  | "portrait_float"
  | "locked_frame";

export type Theme =
  | "Tech" | "Health" | "Economy" | "Politics" | "Entertainment"
  | "Environment" | "Science" | "Sports" | "Lifestyle";

export interface ChannelConfig {
  telegram?: {
    enabled: boolean;
    chatIdEnvVar: string;        // env var name e.g. "TELEGRAM_CHAT_ID"
  };
  line?: {
    enabled: boolean;
    groupIdEnvVar: string;       // env var name e.g. "LINE_DS_GROUP_ID"
  };
}

export interface TrendingConfig {
  googleNewsGeos?: string[];       // e.g. ["TH"] or ["US", "GB"]
  googleNewsLang?: string;         // e.g. "en", "th" — used in RSS URL hl= param
  youtubeRegionCode?: string;      // e.g. "TH", "DE"
  youtubeQuery?: string;           // e.g. "ข่าวไทย", "news europe"
}

export interface BrandConfig {
  id: BrandId;
  name: string;
  language: "th" | "en" | "de";
  timezone: string;
  postTimes: string[];           // e.g. ["08:00", "19:30"]
  weekdays: {
    mon: boolean;
    tue: boolean;
    wed: boolean;
    thu: boolean;
    fri: boolean;
    sat: boolean;
    sun: boolean;
  };
  trustedSources: string[];      // domain names e.g. "thairath.co.th"
  geographicFocus: string;       // e.g. "Thailand" or "Europe, Germany"
  viralCheck: boolean;
  trendingConfig?: TrendingConfig;
  gcsPrefix: string;             // e.g. "dscontent"
  metaPageId: string;            // read from env at runtime
  metaPageToken: string;         // read from env at runtime
  instagramEnabled?: boolean;    // publish reels to Instagram as well
  postSourceAsComment?: boolean; // post source link as first comment instead of in caption
  tikTokEnabled?: boolean;       // publish reels to TikTok
  tikTokAccessToken?: string;    // read from env at runtime
  channels: ChannelConfig;       // messaging channels for notifications and approval
  reels?: ReelConfig;            // optional reel video configuration
  useStockImages: boolean;
}

// ─── Story ────────────────────────────────────────────────────────────────────

export interface Story {
  index: number;                 // position in original candidate list
  headline: string;              // result.title from Tavily (trimmed)
  source: string;                // hostname e.g. "thairath.co.th"
  sourceUrl: string;             // result.url from Tavily — locked at step 1b, never modified by AI
  snippet: string;               // result.content — passed to caption stage
  theme?: Theme;                 // topic classification from Gemini
  selectionReason: string;       // Gemini's reasoning text
  compositeScore: number;        // for debugging / review page
  verified: boolean;             // confirmed via Tavily verification search
  verifiedBy?: string;           // outlet domain that confirmed the story
  viralFlag?: boolean;           // set by stage 1b (DS only)
  sourceReadMode?: "tavily_extract" | "url_model_read";
  sourceExtractChars?: number;
  sourceExtractDownloadUrl?: string;
  sourceExtractAvailable?: boolean;
  sourceExtractText?: string;
}

// ─── Post ─────────────────────────────────────────────────────────────────────

export interface Post {
  index: number;                 // 0 or 1 (post 1 or post 2)
  story: Story;
  caption: string;
  textOverlay: string;
  imagePrompt: string;
  imagePath?: string;            // GCS public URL after upload
  imageFailed?: boolean;         // true if all image gen attempts failed
  imageSource?: ImageSource;         // how the image was obtained
  scheduledTime: string;         // ISO timestamp
  facebookPostId?: string;       // set after publish
  publishedAt?: string;          // ISO timestamp, set after publish
  approved: boolean;
}

// ─── Pipeline run ─────────────────────────────────────────────────────────────

export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "approved"
  | "published"
  | "rejected"
  | "failed"
  | "cancelled";

export interface StageLog {
  stage: string;
  status: "ok" | "error" | "skipped";
  durationMs: number;
  error?: string;
}

export type CategorySource = "scheduled" | "manual" | "rerescript";

export interface RunContext {
  runId: string;
  brand: BrandConfig;
  runDate: string;               // YYYY-MM-DD in brand timezone
  theme?: Theme;
  trendingSignals?: import("./services/trending.js").TrendingSignals;
  reelCategoryBias?: string;     // soft bias hint injected into discovery for reels only
  excludedTopics?: string[];      // recent headlines from posts + reels — used by topic dedup
  reelRecentUrls?: string[];      // source URLs of recent reels — used by dedup prompt
  manualSourceHintText?: string;  // operator-provided hint text for reel discovery
  stories: Story[];
  posts: Post[];
  reviewUrl?: string;
  approvalDecision?: ApprovalDecision;
  stageLogs: StageLog[];
  status: RunStatus;
  useStockImages?: boolean;
  apiSourceMap?: ApiSourceMap;
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export type ApprovalAction =
  | "approve_all"
  | "approve"
  | "edit"
  | "reject"
  | "new_image"
  | "new_text"
  | "reschedule";

export interface ApprovalDecision {
  action: ApprovalAction;
  postIndices?: number[];        // which posts this applies to
  publishNow?: boolean;          // true = publish immediately, bypass cron
  editPayload?: {
    caption?: string;
    textOverlay?: string;
    newTime?: string;
  };
}

// ─── Stage interface ──────────────────────────────────────────────────────────

export interface Services {
  search: import("./services/search.js").SearchService;
  bedrock: import("./services/bedrock.js").BedrockService;
  gemini: import("./services/gemini.js").GeminiService;
  imageGen: import("./services/image-gen.js").ImageGenService;
  stockImage: import("./services/stock-image.js").StockImageService;
  gcs: import("./services/gcs.js").GcsService;
  telegram: import("./services/telegram.js").TelegramService;
  line: import("./services/line.js").LineService | null;
  meta: import("./services/meta.js").MetaService;
}

export interface Stage {
  name: string;
  run(ctx: RunContext, services: Services): Promise<Partial<RunContext>>;
}

// ─── Image gen ────────────────────────────────────────────────────────────────

export interface ImageGenOptions {
  width?: number;
  height?: number;
  style?: string;
  aspectRatio?: "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
}

export type StockProvider = "unsplash" | "pexels" | "pixabay";

export type ApiProvider = "native" | "azure";

export interface ApiSourceMap {
  captions?: ApiProvider;
  discovery?: ApiProvider;
  images?: ApiProvider;
}

export type ImageSource =
  | { type: "stock"; provider: StockProvider }
  | { type: "ai"; model: string; provider?: ApiProvider }
  | { type: "failed" }; // Explicit failure state, distinct from "not yet attempted"

// ─── Reel ─────────────────────────────────────────────────────────────────────

export type Stage5RendererType = "hyperframes";
export type Stage5TemplateName = "enhanced-default";
export type HyperframesRenderQuality = "draft" | "standard" | "high";

export interface Stage5RenderSettings {
  fps: number;
  quality: HyperframesRenderQuality;
  workers: number;
  timeoutMs: number;
  performanceProfile: import("./stages/reel-stage5-performance.js").Stage5EffectQuality;
}

export interface Stage5RenderTelemetry {
  renderer: Stage5RendererType;
  template?: Stage5TemplateName;
  fps?: number;
  quality?: HyperframesRenderQuality;
  workers?: number;
  durationMs: number;
  outputBytes?: number;
  mode?: "local" | "offloaded";
}

export interface ReelConfig {
  enabled: boolean;
  scheduleEnabled?: boolean; // master switch — enables automated cron scheduling
  voiceId: string;                    // primary voice (used as fallback if voiceIds not set)
  voiceIds?: string[];                // pool — one is picked randomly per reel
  voiceSpeeds?: Record<string, number>; // per-voice atempo override, e.g. { "abc123": 1.2 }
  voiceSpeed?: number;   // atempo multiplier, default 1.2 (e.g. 1.3 = 30% faster)
  voices?: VoiceEntry[]; // provider-tagged voice pool; takes precedence over voiceIds/voiceId
  voicesFull?: VoiceEntry[]; // full pool before env override; used by re-voice command
  sceneCount: number;
  reelTimes: Array<string | { time: string; category?: ReelCategory; theme?: Theme }>;
  reelTimesWeekend?: Array<string | { time: string; category?: ReelCategory; theme?: Theme }>;
  musicFiles?: string[]; // fallback pool — used when no category-specific tracks defined
  musicByCategory?: Partial<Record<ReelCategory, string[]>>; // category → track paths
  cameraEffectByCategory?: Partial<Record<ReelCategory, CameraEffectType>>; // category → camera motion effect
  cameraPresetByCategory?: Partial<Record<ReelCategory, HyperframesCameraPreset>>;
  musicVolume?: number;  // 0.0 - 1.0, default 0.13
  stage5Performance?: Stage5PerformanceConfig;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
}

export interface WordTiming {
  word: string;
  start: number; // seconds (already atempo-adjusted)
  end: number;
}

export interface ReelScene {
  sceneNumber: number;
  voiceover: string;       // spoken text
  caption: string;         // hook caption (0-2s)
  imagePrompt: string;     // image generation prompt
  durationSeconds?: number; // filled in after audio generation
  wordTimings?: WordTiming[]; // word-level sync data (filled in after audio generation)
}

export interface ReelScript {
  category?: ReelCategory;  // auto-selected or forced
  title: string;
  scenes: ReelScene[];
  hashtags: string[];  // 3-5 relevant hashtags e.g. ["#SpainAirspace", "#IranWar", "#BreakingNews"]
}

export interface ReelContext {
  runId: string;
  brand: BrandConfig;
  runDate: string;
  workDir?: string;          // persistent working directory for all stage artifacts
  theme?: Theme;
  category?: ReelCategory;       // explicit override; if unset, auto-picked in stage 1
  categorySource?: CategorySource; // how category was set: scheduled slot, manual command, rerescript
  discoveryBias?: string;          // the bias text injected into discovery for this category
  recentTopics?: string[];         // headlines excluded to avoid repetition
  trendingSignals?: import("./services/trending.js").TrendingSignals;
  story?: Story;
  script?: ReelScript;
  previousScript?: ReelScript;
  audioPaths?: string[];   // local temp mp3 paths
  imagePaths?: string[];   // local temp png paths
  imageSourceMap?: Record<number, ImageSource>; // sceneNumber → source
  videoPath?: string;      // local temp mp4 path
  videoGcsUrl?: string;    // GCS public URL after upload
  reviewUrl?: string;
  musicFile?: string;      // filename of background music used
  musicTrackOverride?: string; // optional music selector: 1-based index or basename
  cameraEffect?: CameraEffectType; // user-overridden camera effect (takes precedence over category default)
  cameraPreset?: HyperframesCameraPreset;
  voiceSpeed?: number; // user-overridden voice speed multiplier (takes precedence over brand config)
  voiceId?: string; // user-overridden voice ID (takes precedence over brand config)
  usedVoiceId?: string; // actual voice ID used (set after stage3)
  usedVoiceProvider?: string; // actual provider used (set after stage3)
  usedVoiceSpeed?: number; // actual speed used after overrides (set after stage3)
  usedCameraEffect?: CameraEffectType; // actual camera effect resolved by stage5 (set after stage5)
  usedCameraPreset?: HyperframesCameraPreset;
  status: RunStatus;
  stageLogs: StageLog[];
  useStockImages?: boolean;
  apiSourceMap?: ApiSourceMap;
  stage5Performance?: Stage5PerformanceConfig;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  stage5RenderSettings?: Stage5RenderSettings;
  stage5RenderTelemetry?: Stage5RenderTelemetry;
  manualSourceMode?: "text" | "hint";
  manualSourceInput?: string;
  manualSourceText?: string;
  manualSourceTextInputType?: "pasted" | "txt_upload";
  manualSourceHintText?: string;
  progressNote?: string; // last-known stage action; appended to stage timeout errors
  isImageRebuild?: boolean; // true when re-images is invoked; stage4 adds prompt variation
}

export interface ReelStage {
  name: string;
  run(ctx: ReelContext): Promise<Partial<ReelContext>>;
}

export interface ReelRunOptions {
  sourceUrls?: string[];
  theme?: Theme;
  category?: ReelCategory;          // explicit category; skips auto-selection and biases discovery
  categorySource?: CategorySource;  // how this run was triggered
  cameraEffect?: CameraEffectType;  // force a specific camera effect, overriding category default
  cameraPreset?: HyperframesCameraPreset;
  dryRun?: boolean;
  useStockImages?: boolean;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  manualSourceMode?: "text" | "hint";
  manualSourceInput?: string;
  manualSourceText?: string;
  manualSourceTextInputType?: "pasted" | "txt_upload";
}
