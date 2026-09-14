// 对 KV 中已产出的 forge 书重跑 sanityCheck（新修复版）并写回
// 用法：node tools/repatch-forge.mjs [bookKey]
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { sanityCheck } from '../worker/forge.js';

const kvPath = new URL('../.kv-data/save.json', import.meta.url);
const kv = JSON.parse(readFileSync(kvPath, 'utf8'));
const targets = process.argv[2]
  ? [process.argv[2]]
  : Object.keys(kv).filter((k) => k.startsWith('book:forge_'));

for (const key of targets) {
  if (!kv[key]?.value) continue;
  const novel = JSON.parse(kv[key].value);
  novel.__chapterSummaries = (novel.meta?.chapters_covered || []).map((ch) => ({ chapter: ch, summary: '' }));
  const problems = sanityCheck(novel);
  delete novel.__chapterSummaries;
  kv[key].value = JSON.stringify(novel);
  const dump = new URL('../forge-check.json', import.meta.url);
  writeFileSync(dump, JSON.stringify(novel));
  console.log(key, '→', problems.length ? problems.join('；') : '无需修复');
}
writeFileSync(kvPath, JSON.stringify(kv));
