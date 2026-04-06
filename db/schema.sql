PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (
    id        INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL UNIQUE,
    applied_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS meetings (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    audio_path TEXT,
    transcript TEXT,
    summary    TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS action_items (
    id           TEXT PRIMARY KEY,
    meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    assignee     TEXT,
    due_date     TEXT,
    status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'done', 'stale')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS participants (
    id         TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    email      TEXT
);

CREATE TABLE IF NOT EXISTS ci_checks (
    id          TEXT PRIMARY KEY,
    action_id   TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
    check_type  TEXT NOT NULL,
    config      TEXT NOT NULL DEFAULT '{}',
    cron_expr   TEXT NOT NULL,
    last_run    TEXT,
    last_result TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS templates (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    prompt TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'markdown'
);

CREATE INDEX IF NOT EXISTS idx_action_items_meeting_id ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status     ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_participants_meeting_id  ON participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_ci_checks_action_id      ON ci_checks(action_id);
CREATE INDEX IF NOT EXISTS idx_ci_checks_enabled        ON ci_checks(enabled);
CREATE INDEX IF NOT EXISTS idx_meetings_started_at      ON meetings(started_at);

CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
    title,
    transcript,
    summary,
    content='meetings',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE ON meetings BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;
