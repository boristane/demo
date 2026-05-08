-- D1 Database Schema for Constellation Connect

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v2: rebuild drawings with a score column
DROP TABLE IF EXISTS drawings;
CREATE TABLE drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    drawing_data TEXT,
    analysis_result TEXT,
    score INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v3: analytics tables (no indexes, wide rows, duplicated data)
DROP TABLE IF EXISTS analytics_events;
CREATE TABLE analytics_events (
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

DROP TABLE IF EXISTS ai_cache;
CREATE TABLE ai_cache (
    prompt TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v4: users table (plaintext password mirror, no unique constraints)
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    password_hash TEXT,
    api_key TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);