// 用户数据体系回归：匿名 24h 过期（滚动续期）/ 游客隔离 / 登录迁移转永久
// 走 kvStore 路径（假 KV），D1 路径线上由 migration+同语义实现覆盖
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../worker/memory.js';

function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
    _map: m,
  };
}

const ANON_A = 'anon:' + 'a'.repeat(24);
const ANON_B = 'anon:' + 'b'.repeat(24);
const ZH_USER = 'zh:' + 'z'.repeat(24);

test('匿名存档：写入即带 24h 过期时间', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('s1', 'btg_room', ANON_A, { chapter: 1 }, 1);
  const rec = JSON.parse(kv._map.get('save:s1'));
  assert.ok(rec.expiresAt > Date.now() + 23 * 3600 * 1000, 'expiresAt 应在 ~24h 后');
});

test('登录存档：expiresAt=0 永久', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('s2', 'btg_room', ZH_USER, { chapter: 1 }, 1);
  const rec = JSON.parse(kv._map.get('save:s2'));
  assert.equal(rec.expiresAt, 0);
});

test('匿名 24h 到期：getOwner 视为不存在，findLatestSave 不再返回', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('s3', 'btg_room', ANON_A, { chapter: 2 }, 2);
  // 篡改为已过期
  const rec = JSON.parse(kv._map.get('save:s3'));
  rec.expiresAt = Date.now() - 1000;
  kv._map.set('save:s3', JSON.stringify(rec));
  assert.equal(await store.getOwner('s3'), null, '过期后归属视为空');
  assert.equal(await store.findLatestSave(ANON_A, 'btg_room'), null, '过期档不参与最新查找');
  const st = await store.loadState('s3'); // 底层数据尚在（由 Cron 物理删除）
  assert.equal(st?.chapter, 2);
});

test('游客相互独立：A 的存档对 B 不可见', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('a1', 'btg_room', ANON_A, { chapter: 1 }, 1);
  assert.equal(await store.getOwner('a1'), ANON_A);
  assert.equal(await store.findLatestSave(ANON_B, 'btg_room'), null);
});

test('登录迁移：匿名存档划归登录账号且转为永久', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('m1', 'btg_room', ANON_A, { chapter: 3 }, 3);
  await store.migrateUser(ANON_A, ZH_USER);
  const rec = JSON.parse(kv._map.get('save:m1'));
  assert.equal(rec.userHash, ZH_USER);
  assert.equal(rec.expiresAt, 0);
  assert.equal(await store.findLatestSave(ZH_USER, 'btg_room'), 'm1');
  // 匿名身份下不再可见
  assert.equal(await store.findLatestSave(ANON_A, 'btg_room'), null);
});

test('匿名滚动续期：再次 sync 后过期时间顺延', async () => {
  const kv = fakeKV();
  const store = createMemoryStore({ SAVE_KV: kv });
  await store.saveState('r1', 'btg_room', ANON_A, { chapter: 1 }, 1);
  const t1 = JSON.parse(kv._map.get('save:r1')).expiresAt;
  await new Promise((r) => setTimeout(r, 20));
  await store.saveState('r1', 'btg_room', ANON_A, { chapter: 2 }, 2);
  const t2 = JSON.parse(kv._map.get('save:r1')).expiresAt;
  assert.ok(t2 > t1, '第二次 sync 的过期时间应更晚（滚动 24h）');
});
