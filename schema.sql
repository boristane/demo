-- D1 Database Schema for Constellation Connect

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v2: Add score column to drawings table (use ALTER instead of DROP to preserve data)
-- Note: D1 doesn't support ALTER TABLE ADD COLUMN in early versions,
-- so we need to create a new table, migrate data, and drop old one in a transaction
-- For production, use proper migration tools like node-pg-migrate or wrangler d1 migrations

-- Create new table with all columns
CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    drawing_data TEXT,
    analysis_result TEXT,
    score INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v3: Analytics tables with proper indexes
-- Note: Add indexes after tables are created for performance
CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT,
    user_id TEXT,
    event_type TEXT,
    event_payload TEXT,
    drawing_data_copy TEXT,
    analysis_result_copy TEXT,
    ai_summary TEXT,
    r2_snapshot_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v4: Users table with unique constraints and proper password storage
-- Note: passwords are stored as hashes only, never plaintext
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    api_key TEXT UNIQUE,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for commonly queried columns
CREATE INDEX IF NOT EXISTS idx_sessions_room ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_drawings_room ON drawings(room_id);
CREATE INDEX IF NOT EXISTS idx_analytics_room ON analytics_events(room_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);