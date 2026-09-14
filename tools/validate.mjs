// novel.json 校验器 —— 技术文档 §6.2
// 用法：node tools/validate.mjs public/data/books/btg_room.json
// 规则分 ERROR（必须为 0 才算通过）与 WARN（提示）
import { readFile } from 'node:fs/promises';

const errors = [];
const warns = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warns.push(msg); }

const file = process.argv[2];
if (!file) { console.error('用法: node tools/validate.mjs <novel.json>'); process.exit(2); }
const novel = JSON.parse(await readFile(file, 'utf8'));

// ---- meta ----
for (const key of ['id', 'title', 'source', 'intro']) if (!novel.meta?.[key]) err(`meta.${key} 缺失`);
if (!Array.isArray(novel.meta?.chapters_covered) || novel.meta.chapters_covered.length === 0) err('meta.chapters_covered 缺失');

// ---- canon_rules ----
if (!Array.isArray(novel.canon_rules) || novel.canon_rules.length === 0) err('canon_rules 为空');
if (novel.canon_rules?.length > 6) warn(`canon_rules 有 ${novel.canon_rules.length} 条（>6，模型可能记不住）`);

// ---- lorebook ----
for (const [i, e] of (novel.lorebook || []).entries()) {
  if (!Array.isArray(e.keys) || e.keys.length === 0) err(`lorebook[${i}].keys 为空`);
  if (!e.content) err(`lorebook[${i}].content 为空`);
  if (e.content?.length > 200) warn(`lorebook[${i}].content 超过 200 字`);
  if (e.constant !== true && (e.insertion_order ?? 99) > 80) warn(`lorebook[${i}] insertion_order 过低`);
}
if (!(novel.lorebook || []).some((e) => e.constant)) warn('lorebook 没有常驻条目（世界观核心建议 constant）');

// ---- characters ----
for (const c of (novel.characters || [])) {
  for (const key of ['id', 'name', 'anchor', 'mind', 'voice']) if (!c[key]) err(`角色 ${c.id || '?'} 缺少 ${key}`);
}
if ((novel.characters || []).length > 8) warn('角色超过 8 人，成本上升');

// ---- player ----
const attrKeys = new Set((novel.player?.attributes || []).map((a) => a.key));
if (attrKeys.size < 3) err('attributes 少于 3 条');
if (attrKeys.size > 7) warn('attributes 超过 7 条');
const softStates = (novel.player?.attributes || []).filter((a) => a.deathBelow != null);
if (softStates.length === 0) warn('没有软状态设置 deathBelow（心死判负机制未启用）');
for (const a of novel.player.attributes) {
  if (a.min > a.initial || a.initial > a.max) err(`属性 ${a.key} 初始值越界`);
  if (!a.name) err(`属性 ${a.key} 缺少 name`);
}

// ---- graph ----
const nodes = novel.graph?.nodes || [];
const nodeIds = new Set(nodes.map((n) => n.id));
if (!nodeIds.has(novel.graph?.start)) err(`start 节点 ${novel.graph?.start} 不存在`);
const chapters = new Map();
for (const n of nodes) {
  if (!n.id || !n.text || !n.who) err(`节点 ${n.id || '?'} 缺少基本字段`);
  if (n.goto && !nodeIds.has(n.goto)) err(`节点 ${n.id} 的 goto 指向不存在的 ${n.goto}`);
  for (const [ci, c] of (n.choices || []).entries()) {
    if (c.goto && !nodeIds.has(c.goto)) err(`节点 ${n.id} 选项${ci} 的 goto 指向不存在的 ${c.goto}`);
    if (!c.text) err(`节点 ${n.id} 选项${ci} 缺少 text`);
    if ((c.text || '').length > 20) warn(`节点 ${n.id} 选项${ci} 文本超过 20 字`);
    for (const k of Object.keys(c.set || {})) if (!attrKeys.has(k)) err(`节点 ${n.id} 选项${ci} set 了未定义属性 ${k}`);
    for (const k of Object.keys(n.set || {})) if (!attrKeys.has(k)) err(`节点 ${n.id} set 了未定义属性 ${k}`);
    for (const v of Object.values({ ...(n.set || {}), ...(c.set || {}) })) if (Math.abs(Number(v)) > 2) warn(`节点 ${n.id} 单次 set 幅度 |${v}|>2（引擎会截断到 ±2）`);
  }
  if (chapters.has(n.chapter)) chapters.get(n.chapter).push(n);
  else chapters.set(n.chapter, [n]);
}
for (const [ch, list] of chapters) {
  if (list.length < 3) err(`第 ${ch} 章只有 ${list.length} 个节点（<3）`);
  const km = list.filter((n) => n.keyMoment).length;
  if (km > 2) err(`第 ${ch} 章 keyMoment 有 ${km} 个（>2）`);
}

// ---- 可达性：从 start BFS ----
const reachable = new Set([novel.graph.start]);
const queue = [novel.graph.start];
while (queue.length) {
  const id = queue.shift();
  const n = nodes.find((x) => x.id === id);
  if (!n) continue;
  const nexts = [];
  if (n.goto) nexts.push(n.goto);
  for (const c of n.choices || []) if (c.goto) nexts.push(c.goto);
  for (const nx of nexts) if (!reachable.has(nx)) { reachable.add(nx); queue.push(nx); }
}
for (const n of nodes) if (!reachable.has(n.id)) warn(`节点 ${n.id} 从 start 不可达（孤儿节点）`);
// 改编书（如凡人修仙传，按章号跳章）里分支替代场景不可达属正常，降为 WARN
const isConverted = (novel.meta?.source || '') === 'fanren_reference' || nodes.length > 80;
for (const n of nodes) if (n.keyMoment && !reachable.has(n.id)) (isConverted ? warn : err)(`keyMoment 节点 ${n.id} 不可达`);

// ---- 角色 v2 扩展：情感底色 / 初始好感 ----
const TONES = '藏溢钝烈淡惑净缠默';
for (const c of (novel.characters || [])) {
  if (c.tone && !TONES.includes(c.tone)) warn(`角色 ${c.id} tone "${c.tone}" 不在九型底色中`);
  if (c.favor_init != null && (c.favor_init < 0 || c.favor_init > 100)) warn(`角色 ${c.id} favor_init 越界(0-100)`);
}

// ---- 事件池（v2） ----
const evtIds = new Set();
const eventRequires = [];
for (const [i, e] of (novel.events || []).entries()) {
  if (!e.id) { err(`events[${i}] 缺少 id`); continue; }
  if (evtIds.has(e.id)) err(`事件 ${e.id} id 重复`);
  if (nodeIds.has(e.id)) err(`事件 ${e.id} 与剧情节点 id 冲突`);
  evtIds.add(e.id);
  if (!e.narrative) err(`事件 ${e.id} 缺少 narrative`);
  if (!Number.isInteger(e.chapter)) err(`事件 ${e.id} chapter 非整数`);
  else if (!chapters.has(e.chapter)) err(`事件 ${e.id} chapter ${e.chapter} 不存在于剧情图谱`);
  if ((e.choices || []).length === 0) warn(`事件 ${e.id} 没有选项（将只能被路过）`);
  for (const [ci, c] of (e.choices || []).entries()) {
    if (!c.text) err(`事件 ${e.id} 选项${ci} 缺少 text`);
    if ((c.text || '').length > 14) warn(`事件 ${e.id} 选项${ci} 文本超过 14 字`);
    for (const k of Object.keys(c.set || {})) if (!attrKeys.has(k)) err(`事件 ${e.id} 选项${ci} set 了未定义属性 ${k}`);
  }
  if (e.requires) eventRequires.push(e.requires);
}
for (const [ch, list] of chapters) {
  const pool = (novel.events || []).filter((e) => e.chapter === ch);
  if (pool.length === 0) warn(`第 ${ch} 章没有日常事件（自由行动阶段全靠 AI 撑）`);
  else if (pool.length < 3) warn(`第 ${ch} 章日常事件仅 ${pool.length} 条（建议≥4）`);
}

// ---- 结局 ----
const attrRegex = /[\u4e00-\u9fffA-Za-z_][\u4e00-\u9fffA-Za-z0-9_]*/g;
for (const e of novel.endings || []) {
  if (!e.id || !e.title || !e.epilogue) err(`结局 ${e.id || '?'} 缺少基本字段`);
  if (!['原作', '改命', '死亡', '隐藏'].includes(e.family)) warn(`结局 ${e.id} family "${e.family}" 非标准分类`);
  const cond = e.condition || '';
  const evtRefs = [...cond.matchAll(/EVT\?\[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
  for (const ref of evtRefs) if (ref && !nodeIds.has(ref) && !reachable.has(ref)) err(`结局 ${e.id} EVT 引用不存在的节点 ${ref}`);
  const names = [...cond.replace(/EVT\?\[[^\]]*\]/g, '').replace(/TLT\?\[[^\]]*\]/g, '').matchAll(attrRegex)]
    .map((m) => m[0]).filter((s) => !['true', 'false'].includes(s));
  for (const name of names) if (!attrKeys.has(name)) err(`结局 ${e.id} 条件引用未定义属性 ${name}`);
}
if (!(novel.endings || []).some((e) => e.family === '死亡')) warn('没有死亡族结局（deathBottom 触发时无结局可跳');
if (!(novel.endings || []).some((e) => !e.condition)) err('缺少无条件兜底结局（condition 为空）');

// ---- DSL 语法试解析（轻量：平衡括号/引号） ----
const allConds = [];
for (const n of nodes) { allConds.push(...(n.choices || []).map((c) => c.requires).filter(Boolean)); }
for (const r of eventRequires) allConds.push(r);
for (const e of novel.endings || []) if (e.condition) allConds.push(e.condition);
for (const c of allConds) {
  if (typeof c !== 'string') continue;
  if ((c.match(/\(/g) || []).length !== (c.match(/\)/g) || []).length) err(`DSL 括号不平衡: ${c}`);
  if (/\[\s*\]/.test(c)) err(`DSL 空集合: ${c}`);
}
// 事件池 requires 引用的节点 id 必须存在
for (const cond of eventRequires) {
  const refs = [...cond.matchAll(/EVT\?\[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
  for (const ref of refs) if (ref && !nodeIds.has(ref) && !evtIds.has(ref)) err(`事件条件 EVT 引用不存在的 id ${ref}: ${cond}`);
}

// ---- 汇总 ----
const result = { file, errors, warns, ok: errors.length === 0,
  stats: { nodes: nodes.length, chapters: chapters.size, characters: novel.characters?.length || 0, endings: novel.endings?.length || 0, lorebook: novel.lorebook?.length || 0, events: novel.events?.length || 0, reachable: reachable.size } };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
