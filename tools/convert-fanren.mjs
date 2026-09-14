// 凡人修仙传 → 穿书引擎 novel.json v2 转换器
// 用法：python 导出 fanren-scenes.json 后执行 node tools/convert-fanren.mjs
// 场景图/属性/条件自动转换；角色卡/地图/事件/结局为人工改编（忠实原作设定）
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../../fanren-xiuxian-chuan/fanren-scenes.json', import.meta.url);
const OUT = new URL('../public/data/books/fanren.json', import.meta.url);
const data = JSON.parse(readFileSync(SRC, 'utf8'));
const scenes = data.scenes;

// ---- 境界表（与 game_engine.py REALMS 对齐；"圆满"后缀向前归并） ----
const REALMS = ['凡人', '练气初期', '练气中期', '练气后期', '筑基初期', '筑基中期', '筑基后期',
  '结丹初期', '结丹中期', '结丹后期', '元婴初期', '元婴中期', '元婴后期', '化神初期', '化神中期', '化神后期'];
const realmIdx = (name) => {
  if (name == null) return 0;
  const n = String(name).replace(/圆满$/, '');
  const i = REALMS.indexOf(n);
  if (i >= 0) return i;
  // 模糊匹配（如"练气"→练气初期）
  const p = REALMS.find((r) => n.startsWith(r.slice(0, 2)));
  return p ? REALMS.indexOf(p) : 0;
};
const clamp2 = (v) => Math.max(-2, Math.min(2, v));

// ---- 效果 → 属性 set / flags ----
function convertEffects(e = {}) {
  const set = {};
  const flags = {};
  if (e.hp) set['气血'] = clamp2(e.hp > 0 ? Math.max(1, Math.round(e.hp / 15)) : -Math.max(1, Math.round(-e.hp / 15)));
  if (e.max_hp && e.max_hp > 0) set['气血'] = clamp2((set['气血'] || 0) + 1);
  if (e.spiritual_power) set['灵力'] = clamp2(e.spiritual_power > 0 ? Math.max(1, Math.round(e.spiritual_power / 10)) : -Math.max(1, Math.round(-e.spiritual_power / 10)));
  if (e.spirit_stones) set['灵石'] = clamp2(e.spirit_stones > 0 ? Math.max(1, Math.round(e.spirit_stones / 20)) : -Math.max(1, Math.round(-e.spirit_stones / 20)));
  if (e.talent) set['根骨'] = clamp2(e.talent);
  if (e.comprehension) set['悟性'] = clamp2(e.comprehension);
  if (e.luck) set['气运'] = clamp2(e.luck);
  if (e.cultivation) set['修为'] = 1; // 突破场景逐境推进
  if (e.reputation && typeof e.reputation === 'object') {
    const total = Object.values(e.reputation).reduce((s, v) => s + (Number(v) || 0), 0);
    if (total) set['声望'] = clamp2(total > 0 ? Math.max(1, Math.round(total / 10)) : -Math.max(1, Math.round(-total / 10)));
  } else if (e.reputation) set['声望'] = clamp2(Number(e.reputation) || 0);
  for (const [k, v] of [['add_item', e.add_item], ['add_technique', e.add_technique], ['add_artifact', e.add_artifact], ['add_pill', e.add_pill]]) {
    if (v) flags[`i_${v}`] = true;
  }
  if (e.remove_item) flags[`i_${e.remove_item}`] = false;
  if (e.set_flag) flags[`f_${e.set_flag}`] = true;
  return { set, flags };
}

// ---- 条件 → DSL requires ----
function convertConditions(c = {}) {
  const parts = [];
  if (c.cultivation_min) parts.push(`修为>=${realmIdx(c.cultivation_min)}`);
  if (c.talent_min) parts.push(`根骨>=${c.talent_min}`);
  if (c.comprehension_min) parts.push(`悟性>=${c.comprehension_min}`);
  if (c.luck_min) parts.push(`气运>=${c.luck_min}`);
  if (c.spirit_stones_min) parts.push(`灵石>=${Math.max(1, Math.round(c.spirit_stones_min / 20))}`);
  if (c.has_item) parts.push(`i_${c.has_item}`);
  if (c.has_technique) parts.push(`i_${c.has_technique}`);
  if (c.has_pill) parts.push(`i_${c.has_pill}`);
  if (c.flag) parts.push(`f_${c.flag}`);
  if (c.no_flag) parts.push(`!f_${c.no_flag}`);
  // reputation_min / chapter_min：聚合近似，条件数极少，忽略（宁松勿误锁）
  return parts.join(' & ');
}

const DEATH_RE = /(死|陨落|身陨|尸骨|形神俱灭|卒|终结|出局|失败|葬)/;

// ---- 软收尾 is_end 场景补 goto（原版前端硬编码的换章入口表，见 static/index.html continueStory） ----
// 死亡场景不接边：作为终局死路，由结局判定（EVT）接管
const CHAPTER_ENTRIES = {
  2: 'chapter2_start', 3: 'ch3_enter_realm', 4: 'ch4_return_to_sect', 5: 'ch5_cauldron_awakening',
  6: 'ch6_peaceful_days', 7: 'ch7_departure', 8: 'ch8_departure', 9: 'ch9_elder_days',
  10: 'ch10_new_horizon_gc', 11: 'ch11_new_horizon', 12: 'ch12_seeking_truth', 13: 'ch13_yuanying_depth',
  14: 'ch13_prepare', 15: 'ch14_first_step',
};
const chapterNums = [...new Set(Object.values(scenes).map((s) => s.chapter ?? 1))].sort((a, b) => a - b);
for (const [sid, s] of Object.entries(scenes)) {
  if (!s.is_end || DEATH_RE.test((s.text || []).join(' '))) continue;
  const ch = s.chapter ?? 1;
  const target = CHAPTER_ENTRIES[ch + 1];
  if (target && scenes[target]) s.__goto = target; // 软收尾接边
}
// 兜底桥接：仍有入度为 0 的章节入口，从上一章找未接边的软收尾场景接上
{
  const hasEdgeTo = new Set();
  for (const s of Object.values(scenes)) {
    if (s.__goto) hasEdgeTo.add(s.__goto);
    for (const c of s.choices || []) if (c.next && scenes[c.next]) hasEdgeTo.add(c.next);
  }
  for (const [chStr, entry] of Object.entries(CHAPTER_ENTRIES)) {
    const ch = Number(chStr);
    if (ch <= 1 || !scenes[entry] || hasEdgeTo.has(entry)) continue;
    const prevEnds = Object.entries(scenes).filter(([sid, s]) =>
      (s.chapter ?? 1) === ch - 1 && s.is_end && !DEATH_RE.test((s.text || []).join(' ')) && !s.__goto);
    if (prevEnds.length) { prevEnds[prevEnds.length - 1][1].__goto = entry; continue; }
    const prevNodes = Object.entries(scenes).filter(([sid, s]) => (s.chapter ?? 1) === ch - 1 && !s.choices?.length);
    if (prevNodes.length) prevNodes[prevNodes.length - 1][1].__goto = entry;
  }
}

// ---- 场景 → graph 节点 ----
const nodes = [];
for (const [sid, s] of Object.entries(scenes)) {
  const text = (s.text || []).join('\n').replace(/\n{2,}/g, '\n').trim().slice(0, 600);
  const node = {
    id: sid,
    chapter: s.chapter ?? 1,
    who: 'narrator',
    text,
    set: {},
    canon: true,
    keyMoment: false,
  };
  if (!s.is_end && Array.isArray(s.choices) && s.choices.length) {
    node.choices = s.choices.slice(0, 4).map((c) => {
      const { set, flags } = convertEffects(c.effects);
      const out = { text: String(c.text || '……').slice(0, 18), requires: convertConditions(c.conditions || {}), set, goto: c.next || null };
      if (c.hint) out.hint = String(c.hint).slice(0, 12);
      if (Object.keys(flags).length) out.flags = flags;
      return out;
    }).filter((c) => c.goto && scenes[c.goto]);
  }
  if (s.__goto && (!node.choices || !node.choices.length)) node.goto = s.__goto; // 软收尾接边
  nodes.push(node);
}
const nodeIds = new Set(nodes.map((n) => n.id));

// ---- keyMoment 标记：跨章出口 > 突破场景 > 死亡终局；每章最多 2 个 ----
const byChapter = {};
for (const n of nodes) (byChapter[n.chapter] = byChapter[n.chapter] || []).push(n);
{
  const score = { exit: 3, breakthrough: 2, death: 2 };
  for (const n of nodes) {
    const s = scenes[n.id];
    if (s?.is_end) { if (DEATH_RE.test(n.text)) { n.keyMoment = true; n.__kmScore = score.death; } continue; }
    if ((s?.choices || []).some((c) => c.goto && scenes[c.goto] && (scenes[c.goto].chapter ?? 1) !== n.chapter)) { n.keyMoment = true; n.__kmScore = score.exit; continue; }
    if ((s?.choices || []).some((c) => (c.effects || {}).cultivation)) { n.keyMoment = true; n.__kmScore = score.breakthrough; }
  }
  const byCh = {};
  for (const n of nodes) (byCh[n.chapter] = byCh[n.chapter] || []).push(n);
  for (const list of Object.values(byCh)) {
    const kms = list.filter((n) => n.keyMoment).sort((a, b) => (b.__kmScore || 0) - (a.__kmScore || 0));
    for (const n of kms.slice(2)) n.keyMoment = false;
    if (!kms.slice(0, 2).some((n) => n.choices?.length)) {
      const fallback = [...list].reverse().find((n) => n.choices?.length);
      if (fallback) fallback.keyMoment = true;
    }
  }
}

// ---- 章节入口排序（chapterStartNode 取数组中该章第一个节点 = 入口场景） ----
const ordered = [];
const used = new Set();
{
  let entry = nodeIds.has('start') ? 'start' : byChapter[1]?.[0]?.id;
  for (const ch of chapterNums) {
    if (!entry || used.has(entry) || (scenes[entry]?.chapter ?? ch) !== ch) {
      entry = (byChapter[ch] || []).find((n) => /start/i.test(n.id))?.id || byChapter[ch]?.[0]?.id;
    }
    if (entry && !used.has(entry)) { ordered.push(nodeOf(entry)); used.add(entry); }
    for (const n of byChapter[ch] || []) if (!used.has(n.id)) { ordered.push(n); used.add(n.id); }
    // 下一章入口：本章 choices 指向下一章最多的目标；否则找 *start* 命名
    const count = {};
    let best = 0, nextEntry = null;
    for (const n of byChapter[ch] || []) {
      for (const c of n.choices || []) {
        const t = scenes[c.goto];
        if (t && (t.chapter ?? 1) === ch + 1) { count[c.goto] = (count[c.goto] || 0) + 1; if (count[c.goto] > best) { best = count[c.goto]; nextEntry = c.goto; } }
      }
    }
    if (!nextEntry) nextEntry = (byChapter[ch + 1] || []).find((n) => /start/i.test(n.id))?.id || null;
    entry = nextEntry;
  }
}
function nodeOf(id) { return nodes.find((n) => n.id === id); }

// ---- is_end 死亡场景 → 结局（EVT 门控优先命中） ----
const sceneEndings = [];
for (const [sid, s] of Object.entries(scenes)) {
  if (!s.is_end) continue;
  const text = (s.text || []).join(' ');
  if (!DEATH_RE.test(text) && (s.chapter ?? 1) < chapterNums[chapterNums.length - 1]) continue; // 软收尾：留作过场
  const isDeath = DEATH_RE.test(text);
  sceneEndings.push({
    id: `end_${sid}`.slice(0, 24),
    family: isDeath ? '死亡' : (sid.includes('ch15') || (s.chapter ?? 1) >= 15 ? '原作' : '原作'),
    condition: `EVT?[${sid}]`,
    title: isDeath ? '道途陨落' : '凡人一梦',
    tone: isDeath ? '崩溃线·身死道消' : '原作向·本卷终',
    epilogue: text.replace(/=====.*?=====/g, '').replace(/\s+/g, ' ').trim().slice(0, 110) + '……',
    rarity: isDeath ? 0.09 : 0.12,
  });
}

// ==================== 人工改编层 ====================
const CHARACTERS = [
  { id: 'hl', name: '韩立', role: 'lead', description: '四灵根的山村少年，七玄门杂役起步。', appearance: '相貌普通，眼神却比同龄人沉静得多。', anchor: '谨慎到骨子里，从不把命运交给运气。', mind: '机缘背后必有杀机，先想退路，再谈进取。', voice: '「在下只是个散修，道友说笑了。」\n「此事……容我三思。」', first_mes: '（他擦了擦手里的柴刀，抬头看了一眼山门的方向。）', avatar: '韩' },
  { id: 'mdf', name: '墨大夫', role: 'npc', tone: '藏', favor_init: 35, description: '七玄门神手谷药师，收你为记名弟子。', appearance: '面容枯槁，眼神却亮得吓人。', anchor: '慈眉善目地教你炼药，账却一笔笔记在心里。', mind: '这孩子的心性……若不能为我所用，就必须除掉。', voice: '「孩子，为师这是为你好。」\n「机缘这种东西，从来只留给有准备的人。」', first_mes: '「从今日起，你便在神手谷当差。记住，眼勤手快，少问多看。」', avatar: '墨' },
  { id: 'lfy', name: '厉飞雨', role: 'npc', tone: '烈', favor_init: 50, description: '七玄门天才弟子，你最早的朋友与对手。', appearance: '锦衣少年，眉眼张扬。', anchor: '把胜负写脸上，把义气刻进骨头里。', mind: '韩立这小子，看着闷，心里比谁都透亮。', voice: '「韩立，你这小子，关键时刻倒是靠得住！」\n「这一场，我肯定赢你——你等着。」', first_mes: '「新来的？站我旁边，考试点名看得见。」', avatar: '厉' },
  { id: 'zt', name: '张铁', role: 'npc', tone: '默', favor_init: 45, description: '同乡好友，憨厚力大，与你一起入门。', appearance: '粗布短打，手掌全是老茧。', anchor: '不说漂亮话，但你缺什么他递什么。', mind: '韩立哥说能行，那就能行。', voice: '「韩立哥，俺信你。」\n「……俺去烧水。」', first_mes: '「韩立哥，俺们……真能当仙人？」', avatar: '张' },
  { id: 'nhw', name: '南宫婉', role: 'npc', tone: '淡', favor_init: 30, description: '掩月宗的天之骄女，与你有一段纠缠三界的缘分。', appearance: '白衣胜雪，眉目如画，气质清冷。', anchor: '把所有波澜都压进一池静水里。', mind: '此人行事……与自己竟有几分相似。', voice: '「道友请自重。」\n「这一别，再会无期——望道友珍重。」', first_mes: '（她看了你一眼，目光在你脸上停了半息，随即移开。）', avatar: '婉' },
  { id: 'sys', name: '神秘瓶灵', role: 'npc', tone: '惑', favor_init: 20, description: '小绿瓶中沉睡的一缕意识，偶尔在你识海里低语。', appearance: '虚影，似有似无。', anchor: '每句话都像提示，又都像考验。', mind: '他会不会……就是那个人？', voice: '「滴——机会只有一次。」\n「你确定吗？」', first_mes: '（识海深处，传来一声若有若无的叹息。）', avatar: '瓶' },
];

const PLAYER = {
  identity_cards: [
    { id: 'ic_hl', name: '穿成韩立', desc: '四灵根的山村少年，靠一个神秘小瓶和过分谨慎的心性，在弱肉强食的修仙界步步登天。', char: 'hl', init: { 气运: 1 } },
    { id: 'ic_lfy', name: '穿成厉飞雨', desc: '天资卓绝的七玄门骄子。这一次，血色试炼里先倒下的会是谁？', char: 'lfy', init: { 根骨: 1, 气血: 1 } },
    { id: 'ic_san', name: '穿成无名散修', desc: '没有主角光环，没有靠山，只有比韩立更穷的起点。', init: { 灵石: 2, 根骨: -1 } },
  ],
  attributes: [
    { key: '气血', name: '气血', initial: 7, min: 0, max: 12, deathBelow: 1, bands: [{ upTo: 2, label: '油尽灯枯', directive: '气息奄奄，任何争斗都可能致命' }] },
    { key: '修为', name: '修为', initial: 0, min: 0, max: 15, deathBelow: null, bands: [
      { upTo: 0, label: '凡人' }, { upTo: 1, label: '练气初期' }, { upTo: 2, label: '练气中期' }, { upTo: 3, label: '练气后期' },
      { upTo: 4, label: '筑基初期' }, { upTo: 5, label: '筑基中期' }, { upTo: 6, label: '筑基后期' },
      { upTo: 7, label: '结丹初期' }, { upTo: 8, label: '结丹中期' }, { upTo: 9, label: '结丹后期' },
      { upTo: 10, label: '元婴初期' }, { upTo: 11, label: '元婴中期' }, { upTo: 12, label: '元婴后期' },
      { upTo: 13, label: '化神初期' }, { upTo: 14, label: '化神中期' }, { upTo: 15, label: '化神后期' },
    ] },
    { key: '灵力', name: '灵力', initial: 0, min: 0, max: 15, deathBelow: null, bands: [] },
    { key: '灵石', name: '灵石', initial: 0, min: 0, max: 12, deathBelow: null, bands: [{ upTo: 1, label: '囊中羞涩' }] },
    { key: '根骨', name: '根骨', initial: 5, min: 0, max: 10, deathBelow: null, bands: [] },
    { key: '悟性', name: '悟性', initial: 5, min: 0, max: 10, deathBelow: null, bands: [{ upTo: 2, label: '滞涩', directive: '参悟功法极慢，容易走岔' }] },
    { key: '气运', name: '气运', initial: 5, min: 0, max: 10, deathBelow: null, bands: [] },
    { key: '声望', name: '声望', initial: 0, min: 0, max: 10, deathBelow: null, bands: [] },
  ],
};

const CANON_RULES = [
  { id: 'r1', rule: '韩立行事极度谨慎：不轻信任何人，机缘背后先想杀机', type: 'character', source_chapter: 1 },
  { id: 'r2', rule: '扮猪吃虎：实力不轻易示人，示人即是杀局', type: 'character', source_chapter: 2 },
  { id: 'r3', rule: '修真界弱肉强食：资源抢夺理所当然，仁慈是奢侈品', type: 'world', source_chapter: 1 },
  { id: 'r4', rule: '十六境界步步登天：凡人→练气→筑基→结丹→元婴→化神，越阶挑战九死一生', type: 'world', source_chapter: 2 },
  { id: 'r5', rule: '神秘小瓶是最大底牌：催熟灵药的秘密绝不可让第二人知晓', type: 'structure', source_chapter: 1 },
  { id: 'r6', rule: '恩怨分明：受人恩必还，欠人债必偿，挡路者——斩草除根', type: 'character', source_chapter: 3 },
];

const LOREBOOK = [
  { keys: ['小瓶', '掌天瓶', '绿液', '催熟'], content: '坠崖时得来的三足小鼎残瓶（掌天瓶）：每逢月圆吸收天地灵气凝出一滴绿液，可催熟灵药百年成材。这是韩立立足修仙界的最大秘密，泄露即死。', constant: true, insertion_order: 1 },
  { keys: ['青牛镇', '青云镇', '山村'], content: '你出生的凡人村镇，靠山吃山。爹娘早逝，靠邻里接济长大——进山砍柴遇石缝青光，是这一切的开始。', constant: false, insertion_order: 10 },
  { keys: ['七玄门', '外门', '杂役'], content: '镜像山下的江湖门派，明为武林宗派实为修仙外围。弟子分杂役/外门/内门，每年考核末位淘汰。墨大夫的神手谷在门内西侧。', constant: false, insertion_order: 20 },
  { keys: ['墨大夫', '神手谷', '师父'], content: '收你为记名弟子的老药师，教你无名口诀（实为长春功）。他图谋你的身体做夺舍容器——师的恩，局的饵。', constant: false, insertion_order: 30 },
  { keys: ['长春功', '口诀', '功法'], content: '墨大夫传授的无名口诀，实为修仙功法《长春功》。灵根四属性杂灵根，进境奇慢——靠小瓶催熟的药草硬生生堆上去。', constant: false, insertion_order: 4 },
  { keys: ['血色试炼', '血色禁地', '试炼'], content: '七玄门每五年一次的弟子试炼，入禁地采药夺宝。禁地实为修仙者布下的杀局：遍地前辈遗骨，存活率不足半数。', constant: false, insertion_order: 5 },
  { keys: ['筑基丹', '筑基', '灵药'], content: '筑基必备灵丹，三味主药缺一不可：灵髓草、紫猿花、百年灵乳。你靠小瓶催生药草，硬凑出一炉——凡人逆天改命的第一步。', constant: false, insertion_order: 6 },
  { keys: ['黄枫谷', '宗门', '百药园'], content: '越国七大修仙门派之一。你以筑基修为入谷执掌百药园，明面是闲差，实际是借宗门资源闭门种药修行。', constant: false, insertion_order: 7 },
  { keys: ['太南小会', '坊市', '散修'], content: '散修一年一度的交易盛会，灵药、法器、功法、消息皆可交易。各路人心在此交汇：捡漏、黑吃黑、结盟、构陷，一应俱全。', constant: false, insertion_order: 8 },
  { keys: ['乱星海', '坠星海', '海底'], content: '域外修仙海域，灵石矿脉与上古洞府沉眠海底。化神传说的真相，要从这里一寸一寸捞出来。', constant: false, insertion_order: 9 },
  { keys: ['南宫婉', '掩月宗', '道侣'], content: '掩月宗圣女，与你从互相试探到并肩作战。她的信物是一枚冰晶玉佩——情之一字，凡人修的是道，也是执。', constant: false, insertion_order: 10 },
];

const EVENTS = [
  { id: 'f1_1', chapter: 1, weight: 3, once: true, requires: '', narrative: '进山砍柴时，你在溪边发现一株通体赤红的野参——村里老郎中说过，赤参能吊住一口气。', choices: [{ text: '挖走', set: { 气运: 1 } }, { text: '留给村里药铺', set: { 声望: 1 } }] },
  { id: 'f1_2', chapter: 1, weight: 2, once: true, requires: '', narrative: '镇上贴出七玄门收人的告示：测骨入门，管吃管住，但十年不得离门。', choices: [{ text: '去试试', set: { 根骨: 1 } }, { text: '再观望观望', set: { 气运: 1 } }] },
  { id: 'f2_1', chapter: 2, weight: 3, once: true, requires: '', narrative: '深夜，你撞见墨大夫独自在药炉前熬煮一炉黑漆漆的汤药，见你来了，眼神一冷。', choices: [{ text: '装没看见', set: { 悟性: 1 } }, { text: '上前请安套话', set: { 声望: 1, 气运: -1 } }] },
  { id: 'f2_2', chapter: 2, weight: 2, once: true, requires: '', narrative: '杂役峰的管事克扣月钱，同门都忍气吞声。', choices: [{ text: '忍下，闷头修炼', set: { 悟性: 1 } }, { text: '拿话点他', set: { 声望: 1, 灵石: -1 } }] },
  { id: 'f3_1', chapter: 3, weight: 3, once: true, requires: '', narrative: '血色禁地中，一具前辈遗骨的手里攥着半卷兽皮残图。', choices: [{ text: '收起残图', set: { 气运: 1 }, flags: { f_got_map: true } }, { text: '不碰，赶路', set: {} }] },
  { id: 'f3_2', chapter: 3, weight: 2, once: true, requires: '', narrative: '同门弟子重伤倒在血泊里，向你伸手：「救……救我……」', choices: [{ text: '救', set: { 声望: 1, 气血: -1 } }, { text: '趁乱取其储物袋', set: { 灵石: 2, 声望: -1 } }] },
  { id: 'f4_1', chapter: 4, weight: 3, once: true, requires: '', narrative: '百药园里一株灵草长势诡异，夜里隐隐有光——像是被人催熟过。', choices: [{ text: '彻夜守株观察', set: { 悟性: 1 } }, { text: '报告执事', set: { 声望: 1 } }] },
  { id: 'f4_2', chapter: 4, weight: 2, once: true, requires: '', narrative: '坊市黑店掌柜神秘兮兮推来一只木盒：「筑基丹的主药，道友要吗？」', choices: [{ text: '买（灵石吃紧）', set: { 灵石: -2, 气运: 1 } }, { text: '掉头就走', set: {} }] },
  { id: 'f5_1', chapter: 5, weight: 3, once: true, requires: '', narrative: '丹炉炸了。半年心血付之一炬，你被反噬的药气熏得七窍生烟。', choices: [{ text: '总结教训重来', set: { 悟性: 1 } }, { text: '改修外功散心', set: { 气血: 1 } }] },
  { id: 'f6_1', chapter: 6, weight: 3, once: true, requires: '', narrative: '太南小会上，一个蒙面散修拉住你：「道友，合做个大买卖？」', choices: [{ text: '听听无妨', set: { 灵石: 1, 气运: -1 } }, { text: '婉拒离开', set: { 气运: 1 } }] },
  { id: 'f8_1', chapter: 8, weight: 3, once: true, requires: '', narrative: '结丹关头，你心魔乍起：眼前闪过墨大夫临死的脸。', choices: [{ text: '斩心魔', set: { 悟性: 1 } }, { text: '任其蔓延', set: { 根骨: 1, 气血: -1 } }] },
  { id: 'f11_1', chapter: 11, weight: 3, once: true, requires: '', narrative: '元婴天劫降至，护山大阵嗡嗡作响。宗门上下都在看你的动静。', choices: [{ text: '硬抗天劫', set: { 气血: -1, 修为: 1 } }, { text: '动用保命底牌', set: { 灵石: -2, 气血: 1 } }] },
  { id: 'f13_1', chapter: 13, weight: 2, once: true, requires: '', narrative: '幻境秘境中，你见到了早已死去的故人——音容笑貌，分毫不差。', choices: [{ text: '上前相认', set: { 悟性: 1 } }, { text: '一剑斩幻', set: { 根骨: 1 } }] },
  { id: 'f15_1', chapter: 15, weight: 3, once: true, requires: '', narrative: '飞升台前，最后一道考验：斩去凡尘记忆，你可愿？', choices: [{ text: '斩', set: { 悟性: 1, 声望: -1 } }, { text: '不斩——凡人之身，凡人之道', set: { 气运: 1 } }] },
];

const MAP = [
  { id: 'fm_town', name: '青牛镇', chapter: 1, desc: '你出生的凡人村镇。溪水绕村，鸡犬相闻——以及一堵贴满告示的土墙。', set: {} },
  { id: 'fm_valley', name: '彩色山谷', chapter: 1, desc: '坠崖后爬进的山谷，四壁色彩斑斓。谷底静卧着一尊落满灰的三足小鼎。', clue: '小瓶每逢月圆凝出一滴绿液——一滴，能催熟百年灵药。这是你此生最大的秘密。', knowledge: '掌天瓶可催熟灵药', set: { 气运: 1 } },
  { id: 'fm_seven', name: '七玄门·神手谷', chapter: 2, desc: '墨大夫的药谷，药香混着一丝说不清的腥气。谷中昼夜炉火不熄。', clue: '你在药渣里认出了迷魂草的配伍——师父在炼的，不是救人的药。', knowledge: '墨大夫在炼迷魂类药物', set: { 悟性: 1 } },
  { id: 'fm_library7', name: '七玄门藏经阁', chapter: 2, desc: '外门弟子唯一能进的三层小楼。真正的修仙功法，藏在最顶层——外人止步。', clue: '阁中《江湖异闻录》记载：仙缘之说非虚，仙师确在世上游走。', set: { 悟性: 1 } },
  { id: 'fm_blood', name: '血色禁地', chapter: 3, desc: '五年一开的地界，雾锁百里。进去的人带回来的除了灵药，还有一辈子的噩梦。', clue: '禁地深处遍地遗骨，骨骼上皆是同一类爪痕——这不是天然秘境，是养蛊的池子。', knowledge: '血色试炼是修仙者的杀局', set: { 气血: -1, 气运: 1 } },
  { id: 'fm_huangfeng', name: '黄枫谷·百药园', chapter: 4, desc: '你执掌的一亩三分灵田。明面是闲差，实际上——全宗门没有比这更适合苟着发育的位置。', clue: '药园地脉下埋着前人洞府的禁制残纹，月圆之夜会隐隐发光。', knowledge: '百药园地下有洞府残禁', set: { 灵石: 1 } },
  { id: 'fm_danroom', name: '丹房', chapter: 5, desc: '你闭关炼药的地方。炉火三年不熄，失败品堆了半间屋。', clue: '筑基丹三味主药的丹方补全了——最后一味「百年灵乳」，小瓶能催。', knowledge: '筑基丹方可成', set: { 悟性: 1 } },
  { id: 'fm_tainan', name: '太南小会', chapter: 6, desc: '散修盛会，鱼龙混杂。半数的笑脸背后都藏着算盘，剩下一半连笑脸都没有。', clue: '有人兜售「上古丹宗」地图残片——与你在血色禁地捡的残图，严丝合缝。', knowledge: '两份残图可拼合', set: { 灵石: -1, 气运: 1 } },
  { id: 'fm_sea', name: '乱星海·坠星海坊市', chapter: 8, desc: '建在海眼之上的浮动坊市，潮声里有灵兽低鸣。这里灵石比命贵。', clue: '水牌上悬赏：海底沉城现世，化神洞府残图——赏格是十万灵石。', knowledge: '海底有化神洞府', set: {} },
  { id: 'fm_vortex', name: '灵气漩涡之地', chapter: 11, desc: '元婴突破的天劫雷云终年盘旋之地，方圆百里草木不生。', clue: '雷云中心的石壁上，刻着一道过期天劫留下的焦痕——形似符文，又似天书。', set: { 悟性: 1 } },
  { id: 'fm_array', name: '五指山阵眼', chapter: 14, desc: '破阵之战的主战场。上古大阵的灵纹在大地上亮起，像一只覆下的巨掌。', clue: '阵眼灵纹与太南小会的地图残片完全吻合——这张图，从绘制那天起就是为了进这里。', knowledge: '残图是阵眼钥匙', set: { 悟性: 1 } },
  { id: 'fm_gate', name: '飞升台', chapter: 15, desc: '传说中接引飞升的祭坛。台上一级石阶，比整个修真界都安静。', set: {} },
];

const EXTRA_ENDINGS = [
  { id: 'end_huashen', family: '隐藏', condition: '修为>=13 & 悟性>=6', title: '化神之谜', tone: '隐藏·问道之巅', epilogue: '化神之上是什么？你在飞升台上得到答案的形状——不是仙，不是道，是一个更大的世界大门缓缓开启的声音。凡人韩立，走到了传说开始的地方。', rarity: 0.07 },
  { id: 'end_yuanying', family: '改命', condition: '修为>=10 & 气运>=5', title: '元婴问道', tone: '爽·元婴老祖', epilogue: '元婴出窍那一日，万里外的宗门钟声齐鸣。曾经要你死的人坟头草三丈，曾经救过的人开宗立派。你盘坐云端，忽然想起青牛镇那个砍柴的少年——他要是看到今天，大概会咧嘴笑吧。', rarity: 0.16 },
  { id: 'end_jindan', family: '改命', condition: '修为>=7', title: '金丹大道', tone: '爽·一丹定命', epilogue: '金丹一成，此生不为民。你在洞府里种了半辈子的药，终于把自己种成了一方巨擘。散修们提起你的名号，都要压低声音：那位，苟了三百年，出手一次，就没了。', rarity: 0.2 },
  { id: 'end_poor', family: '原作', condition: '修为<=2 & 灵石<=1', title: '凡尘困顿', tone: '憋屈·蹉跎', epilogue: '灵根太杂，灵石太少，机缘太少。你在杂役峰蹉跎到两鬓斑白，最后成了一个普通的老杂役。（提示：重开时试试攒灵石、抱紧小瓶——凡人也可以逆天）', rarity: 0.14 },
  { id: 'end_mortal', family: '原作', condition: '', title: '凡人之路', tone: '平实·步履不停', epilogue: '这一世的故事讲到这里。前路还长：筑基、结丹、元婴、化神……修仙百年，凡人一步步走。擦干净柴刀，明天还要进山。', rarity: 0.3 },
];

// ==================== 组装 ====================
const chapterNames = {};
for (const [num, name] of Object.entries(data.chapters || {})) {
  chapterNames[String(num)] = String(name).replace(/^第.+?[章回][:：]?/, '').trim().slice(0, 8);
}

const novel = {
  meta: {
    id: 'fanren',
    title: '凡人修仙传·凡人风起',
    author: '忘语（改编）',
    source: 'fanren_reference',
    intro: '一个山村穷小子的修仙长卷：四灵根、无靠山，靠一个神秘小瓶和过分谨慎的心性，从七玄门杂役一路走到化神之巅。这一世，穿进去的人是你。',
    chapters_covered: chapterNums,
    schema: 2,
    ai_disclaimer: true,
    rating_hint: 'general',
    generated_at: new Date().toISOString(),
  },
  canon_rules: CANON_RULES,
  lorebook: LOREBOOK,
  characters: CHARACTERS,
  player: PLAYER,
  graph: { start: nodeIds.has('start') ? 'start' : ordered[0]?.id, nodes: ordered },
  events: EVENTS,
  map: MAP,
  endings: [...sceneEndings, ...EXTRA_ENDINGS],
  presentation: {
    ui_style: 'ai-avg',
    bubble_theme: 'light',
    narration_rules: '凡人风：旁白克制写实，台词朴拙；修仙细节（灵石/法器/境界）须符合设定',
    mind_reading: true,
    mind_require: '修为>=10',
    mind_flavor: '神识感应·元婴外放',
    npc_pool: ['门房执事', '同门弟子', '坊市商人'],
    chapter_names: chapterNames,
    prologue: [
      { title: '这是一个什么世界', text: '修真界，弱肉强食。凡人如蝼蚁，修士分十六境：凡人→练气→筑基→结丹→元婴→化神，每一境都是天堑。你灵根杂驳，进境奇慢；灵石是硬通货；恩怨分明，杀机四伏。在这里，仁慈是奢侈品，谨慎才是活命的本钱。' },
      { title: '发生在你身上的事', text: '你是青牛镇的山村少年，父母早亡，靠邻里接济和打柴度日。这一日进山，你在从未到过的山谷里坠崖未死，摸到一尊落满灰的三足小鼎——每逢月圆，鼎中凝出一滴绿液，能催熟灵药百年成材。这个秘密，你谁也不能说。很快，七玄门收人的告示贴到了镇上。' },
      { title: '活下去的三条规矩', text: '一、不轻信任何人——对你笑的人都在算计；二、扮猪吃虎——实力不示人，示人即杀局；三、恩要还，债要偿——挡路者，斩草除根。' },
      { title: '这一世的目标', text: '从七玄门杂役做起：练气、筑基、结丹、元婴，直至触摸化神之谜。十五章、五百余段旅程。你死在半路，故事当场终结；你走到最后——修仙界会记住一个新的名字。' },
    ],
  },
};

// 自检：goto 存在 & 每章 keyMoment
const ids = new Set(ordered.map((n) => n.id));
let broken = 0;
for (const n of ordered) {
  if (n.goto && !ids.has(n.goto)) { delete n.goto; broken++; }
  for (const c of n.choices || []) if (c.goto && !ids.has(c.goto)) { c.goto = n.goto || null; broken++; }
}
const kmByCh = {};
for (const n of ordered) kmByCh[n.chapter] = kmByCh[n.chapter] || 0, n.keyMoment && n.choices?.length && kmByCh[n.chapter]++;

writeFileSync(OUT, JSON.stringify(novel, null, 1), 'utf8');
console.log(`fanren.json 已生成: ${ordered.length} 节点 / ${chapterNums.length} 章 / ${novel.events.length} 事件 / ${novel.endings.length} 结局 / ${MAP.length} 地图点 / 坏goto修复 ${broken}`);
console.log('每章 keyMoment:', JSON.stringify(kmByCh));
