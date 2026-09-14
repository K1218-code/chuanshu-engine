-- 书籍数据权威存储（KV 传播延迟的兜底；D1 强一致，写入立即可读）
-- 数据来源：public/data/books/*.json 由 tools/seed-books-d1.mjs 生成 SQL 后导入
CREATE TABLE IF NOT EXISTS books (
  book_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,   -- novel.json 全量
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
