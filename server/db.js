// SQLite storage (Node's built-in node:sqlite, so there's nothing native to compile).
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  system TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  files TEXT NOT NULL DEFAULT '[]',
  size INTEGER, mtime INTEGER,
  crc TEXT, serial TEXT,
  title TEXT NOT NULL, sort_title TEXT, db_name TEXT, region TEXT, tags TEXT,
  year INTEGER, genre TEXT, players INTEGER, developer TEXT, publisher TEXT,
  discs INTEGER NOT NULL DEFAULT 1,
  matched INTEGER NOT NULL DEFAULT 0,
  art_box TEXT, art_snap TEXT, art_title TEXT, art_checked INTEGER NOT NULL DEFAULT 0,
  custom_title TEXT,
  added_at INTEGER NOT NULL,
  missing_since INTEGER
);
CREATE INDEX IF NOT EXISTS games_system ON games(system, sort_title);
CREATE INDEX IF NOT EXISTS games_crc ON games(crc);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS plays (
  profile_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  last_played INTEGER,
  seconds INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, game_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_profile ON sessions(profile_id, started_at);

CREATE TABLE IF NOT EXISTS states (
  profile_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  core TEXT,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, game_id, slot)
);

CREATE TABLE IF NOT EXISTS saves (
  profile_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  file TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, game_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_games (
  collection_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, game_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;");
  db.exec(SCHEMA);
  const stmtCache = new Map();
  const prep = (sql) => {
    let s = stmtCache.get(sql);
    if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
    return s;
  };
  return {
    raw: db,
    all: (sql, ...p) => prep(sql).all(...p),
    get: (sql, ...p) => prep(sql).get(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    tx(fn) {
      db.exec("BEGIN");
      try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    getSetting(key, fallback = null) {
      const row = prep("SELECT value FROM settings WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : fallback;
    },
    setSetting(key, value) {
      prep("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
    },
    close: () => db.close(),
  };
}
