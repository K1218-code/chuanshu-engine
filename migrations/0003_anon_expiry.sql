-- 匿名用户数据 24h 过期（登录用户 expires_at=0 永久保留）
-- 匿名每次 sync 滚动续期 24h（最后活动时间起算）；登录迁移时清零
ALTER TABLE saves ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_saves_expiry ON saves(expires_at);
