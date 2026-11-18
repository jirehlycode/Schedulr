'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'schedulr.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  duration_min      INTEGER NOT NULL DEFAULT 30,
  location          TEXT NOT NULL DEFAULT '',
  color             TEXT NOT NULL DEFAULT '#006bff',
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min  INTEGER NOT NULL DEFAULT 0,
  min_notice_min    INTEGER NOT NULL DEFAULT 240,
  max_days_ahead    INTEGER NOT NULL DEFAULT 60,
  slot_interval_min INTEGER,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, slug)
);

-- Weekly recurring hours. weekday: 1 = Monday ... 7 = Sunday (ISO / Luxon).
-- start_min / end_min are minutes after local midnight in the host's timezone.
CREATE TABLE IF NOT EXISTS availability (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,
  CHECK (end_min > start_min)
);

-- Per-date overrides. A row with NULL start/end marks the whole day unavailable.
CREATE TABLE IF NOT EXISTS date_overrides (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  start_min INTEGER,
  end_min   INTEGER
);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type_id    INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_name     TEXT NOT NULL,
  invitee_email    TEXT NOT NULL,
  invitee_timezone TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  start_utc        TEXT NOT NULL,
  end_utc          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','canceled')),
  cancel_reason    TEXT,
  canceled_by      TEXT,
  token            TEXT NOT NULL UNIQUE,
  rescheduled_from INTEGER REFERENCES bookings(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_time ON bookings(user_id, start_utc);
CREATE INDEX IF NOT EXISTS idx_avail_user ON availability(user_id);
CREATE INDEX IF NOT EXISTS idx_overrides_user ON date_overrides(user_id, date);
`);

/** Run fn inside a transaction (BEGIN IMMEDIATE so concurrent bookings serialize). */
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const q = {
  get: (sql, ...params) => db.prepare(sql).get(...params),
  all: (sql, ...params) => db.prepare(sql).all(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};

module.exports = { db, q, transaction };
