// 确定性引擎 —— 技术文档 §4.2
// 每次选择 = (state, choice) 纯函数；LLM 无状态提交权。
import { createEvaluator } from './dsl.js';

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
  return {
    v: 1,
    bookId: novel.meta.id,
    mode: 'avg',
    identity,
    playerName,
    node: novel.graph.start,
    chapter: novel.graph.nodes[0]?.chapter ?? 1,
    attrs,
    flags: {},
    evt: [],
    tlt,
    knowledge: { facts: [], npcMinds: {}, playerKnown: [] },
    divergence: 0,
    summaryChain: { book: novel.meta.intro || '', chapter: '' },
    recent: [],
    endingsUnlocked: [],
    ts: Date.now(),
  };
}

export function nodeOf(novel, id) {
  return novel.graph.nodes.find((n) => n.id === id) || null;
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
    // 单轮 |Δ| ≤ 2，超限截断（技术文档 §5.4 的精神同样适用于离线 set）
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

export function applyChoice(state, novel, choiceIndex) {
  const node = nodeOf(novel, state.node);
  if (!node?.choices) throw new Error(`节点 ${state.node} 无选项`);
  const choice = node.choices[choiceIndex];
  if (!choice) throw new Error(`选项序号越界: ${choiceIndex}`);
  const next = structuredClone(state);
  applySet(next, novel, choice.set);
  applyKnowledge(next, choice.knowledge_patch);
  if (choice.divergence_delta) next.divergence = Math.max(0, Math.min(1, +(next.divergence + choice.divergence_delta).toFixed(2)));
  if (!next.evt.includes(node.id)) next.evt.push(node.id);
  if (choice.goto) next.node = choice.goto;
  const target = nodeOf(novel, next.node);
  if (target) next.chapter = target.chapter ?? next.chapter;
  next.ts = Date.now();
  return next;
}

// 自动推进节点（无 choices 的节点沿 goto 前进）；返回 null 表示没有后继
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

function hintOf(requires) {
  // 生成灰显提示，如 "需要 信心≥5"
  return String(requires)
    .replace(/&/g, ' 且 ').replace(/\|/g, ' 或 ')
    .replace(/>=/g, '≥').replace(/<=/g, '≤')
    .replace(/EVT\?\[([^\]]*)\]/g, '需经历「$1」')
    .replace(/TLT?\[([^\]]*)\]/g, '需身份「$1」')
    .slice(0, 24);
}

export function checkEnding(state, novel) {
  // 1) 软状态跌破 deathBelow → 强制死亡/崩溃族结局
  for (const def of novel.player.attributes) {
    if (def.deathBelow != null && (state.attrs[def.key] ?? 0) < def.deathBelow) {
      const death = novel.endings.find((e) => e.family === '死亡' && (!e.condition || safeEval(e.condition, state, novel)))
        || novel.endings.find((e) => e.family === '死亡');
      if (death) return { ending: death, cause: `「${def.name}」跌破底线` };
    }
  }
  // 2) 按数组顺序，首个条件命中的结局（顺序即特异性优先级）
  for (const ending of novel.endings) {
    if (ending.family === '死亡') continue;
    if (!ending.condition || safeEval(ending.condition, state, novel)) return { ending, cause: '' };
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

// LLM state_patch 合并入口（模式①用）；白名单 + 范围 + 单轮限幅
export function applyPatch(state, novel, patch = {}) {
  const next = structuredClone(state);
  const rejected = applySet(next, novel, patch.attrs);
  if (patch.flags) for (const [k, v] of Object.entries(patch.flags)) next.flags[k] = Boolean(v);
  applyKnowledge(next, patch.knowledge);
  if (patch.divergence_delta) next.divergence = Math.max(0, Math.min(1, +(next.divergence + Number(patch.divergence_delta) || 0).toFixed(2)));
  return { state: next, rejected };
}

export function attrBand(def, value) {
  if (!def.bands) return null;
  const sorted = [...def.bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const band of sorted) if (value <= (band.upTo ?? Infinity)) return band;
  return sorted[sorted.length - 1] || null;
}
