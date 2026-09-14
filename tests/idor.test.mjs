// BUG-001 回归测试：存档归属校验（IDOR 防护）
// 用户 A 建档后，用户 B 不得覆写（403）或读取（found:false）该存档；属主本人不受影响。
// 直接以 Hono app.fetch 驱动 worker/index.js，KV 用内存 Map 等效实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../worker/index.js';

function memKV() {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true }; },
  };
}

function makeEnv() {
  return { SESSION_KV: memKV(), SAVE_KV: memKV(), DB: undefined };
}

function syncReq(env, anonId, body) {
  return app.fetch(new Request('https://t.local/api/save/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `cs_anon=${anonId}` },
    body: JSON.stringify(body),
  }), env);
}

function loadReq(env, anonId, query) {
  return app.fetch(new Request(`https://t.local/api/save/load?${query}`, {
    headers: { Cookie: `cs_anon=${anonId}` },
  }), env);
}

const USER_A = 'a'.repeat(24);
const USER_B = 'b'.repeat(24);
const BOOK = 'ak47_xiuzhen';

test('BUG-001 回归：B 不得覆写 A 的存档（403）', async () => {
  const env = makeEnv();
  const r1 = await syncReq(env, USER_A, { saveId: 's1', bookId: BOOK, state: { chapter: 1, owner: 'A' }, newMemories: [] });
  assert.equal((await r1.json()).ok, true);
  const r2 = await syncReq(env, USER_B, { saveId: 's1', bookId: BOOK, state: { chapter: 9, hacked: true }, newMemories: [] });
  assert.equal(r2.status, 403);
  assert.equal((await r2.json()).error.code, 'FORBIDDEN');
});

test('BUG-001 回归：B 读取 A 的存档按不存在处理（不泄露存在性）', async () => {
  const env = makeEnv();
  await syncReq(env, USER_A, { saveId: 's2', bookId: BOOK, state: { chapter: 2, owner: 'A' }, newMemories: [] });
  const r = await loadReq(env, USER_B, `bookId=${BOOK}&saveId=s2`);
  const d = await r.json();
  assert.equal(d.found, false);
});

test('BUG-001 回归：A 读写自己的存档不受影响', async () => {
  const env = makeEnv();
  await syncReq(env, USER_A, { saveId: 's3', bookId: BOOK, state: { chapter: 3, owner: 'A' }, newMemories: [] });
  const w = await syncReq(env, USER_A, { saveId: 's3', bookId: BOOK, state: { chapter: 4, owner: 'A' }, newMemories: [{ kind: 'fact', content: '回归', importance: 1 }] });
  assert.equal((await w.json()).ok, true);
  const r = await loadReq(env, USER_A, `bookId=${BOOK}&saveId=s3`);
  const d = await r.json();
  assert.equal(d.found, true);
  assert.equal(d.state.chapter, 4);
  assert.equal(d.memories.length, 1);
});

test('BUG-001 回归：不指定 saveId 时只能找到自己的最新档', async () => {
  const env = makeEnv();
  await syncReq(env, USER_A, { saveId: 'sA', bookId: BOOK, state: { chapter: 5 }, newMemories: [] });
  const mine = await loadReq(env, USER_A, `bookId=${BOOK}`);
  assert.equal((await mine.json()).saveId, 'sA');
  const other = await loadReq(env, USER_B, `bookId=${BOOK}`);
  assert.equal((await other.json()).found, false);
});

test('无存储后端时 sync 返回 NO_STORE 提示（不 500）', async () => {
  const r = await app.fetch(new Request('https://t.local/api/save/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `cs_anon=${USER_A}` },
    body: JSON.stringify({ saveId: 'x', bookId: BOOK, state: {} }),
  }), {});
  const d = await r.json();
  assert.equal(d.error.code, 'NO_STORE');
});
