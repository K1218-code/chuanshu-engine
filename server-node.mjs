// Node 运行时入口：复用 worker/index.js 的 Hono 应用，部署到任意 Node 平台（Zeabur/Railway/自有服务器）
// 与 Cloudflare Worker 版共用同一套路由；KV 用「内存 + 文件持久化」等效实现
import { serve } from '@hono/node-server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, '.kv-data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// ---- KV 等效实现（内存 Map + JSON 文件持久化；TTL 由时间戳判定） ----
class FileKV {
  constructor(name) {
    this.name = name;
    this.file = path.join(dataDir, `${name}.json`);
    this.store = new Map();
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.file, 'utf8') || '{}'))) this.store.set(k, v); }
    catch { /* 首次运行 */ }
    this.timer = setInterval(() => this.flush(), 3000);
    this.timer.unref?.();
  }
  flush() {
    try { writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.store))); } catch { /* 忽略写失败 */ }
  }
  async get(key) {
    const v = this.store.get(key);
    if (!v) return null;
    if (v.exp && v.exp < Date.now()) { this.store.delete(key); return null; }
    return v.value;
  }
  async put(key, value, { expirationTtl } = {}) {
    this.store.set(key, { value, exp: expirationTtl ? Date.now() + expirationTtl * 1000 : null });
    this.flush();
  }
  async delete(key) { this.store.delete(key); this.flush(); }
}

// ---- Cache API 等效实现（gm 缓存用，内存版） ----
class SimpleCache {
  constructor() { this.map = new Map(); }
  async match(req) {
    const key = typeof req === 'string' ? req : req.url;
    const v = this.map.get(key);
    if (!v) return undefined;
    if (v.exp && v.exp < Date.now()) { this.map.delete(key); return undefined; }
    return new Response(v.body, { status: v.status, headers: v.headers });
  }
  async put(req, res) {
    const key = typeof req === 'string' ? req : req.url;
    const body = await res.clone().text();
    this.map.set(key, { body, status: res.status, headers: Object.fromEntries(res.headers), exp: Date.now() + 30 * 60 * 1000 });
  }
}
if (!globalThis.caches) globalThis.caches = { default: new SimpleCache() };

const env = {
  SESSION_KV: new FileKV('session'),
  SAVE_KV: new FileKV('save'),
  ZHIHU_OAUTH_APP_ID: process.env.ZHIHU_OAUTH_APP_ID || '442',
  ZHIHU_OAUTH_APP_KEY: process.env.ZHIHU_OAUTH_APP_KEY || '',
  ZHIHU_OAUTH_REDIRECT_URI: process.env.ZHIHU_OAUTH_REDIRECT_URI || '',
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  LLM_BASE_URL: process.env.LLM_BASE_URL || '',
  LLM_MODEL: process.env.LLM_MODEL || '',
};

// ---- 加载 Worker 版 Hono 应用并注入环境 ----
const modPath = new URL('./worker/index.js', import.meta.url).href;
const workerMod = await import(modPath);
const app = workerMod.default;

const node = new Hono();
// 环境/平台垫片注入到每个请求（实例级覆盖只读 getter）
node.use('*', async (c, next) => {
  Object.defineProperty(c, 'env', { value: env, configurable: true });
  Object.defineProperty(c, 'executionCtx', {
    value: { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } },
    configurable: true,
  });
  await next();
});
node.route('/', app);
// pretty-URL：/chat → /chat.html（Workers Assets 原生行为，Node 需手动补全）
node.use('*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  if (p !== '/' && !path.extname(p)) {
    const candidate = path.join(root, 'public', p + '.html');
    if (existsSync(candidate)) return serveStatic({ root: './public', path: p + '.html' })(c, next);
  }
  await next();
});
// 静态资源（public/）兜底 + SPA
node.use('*', serveStatic({ root: './public' }));
node.get('*', serveStatic({ root: './public', path: './index.html' }));

const port = Number(process.env.PORT || 8080);
serve({ fetch: node.fetch, port }, (info) => {
  process.stdout.write(`chuanshu-engine (node): http://0.0.0.0:${info.port}/\n`);
});
