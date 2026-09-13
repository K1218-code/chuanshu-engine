// EdgeOne Pages 适配层：把 Cloudflare Workers 风格的 Hono 应用接到 EO Functions 运行时
// 差异点：EO 的 KV 以全局变量绑定（SESSION_KV/SAVE_KV），环境变量在 ctx.env，executionCtx 需垫片
import app from '../worker/index.js';

function adaptKV(raw) {
  if (!raw) return null;
  return {
    async get(key) {
      const v = await raw.get(key);
      if (v == null) return null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
    async put(key, value, opts = {}) {
      try { await raw.put(key, value, opts); }
      catch { await raw.put(key, value); } // TTL 不支持时降级为永久写
    },
    async delete(key) { await raw.delete(key); },
  };
}

export function eoEnv(ctx) {
  const kvSession = adaptKV(globalThis.SESSION_KV);
  const kvSave = adaptKV(globalThis.SAVE_KV);
  const vars = (ctx && ctx.env) || {};
  const env = {
    ...vars,
    SESSION_KV: kvSession || fakeKV(),
    SAVE_KV: kvSave || fakeKV(),
  };
  return env;
}

function fakeKV() {
  const m = new Map();
  return { async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

export const onRequest = (ctx) => app.fetch(ctx.request, eoEnv(ctx), {
  waitUntil: (p) => { Promise.resolve(p).catch(() => {}); },
  passThroughOnException: () => {},
});
