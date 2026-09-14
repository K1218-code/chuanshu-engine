// 确定性引擎 v2 —— 技术文档 §4.2 + AI对话AVG扩展（事件池/羁绊/长期记忆/章节流程）
// 每次选择 = (state, choice) 纯函数；LLM 无状态提交权（applyPatch 白名单+限幅）。
// v1 书籍（无 events/rels 字段）自动降级兼容，chat/avg 旧页面不受影响。
import { createEvaluator } from './dsl.js';

export const MEMORY_CAP = 24;        // 长期记忆客户端镜像上限（服务端库为准）
export const MEMORY_TURN_CAP = 2;    // 单轮允许新增的记忆条数
const REL_MIN = 0, REL_MAX = 100;

export function createState(novel, { identity = null, playerName = '' } = {}) {
  const attrs = {};
  for (const def of novel.player.attributes) attrs[def.key] = def.initial;
  let tlt = [];
  if (identity) {
    const card = novel.player.identity_cards.find((c) => c.id === identity) || null;
    if (card?.init) for (const [k, v] of Object.entries(card.init)) {
      if (k in attrs) attrs[k] = clampTo(novel, k, attrs[k] + v);
    }
    tlt = [identity];
  }
  const rels = {};
  for (const ch of novel.characters || []) {
    if (ch.role === 'lead' || ch.id === identity) continue;
    rels[ch.id] = { favor: ch.favor_init ?? 30, nature: '' };
  }
  const chapters = chapterList(novel);
  return {
    v: 2,
    bookId: novel.meta.id,
    mode: 'ai-avg',
    identity,
    playerChar: resolvePlayerChar(novel, identity), // 穿越对应的原著角色 id（ null=原创身份）
    playerName,
    location: null,      // 当前所在地图地点 id
    mapVisited: [],
    node: novel.graph.start,
    chapter: novel.graph.nodes[0]?.chapter ?? 1,
    chapters,
    chapterTurn: 0,
    chapterBudget: rollBudget(chapters[0] ?? 1, identity),
    attrs,
    flags: {},
    evt: [],
    tlt,
    rels,
    memories: [], // {kind, content, importance, turn}
    knowledge: { facts: [], npcMinds: {}, playerKnown: [] },
    divergence: 0,
    summaryChain: { book: novel.meta.intro || '', chapter: '' },
    recent: [],
    endingsUnlocked: [],
    ts: Date.now(),
  };
}

function clampTo(novel, key, value) {
  const def = novel.player.attributes.find((a) => a.key === key);
  if (!def) return value;
  return Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, value));
}

function applySet(state, novel, set = {}) {
  const rejected = [];
  for (const [k, v] of Object.entries(set)) {
    if (!(k in state.attrs)) { rejected.push(k); continue; }
    const delta = Number(v);
    if (!Number.isFinite(delta)) { rejected.push(k); continue; }
    // 单轮 |Δ| ≤ 2，超限截断
    const capped = Math.max(-2, Math.min(2, delta));
    state.attrs[k] = clampTo(novel, k, state.attrs[k] + capped);
  }
  return rejected;
}

function applyKnowledge(state, patch = {}) {
  if (patch.playerKnown) {
    const known = new Set(state.knowledge.playerKnown);
    for (const k of patch.playerKnown) known.add(k); // 只允许追加
    state.knowledge.playerKnown = [...known];
  }
  if (patch.npcMinds) {
    for (const [npc, mind] of Object.entries(patch.npcMinds)) state.knowledge.npcMinds[npc] = mind;
  }
  if (patch.facts) {
    const facts = new Set(state.knowledge.facts);
    for (const f of patch.facts) facts.add(f);
    state.knowledge.facts = [...facts];
  }
}

// ---- 羁绊（好感度 0-100 + 性质标签） ----
// ---- 穿越角色解析：身份卡 → 原著角色（身份卡带 char 字段优先，否则剥 ic_ 前缀匹配） ----
export function resolvePlayerChar(novel, identity) {
  if (!identity) return null;
  const card = (novel.player.identity_cards || []).find((c) => c.id === identity);
  const candidates = [card?.char, identity.replace(/^ic_/, '')].filter(Boolean);
  for (const cand of candidates) {
    if ((novel.characters || []).some((c) => c.id === cand)) return cand;
  }
  return null;
}

export function relOf(state, npcId) {
  if (!state.rels[npcId]) state.rels[npcId] = { favor: 30, nature: '' };
  return state.rels[npcId];
}

function applyRelPatch(state, novel, rels = {}) {
  const charIds = new Set((novel.characters || []).map((c) => c.id));
  for (const [npc, patch] of Object.entries(rels)) {
    if (!charIds.has(npc)) continue;
    const rel = relOf(state, npc);
    const d = Number(patch?.favor);
    if (Number.isFinite(d) && d !== 0) rel.favor = Math.max(REL_MIN, Math.min(REL_MAX, rel.favor + Math.max(-8, Math.min(8, d))));
    if (typeof patch?.nature === 'string' && patch.nature) rel.nature = patch.nature.slice(0, 6);
  }
}

// ---- 长期记忆（客户端镜像；服务端数据库为准，见 worker/memory.js） ----
export function pushMemories(state, items = []) {
  for (const m of items.slice(0, MEMORY_TURN_CAP)) {
    const content = String(m?.content || '').trim().slice(0, 80);
    if (!content) continue;
    state.memories.push({
      kind: ['fact', 'relationship', 'promise', 'secret'].includes(m.kind) ? m.kind : 'fact',
      content,
      importance: Math.max(1, Math.min(3, Number(m.importance) || 1)),
      turn: state.chapterTurn,
      chapter: state.chapter,
    });
  }
  // 超限淘汰：重要性低且最旧的先出局
  if (state.memories.length > MEMORY_CAP) {
    state.memories.sort((a, b) => b.importance - a.importance || b.turn - a.turn);
    state.memories = state.memories.slice(0, MEMORY_CAP);
  }
}

// ---- 日常事件池（千世书 schema；v1 书籍无此池返回 null） ----
export function drawEvent(state, novel, rng = Math.random) {
  const pool = (novel.events || []).filter((e) => {
    if (e.chapter !== state.chapter) return false;
    if (e.once !== false && state.evt.includes(e.id)) return false;
    if (e.requires) { try { if (!createEvaluator(state)(e.requires)) return false; } catch { return false; } }
    return true;
  });
  if (!pool.length) return null;
  const total = pool.reduce((s, e) => s + (Number(e.weight) || 1), 0);
  let roll = rng() * total;
  for (const e of pool) { roll -= (Number(e.weight) || 1); if (roll <= 0) return e; }
  return pool[pool.length - 1];
}

export function applyEventChoice(state, novel, event, choiceIndex) {
  const choice = event?.choices?.[choiceIndex] ?? null;
  const next = structuredClone(state);
  if (choice) {
    applySet(next, novel, choice.set);
    if (choice.flags) for (const [k, v] of Object.entries(choice.flags)) next.flags[k] = Boolean(v);
    if (choice.divergence_delta) next.divergence = clampDivergence(next.divergence + Number(choice.divergence_delta) || 0);
  }
  if (!next.evt.includes(event.id)) next.evt.push(event.id);
  next.ts = Date.now();
  return next;
}

// ---- 章节流程：AI 自由阶段（血肉）× graph 命运节点（骨架） ----
export function chapterList(novel) {
  return [...new Set((novel.graph?.nodes || []).map((n) => n.chapter ?? 1))].sort((a, b) => a - b);
}

export function chapterStartNode(novel, ch) {
  return (novel.graph?.nodes || []).find((n) => (n.chapter ?? 1) === ch) || null;
}

// 本章命运节点：优先 keyMoment 且带 choices 的第一个节点
export function keyMomentNode(novel, ch) {
  const nodes = (novel.graph?.nodes || []).filter((n) => (n.chapter ?? 1) === ch);
  return nodes.find((n) => n.keyMoment && n.choices?.length) || nodes.find((n) => n.choices?.length) || null;
}

// 每章自由行动预算：5-8 轮，由章节号+身份稳定派生（可被 presentation.turns_per_chapter 覆盖）
export function rollBudget(ch, identity) {
  const base = 5;
  let h = ch * 31 + String(identity || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  h = (h ^ (h >> 3)) % 997;
  return base + (h % 4);
}

// 沿 goto 链推进并收集沿途节点（应用 set/knowledge），在「有选项」「换章」「无后继」处停下
// 返回 { state, visited, nextChapter }；visited[0] 为 fromNode；
// nextChapter 非 null = 本章链条已走完，下一站是该章（state.node 停在本章最后一个节点）
export function advanceThrough(state, novel, fromNode) {
  let cur = fromNode;
  const visited = [];
  let stopNodeId = fromNode?.id;
  let nextChapter = null;
  for (let i = 0; i < 12 && cur; i++) {
    const next = structuredClone(state);
    applySet(next, novel, cur.set);
    applyKnowledge(next, cur.knowledge_patch);
    if (!next.evt.includes(cur.id)) next.evt.push(cur.id);
    state = next;
    visited.push(cur);
    if (cur.choices?.length) { stopNodeId = cur.id; break; }   // 等玩家抉择
    if (!cur.goto) { stopNodeId = cur.id; break; }            // 死路/闸门
    const target = nodeOf(novel, cur.goto);
    if (!target) { stopNodeId = cur.id; break; }
    if ((target.chapter ?? 1) !== (cur.chapter ?? 1)) {
      stopNodeId = cur.id;
      nextChapter = target.chapter ?? ((cur.chapter ?? 1) + 1);
      break;                                                   // 跨章：本章演出到此为止
    }
    stopNodeId = cur.goto;
    cur = target;
  }
  state.node = stopNodeId;
  const stay = nodeOf(novel, state.node);
  if (stay) state.chapter = stay.chapter ?? state.chapter;
  state.ts = Date.now();
  return { state, visited, nextChapter };
}

// ---- 可探索地图（v2.1）：仿修仙模拟器「地图随脚步展开」 ----
// novel.map = [{id, name, chapter(解锁章), desc(场所描述), clue?(线索), knowledge?(线索入playerKnown),
//               set?(探索奖励), flags?(旗标), once:true, requires?(DSL)}]
export function mapLocations(novel, state) {
  return (novel.map || []).map((loc) => {
    let unlocked = (loc.chapter ?? 1) <= state.chapter;
    if (unlocked && loc.requires) {
      try { unlocked = !!createEvaluator(state)(loc.requires); } catch { unlocked = false; }
    }
    return { ...loc, unlocked, visited: (state.mapVisited || []).includes(loc.id) };
  });
}

export function visitLocation(state, novel, locId) {
  const loc = (novel.map || []).find((l) => l.id === locId);
  if (!loc) return { state, loc: null };
  const next = structuredClone(state);
  next.mapVisited = next.mapVisited || [];
  if (!next.mapVisited.includes(locId)) next.mapVisited.push(locId);
  applySet(next, novel, loc.set);
  if (loc.flags) for (const [k, v] of Object.entries(loc.flags)) next.flags[k] = Boolean(v);
  if (loc.knowledge) {
    const known = new Set(next.knowledge.playerKnown);
    for (const k of [].concat(loc.knowledge)) known.add(k);
    next.knowledge.playerKnown = [...known];
  }
  if (loc.clue) pushMemories(next, [{ kind: 'fact', content: `【${loc.name}】${String(loc.clue).slice(0, 50)}`, importance: 2 }]);
  next.ts = Date.now();
  return { state: next, loc };
}

function clampDivergence(v) { return Math.max(0, Math.min(1, +v.toFixed(2))); }

export function nodeOf(novel, id) {
  return novel.graph.nodes.find((n) => n.id === id) || null;
}

export function applyChoice(state, novel, choiceIndex) {
  const node = nodeOf(novel, state.node);
  if (!node?.choices) throw new Error(`节点 ${state.node} 无选项`);
  const choice = node.choices[choiceIndex];
  if (!choice) throw new Error(`选项序号越界: ${choiceIndex}`);
  const next = structuredClone(state);
  applySet(next, novel, choice.set);
  if (choice.flags) for (const [k, v] of Object.entries(choice.flags)) next.flags[k] = Boolean(v);
  applyKnowledge(next, choice.knowledge_patch);
  if (choice.divergence_delta) next.divergence = clampDivergence(next.divergence + choice.divergence_delta);
  if (!next.evt.includes(node.id)) next.evt.push(node.id);
  if (choice.goto) next.node = choice.goto;
  const target = nodeOf(novel, next.node);
  if (target) next.chapter = target.chapter ?? next.chapter;
  next.ts = Date.now();
  return next;
}

// 自动推进节点（无 choices 的节点沿 goto 前进）；返回 null 表示没有后继（v1 兼容）
export function advance(state, novel) {
  const node = nodeOf(novel, state.node);
  if (!node) return null;
  const next = structuredClone(state);
  applySet(next, novel, node.set);
  applyKnowledge(next, node.knowledge_patch);
  if (!next.evt.includes(node.id)) next.evt.push(node.id);
  if (node.goto) { next.node = node.goto; const t = nodeOf(novel, node.goto); if (t) next.chapter = t.chapter ?? next.chapter; }
  next.ts = Date.now();
  return next;
}

export function evalChoices(state, novel, node) {
  const evaluate = createEvaluator(state);
  return (node.choices || []).map((c) => {
    let ok = true, reason = '';
    if (c.requires) {
      try { ok = evaluate(c.requires); }
      catch (e) { ok = false; reason = '条件异常'; }
      if (!ok) reason = hintOf(c.requires);
    }
    return { choice: c, ok, reason };
  });
}

export function evalEventChoices(state, event) {
  const evaluate = createEvaluator(state);
  return (event?.choices || []).map((c) => {
    let ok = true, reason = '';
    if (c.requires) {
      try { ok = evaluate(c.requires); }
      catch { ok = false; }
      if (!ok) reason = hintOf(c.requires);
    }
    return { choice: c, ok, reason };
  });
}

function hintOf(requires) {
  // 生成灰显提示，如 "需要 信心≥5"
  return String(requires)
    .replace(/&/g, ' 且 ').replace(/\|/g, ' 或 ')
    .replace(/>=/g, '≥').replace(/<=/g, '≤')
    .replace(/EVT\?\[([^\]]*)\]/g, '需经历「$1」')
    .replace(/TLT?\[([^\]]*)\]/g, '需身份「$1」')
    .slice(0, 24);
}

// 实时死亡判定：仅软状态跌破 deathBelow（自由行动阶段随时可触发）
export function checkDeathEnding(state, novel) {
  for (const def of novel.player.attributes) {
    if (def.deathBelow != null && (state.attrs[def.key] ?? 0) < def.deathBelow) {
      const death = novel.endings.find((e) => e.family === '死亡' && (!e.condition || safeEval(e.condition, state, novel)))
        || novel.endings.find((e) => e.family === '死亡');
      if (death) return { ending: death, cause: `「${def.name}」跌破底线` };
    }
  }
  return null;
}

export function checkEnding(state, novel, { allowFallback = true } = {}) {
  // 1) 软状态跌破 deathBelow → 强制死亡/崩溃族结局
  const death = checkDeathEnding(state, novel);
  if (death) return death;
  // 2) 按数组顺序，首个条件命中的结局（顺序即特异性优先级）
  //    allowFallback=false 时跳过无条件兜底结局（中途结算不允许"故事结束"型结局混入）
  for (const ending of novel.endings) {
    if (ending.family === '死亡') continue;
    if (!ending.condition) { if (allowFallback) return { ending, cause: '' }; continue; }
    if (safeEval(ending.condition, state, novel)) return { ending, cause: '' };
  }
  return null;
}

function safeEval(expr, state, novel) {
  try { return createEvaluator(state, () => {})(expr); } catch { return false; }
}

export function isDeadEnd(state, novel, nodeId) {
  const node = nodeOf(novel, nodeId);
  return !node || (!node.choices && !node.goto);
}

// LLM state_patch 合并入口；白名单 + 范围 + 单轮限幅（AI 无提交权）
export function applyPatch(state, novel, patch = {}) {
  const next = structuredClone(state);
  const rejected = applySet(next, novel, patch.attrs);
  if (patch.flags) for (const [k, v] of Object.entries(patch.flags)) next.flags[k] = Boolean(v);
  applyKnowledge(next, patch.knowledge);
  applyRelPatch(next, novel, patch.rels);
  if (Array.isArray(patch.memories_add)) pushMemories(next, patch.memories_add);
  if (patch.divergence_delta) {
    const dd = Math.max(-0.1, Math.min(0.1, Number(patch.divergence_delta) || 0));
    next.divergence = clampDivergence(next.divergence + dd);
  }
  return { state: next, rejected };
}

// ---- 储物袋（物品/功法/丹药）：i_ 前缀旗标 → 名称列表 ----
export function inventoryOf(state) {
  return Object.entries(state.flags || {})
    .filter(([k, v]) => v && k.startsWith('i_'))
    .map(([k, v]) => ({ id: k, name: k.slice(2) }));
}

// ---- 境界/阶段跃迁检测：band 标签变化即触发（用于突破仪式演出） ----
// 多段 bands（如凡人 16 境界）才算"境界"；返回 {key, name, label} 或 null
export function realmChange(beforeAttrs, afterAttrs, novel) {
  for (const def of novel.player.attributes) {
    if (!def.bands || def.bands.length < 4) continue;
    const before = beforeAttrs?.[def.key];
    const after = afterAttrs?.[def.key];
    if (before == null || after == null || after <= before) continue;
    const b1 = attrBand(def, before);
    const b2 = attrBand(def, after);
    if (b1 && b2 && b1.label !== b2.label) return { key: def.key, name: def.name, label: b2.label };
  }
  return null;
}

// ---- 序章引导：交代世界观/身份处境/玩法 ----
// presentation.prologue 提供自定义的世界观段落；身份与玩法段落始终自动追加
export function buildPrologue(novel, identityCard) {
  const custom = novel.presentation?.prologue;
  const sections = Array.isArray(custom) && custom.length
    ? custom.map((s) => ({ title: String(s.title || ''), text: String(s.text || '') }))
    : [{ title: '这个世界', text: novel.meta.intro || '' }];
  if (!sections.length) sections.push({ title: '这个世界', text: novel.meta.intro || '' });
  if (identityCard) sections.push({ title: '你穿成了谁', text: `${identityCard.name}——${identityCard.desc || ''}` });
  sections.push({
    title: '怎么玩',
    text: '固定选项之外，输入框里可以写下任何言行（AI 当场裁定结果）。留意「意外事件」与地图——探索会留下线索；羁绊簿记录每个 NPC 对你的态度；命运节点的抉择将决定结局走向。',
  });
  return sections;
}

export function attrBand(def, value) {
  if (!def.bands) return null;
  const sorted = [...def.bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const band of sorted) if (value <= (band.upTo ?? Infinity)) return band;
  return sorted[sorted.length - 1] || null;
}
