-- 穿书引擎 v2 · 长期记忆库（Cloudflare D1 / SQLite）
-- 部署：npx wrangler d1 create chuanshu-memory && npx wrangler d1 migrations apply chuanshu-memory --remote
-- 本地：npx wrangler d1 migrations apply chuanshu-memory --local

CREATE TABLE IF NOT EXISTS saves (
  save_id    TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL,
  user_hash  TEXT NOT NULL,
  state      TEXT NOT NULL,        -- GameState JSON 快照（章末同步）
  chapter    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_hash, book_id, updated_at);

CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  save_id    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'fact',  -- fact | relationship | promise | secret
  content    TEXT NOT NULL,                 -- ≤80 字事实句
  importance INTEGER NOT NULL DEFAULT 1,    -- 1-3
  turn       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,    -- 淘汰标记：0=已出局
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_memories_save ON memories(save_id, active, importance, id);

CREATE TABLE IF NOT EXISTS summaries (
  save_id    TEXT NOT NULL,
  chapter    INTEGER NOT NULL,
  summary    TEXT NOT NULL,        -- ≤300 字章节摘要（GM 记忆注入用）
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (save_id, chapter)
);
