import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),                          // uuid
  brand: text("brand").notNull(),                       // "ds" | "ns" | "ts"
  runDate: text("run_date").notNull(),                  // YYYY-MM-DD
  theme: text("theme"),
  status: text("status").notNull().default("running"),  // RunStatus
  stagesCompleted: integer("stages_completed").notNull().default(0),
  reviewUrl: text("review_url"),
  telegramOffset: integer("telegram_offset"),           // last update_id + 1 for resume
  lineOffset: integer("line_offset"),                   // last LINE event id + 1 for resume
  stories: text("stories"),                             // JSON — saved after stage 1 for resumability
  context: text("context"),                             // JSON — { trendingSignals, themeSource, pillarBalance }
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const lineEvents = sqliteTable("line_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: text("group_id").notNull(),
  text: text("text").notNull(),
  userId: text("user_id"),
  lineTimestamp: integer("line_timestamp").notNull(),   // LINE event timestamp ms
  createdAt: text("created_at").notNull(),
});

export const reelIntakeSessions = sqliteTable("reel_intake_sessions", {
  brand: text("brand").notNull(),
  chatId: text("chat_id").notNull(),
  mode: text("mode").notNull(),
  step: text("step").notNull(),
  sourceInput: text("source_input"),
  stage5Renderer: text("stage5_renderer"),
  stage5Template: text("stage5_template"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.brand, t.chatId] }),
}));

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),                          // uuid
  runId: text("run_id").notNull().references(() => runs.id),
  index: integer("index").notNull(),                    // 0 or 1
  pillar: text("pillar").notNull(),
  headline: text("headline").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull(),
  caption: text("caption"),
  textOverlay: text("text_overlay"),
  imagePrompt: text("image_prompt"),
  imagePath: text("image_path"),
  imageFailed: integer("image_failed", { mode: "boolean" }).notNull().default(false),
  imageSource: text("image_source"),                    // JSON ImageSource — nullable
  scheduledTime: text("scheduled_time"),
  facebookPostId: text("facebook_post_id"),
  publishedAt: text("published_at"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const themeWeights = sqliteTable("theme_weights", {
  brand: text("brand").notNull(),
  theme: text("theme").notNull(),
  weight: integer("weight").notNull().default(1),
}, (t) => ({
  pk: primaryKey({ columns: [t.brand, t.theme] }),
}));

export const reels = sqliteTable("reels", {
  id: text("id").primaryKey(),                          // runId (uuid)
  brand: text("brand").notNull(),
  runDate: text("run_date").notNull(),
  headline: text("headline").notNull(),
  sourceUrl: text("source_url").notNull(),
  script: text("script"),                               // JSON ReelScript
  category: text("category"),                           // ReelCategory — auto-selected or forced
  snippet: text("snippet"),                             // story snippet — stored for rerescript
  context: text("context"),                             // JSON { themeSource, pillarBalance, trendingSignals }
  videoGcsUrl: text("video_gcs_url"),
  reviewUrl: text("review_url"),
  status: text("status").notNull().default("generating"),
  currentStage: text("current_stage"),                    // live stage name while generating
  scheduledTime: text("scheduled_time"),
  publishedAt: text("published_at"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  facebookPostId: text("facebook_post_id"),
  tikTokPostId: text("tik_tok_post_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assemblyJobs = sqliteTable("assembly_jobs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => reels.id),
  brand: text("brand").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(1),
  instanceId: text("instance_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  updatedAt: text("updated_at").notNull(),
});

export const reelSchedule = sqliteTable("reel_schedule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),
  time: text("time").notNull(),   // "HH:MM" — target post time (cron fires 30min before)
}, (t) => ({
  pk: primaryKey({ columns: [t.brand, t.time] }),
}));

export const reelStartLocks = sqliteTable("reel_start_locks", {
  brand: text("brand").primaryKey(),
  runId: text("run_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reelScheduleLocks = sqliteTable("reel_schedule_locks", {
  brand: text("brand").notNull(),
  slotKey: text("slot_key").notNull(),
  runId: text("run_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.brand, t.slotKey] }),
}));

export const stageLogs = sqliteTable("stage_logs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => runs.id),
  stage: text("stage").notNull(),
  status: text("status").notNull(),                     // "ok" | "error" | "skipped"
  durationMs: integer("duration_ms").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const batchRuns = sqliteTable("batch_runs", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull(),
  count: integer("count").notNull(),
  status: text("status").notNull().default("prepping"),
  config: text("config"),
  timing: text("timing"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const batchRunReels = sqliteTable("batch_run_reels", {
  batchRunId: text("batch_run_id").notNull().references(() => batchRuns.id),
  reelId: text("reel_id").notNull().references(() => reels.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.batchRunId, t.reelId] }),
}));

export const reelMetrics = sqliteTable("reel_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reelId: text("reel_id").notNull().references(() => reels.id),
  fetchedAt: text("fetched_at").notNull(),
  platform: text("platform").notNull().default("facebook"),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  reach: integer("reach"),
  watchTimeSec: real("watch_time_sec"),
  totalWatchTimeSec: real("total_watch_time_sec"),
  followersGained: integer("followers_gained"),
});

export const performanceBenchmarks = sqliteTable("performance_benchmarks", {
  brandId: text("brand_id").notNull(),
  dimension: text("dimension").notNull(),
  dimensionValue: text("dimension_value").notNull(),
  period: text("period").notNull(),
  avgViews: real("avg_views"),
  avgEngagementRate: real("avg_engagement_rate"),
  avgWatchTime: real("avg_watch_time"),
  sampleCount: integer("sample_count").notNull().default(0),
  computedAt: text("computed_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.brandId, t.dimension, t.dimensionValue, t.period] }),
}));

export const performanceScores = sqliteTable("performance_scores", {
  reelId: text("reel_id").primaryKey().references(() => reels.id),
  viewsRatio: real("views_ratio"),
  engagementRatio: real("engagement_ratio"),
  overallScore: real("overall_score"),
  computedAt: text("computed_at").notNull(),
});

export const followerSnapshots = sqliteTable("follower_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),
  date: text("date").notNull(),             // YYYY-MM-DD
  totalFollowers: integer("total_followers").notNull(),
  fetchedAt: text("fetched_at").notNull(),
}, (t) => ({
  uniq: uniqueIndex("follower_snapshots_brand_date_uniq").on(t.brand, t.date),
}));

export const voices = sqliteTable("voices", {
  id: text("id").primaryKey(),
  voiceId: text("voice_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  language: text("language").notNull(),
  styles: text("styles").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  telegramChatId: text("telegram_chat_id").notNull(),
  profileName: text("profile_name").notNull(),
  audienceLanguage: text("audience_language").notNull(),
  audienceDescription: text("audience_description").notNull(),
  preferredVoiceId: text("preferred_voice_id"),
  preferredVoiceProvider: text("preferred_voice_provider"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  telegramChatIdIdx: uniqueIndex("profiles_telegram_chat_id_uniq").on(t.telegramChatId),
}));

export const storyIntakeSessions = sqliteTable("story_intake_sessions", {
  chatId: text("chat_id").primaryKey(),
  clips: text("clips").notNull(),
  totalSizeMb: real("total_size_mb").notNull(),
  totalDurationSec: real("total_duration_sec").notNull(),
  pendingMusicOverride: text("pending_music_override"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storySetupRequests = sqliteTable("story_setup_requests", {
  chatId: text("chat_id").primaryKey(),
  chatTitle: text("chat_title"),
  chatType: text("chat_type"),
  chatUsername: text("chat_username"),
  profileName: text("profile_name").notNull(),
  audienceLanguage: text("audience_language").notNull(),
  audienceDescription: text("audience_description").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storyRuns = sqliteTable("story_runs", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id),
  telegramChatId: text("telegram_chat_id").notNull(),
  sourceClipsMetadata: text("source_clips_metadata").notNull(),
  clipCount: integer("clip_count").notNull(),
  totalClipsSizeMb: real("total_clips_size_mb").notNull(),
  totalSourceDurationSec: real("total_source_duration_sec").notNull(),
  userNote: text("user_note"),
  musicPath: text("music_path"),
  musicTitle: text("music_title"),
  musicArtist: text("music_artist"),
  musicGenreUsed: text("music_genre_used"),
  voiceIdUsed: text("voice_id_used"),
  voiceProviderUsed: text("voice_provider_used"),
  durationUsedSec: real("duration_used_sec"),
  directionJson: text("direction_json"),
  workDir: text("work_dir"),
  voiceoverPath: text("voiceover_path"),
  geminiInputTokens: integer("gemini_input_tokens"),
  geminiOutputTokens: integer("gemini_output_tokens"),
  geminiCostUsd: real("gemini_cost_usd"),
  videoGcsUrl: text("video_gcs_url"),
  reviewUrl: text("review_url"),
  status: text("status").notNull().default("pending"),
  currentStage: text("current_stage"),
  stageLogs: text("stage_logs"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
