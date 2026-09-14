// 长期记忆存储适配器 —— worker 侧三层记忆的中长期持久化
//   中期：章节摘要 summaries（每章末由 /api/summary 生成写入）
//   长期：事实记忆 memories（GM 每轮抽取，章末随 /api/save/sync 落库）
// 实现链：Cloudflare D1（主）→ SAVE_KV（降级）→ null（前端内嵌兜底）。
// 安全红线：所有 SQL 一律 prepare().bind() 参数绑定，禁止任何字符串拼接组装查询。

const MEM_ROW_CAP = 64;   // 每个存档的记忆行数上限（超限淘汰低重要度旧行）
const MEM_SYNC_CAP = 8;   // 单次 sync 允许追加的记忆条数

export function createMemoryStore(env) {
  if (env?.DB?.prepare) return d1Store(env.DB);
  if (env?.SAVE_KV) return kvStore(env.SAVE_KV);
  return null;
}

// ---- Cloudflare D1（SQLite）实现 ----
function d1Store(db) {
  return {
    engine: 'd1',
    async saveState(saveId, bookId, userHash, state, chapter) {
      await db.prepare(
        `INSERT INTO saves (save_id, book_id, user_hash, state, chapter, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(save_id) DO UPDATE SET state=excluded.state, chapter=excluded.chapter, updated_at=excluded.updated_at`
      ).bind(String(saveId), String(bookId), String(userHash), JSON.stringify(state), Number(chapter) || 1, Date.now()).run();
    },
    async loadState(saveId) {
      const row = await db.prepare(`SELECT state FROM saves WHERE save_id = ?`).bind(String(saveId)).first();
      if (!row?.state) return null;
      try { return JSON.parse(row.state); } catch { return null; }
    },
    async findLatestSave(userHash, bookId) {
      const row = await db.prepare(
        `SELECT save_id FROM saves WHERE user_hash = ? AND book_id = ? ORDER BY updated_at DESC LIMIT 1`
      ).bind(String(userHash), String(bookId)).first();
      return row?.save_id || null;
    },
    async addMemories(saveId, items, turn) {
      const rows = (Array.isArray(items) ? items : []).slice(0, MEM_SYNC_CAP)
        .filter((m) => m && String(m.content || '').trim())
        .map((m) => ({
          kind: ['fact', 'relationship', 'promise', 'secret'].includes(m.kind) ? m.kind : 'fact',
          content: String(m.content).trim().slice(0, 80),
          importance: Math.max(1, Math.min(3, Number(m.importance) || 1)),
        }));
      for (const m of rows) {
        await db.prepare(
          `INSERT INTO memories (save_id, kind, content, importance, turn, active) VALUES (?, ?, ?, ?, ?, 1)`
        ).bind(String(saveId), m.kind, m.content, m.importance, Number(turn) || 0).run();
      }
      if (rows.length) await pruneMemories(db, saveId);
      return rows.length;
    },
    async loadMemories(saveId, limit = 8) {
      const { results } = await db.prepare(
        `SELECT kind, content, importance FROM memories WHERE save_id = ? AND active = 1
         ORDER BY importance DESC, id DESC LIMIT ?`
      ).bind(String(saveId), Math.max(1, Math.min(16, Number(limit) || 8))).all().catch(() => ({ results: [] }));
      return results || [];
    },
    async saveSummary(saveId, chapter, summary) {
      await db.prepare(
        `INSERT INTO summaries (save_id, chapter, summary) VALUES (?, ?, ?)
         ON CONFLICT(save_id, chapter) DO UPDATE SET summary=excluded.summary`
      ).bind(String(saveId), Number(chapter) || 1, String(summary).slice(0, 300)).run();
    },
    async getSummaries(saveId) {
      const { results } = await db.prepare(
        `SELECT chapter, summary FROM summaries WHERE save_id = ? ORDER BY chapter ASC`
      ).bind(String(saveId)).all().catch(() => ({ results: [] }));
      return results || [];
    },
  };
}

async function pruneMemories(db, saveId) {
  // 只保留重要度/时近占优的 MEM_ROW_CAP 行（子查询全部参数绑定）
  await db.prepare(
    `UPDATE memories SET active = 0 WHERE save_id = ? AND id NOT IN (
       SELECT id FROM memories WHERE save_id = ? AND active = 1
       ORDER BY importance DESC, id DESC LIMIT ?
     )`
  ).bind(String(saveId), String(saveId), MEM_ROW_CAP).run();
}

// ---- SAVE_KV 降级实现（本地 Node FileKV / Workers KV 均可） ----
// 每个存档三把钥匙：save:{id} / mem:{id} / summ:{id}，值为 JSON。
function kvStore(kv) {
  const mem = {
    engine: 'kv',
    async saveState(saveId, bookId, userHash, state, chapter) {
      await kv.put(`save:${saveId}`, JSON.stringify({ bookId, userHash, state, chapter, ts: Date.now() }));
    },
    async loadState(saveId) {
      const raw = await kv.get(`save:${saveId}`);
      if (!raw) return null;
      try { return JSON.parse(raw)?.state ?? null; } catch { return null; }
    },
    async findLatestSave(userHash, bookId) {
      // KV 无二级索引：靠 list 前缀扫描（量小可接受）
      let cursor;
      let best = null, bestTs = 0;
      do {
        const page = await kv.list({ prefix: 'save:', cursor });
        for (const key of page.keys) {
          const raw = await kv.get(key.name);
          if (!raw) continue;
          try {
            const rec = JSON.parse(raw);
            if (rec.userHash === userHash && rec.bookId === bookId && rec.ts > bestTs) { best = key.name.slice(5); bestTs = rec.ts; }
          } catch { /* 跳过坏行 */ }
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return best;
    },
    async addMemories(saveId, items, turn) {
      const list = JSON.parse(await kv.get(`mem:${saveId}`) || '[]');
      for (const m of (Array.isArray(items) ? items : []).slice(0, MEM_SYNC_CAP)) {
        const content = String(m?.content || '').trim().slice(0, 80);
        if (!content) continue;
        list.push({
          kind: ['fact', 'relationship', 'promise', 'secret'].includes(m?.kind) ? m.kind : 'fact',
          content,
          importance: Math.max(1, Math.min(3, Number(m?.importance) || 1)),
          turn: Number(turn) || 0,
          id: list.length + 1,
        });
      }
      list.sort((a, b) => b.importance - a.importance || b.id - a.id);
      await kv.put(`mem:${saveId}`, JSON.stringify(list.slice(0, MEM_ROW_CAP)));
    },
    async loadMemories(saveId, limit = 8) {
      const list = JSON.parse(await kv.get(`mem:${saveId}`) || '[]');
      return list.slice(0, Math.max(1, Math.min(16, Number(limit) || 8)))
        .map(({ kind, content, importance }) => ({ kind, content, importance }));
    },
    async saveSummary(saveId, chapter, summary) {
      const all = JSON.parse(await kv.get(`summ:${saveId}`) || '{}');
      all[Number(chapter) || 1] = String(summary).slice(0, 300);
      await kv.put(`summ:${saveId}`, JSON.stringify(all));
    },
    async getSummaries(saveId) {
      const all = JSON.parse(await kv.get(`summ:${saveId}`) || '{}');
      return Object.entries(all).map(([chapter, summary]) => ({ chapter: Number(chapter), summary }));
    },
  };
  return mem;
}
