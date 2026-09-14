// 生成 Worker 内置的 GM 书籍上下文（瘦身版：仅 GM prompt 与 sanitize 需要的字段）
// 用法：node tools/gen-gm-context.mjs → worker/gm-context.generated.json
// 打包进 bundle 后 loadNovel 拥有零延迟、零传播的最终兜底层
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const KEEP = [
  'meta.id', 'meta.title', 'meta.intro',
  'canon_rules', 'lorebook', 'characters', 'map',
  'player.attributes', 'player.identity_cards',
  'presentation.chapter_names',
];

const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const out = {};
for (const f of readdirSync(new URL('../public/data/books/', import.meta.url)).filter((x) => x.endsWith('.json'))) {
  const novel = JSON.parse(readFileSync(new URL(`../public/data/books/${f}`, import.meta.url), 'utf8'));
  const slim = {};
  for (const path of KEEP) {
    const v = pick(novel, path);
    if (v === undefined) continue;
    const [top, sub] = path.split('.');
    if (sub) slim[top] = { ...(slim[top] || {}), [sub]: v };
    else slim[top] = v;
  }
  out[novel.meta.id] = slim;
}
const file = new URL('../worker/gm-context.generated.json', import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(`gm-context.generated.json: ${Object.keys(out).join(', ')} 共 ${(readFileSync(file, 'utf8').length / 1024).toFixed(0)}KB`);
