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

// ===================== v2：AI对话AVG 扩展 =====================
const novelV2 = JSON.parse(await readFile(path.join(root, 'public/data/books/ak47_xiuzhen.json'), 'utf8'));

test('v2：createState 带羁绊/记忆/章节预算', () => {
  const s = engine.createState(novelV2, { identity: 'ic_yqq' });
  assert.equal(s.v, 2);
  assert.equal(s.mode, 'ai-avg');
  assert.ok(s.rels.sqq);                       // NPC 自动入羁绊簿
  assert.equal(s.rels.sqq.favor, 15);          // favor_init
  assert.equal(s.rels.sqq.nature, '');
  assert.deepEqual(s.memories, []);
  assert.ok(s.chapterBudget >= 5 && s.chapterBudget <= 8);
  assert.ok(!('sqq' in s.rels) || s.rels.sqq !== undefined);
  assert.ok(s.rels.my && s.rels.xt);
});

test('v2：applyPatch 羁绊限幅与记忆上限', () => {
  const s = engine.createState(novelV2, { identity: 'ic_yqq' });
  const { state } = engine.applyPatch(s, novelV2, {
    rels: {
      sqq: { favor: 50, nature: '宿敌' },        // +50 被限幅到 ±8/轮 → 15+8=23
      不存在的npc: { favor: 10 },                 // 白名单外拒绝
    },
    memories_add: [
      { kind: 'promise', content: '答应系统苟到大结局', importance: 2 },
      { kind: 'secret', content: '发现了仓库清单被人动过', importance: 3 },
      { kind: 'fact', content: '第三条多余的被丢弃', importance: 1 },
    ],
    divergence_delta: 0.5,                        // 限幅到 ±0.1
  });
  assert.equal(state.rels.sqq.favor, 23);
  assert.equal(state.rels.sqq.nature, '宿敌');
  assert.ok(!('不存在的npc' in state.rels));
  assert.equal(state.memories.length, 2);        // 单轮最多 2 条
  assert.equal(state.memories[0].kind, 'promise');
  assert.equal(state.divergence, 0.1);
});

test('v2：长期记忆淘汰（重要性优先）', () => {
  const s = engine.createState(novelV2, { identity: 'ic_yqq' });
  for (let i = 0; i < 30; i++) {
    engine.pushMemories(s, [{ kind: 'fact', content: `记事${i}`, importance: i % 3 + 1 }]);
  }
  assert.ok(s.memories.length <= 24);
  // 重要性3的必须全部存活（10条 < 上限24）
  assert.equal(s.memories.filter((m) => m.importance === 3).length, 10);
  // 重要性1的最多只留少量（低重要度优先出局）
  assert.ok(s.memories.filter((m) => m.importance === 1).length <= 4);
});

test('v2：事件池抽取（章节过滤 + once + requires + 加权）', () => {
  const s = engine.createState(novelV2, { identity: 'ic_yqq' });
  s.chapter = 1;
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const e = engine.drawEvent(s, novelV2);
    if (!e) break;
    assert.equal(e.chapter, 1);
    seen.add(e.id);
    s.evt.push(e.id); // 模拟 once 消耗
  }
  assert.equal(seen.size, 4, '第1章 4 个 once 事件全部可抽到');
  assert.equal(engine.drawEvent(s, novelV2), null, '抽干后返回 null');
  const s2 = engine.createState(novelV2, { identity: 'ic_yqq' });
  s2.chapter = 6;
  const e6 = engine.drawEvent(s2, novelV2);
  assert.ok(e6 && e6.chapter === 6);
});

test('v2：applyEventChoice 确定性结算', () => {
  const s = engine.createState(novelV2, { identity: 'ic_yqq' });
  const event = novelV2.events.find((e) => e.id === 'e1_1');
  const s2 = engine.applyEventChoice(s, novelV2, event, 0); // 撕了，睡觉 → 杀心+1
  assert.equal(s2.attrs.杀心, engine.createState(novelV2, { identity: 'ic_yqq' }).attrs.杀心 + 1);
  assert.ok(s2.evt.includes('e1_1'));
  assert.equal(s2.node, s.node); // 事件不影响 graph 位置
});

test('v2：章节流程（开场/命运节点/跨章链）', () => {
  // 每章都有可玩的开场与命运节点
  for (const ch of [1, 2, 3, 4, 5, 6]) {
    assert.ok(engine.chapterStartNode(novelV2, ch), `ch${ch} 有开场节点`);
    const km = engine.keyMomentNode(novelV2, ch);
    assert.ok(km && km.choices?.length, `ch${ch} 有带选项的命运节点`);
  }
  // 跨章链：从 ch1 命运节点抉择后一路推进到 ch2
  let s = engine.createState(novelV2, { identity: 'ic_yqq' });
  s.node = 'n1';
  s = engine.applyChoice(s, novelV2, 0);       // 掏出AK47 → n2a
  assert.equal(s.node, 'n2a');
  const { state: s2, visited, nextChapter } = engine.advanceThrough(s, novelV2, engine.nodeOf(novelV2, 'n2a'));
  assert.ok(visited.length >= 2);              // n2a → n3（停止：有选项）
  assert.equal(nextChapter, null);             // 停在同章命运节点 n3
  assert.equal(s2.node, 'n3');
  // ch4 尾 → ch5：nextChapter=5，state.node 停在本章最后节点
  s = engine.createState(novelV2, { identity: 'ic_yqq' });
  s.node = 'n11a';
  const r = engine.advanceThrough(s, novelV2, engine.nodeOf(novelV2, 'n11a'));
  assert.equal(r.nextChapter, 5);
  assert.equal(r.state.node, 'n11a');          // 停在本章（不跨章渲染）
});

test('v2：预算函数稳定且有界', () => {
  const a = engine.rollBudget(3, 'ic_yqq');
  const b = engine.rollBudget(3, 'ic_yqq');
  assert.equal(a, b);                          // 同参数确定性
  for (let ch = 1; ch <= 6; ch++) {
    const v = engine.rollBudget(ch, 'ic_yqq');
    assert.ok(v >= 5 && v <= 8);
  }
});

// ===================== v2.1：玩家角色解析 / 地图探索 =====================

test('v2.1：resolvePlayerChar 身份卡映射', async () => {
  const btg = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));
  assert.equal(engine.resolvePlayerChar(btg, 'ic_snn'), 'snn');   // 穿成宋柠柠 → 她本人
  assert.equal(engine.resolvePlayerChar(btg, 'ic_lcy'), 'lcy');
  assert.equal(engine.resolvePlayerChar(btg, 'ic_watcher'), null); // 路人同学无对应角色
  // 显式 char 字段优先
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  assert.equal(engine.resolvePlayerChar(fanren, 'ic_hl'), 'hl');
  assert.equal(engine.resolvePlayerChar(fanren, 'ic_san'), null);
  // createState 记录 playerChar
  const s = engine.createState(btg, { identity: 'ic_snn' });
  assert.equal(s.playerChar, 'snn');
});

test('v2.1：地图探索（解锁/visited/线索/属性/记忆）', async () => {
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  const s = engine.createState(fanren, { identity: 'ic_hl' });
  // 全部地点可见但按章节解锁
  const visible = engine.mapLocations(fanren, s);
  assert.ok(visible.length >= 12);
  assert.ok(visible.filter((l) => l.chapter <= 1).every((l) => l.unlocked));
  assert.ok(visible.filter((l) => l.chapter >= 8).every((l) => !l.unlocked));
  assert.ok(visible.every((l) => !l.visited));
  // 探索彩色山谷（线索 + 属性 + 记忆）
  const valley = visible.find((l) => l.id === 'fm_valley');
  assert.ok(valley && valley.unlocked);
  const { state: s2, loc } = engine.visitLocation(s, fanren, 'fm_valley');
  assert.equal(loc.name, '彩色山谷');
  assert.ok(s2.mapVisited.includes('fm_valley'));
  assert.ok(s2.knowledge.playerKnown.includes('掌天瓶可催熟灵药'));      // 线索入认知
  assert.ok(s2.memories.some((m) => m.content.includes('彩色山谷')));    // 线索入长期记忆
  assert.equal(s2.attrs.气运, Math.min(10, s.attrs.气运 + 1));            // 探索奖励
  // 高章地点未解锁
  const deep = engine.mapLocations(fanren, s2).find((l) => l.chapter >= 8);
  assert.ok(deep && !deep.unlocked);
});

test('v2.1：choice/事件 flags 结算 + DSL 旗标门控', async () => {
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  const s = engine.createState(fanren, { identity: 'ic_hl' });
  const event = fanren.events.find((e) => e.id === 'f3_1'); // 收起残图 → flags.f_got_map
  const idx = event.choices.findIndex((c) => c.flags?.f_got_map);
  assert.ok(idx >= 0);
  const s2 = engine.applyEventChoice(s, fanren, event, idx);
  assert.equal(s2.flags.f_got_map, true);
  // DSL 裸旗标判定
  assert.equal(evalCondition('f_got_map', s2), true);
  assert.equal(evalCondition('f_got_map', s), false);
});

test('v2.1：凡人修仙传结构健全性', async () => {
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  assert.equal(fanren.meta.schema, 2);
  // FIX-08：66 个未接入主链的支线场景归档至 archive_nodes，游玩图为 488 节点全可达
  assert.equal(fanren.graph.nodes.length, 488);
  assert.equal(fanren.graph.archive_nodes.length, 66);
  assert.equal(fanren.meta.chapters_covered.length, 14);
  // 每章都有命运节点与开场节点
  for (let ch = 1; ch <= 14; ch++) {
    assert.ok(engine.chapterStartNode(fanren, ch), `ch${ch} 开场`);
    assert.ok(engine.keyMomentNode(fanren, ch), `ch${ch} 命运节点`);
  }
  // 境界带标签（HUD 显示当前境界）
  const xiuwei = fanren.player.attributes.find((a) => a.key === '修为');
  const band = engine.attrBand(xiuwei, 4);
  assert.equal(band.label, '筑基初期');
  // 结局：EVT 门控的场景结局在无兜底判定下可命中，兜底结局排最后
  assert.equal(fanren.endings[fanren.endings.length - 1].id, 'end_mortal');
  // FIX-08 回归：end_ch14_ending 门控指向可达节点（转换时原节点 ch14_ending 丢失）
  const liveIds = new Set(fanren.graph.nodes.map((n) => n.id));
  const evtRefs = fanren.endings.map((e) => String(e.condition || '').match(/EVT?\[([^\]]*)\]/)?.[1]).filter(Boolean);
  for (const ref of evtRefs) for (const id of ref.split(',')) assert.ok(liveIds.has(id.trim()), `结局 EVT 引用可达节点 ${id}`);
});

test('v2.2：序章构建器（自定义文案 + 身份/玩法自动追加）', async () => {
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  const card = fanren.player.identity_cards[0];
  const sections = engine.buildPrologue(fanren, card);
  assert.ok(sections.length >= 6, '4 段自定义 + 身份 + 玩法');
  assert.equal(sections[0].title, '这是一个什么世界');
  assert.ok(sections.some((s) => s.title === '你穿成了谁'));
  assert.ok(sections.some((s) => s.title === '怎么玩'));
  // 无自定义文案的书自动拼装
  const btg = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));
  const auto = engine.buildPrologue(btg, null);
  assert.ok(auto.length >= 3);
});

test('v2.2：储物袋 inventory 与境界跃迁检测', async () => {
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  const s = engine.createState(fanren, { identity: 'ic_hl' });
  s.flags['i_三足小鼎'] = true;
  s.flags['i_长春功'] = true;
  s.flags['f_其他旗标'] = true; // 非 i_ 前缀不计入
  const items = engine.inventoryOf(s);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.name).sort(), ['三足小鼎', '长春功']);
  // 境界跃迁：修为 0→1 触发「练气初期」
  const s2 = structuredClone(s);
  s2.attrs['修为'] = 1;
  const change = engine.realmChange(s.attrs, s2.attrs, fanren);
  assert.ok(change);
  assert.equal(change.label, '练气初期');
  // 非境界属性（bands 少）不触发
  const s3 = structuredClone(s);
  s3.attrs['根骨'] = 8;
  assert.equal(engine.realmChange(s.attrs, s3.attrs, fanren), null);
});

test('v2.5：心声能力门控 mindAllowed', async () => {
  const ak47 = JSON.parse(await readFile(path.join(root, 'public/data/books/ak47_xiuzhen.json'), 'utf8'));
  // 穿成叶青青：无读心能力 → 无声
  const sYqq = engine.createState(ak47, { identity: 'ic_yqq' });
  assert.equal(engine.mindAllowed(ak47, sYqq), false);
  // 穿成系统：全知后台 → 有声
  const sXt = engine.createState(ak47, { identity: 'ic_xt' });
  assert.equal(engine.mindAllowed(ak47, sXt), true);
  // btg_room：mind_reading=false 一票否决
  const btg = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));
  const sSnn = engine.createState(btg, { identity: 'ic_snn' });
  assert.equal(engine.mindAllowed(btg, sSnn), false);
  // fanren：修为>=10（元婴神识）才开
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  const sHl = engine.createState(fanren, { identity: 'ic_hl' });
  assert.equal(engine.mindAllowed(fanren, sHl), false);
  sHl.attrs['修为'] = 10;
  assert.equal(engine.mindAllowed(fanren, sHl), true);
  // 无身份卡的极简书保留原行为
  assert.equal(engine.mindAllowed({ presentation: {}, player: {} }, { attrs: {}, flags: {}, evt: [], tlt: [] }), true);
});

test('v2.5：序章自动拼装含开局处境段（讲明白发生了什么）', async () => {
  const btg = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));
  const card = btg.player.identity_cards[0];
  const sections = engine.buildPrologue(btg, card);
  // 手写序章 + 开局处境 + 身份 + 玩法
  assert.ok(sections.some((s) => s.title === '发生在你身上的事'), '手写序章保留');
  assert.ok(!sections.some((s) => s.title === '故事从你睁开眼开始'), '手写序章不叠加开场段');
  assert.ok(sections.some((s) => s.title === '你穿成了谁'));
  assert.ok(sections.some((s) => s.title === '怎么玩'));
  // forge 风（无手写序章）的书：intro + 开局处境也齐
  const fake = { meta: { intro: '测试世界' }, presentation: {}, player: { identity_cards: [card] },
    graph: { nodes: [{ id: 'n0', chapter: 1, who: 'narrator', text: '主角被困在测试房间，墙上倒计时归零在即，门外传来脚步声。' }] } };
  const auto = engine.buildPrologue(fake, card);
  assert.ok(auto.some((s) => s.text.includes('测试房间')));
});

// ---- v2.4：题材主题（舞台氛围随书而变） ----
test('v2.4：题材推断 meta.genre 优先，关键词兜底', async () => {
  const ak47 = JSON.parse(await readFile(path.join(root, 'public/data/books/ak47_xiuzhen.json'), 'utf8'));
  const btg = JSON.parse(await readFile(path.join(root, 'public/data/books/btg_room.json'), 'utf8'));
  const fanren = JSON.parse(await readFile(path.join(root, 'public/data/books/fanren.json'), 'utf8'));
  assert.equal(engine.inferGenre(ak47), 'xiuxian');
  assert.equal(engine.inferGenre(btg), 'romance');
  assert.equal(engine.inferGenre(fanren), 'xiuxian');
  // 无 meta.genre 时按关键词推断（forge 书路径）
  assert.equal(engine.inferGenre({ meta: { tags: ['恐怖', '规则怪谈'], intro: '' } }), 'horror');
  assert.equal(engine.inferGenre({ meta: { intro: '一个关于悬疑与推理的故事' } }), 'suspense');
  assert.equal(engine.inferGenre({ meta: { intro: '甜宠日常，暧昧升温' } }), 'romance');
  assert.equal(engine.inferGenre({ meta: { intro: '普通故事' } }), 'default');
});

test('v2.4：题材主题表完整 & 章节色相不跳出色系', () => {
  for (const key of ['xiuxian', 'romance', 'horror', 'suspense', 'default']) {
    assert.ok(engine.GENRE_THEMES[key], `主题 ${key}`);
    assert.equal(typeof engine.GENRE_THEMES[key].hue, 'number');
  }
  // 各题材各章节色相都在主题基调 ±14 内
  for (const key of Object.keys(engine.GENRE_THEMES)) {
    for (let ch = 1; ch <= 15; ch++) {
      const hue = engine.sceneHueFor(key, ch);
      const base = engine.GENRE_THEMES[key].hue;
      const diff = Math.min(Math.abs(hue - base), 360 - Math.abs(hue - base));
      assert.ok(diff <= 14, `${key} ch${ch} hue=${hue} 偏移 ${diff}>14`);
    }
  }
  // sceneHueFor 对未知题材与 0/负章号容错
  assert.equal(engine.sceneHueFor('unknown', 1), engine.GENRE_THEMES.default.hue);
  assert.equal(engine.sceneHueFor('xiuxian', 0), engine.sceneHueFor('xiuxian', 1));
});
