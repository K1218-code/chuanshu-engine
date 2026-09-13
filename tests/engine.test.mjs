// 引擎与 DSL 自测 —— node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { evalCondition } = await import(`file://${path.join(root, 'public/js/dsl.js').replace(/\\/g, '/')}`);
const engine = await import(`file://${path.join(root, 'public/js/engine.js').replace(/\\/g, '/')}`);
const novel = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));

test('DSL：属性比较与逻辑组合', () => {
  const state = { attrs: { 信心: 3, 清醒: 6, 默契: 0, 提分: 5 }, flags: { 已和解: true }, evt: ['n5', 'n9'], tlt: ['ic_snn'] };
  assert.equal(evalCondition('清醒>=6', state), true);
  assert.equal(evalCondition('信心>3', state), false);
  assert.equal(evalCondition('清醒>=6 & 信心>=3', state), true);
  assert.equal(evalCondition('清醒>=6 & 信心>3', state), false);
  assert.equal(evalCondition('信心>3 | 提分>=5', state), true);
  assert.equal(evalCondition('!信心>3', state), true);
  assert.equal(evalCondition('(提分>=5 | 默契>=1) & 清醒>=6', state), true);
});

test('DSL：EVT/TLT 集合查询', () => {
  const state = { attrs: { 信心: 0 }, flags: {}, evt: ['n5', 'n9'], tlt: ['ic_lcy'] };
  assert.equal(evalCondition('EVT?[n9]', state), true);
  assert.equal(evalCondition('EVT?[n5,n99]', state), true);
  assert.equal(evalCondition('EVT?[n99]', state), false);
  assert.equal(evalCondition('TLT?[ic_lcy]', state), true);
  assert.equal(evalCondition('默契>=7 & EVT?[n13c]', { attrs: { 默契: 8 }, flags: {}, evt: ['n13c'], tlt: [] }), true);
});

test('DSL：旗标', () => {
  const state = { attrs: {}, flags: { 已和解: true }, evt: [], tlt: [] };
  assert.equal(evalCondition('已和解=true', state), true);
  assert.equal(evalCondition('已和解=false', state), false);
});

test('engine：createState 初始化与身份卡', () => {
  const s = engine.createState(novel, { identity: 'ic_snn' });
  assert.equal(s.node, 'n0');
  assert.equal(s.attrs.信心, 3);
  const s2 = engine.createState(novel, { identity: 'ic_lcy' });
  assert.equal(s2.attrs.清醒, 4); // 2 + 身份卡+2
  assert.deepEqual(s2.tlt, ['ic_lcy']);
});

test('engine：applyChoice 纯函数 + 单轮限幅', () => {
  const s = engine.createState(novel, { identity: 'ic_snn' });
  s.node = 'n1';
  const s2 = engine.applyChoice(s, novel, 0); // 追问：默契-1 清醒+1
  assert.equal(s.attrs.默契, 0);      // 原 state 不变（纯函数）
  assert.equal(s.attrs.清醒, 2);
  assert.equal(s2.attrs.默契, 0);     // min clamp 到 0
  assert.equal(s2.attrs.清醒, 3);
  assert.equal(s2.node, 'n2a');
  assert.ok(s2.evt.includes('n1'));
  // knowledge_patch 只追加
  assert.ok(s2.knowledge.playerKnown.includes('李迟游看得见那行字'));
});

test('engine：选项 requires 门控', () => {
  const s = engine.createState(novel, { identity: 'ic_snn' });
  const n10 = engine.nodeOf(novel, 'n10');
  const evaluated = engine.evalChoices(s, novel, n10);
  assert.equal(evaluated[2].ok, false); // 清醒>=4 未满足
  assert.equal(evaluated[0].ok, true);
  assert.ok(evaluated[2].reason.length > 0); // 灰显提示
});

test('engine：结局判定（顺序即特异性）', () => {
  // 隐藏结局：默契>=7 且经历过 n13c
  const s = engine.createState(novel, { identity: 'ic_snn' });
  s.attrs.默契 = 8; s.evt.push('n13c'); s.attrs.提分 = 7; s.attrs.清醒 = 7;
  const hit = engine.checkEnding(s, novel);
  assert.equal(hit.ending.id, 'end_truth');
  // 改命结局
  const s2 = engine.createState(novel, { identity: 'ic_snn' });
  s2.attrs.提分 = 7; s2.attrs.清醒 = 7; s2.attrs.默契 = 3;
  assert.equal(engine.checkEnding(s2, novel).ending.id, 'end_win');
  // 兜底结局
  const s3 = engine.createState(novel, { identity: 'ic_snn' });
  assert.equal(engine.checkEnding(s3, novel).ending.id, 'end_normal');
  // 信心崩盘 → 死亡族
  const s4 = engine.createState(novel, { identity: 'ic_snn' });
  s4.attrs.信心 = 0;
  const dead = engine.checkEnding(s4, novel);
  assert.equal(dead.ending.family, '死亡');
  assert.ok(dead.cause.length > 0);
});

test('engine：一条完整通关路径（追问→吃透→接台阶→稳住）', () => {
  let s = engine.createState(novel, { identity: 'ic_snn' });
  const picks = [
    { node: 'n1', pick: 0 }, { node: 'n8', pick: 0 }, { node: 'n10', pick: 0 }, { node: 'n13', pick: 0 },
  ];
  for (const step of picks) {
    s.node = step.node;
    s = engine.applyChoice(s, novel, step.pick);
  }
  assert.ok(s.evt.includes('n1') && s.evt.includes('n8'));
  assert.equal(s.attrs.清醒, 1); // 2 +1(n1a) -2(n10a) = 1 → 堕线倾向
  const hit = engine.checkEnding(s, novel);
  assert.ok(['end_zhou', 'end_pass', 'end_normal'].includes(hit.ending.id));
});

test('engine：applyPatch 白名单与限幅（LLM 无提交权）', () => {
  const s = engine.createState(novel, { identity: 'ic_snn' });
  const { state, rejected } = engine.applyPatch(s, novel, {
    attrs: { 默契: 9, 不存在的属性: 1 },
    knowledge: { playerKnown: ['新线索'] },
  });
  assert.equal(state.attrs.默契, 2);   // +9 被限幅到 +2
  assert.deepEqual(rejected, ['不存在的属性']);
  assert.ok(state.knowledge.playerKnown.includes('新线索'));
});
