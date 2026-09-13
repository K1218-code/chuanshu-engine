// 剧情体验页逻辑：IM 沉浸对话 + 心声层 + 剧情推进 + 自由输入
// 优先走 /api/gm（部署后 AI 叙事）；不可用时降级为「本地预置模式」：
//   - 剧情推进按钮沿 novel.graph 原作主线走（台词全部原文）
//   - 自由输入用 lorebook 关键词命中 + 角色 anchor 风格池回应，心声取自角色卡 mind
import { createState, nodeOf, advance, applyChoice, checkEnding, attrBand } from './engine.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const bookId = (/^[a-z0-9_-]{1,64}$/i.test(params.get('book') || '') ? params.get('book') : 'btg_room');
let novel = null, state = null;
let gmAvailable = null; // null=未探测

$('btn-back').addEventListener('click', () => location.href = './index.html');
$('btn-reset').addEventListener('click', () => { localStorage.removeItem(`cs_chat_${bookId}`); location.reload(); });
const msgs = $('msgs');

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

function addBubble(who, text, loc) {
  const c = novel.characters.find((x) => x.id === who);
  const block = el('div', 'bubble-block' + (who === 'me' ? ' me' : ''));
  const head = el('div', 'bubble-head');
  head.append(el('span', 'bubble-avatar', c ? c.avatar : '我'), el('span', 'bubble-name', c ? c.name : '我'));
  if (loc) head.append(el('span', 'bubble-loc', `〔${loc}〕`));
  block.append(head, el('div', 'bubble', text), el('span', 'ai-mark', 'AI'));
  msgs.append(block);
}
function addMy(text) {
  const block = el('div', 'bubble-block me');
  block.append(el('div', 'bubble', text));
  msgs.append(block);
}
function addNarration(text) { msgs.append(el('div', 'narration', text)); }
function addMind(text) {
  const card = el('div', 'mind-card');
  card.append(el('span', 'tag-mind', '心声 · 他没说出口的'), el('span', null, text));
  msgs.append(card);
}
function addTime(text) { msgs.append(el('div', 'msg-time', text)); }

function renderStatbar() {
  const bar = $('statbar'); bar.replaceChildren();
  for (const def of novel.player.attributes) {
    const v = state.attrs[def.key];
    const band = attrBand(def, v);
    const s = el('span', 'stat' + (v <= (def.deathBelow ?? -1) + 1 ? ' danger' : ''));
    const b = el('b', null, String(v));
    s.append(`${def.name} `, b);
    if (band && band.label && v <= band.upTo) s.append(`·${band.label}`);
    bar.append(s);
  }
}

// ---- 剧情推进：沿 graph 主线（本地预置模式的核心） ----
function advanceStory() {
  const node = nodeOf(novel, state.node);
  if (!node) return;
  if (node.keyMoment) msgs.append(el('div', 'km-flag', '· 命运节点 ·'));
  if (node.who === 'narrator') addNarration(node.text);
  else addBubble(node.who, node.text, chapterLoc(node.chapter));
  // 心声：命中世界书「心声/内心」或角色有 mind 且节点为其台词时展示（信息差玩法）
  const speaker = novel.characters.find((x) => x.id === node.who);
  if (speaker && speaker.mind && Math.random() < 0.6) addMind(speaker.mind);
  state = advance(state, novel);
  renderStatbar();
  refreshQuick();
  saveSession();
  scrollBottom();
}

function chapterLoc(ch) {
  const map = novel.meta.id === 'ak47_xiuzhen'
    ? { 1: '宗门大比', 2: '擂台', 3: '擂台·对峙', 4: '擂台·清算' }
    : { 1: '不提分房间', 2: '不提分房间', 3: '晚自习走廊', 4: '不提分房间' };
  return map[ch] || '';
}

function refreshQuick() {
  const quick = $('quick'); quick.replaceChildren();
  const node = nodeOf(novel, state.node);
  const adv = el('button', 'quick-btn advance', node?.choices?.length ? '剧情抉择 ▸' : '继续剧情 ▸');
  adv.addEventListener('click', () => {
    if (node?.choices?.length) { renderChoicesInline(node); } else advanceStory();
  });
  quick.append(adv);
  // NPC 点名快捷（最多3个）
  for (const c of novel.characters.filter((x) => x.role !== 'lead').slice(0, 3)) {
    const b = el('button', 'quick-btn', `@${c.name}`);
    b.addEventListener('click', () => { addMy(`@${c.name}`); freeTalk(`（点名）${c.name}`, c); });
    quick.append(b);
  }
}

function renderChoicesInline(node) {
  // 命运节点：把选项渲染成快捷按钮（点后走 applyChoice 并演出结果节点）
  const quick = $('quick'); quick.replaceChildren();
  node.choices.forEach((c, i) => {
    const b = el('button', 'quick-btn', c.text);
    b.addEventListener('click', () => {
      addMy(c.text);
      state = applyChoice(state, novel, i);
      const next = nodeOf(novel, state.node);
      if (next) { if (next.keyMoment) msgs.append(el('div', 'km-flag', '· 命运节点 ·'));
        if (next.who === 'narrator') addNarration(next.text); else addBubble(next.who, next.text, chapterLoc(next.chapter));
        const hit = checkEnding(state, novel);
        if (hit && (!next.choices?.length)) { addNarration(`—— 结局 ·「${hit.ending.title}」——`); addNarration(hit.ending.epilogue); }
        state = advance(state, novel);
      }
      renderStatbar(); refreshQuick(); saveSession(); scrollBottom();
    });
    quick.append(b);
  });
}

// ---- 自由输入 ----
$('send').addEventListener('click', send);
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
function send() {
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMy(text);
  freeTalk(text, null);
}

async function freeTalk(text, targetChar) {
  if (gmAvailable !== false) {
    try {
      const r = await fetch('./api/gm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, state, userInput: text }) });
      if (!r.ok) throw new Error('gm ' + r.status);
      const d = await r.json();
      gmAvailable = true; $('mode-badge').hidden = true;
      for (const rep of d.replies || []) addBubble(charIdByName(rep.who) || firstLead(), rep.text, rep.loc);
      if (d.narration) addNarration(d.narration);
      if (d.mind) addMind(d.mind);
      renderQuickFromGm(d.choices || []);
      scrollBottom();
      return;
    } catch { gmAvailable = false; $('mode-badge').hidden = false; }
  }
  localFallback(text, targetChar);
  scrollBottom();
}

function renderQuickFromGm(choices) {
  const quick = $('quick'); quick.replaceChildren();
  const adv = el('button', 'quick-btn advance', '继续剧情 ▸');
  adv.addEventListener('click', advanceStory);
  quick.append(adv);
  for (const c of choices.slice(0, 3)) {
    const b = el('button', 'quick-btn', c);
    b.addEventListener('click', () => { addMy(c); freeTalk(c, null); });
    quick.append(b);
  }
}

// 本地降级回复器：lorebook 关键词命中 → 旁白；否则角色 anchor 风格池
function localFallback(text, targetChar) {
  $('mode-badge').hidden = false;
  const hit = novel.lorebook.find((e) => !e.constant && e.keys.some((k) => text.includes(k)));
  if (hit) addNarration(hit.content.slice(0, 60));
  const c = targetChar || novel.characters.find((x) => x.id === x.id && text.includes(x.name)) || firstLead();
  const pool = [
    ...c.voice.split('\n').filter(Boolean),
    c.first_mes,
    '……你说这个，我可就不困了。',
    '（他垂了垂眼，没有接话。）',
  ];
  const line = pool[Math.floor(Math.random() * pool.length)];
  addBubble(c.id, line, '');
  if (c.mind) addMind(c.mind);
}

function firstLead() { return novel.characters.find((x) => x.role === 'lead') || novel.characters[0]; }
function charIdByName(name) { const c = novel.characters.find((x) => x.name === name); return c ? c.id : null; }

// ---- 会话存档（轻量：只存 state + 最近6条文本） ----
function saveSession() {
  try { localStorage.setItem(`cs_chat_${bookId}`, JSON.stringify({ state, log: recentLog(6) })); } catch {}
}
function recentLog(n) { return [...msgs.querySelectorAll('.bubble')].slice(-n).map((b) => b.textContent); }

// ---- 启动 ----
(async () => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res = await fetch(`./data/books/${bookId}.json`, { signal: ctrl.signal });
    if (!res.ok) res = await fetch(`./api/books/${bookId}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    novel = await res.json();
    document.title = `${novel.meta.title} · 剧情体验`;
    $('book-title').textContent = novel.meta.title;

    const saved = localStorage.getItem(`cs_chat_${bookId}`);
    if (saved) {
      const s = JSON.parse(saved);
      state = s.state;
      addTime('— 已恢复上次进度 · 点右上 ↺ 重新开始 —');
    } else {
      state = createState(novel, { identity: novel.player.identity_cards[0]?.id });
      addTime(`— 你穿成了「${novel.player.identity_cards[0]?.name || '书中人'}」 —`);
      addNarration(novel.meta.intro);
      const opener = firstLead();
      if (opener.first_mes) addBubble(opener.id, opener.first_mes, '');
      if (opener.mind) addMind(opener.mind);
    }
    $('whoami').textContent = novel.player.identity_cards[0]?.name || '';
    renderStatbar(); refreshQuick(); scrollBottom();
    // 探测 gm（一次性，HEAD 便宜探测不行就等首次对话失败降级）
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    $('book-title').textContent = '加载失败';
    const hint = isTimeout ? '书籍数据加载超时（网络不稳定或域名被拦截），请重试' : '书籍数据加载失败：' + e.message;
    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = '重试';
    retry.style.cssText = 'margin:12px auto;display:block';
    retry.addEventListener('click', () => location.reload());
    msgs.append(el('div', 'narration', hint), retry);
  }
})();
