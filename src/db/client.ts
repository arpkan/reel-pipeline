import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const dbPath = process.env.PIPELINE_DB_PATH ?? "./data/pipeline.db";

if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Auto-create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    run_date TEXT NOT NULL,
    theme TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    stages_completed INTEGER NOT NULL DEFAULT 0,
    review_url TEXT,
    telegram_offset INTEGER,
    line_offset INTEGER,
    stories TEXT,
    context TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    "index" INTEGER NOT NULL,
    pillar TEXT NOT NULL,
    headline TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    caption TEXT,
    text_overlay TEXT,
    image_prompt TEXT,
    image_path TEXT,
    image_failed INTEGER NOT NULL DEFAULT 0,
    image_source TEXT,
    scheduled_time TEXT,
    facebook_post_id TEXT,
    published_at TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id),
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
`);

// Migrate existing DBs — add columns that may not exist yet
try { sqlite.exec(`ALTER TABLE runs ADD COLUMN stories TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE runs ADD COLUMN line_offset INTEGER`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE runs ADD COLUMN context TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE posts ADD COLUMN published_at TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE posts ADD COLUMN image_source TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN context TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN facebook_post_id TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN category TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN snippet TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN current_stage TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN tik_tok_post_id TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reels ADD COLUMN published_at TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reel_metrics ADD COLUMN followers_gained INTEGER`); } catch { /* already exists */ }

// Migrate scheduled_time from "HH:MM" to "YYYY-MM-DD HH:MM" — combine with run_date
sqlite.exec(`
  UPDATE posts
  SET scheduled_time = (SELECT run_date FROM runs WHERE runs.id = posts.run_id) || ' ' || scheduled_time
  WHERE scheduled_time IS NOT NULL
    AND scheduled_time NOT LIKE '% %'
    AND length(scheduled_time) <= 5
`);

// LINE webhook events table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS line_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    text TEXT NOT NULL,
    user_id TEXT,
    line_timestamp INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reel_intake_sessions (
    brand TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    step TEXT NOT NULL,
    source_input TEXT,
    stage5_renderer TEXT,
    stage5_template TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (brand, chat_id)
  );
`);

try { sqlite.exec(`ALTER TABLE reel_intake_sessions ADD COLUMN stage5_renderer TEXT`); } catch { /* already exists */ }
try { sqlite.exec(`ALTER TABLE reel_intake_sessions ADD COLUMN stage5_template TEXT`); } catch { /* already exists */ }

// Theme weights table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS theme_weights (
    brand TEXT NOT NULL,
    theme TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (brand, theme)
  );
`);

// Reels table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    run_date TEXT NOT NULL,
    headline TEXT NOT NULL,
    source_url TEXT NOT NULL,
    script TEXT,
    video_gcs_url TEXT,
    review_url TEXT,
    status TEXT NOT NULL DEFAULT 'generating',
    scheduled_time TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    context TEXT,
    facebook_post_id TEXT,
    category TEXT,
    snippet TEXT,
    current_stage TEXT,
    tik_tok_post_id TEXT,
    published_at TEXT
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reel_start_locks (
    brand TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reel_schedule_locks (
    brand TEXT NOT NULL,
    slot_key TEXT NOT NULL,
    run_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (brand, slot_key)
  );
`);

// Assembly jobs table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS assembly_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES reels(id),
    brand TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 1,
    instance_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );
`);

// Batch runs table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS batch_runs (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepping',
    config TEXT,
    timing TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS batch_run_reels (
    batch_run_id TEXT NOT NULL REFERENCES batch_runs(id),
    reel_id TEXT NOT NULL REFERENCES reels(id),
    PRIMARY KEY (batch_run_id, reel_id)
  );
`);

// Performance metrics tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reel_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id TEXT NOT NULL REFERENCES reels(id),
    fetched_at TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'facebook',
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    saves INTEGER,
    reach INTEGER,
    watch_time_sec REAL,
    total_watch_time_sec REAL
  );

  CREATE TABLE IF NOT EXISTS performance_benchmarks (
    brand_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    dimension_value TEXT NOT NULL,
    period TEXT NOT NULL,
    avg_views REAL,
    avg_engagement_rate REAL,
    avg_watch_time REAL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (brand_id, dimension, dimension_value, period)
  );

  CREATE TABLE IF NOT EXISTS performance_scores (
    reel_id TEXT PRIMARY KEY REFERENCES reels(id),
    views_ratio REAL,
    engagement_ratio REAL,
    overall_score REAL,
    computed_at TEXT NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS follower_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    date TEXT NOT NULL,
    total_followers INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE(brand, date)
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    language TEXT NOT NULL,
    styles TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    telegram_chat_id TEXT NOT NULL UNIQUE,
    profile_name TEXT NOT NULL,
    audience_language TEXT NOT NULL,
    audience_description TEXT NOT NULL,
    preferred_voice_id TEXT,
    preferred_voice_provider TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS story_intake_sessions (
    chat_id TEXT PRIMARY KEY,
    clips TEXT NOT NULL,
    total_size_mb REAL NOT NULL,
    total_duration_sec REAL NOT NULL,
    pending_music_override TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS story_setup_requests (
    chat_id TEXT PRIMARY KEY,
    chat_title TEXT,
    chat_type TEXT,
    chat_username TEXT,
    profile_name TEXT NOT NULL,
    audience_language TEXT NOT NULL,
    audience_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS story_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT REFERENCES profiles(id),
    telegram_chat_id TEXT NOT NULL,
    source_clips_metadata TEXT NOT NULL,
    clip_count INTEGER NOT NULL,
    total_clips_size_mb REAL NOT NULL,
    total_source_duration_sec REAL NOT NULL,
    user_note TEXT,
    music_path TEXT,
    music_title TEXT,
    music_artist TEXT,
    music_genre_used TEXT,
    voice_id_used TEXT,
    voice_provider_used TEXT,
    duration_used_sec REAL,
    direction_json TEXT,
    work_dir TEXT,
    voiceover_path TEXT,
    gemini_input_tokens INTEGER,
    gemini_output_tokens INTEGER,
    gemini_cost_usd REAL,
    video_gcs_url TEXT,
    review_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    current_stage TEXT,
    stage_logs TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE VIEW IF NOT EXISTS story_runs_validation AS
  SELECT
    r.id,
    r.telegram_chat_id AS telegramChatId,
    p.audience_language AS language,
    r.user_note AS userNote,
    r.clip_count AS clipCount,
    r.total_source_duration_sec AS totalSourceDurationSec,
    json_extract(r.direction_json, '$.inferred_content_type') AS gemini_inferred_content_type,
    json_extract(r.direction_json, '$.inferred_voice_style') AS gemini_inferred_voice_style,
    r.voice_id_used AS voiceIdUsed,
    r.voice_provider_used AS voiceProviderUsed,
    r.music_genre_used AS musicGenreUsed,
    r.duration_used_sec AS durationUsedSec,
    r.gemini_cost_usd AS geminiCostUsd,
    r.status,
    r.error,
    r.created_at AS createdAt
  FROM story_runs r
  LEFT JOIN profiles p ON p.id = r.profile_id;
`);

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
