-- D1 Database Schema for Constellation Connect

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    drawing_data TEXT,
    analysis_result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Saved constellations that appear in the public gallery.
-- strokes is a JSON array of {from, to, color, userId, t} for replay.
CREATE TABLE IF NOT EXISTS constellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    title TEXT NOT NULL,
    story TEXT,
    sky_view_kv_key TEXT,
    strokes TEXT NOT NULL,
    creators TEXT,
    like_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_constellations_created ON constellations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_constellations_likes ON constellations(like_count DESC);

-- One row per like, keyed by a fingerprint hash so a single browser can't spam.
CREATE TABLE IF NOT EXISTS likes (
    constellation_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (constellation_id, fingerprint),
    FOREIGN KEY (constellation_id) REFERENCES constellations(id)
);

-- Constellation battles: a prompt is issued, rooms submit drawings, AI judges.
CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open | judging | complete
    duration_seconds INTEGER NOT NULL DEFAULT 180,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME,
    winner_entry_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status, started_at DESC);

CREATE TABLE IF NOT EXISTS battle_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER NOT NULL,
    room_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    drawing_kv_key TEXT,
    strokes TEXT,
    score INTEGER,
    feedback TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (battle_id) REFERENCES battles(id)
);

CREATE INDEX IF NOT EXISTS idx_battle_entries_battle ON battle_entries(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_entries_score ON battle_entries(score DESC);
