// AI 对话 AVG 控制器 —— 剧情模式 × AVG 模式融合页
// 每章循环：章节开场(AVG演出,零token) → 自由行动(AI对话×5-8轮+日常事件池抽取)
//         → 命运节点(graph门控抉择) → 章末结算(LLM摘要+云存档) → 下一章
// 记忆三层：recent对话窗口 / 章节摘要summaryChain / 长期事实记忆(state镜像+服务端库)
import {
  createState, nodeOf, applyChoice, applyEventChoice, applyPatch,
  drawEvent, evalChoices, evalEventChoices, checkEnding, checkDeathEnding, attrBand,
  chapterStartNode, keyMomentNode, chapterList, rollBudget, relOf, advanceThrough,
  mapLocations, visitLocation, resolvePlayerChar,
  buildPrologue, inventoryOf, realmChange, mindAllowed,
  GENRE_THEMES, inferGenre, sceneHueFor,
} from './engine.js?v=20260914g';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const bookId = (/^[a-z0-9_-]{1,64}$/i.test(params.get('book') || '') ? params.get('book') : 'ak47_xiuzhen');
const DEFAULT_INPUT_HINT = '固定选项之外的自定义行动：说什么、做什么都行……';

// ---- 玩过的书：完成一局、或拆解生成的新书进入过游戏，即记入首页「玩过的书」栏 ----
// forge 书记录后，下次从首页直接进入（服务端 KV 缓存 30 天），无需重新拆书
function markPlayed() {
  if (!novel) return;
  try {
    const played = JSON.parse(localStorage.getItem('cs_played') || '{}');
    played[bookId] = {
      title: novel.meta.title || bookId,
      author: novel.meta.author || '',
      cover: novel.meta.cover || '',
      endings: (novel.endings || []).length,
      at: Date.now(),
    };
    localStorage.setItem('cs_played', JSON.stringify(played));
  } catch { /* 隐私模式等场景下静默 */ }
}

let novel = null, state = null;
let phase = 'loading';           // loading | identity | chapter-start | free | keymoment | chapter-end | ending
let saveId = null;
let busy = false;                // 请求进行中 / 演出进行中
let unsyncedMems = [];           // 待同步到云端的新增记忆
let chapterLog = [];             // 本章记录（章末摘要用）
let chapterSnap = null;          // 章首快照（结算 diff 用）
let pendingEvent = null;         // 待处理事件卡
let currentEnding = null;        // 当前触发结局（战绩卡用）
let lastGmChoices = [];          // 最近一轮 GM 建议选项（持久显示，不丢失）
let presentChars = [];           // 当前在场角色（@ 互动只对在场者开放）
let genreTheme = GENRE_THEMES.default; // 题材主题（舞台氛围）
let typeTimer = null, typeResolve = null;

const msgs = $('msgs');
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }
function charOf(id) { return (novel.characters || []).find((x) => x.id === id) || null; }
function identityName() {
  const card = (novel.player.identity_cards || []).find((i) => i.id === state?.identity);
  return card?.name || '书中人';
}

// ============ 题材主题：舞台氛围随书而变（修仙明金 / 言情暧昧粉 / 恐怖暗夜…） ============
// 变量挂在 #app 上：舞台、事件卡、命运节点横幅、聊天区晕染全部继承主题
function applySceneTheme(ch) {
  if (!novel) return;
  genreTheme = GENRE_THEMES[inferGenre(novel)] || GENRE_THEMES.default;
  const hue = sceneHueFor(inferGenre(novel), ch ?? state?.chapter ?? 1);
  const root = $('app');
  root.style.setProperty('--scene-hue', String(hue));
  root.style.setProperty('--scene-sat', String(genreTheme.sat));
  if (novel.meta.cover) {
    const coverUrl = new URL(novel.meta.cover, location.href).href.replace(/["\\]/g, '');
    document.documentElement.style.setProperty('--book-cover', `url("${coverUrl}")`);
  } else {
    document.documentElement.style.removeProperty('--book-cover');
  }
  root.classList.toggle('genre-dark', !!genreTheme.dark);
}

// ============ 在场角色：@ 互动只对当前场景中的角色开放 ============
// 在场 = 最近一轮演出（AI 回复/事件后果/开场链/开场白）中出现过的非玩家角色
function setPresent(ids) {
  presentChars = [...new Set((ids || []).filter(Boolean))]
    .filter((id) => id !== state?.identity && id !== state?.playerChar && charOf(id))
    .slice(0, 4);
}

// ============ 打字机（点击舞台跳过） ============
function typeInto(elm, text, speed = 26) {
  return new Promise((resolve) => {
    clearInterval(typeTimer);
    elm.textContent = '';
    $('next-hint').hidden = true;
    let i = 0;
    typeResolve = resolve;
    typeTimer = setInterval(() => {
      i += 2;
      elm.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; typeResolve = null; $('next-hint').hidden = false; resolve(); }
    }, speed);
  });
}
$('stage').addEventListener('click', () => {
  if (typeTimer) {
    clearInterval(typeTimer); typeTimer = null;
    $('next-hint').hidden = false;
    const r = typeResolve; typeResolve = null; r?.();
  }
});

// ============ IM 演出 ============
// 玩家自己对应的原著角色（如 ic_snn→snn）台词一律按"我"渲染，绝不以 NPC 口吻出现
function addBubble(who, text, loc, degraded = false) {
  const isMe = who === 'me' || who === state?.playerChar;
  const c = charOf(who);
  const block = el('div', 'bubble-block' + (isMe ? ' me' : ''));
  const head = el('div', 'bubble-head');
  const name = isMe ? (c ? `${c.name}（我）` : '我') : (c ? c.name : who);
  head.append(el('span', 'bubble-avatar', c ? (c.avatar || c.name.slice(0, 1)) : '我'),
    el('span', 'bubble-name', name));
  if (loc && !isMe) head.append(el('span', 'bubble-loc', `〔${loc}〕`));
  block.append(head, el('div', 'bubble', text));
  if (!degraded && !isMe) block.append(el('span', 'ai-mark', 'AI'));
  msgs.append(block);
}
function addNarration(text) { msgs.append(el('div', 'narration', text)); }
function addSys(text) { msgs.append(el('div', 'sys-line', text)); }
function addMind(text) {
  if (!text) return;
  if (!mindAllowed(novel, state)) return; // 能力门控：无读心/偷听能力则听不到心声
  const card = el('div', 'mind-card');
  const flavor = novel.presentation?.mind_flavor || '心声 · 没说出口的';
  card.append(el('span', 'tag-mind', flavor), el('span', null, text));
  msgs.append(card);
}
function remember(role, text) {
  state.recent.push({ role, text: String(text).slice(0, 60) });
  if (state.recent.length > 12) state.recent = state.recent.slice(-12);
  chapterLog.push(String(text).slice(0, 60));
}

// ============ 事件卡 ============
function addEventCard(event) {
  const card = el('div', 'event-card');
  card.append(el('span', 'event-tag', '▚ 意外事件'));
  card.append(el('div', 'event-text', event.narrative));
  const box = el('div', 'event-choices');
  for (const { choice, ok, reason } of evalEventChoices(state, event)) {
    const b = el('button', null, choice.text);
    if (!ok) {
      b.classList.add('locked');
      b.append(el('span', 'cond', `🔒 ${reason || '条件不足'}`));
    } else {
      b.addEventListener('click', () => pickEvent(event, choice, card));
    }
    box.append(b);
  }
  card.append(box);
  msgs.append(card);
  scrollBottom();
}

async function pickEvent(event, choice, card) {
  if (busy) return;
  busy = true;
  const before = { ...state.attrs };
  state = applyEventChoice(state, novel, event, event.choices.indexOf(choice));
  card.querySelector('.event-choices').replaceChildren(el('span', 'event-tag', `▸ ${choice.text}`));
  remember('event', `[事件] ${event.narrative.slice(0, 30)}…我选择了：${choice.text}`);
  // 事件结算播报（确定性，零 token）
  const diffs = Object.entries(choice.set || {}).filter(([k]) => state.attrs[k] !== before[k]);
  if (diffs.length) {
    addSys(diffs.map(([k, v]) => {
      const def = novel.player.attributes.find((a) => a.key === k);
      const d = Number(v);
      return `${def?.name || k} ${d > 0 ? '+' : ''}${d}`;
    }).join(' ｜ '));
  }
  renderPanel(); saveSession();
  pendingEvent = null;
  // AI 补全事件后果演出：让玩家看清这个选择引发了什么
  await aiEventOutcome(event, choice);
  checkBreakthrough(before);
  renderPanel(); renderHUD(); saveSession();
  const dead = checkDeathEnding(state, novel);
  if (dead) { finish(dead); return; }
  busy = false;
  maybeDrawEvent(true); // 事件可能连锁，但有抑制
}

async function aiEventOutcome(event, choice) {
  $('typing-hint').textContent = '命运正在回应你的选择……';
  $('typing-hint').hidden = false;
  scrollBottom();
  let degraded = false;
  let d = null;
  state.mindAllowed = mindAllowed(novel, state);
  try {
    const r = await fetch('./api/gm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId, state, novelOverride: state.novelOverride || null,
        userInput: `【遭遇】${event.narrative} 我选择了「${choice.text}」。请演出这个选择的经过与直接后果：我做了什么、引发了什么、在场的人如何反应。`,
      }) });
    d = await r.json();
    degraded = !!d.degraded;
  } catch { degraded = true; }
  $('typing-hint').hidden = true;
  $('typing-hint').textContent = '叙事引擎正在推演……';

  if (d?.ok && !degraded) {
    for (const rep of d.replies || []) {
      addBubble(rep.who, rep.text, rep.loc, false);
      remember('gm', `${charOf(rep.who)?.name || ''}：${rep.text}`);
    }
    // 事件后果演出中出现的角色同样计入在场
    setPresent((d.replies || []).map((r) => r.who));
    if (d.narration) { addNarration(d.narration); remember('gm', d.narration); if ($('scene-text')) $('scene-text').textContent = d.narration.slice(0, 60); }
    if (d.mind) addMind(d.mind);
    if (Array.isArray(d.choices) && d.choices.length) lastGmChoices = d.choices;
    const { state: next } = applyPatch(state, novel, d.state_patch || {});
    state = next;
    for (const m of (d.state_patch?.memories_add || [])) unsyncedMems.push(m);
    const relDiffs = Object.entries(d.state_patch?.rels || {});
    for (const [npc, rp] of relDiffs) {
      const name = charOf(npc)?.name || npc;
      if (rp.favor) addSys(`${name} 对你的好感 ${rp.favor > 0 ? '+' : ''}${rp.favor}${rp.nature ? ` · 关系变为「${rp.nature}」` : ''}`);
    }
  } else {
    // 降级：确定性后果文案（事件文本 + 选择 + 数值已在上方播报）
    addNarration(`你${choice.text}。${degraded ? '（叙事引擎降级中，结果由事件规则结算）' : ''}`);
  }
  scrollBottom();
}

// 抽取日常事件：每章第2轮必出一次（保底展示），其余 38% 概率；刚出过则不出
let lastEventTurn = -9;
function maybeDrawEvent(forceChance = false) {
  if (phase !== 'free' || pendingEvent) return;
  if (!(novel.events || []).length) return;
  const chance = state.chapterTurn === 1 ? 1 : (forceChance ? 0.18 : 0.38);
  if (Math.random() > chance || state.chapterTurn - lastEventTurn < 1) return;
  const event = drawEvent(state, novel);
  if (!event) return;
  lastEventTurn = state.chapterTurn;
  pendingEvent = event;
  addEventCard(event);
}

// ============ 左上角统一 HUD：章节/轮次/属性/偏离/位置/地图 ============
function renderHUD() {
  const hud = $('hud');
  if (!state) { hud.replaceChildren(); return; }
  hud.replaceChildren();
  // 章节
  hud.append(el('span', 'hud-chip gold', `第${state.chapter}章${chapterName(state.chapter) ? ` · ${chapterName(state.chapter)}` : ''}`));
  // 自由行动轮次
  if (phase === 'free') {
    const dots = el('span', 'hud-chip');
    const box = el('span', 'hud-dots');
    for (let i = 0; i < state.chapterBudget; i++) box.append(el('i', i < state.chapterTurn ? '' : 'on'));
    dots.append(box, document.createTextNode(` 剩${Math.max(0, state.chapterBudget - state.chapterTurn)}轮`));
    hud.append(dots);
  }
  // 属性（带危险态）
  for (const def of novel.player.attributes) {
    const v = state.attrs[def.key] ?? def.initial;
    const band = attrBand(def, v);
    const chip = el('span', 'hud-chip' + (def.deathBelow != null && v <= def.deathBelow + 1 ? ' danger' : ''));
    chip.append(`${def.name} `, el('b', null, String(v)));
    if (band && band.label && v <= band.upTo) chip.append(`·${band.label}`);
    hud.append(chip);
  }
  // 偏离度
  const dvChip = el('span', 'hud-chip', '偏离 ');
  dvChip.append(el('b', null, `${Math.round((state.divergence || 0) * 100)}%`));
  hud.append(dvChip);
  // 当前位置
  const locNow = (novel.map || []).find((l) => l.id === state.location);
  if (locNow) hud.append(el('span', 'hud-chip', `📍${locNow.name}`));
  // 地图入口
  if ((novel.map || []).length) {
    const btn = el('button', 'hud-map-btn', '地 图');
    btn.addEventListener('click', (e) => { e.stopPropagation(); openMap(); });
    hud.append(btn);
  }
}

// ============ 地图探索 ============
function openMap() {
  if (!(novel.map || []).length) return;
  $('map-sub').textContent = `${identityName()} 的足迹 · 已探索 ${(state.mapVisited || []).length}/${novel.map.length} —— 走过的路会成为你的记忆`;
  const grid = $('map-grid'); grid.replaceChildren();
  for (const loc of mapLocations(novel, state)) {
    const card = el('div', 'map-card' + (loc.visited ? ' visited' : loc.unlocked ? ' explore-btn' : ' locked'));
    const h3 = el('h3', null, loc.name);
    h3.append(el('span', 'loc-ch', `第${loc.chapter}章解锁`));
    card.append(h3);
    if (!loc.unlocked) {
      card.append(el('p', null, loc.requires ? '尚未满足进入条件。' : '剧情未至，此地还笼罩在迷雾里。'));
    } else if (loc.visited) {
      card.append(el('p', null, String(loc.desc || '').slice(0, 64)));
      if (loc.clue) card.append(el('span', 'map-clue', `线索已入手：${String(loc.clue).slice(0, 32)}…`));
    } else {
      card.append(el('p', null, '未探索 —— 点击前往，看看有什么在等你。'));
      card.addEventListener('click', () => exploreLoc(loc.id));
    }
    grid.append(card);
  }
  $('map-overlay').hidden = false;
}

function exploreLoc(locId) {
  const before = { ...state.attrs };
  const { state: next, loc } = visitLocation(state, novel, locId);
  if (!loc) return;
  state = next;
  state.location = locId;
  $('map-overlay').hidden = true;
  // 探索播报：描述 + 线索（原文设定，零 token）
  addSys(`—— 你来到了「${loc.name}」 ——`);
  if (loc.desc) addNarration(loc.desc);
  if (loc.clue) {
    addNarration(`【线索】${loc.clue}`);
    remember('gm', `[探索·${loc.name}] ${loc.clue}`);
  }
  const diffs = Object.entries(loc.set || {}).filter(([k, v]) => state.attrs[k] !== before[k]);
  if (diffs.length) addSys(diffs.map(([k, v]) => {
    const def = novel.player.attributes.find((a) => a.key === k);
    return `${def?.name || k} ${Number(v) > 0 ? '+' : ''}${v}`;
  }).join(' ｜ '));
  checkBreakthrough(before);
  renderHUD(); renderPanel(); saveSession(); scrollBottom();
}

$('btn-map-close').addEventListener('click', () => { $('map-overlay').hidden = true; });
$('btn-panel').addEventListener('click', () => { $('panel').hidden = false; renderPanel(); });
$('btn-panel-close').addEventListener('click', () => { $('panel').hidden = true; });
document.querySelectorAll('.panel-tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.panel-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderPanel(b.dataset.tab);
  });
});

function renderPanel(tab) {
  if (!state) return;
  tab = tab || document.querySelector('.panel-tabs button.on')?.dataset.tab || 'attrs';
  $('panel-whoami').textContent = `${identityName()} · 第${state.chapter}章`;
  const body = $('panel-body'); body.replaceChildren();
  if (tab === 'attrs') {
    for (const def of novel.player.attributes) {
      const v = state.attrs[def.key] ?? def.initial;
      const row = el('div', 'attr-row');
      const name = el('div', 'attr-name');
      const left = el('span', null, def.name);
      const right = el('b', null, String(v));
      name.append(left, right);
      const bar = el('div', 'attr-bar');
      const fill = el('i');
      const pct = Math.max(0, Math.min(100, ((v - (def.min ?? 0)) / ((def.max ?? 10) - (def.min ?? 0) || 1)) * 100));
      fill.style.width = pct + '%';
      const band = attrBand(def, v);
      if (def.deathBelow != null && v <= def.deathBelow + 1) fill.classList.add('low');
      bar.append(fill);
      row.append(name, bar);
      if (band && band.label && v <= band.upTo) row.append(el('div', 'attr-band', `状态：${band.label}${band.directive ? ` · ${band.directive}` : ''}`));
      body.append(row);
    }
    const dv = el('div', 'diverge-row');
    dv.append(el('span', null, '偏离原作'), el('b', null, `${Math.round((state.divergence || 0) * 100)}%`));
    body.append(dv);
    const hint = el('div', 'sum-item', '偏离度越高，世界修正力越强，但隐藏结局也更近。安全与真相，你只能选一个。');
    body.append(hint);
  } else if (tab === 'rels') {
    for (const ch of novel.characters || []) {
      if (ch.role === 'lead' || ch.id === state.identity || ch.id === state.playerChar) continue;
      const rel = relOf(state, ch.id);
      const item = el('div', 'rel-item');
      const head = el('div', 'rel-head');
      head.append(el('b', null, ch.name));
      if (rel.nature) head.append(el('span', 'rel-nature', rel.nature));
      head.append(el('span', 'rel-tone', ch.tone ? `底色·${ch.tone}` : ''));
      item.append(head);
      const bar = el('div', 'rel-bar');
      const fill = el('i');
      fill.style.width = `${rel.favor}%`;
      bar.append(fill);
      item.append(bar);
      item.append(el('div', 'rel-desc', `${ch.anchor || ch.description || ''} · 好感 ${rel.favor}`));
      body.append(item);
    }
  } else if (tab === 'bag') {
    const items = inventoryOf(state);
    if (!items.length) {
      body.append(el('div', 'sum-item', '储物袋空空如也。探索地图、完成事件、在命运节点做出选择，都会让你得到东西。'));
    } else {
      body.append(el('div', 'sum-item', `共 ${items.length} 件——它们会在对话中被叙事引擎记得`));
      for (const it of items) {
        const item = el('div', 'mem-item');
        item.append(el('b', null, '·'), document.createTextNode(it.name));
        body.append(item);
      }
    }
  } else if (tab === 'settings') {
    renderSettingsTab(body);
  } else {
    for (const m of [...state.memories].sort((a, b) => b.importance - a.importance).slice(0, 16)) {
      const item = el('div', 'mem-item');
      const kindName = { fact: '事实', relationship: '关系', promise: '承诺', secret: '秘密' }[m.kind] || '记事';
      item.append(el('b', null, kindName), document.createTextNode(m.content));
      body.append(item);
    }
    if (!state.memories.length) body.append(el('div', 'sum-item', '还没有留下值得记住的事。做过承诺、结过怨、发现过秘密，这里会记下来。'));
    const sums = (state.summaries || []);
    if (sums.length) {
      body.append(el('div', 'sum-item', '—— 前情摘要 ——'));
      for (const s of sums) {
        const row = el('div', 'sum-item');
        row.append(el('b', null, `第${s.chapter}章：`), document.createTextNode(s.summary));
        body.append(row);
      }
    }
  }
}

// ============ 云存档 ============
function setSaveDot(cls) { $('save-dot').className = 'save-dot ' + (cls || ''); }
function saveSession() {
  try { localStorage.setItem(`cs_game_${bookId}`, JSON.stringify({ state, chapterLog })); } catch {}
}
async function syncSave(final = false) {
  if (!saveId || !state) return;
  setSaveDot('syncing');
  const newMems = unsyncedMems; unsyncedMems = [];
  try {
    const r = await fetch('./api/save/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveId, bookId, state, newMemories: newMems }) });
    const d = await r.json();
    setSaveDot(d.ok ? 'synced' : '');
  } catch { unsyncedMems.push(...newMems); setSaveDot(''); }
  if (final) setSaveDot('synced');
}

async function askSummary(chapter) {
  try {
    const r = await fetch('./api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId, saveId, chapter: chapter ?? state.chapter, log: chapterLog }) });
    const d = await r.json();
    if (d?.ok && d.summary) return d.summary;
  } catch { /* 降级 */ }
  return chapterLog.slice(-3).join('；').slice(0, 100);
}

function genSaveId() {
  const arr = new Uint8Array(12); crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============ 章节流程 ============
function chapterName(ch) { return novel.presentation?.chapter_names?.[String(ch)] || ''; }

async function startChapter(ch, { entryNode = null, showHint = true } = {}) {
  phase = 'chapter-start';
  busy = true;
  state.chapter = ch;
  state.chapterTurn = 0;
  state.chapterBudget = rollBudget(ch, state.identity);
  chapterLog = [];
  chapterSnap = { attrs: { ...state.attrs }, rels: Object.fromEntries(Object.entries(state.rels).map(([k, v]) => [k, { ...v }])), div: state.divergence };
  applySceneTheme(ch);

  // 全屏章节转场
  const cf = $('chapter-full');
  $('cf-num').textContent = `第${ch}章`;
  $('cf-name').textContent = chapterName(ch);
  cf.hidden = false;
  cf.style.animation = 'none'; void cf.offsetWidth; cf.style.animation = '';
  setTimeout(() => { cf.hidden = true; }, 2300);

  const banner = $('chapter-banner');
  banner.hidden = false;
  $('banner-num').textContent = `第${ch}章`;
  $('banner-name').textContent = chapterName(ch);
  banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';

  renderPanel(); renderTurnDots();
  // 开场：优先用上一章命运节点送来的入口节点（保留分支正确性），否则取本章第一个节点
  const entry = entryNode || chapterStartNode(novel, ch);
  if (entry) {
    state.node = entry.id;
    if (!state.evt.includes(entry.id)) state.evt.push(entry.id);
    if (entry.who !== 'narrator' && charOf(entry.who)) { addBubble(entry.who, entry.text, ''); await typeInto($('scene-text'), entry.text.slice(0, 40)); }
    else await typeInto($('scene-text'), entry.text);
    remember('gm', `[第${ch}章开场] ${entry.text}`);
    // 沿开场链推进：桥接节点演出，命运节点留到 gotoKeyMoment
    const { state: next, visited, nextChapter } = advanceThrough(state, novel, entry);
    state = next;
    for (const vn of visited.slice(1)) {
      if (vn.choices?.length) break;
      if (vn.who !== 'narrator' && charOf(vn.who)) { addBubble(vn.who, vn.text, ''); await typeInto($('scene-text'), vn.text.slice(0, 42)); }
      else await typeInto($('scene-text'), vn.text);
      remember('gm', vn.text);
    }
    // 开场链上露过面的角色计入在场（保留开场白角色，不被 narrator 开场节点清掉）
    setPresent([...presentChars, entry.who, ...visited.map((vn) => vn.who)]);
    if (nextChapter != null) { busy = false; await chapterEnd(nextChapter); return; }
  }
  busy = false;
  enterFree(showHint);
}

// 轮次指示已并入左上角 HUD（renderHUD）
function renderTurnDots() { renderHUD(); }

// ---- 设定卡：三级结构（大类 → 条目 → 具体字段），AI 下一轮生效，自动保存 ----
let novelBase = null; // 未被玩家设定覆盖的原始书籍数据
let settingsView = { level: 'root' }; // root | lore | rules | chars | char

function applyNovelOverride() {
  if (!novelBase || !state) return;
  const ov = state.novelOverride || {};
  novel.canon_rules = Array.isArray(ov.canon_rules) ? ov.canon_rules : structuredClone(novelBase.canon_rules || []);
  novel.lorebook = Array.isArray(ov.lorebook) ? ov.lorebook : structuredClone(novelBase.lorebook || []);
  if (Array.isArray(ov.characters)) {
    for (const p of ov.characters) {
      const ch = (novel.characters || []).find((c) => c.id === p.id);
      if (ch) for (const f of ['anchor', 'mind', 'voice', 'tone']) if (p[f]) ch[f] = p[f];
    }
  }
}

function settingsSaved() {
  saveSession();
  const chip = document.querySelector('#panel-body .set-status');
  if (chip) chip.textContent = `✓ 已自动保存 ${new Date().toTimeString().slice(0, 5)}`;
}

function ensureOv() {
  if (!state.novelOverride) state.novelOverride = {};
  return state.novelOverride;
}

function renderSettingsTab(body) {
  body.replaceChildren();
  if (settingsView.level !== 'root') {
    const back = el('button', 'set-back', '‹ 返回设定分类');
    back.addEventListener('click', () => { settingsView = { level: 'root' }; renderPanel('settings'); });
    body.append(back);
  }
  const status = el('div', 'set-status', '修改即自动保存，AI 下一轮对话生效');
  body.append(status);

  if (settingsView.level === 'root') return renderSettingsRoot(body);
  if (settingsView.level === 'lore') return renderLoreEditor(body);
  if (settingsView.level === 'rules') return renderRulesEditor(body);
  if (settingsView.level === 'chars') return renderCharsList(body);
  if (settingsView.level === 'char') return renderCharEditor(body, settingsView.id);
}

function renderSettingsRoot(body) {
  const q = (settingsView.q || '').trim();
  // 检索框（跨 世界观/铁律/角色 全量检索，点结果直达编辑位置）
  const search = el('input', 'set-search');
  search.value = q;
  search.placeholder = '🔍 检索设定：关键词 / 内容片段 / 角色名';
  search.maxLength = 40;
  search.addEventListener('input', () => { settingsView.q = search.value; renderPanel('settings'); });
  body.append(search);
  if (q) { search.focus(); search.setSelectionRange(q.length, q.length); return renderSearchResults(body, q); }

  const cats = [
    { key: 'lore', icon: '🌍', name: '世界观设定', desc: '世界的规则与知识，AI 对话命中关键词时自动引用', count: (novel.lorebook || []).length, unit: '条' },
    { key: 'rules', icon: '⚖️', name: '人物行为铁律', desc: '角色绝不能违背的硬规则，违反即视为崩设定', count: (novel.canon_rules || []).length, unit: '条' },
    { key: 'chars', icon: '👤', name: '角色设定', desc: '每个角色的行为逻辑、真实心声与说话风格', count: (novel.characters || []).length, unit: '人' },
  ];
  const list = el('div', 'set-cats');
  for (const c of cats) {
    const card = el('div', 'set-cat');
    card.append(
      el('div', 'set-cat-name', `${c.icon} ${c.name}`),
      el('div', 'set-cat-desc', c.desc),
      el('div', 'set-cat-count', `${c.count} ${c.unit} ›`)
    );
    card.addEventListener('click', () => { settingsView = { level: c.key, q: settingsView.q }; renderPanel('settings'); });
    list.append(card);
  }
  body.append(list);
  const resetBtn = el('button', 'set-add', '↺ 恢复原书设定');
  resetBtn.addEventListener('click', () => {
    delete state.novelOverride;
    applyNovelOverride();
    saveSession(); syncSave();
    renderPanel('settings');
  });
  body.append(resetBtn);
}

function searchSettings(q) {
  const ql = q.toLowerCase();
  return {
    lore: (novel.lorebook || []).map((e, i) => ({ i, e }))
      .filter(({ e }) => ((e.keys || []).join(' ') + ' ' + (e.content || '')).toLowerCase().includes(ql)),
    rules: (novel.canon_rules || []).map((e, i) => ({ i, e }))
      .filter(({ e }) => (e.rule || '').toLowerCase().includes(ql)),
    chars: (novel.characters || []).map((e, i) => ({ i, e }))
      .filter(({ e }) => [e.name, e.anchor, e.mind, e.voice].join(' ').toLowerCase().includes(ql)),
  };
}

function renderSearchResults(body, q) {
  const { lore, rules, chars } = searchSettings(q);
  const total = lore.length + rules.length + chars.length;
  const summary = el('div', 'set-status', total ? `找到 ${total} 条匹配` : '没有匹配的设定——换个关键词，或直接去分类里添加新条目');
  body.append(summary);

  const snippet = (text) => {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text.slice(0, 30);
    const start = Math.max(0, idx - 8);
    return (start > 0 ? '…' : '') + text.slice(start, start + 40);
  };
  const jump = (label, catName, detail) => {
    const row = el('div', 'set-result');
    row.append(el('span', 'set-result-cat', catName), el('span', 'set-result-text', label));
    row.addEventListener('click', () => { settingsView = detail; renderPanel('settings'); });
    return row;
  };
  for (const { i, e } of lore) {
    body.append(jump(snippet((e.keys || []).join('，') + '：' + (e.content || '')), `🌍 世界观 #${i + 1}`, { level: 'lore', flash: i }));
  }
  for (const { i, e } of rules) {
    body.append(jump(snippet(e.rule || ''), `⚖️ 铁律 #${i + 1}`, { level: 'rules', flash: i }));
  }
  for (const { i, e } of chars) {
    body.append(jump(snippet(`${e.name}——${e.anchor || e.description || ''}`), `👤 角色`, { level: 'char', id: e.id }));
  }
}

function applyFlash(container, idx) {
  if (idx == null) return;
  settingsView.flash = null;
  const child = container.children[idx];
  if (!child) return;
  child.classList.add('set-flash');
  requestAnimationFrame(() => child.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

function renderLoreEditor(body) {
  const ov = ensureOv();
  if (!Array.isArray(ov.lorebook)) ov.lorebook = structuredClone(novel.lorebook || []);
  body.append(el('div', 'set-sec-title', '世界观条目（点击即可编辑）'));
  const box = el('div', 'set-list');
  ov.lorebook.forEach((e, i) => {
    const row = el('div', 'set-row');
    const top = el('div', 'set-row-top');
    const keys = el('input', 'set-input');
    keys.value = (e.keys || []).join('，');
    keys.placeholder = '触发关键词，逗号分隔';
    keys.maxLength = 60;
    keys.addEventListener('input', () => { e.keys = keys.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean).slice(0, 6); settingsSaved(); });
    const constLabel = el('label', 'set-check');
    const constBox = el('input');
    constBox.type = 'checkbox';
    constBox.checked = e.constant === true;
    constBox.addEventListener('change', () => { e.constant = constBox.checked; settingsSaved(); });
    constLabel.append(constBox, document.createTextNode('常驻'));
    top.append(keys, constLabel);
    const ta = el('textarea', 'set-textarea');
    ta.value = e.content || '';
    ta.rows = 3;
    ta.maxLength = 120;
    ta.placeholder = '设定内容（≤120字）';
    ta.addEventListener('input', () => { e.content = ta.value.slice(0, 120); settingsSaved(); });
    row.append(top, ta, delBtn(() => { ov.lorebook.splice(i, 1); settingsSaved(); renderPanel('settings'); }));
    box.append(row);
  });
  body.append(box);
  applyFlash(box, settingsView.flash);
  const add = el('button', 'set-add', '＋ 添加世界观条目');
  add.addEventListener('click', () => {
    ov.lorebook.push({ keys: [], content: '', constant: false, insertion_order: 5 });
    settingsSaved(); renderPanel('settings');
  });
  body.append(add);
}

function renderRulesEditor(body) {
  const ov = ensureOv();
  if (!Array.isArray(ov.canon_rules)) ov.canon_rules = structuredClone(novel.canon_rules || []);
  body.append(el('div', 'set-sec-title', '铁律（每条 ≤60 字，违反即崩设定）'));
  const box = el('div', 'set-list');
  ov.canon_rules.forEach((r, i) => {
    const row = el('div', 'set-row');
    const ta = el('textarea', 'set-textarea');
    ta.value = r.rule || '';
    ta.rows = 2;
    ta.maxLength = 60;
    ta.placeholder = '例：叶青青绝不自证清白';
    ta.addEventListener('input', () => { r.rule = ta.value.slice(0, 60); settingsSaved(); });
    row.append(ta, delBtn(() => { ov.canon_rules.splice(i, 1); settingsSaved(); renderPanel('settings'); }));
    box.append(row);
  });
  body.append(box);
  applyFlash(box, settingsView.flash);
  const add = el('button', 'set-add', '＋ 添加铁律');
  add.addEventListener('click', () => {
    ov.canon_rules.push({ id: `r_u${Date.now() % 100000}`, rule: '', type: 'structure' });
    settingsSaved(); renderPanel('settings');
  });
  body.append(add);
}

function renderCharsList(body) {
  body.append(el('div', 'set-sec-title', '角色（点开编辑行为逻辑与语气）'));
  const box = el('div', 'set-cats');
  (novel.characters || []).forEach((ch) => {
    const isMe = ch.id === state.playerChar;
    const card = el('div', 'set-cat');
    card.append(
      el('div', 'set-cat-name', `${ch.avatar || '·'} ${ch.name}${isMe ? '（你自己）' : ''}`),
      el('div', 'set-cat-desc', ch.anchor || ch.description || ''),
      el('div', 'set-cat-count', `${ch.tone ? '底色·' + ch.tone + ' ' : ''}编辑 ›`)
    );
    card.addEventListener('click', () => { settingsView = { level: 'char', id: ch.id }; renderPanel('settings'); });
    box.append(card);
  });
  body.append(box);
  applyFlash(box, settingsView.flash);
}

function renderCharEditor(body, id) {
  const ch = (novel.characters || []).find((c) => c.id === id);
  if (!ch) { settingsView = { level: 'root' }; return renderPanel('settings'); }
  const ov = ensureOv();
  if (!Array.isArray(ov.characters)) ov.characters = [];
  let patch = ov.characters.find((p) => p.id === id);
  if (!patch) {
    patch = { id, anchor: ch.anchor || '', mind: ch.mind || '', voice: ch.voice || '', tone: ch.tone || '' };
    ov.characters.push(patch);
  }
  body.append(el('div', 'set-sec-title', `${ch.name} · 角色设定`));

  const fields = [
    { key: 'anchor', label: '行为锚点（他所有行为的读点）', max: 40, rows: 2 },
    { key: 'mind', label: '真实心声（没说出口的话）', max: 40, rows: 2 },
    { key: 'voice', label: '台词风格（两三句样本，换行分隔）', max: 100, rows: 3 },
  ];
  for (const f of fields) {
    body.append(el('div', 'set-sec-title', f.label));
    const ta = el('textarea', 'set-textarea');
    ta.value = patch[f.key] || '';
    ta.rows = f.rows;
    ta.maxLength = f.max;
    ta.addEventListener('input', () => { patch[f.key] = ta.value.slice(0, f.max); settingsSaved(); });
    body.append(ta);
  }
  body.append(el('div', 'set-sec-title', '情感底色（决定他对你的表达方式）'));
  const tones = ['', '藏', '溢', '钝', '烈', '淡', '惑', '净', '缠', '默'];
  const TONE_DESC = { '': '未设置', 藏: '情感向内压，暗中做事', 溢: '情感外露写在脸上', 钝: '来得慢但一旦认定就是真的', 烈: '爱恨强烈爱憎分明', 淡: '温的，不明显', 惑: '言行矛盾自己都搞不清', 净: '干净透明直来直去', 缠: '有执念被推开也会回来', 默: '全藏在行动里' };
  const select = el('select', 'set-input');
  for (const t of tones) select.append(new Option(t ? `${t} · ${TONE_DESC[t]}` : TONE_DESC[t], t));
  select.value = patch.tone || '';
  select.addEventListener('change', () => { patch.tone = select.value; settingsSaved(); });
  body.append(select);
}

function delBtn(onclick) {
  const b = el('button', 'set-del', '×');
  b.addEventListener('click', onclick);
  return b;
}

// ---- 境界突破仪式（多段 bands 属性的标签跃迁，如凡人十六境界） ----
function checkBreakthrough(beforeAttrs) {
  const change = realmChange(beforeAttrs, state.attrs, novel);
  if (!change) return;
  const mem = { kind: 'fact', content: `${change.name}突破至「${change.label}」`, importance: 3 };
  pushMemories(state, [mem]);
  unsyncedMems.push(mem);
  const cf = $('breakthrough-full');
  $('bt-label').textContent = change.label;
  cf.hidden = false;
  cf.style.animation = 'none'; void cf.offsetWidth; cf.style.animation = '';
  setTimeout(() => { cf.hidden = true; }, 2600);
  addSys(`—— ⚡ ${change.name}突破：${change.label} ——`);
}

// ---- 序章引导：开始游戏之前交代世界观 / 身份处境 / 玩法 ----
function showPrologue(card) {
  const sections = buildPrologue(novel, card);
  // 能力告知：让玩家知道自己能否听到心声（及来源）
  if (mindAllowed(novel, { ...state, identity: card.id })) {
    const flavor = novel.presentation?.mind_flavor || '某种直觉';
    sections.splice(sections.length - 1, 0, { title: '你的特殊能力', text: `你能听见别人没说出口的心声（${flavor}）。心声可能与嘴上说的完全相反——信哪个，你自己判断。` });
  }
  $('prologue-title').textContent = `《${novel.meta.title}》`;
  $('prologue-sub').textContent = `穿书之前，先弄清楚三件事：这是哪里、你是谁、怎么活下去`;
  const body = $('prologue-body'); body.replaceChildren();
  for (const sec of sections) {
    const div = el('div', 'prologue-sec');
    div.append(el('h4', null, sec.title), el('p', null, sec.text));
    body.append(div);
  }
  $('id-overlay').hidden = true;
  $('prologue-overlay').hidden = false;
  $('btn-prologue-start').onclick = () => {
    $('prologue-overlay').hidden = true;
    beginStory(card);
  };
}

function beginStory(card) {
  addSys(`— 你穿成了「${card.name}」 —`);
  // 开场白：优先选一个不是玩家本人的角色搭话（避免自己跟自己打招呼）
  const opener = (novel.characters || []).find((x) => x.id !== state.playerChar && x.first_mes)
    || (novel.characters || []).find((x) => x.first_mes);
  if (opener && opener.id !== state.playerChar) {
    if (/^[（(].*[)）]$/.test(String(opener.first_mes).trim())) addNarration(opener.first_mes); // 纯动作描述不是台词
    else addBubble(opener.id, opener.first_mes, '');
    remember('gm', opener.first_mes);
  }
  if (opener && opener.id !== state.playerChar && opener.mind) addMind(opener.mind);
  setPresent(opener ? [opener.id] : []); // 开场只有搭话者在你身边
  saveSession();
  startChapter(state.chapter, { showHint: true });
}

function enterFree(showHint = false) {
  phase = 'free';
  $('km-banner').hidden = true;
  $('stage').classList.add('compact');
  renderTurnDots();
  renderQuick();
  if (showHint) addSys('—— 自由行动：你可以做任何事，命运在积累 ——');
  if (state.chapterTurn === 0) maybeDrawEvent(); // 开局小事件拉气氛
}

function renderQuick(gmChoices = null) {
  const quick = $('quick'); quick.replaceChildren();
  if (gmChoices !== null) lastGmChoices = gmChoices; // 传 null 表示沿用上轮选项（选项不丢失）
  if (phase !== 'free' && phase !== 'keymoment') return;
  if (phase === 'free') {
    const left = state.chapterBudget - state.chapterTurn;
    const adv = el('button', 'quick-btn advance', left > 0 ? `推进剧情 ▸（剩${left}轮）` : '直面命运 ▸');
    adv.addEventListener('click', () => gotoKeyMoment());
    quick.append(adv);
    // @互动：只有当前场景中的角色可以互动；点击后输入框预填 @名字，提示继续输入行为
    for (const id of presentChars) {
      const c = charOf(id);
      if (!c) continue;
      const b = el('button', 'quick-btn at', `@${c.name}`);
      b.addEventListener('click', () => {
        const input = $('input');
        input.value = `@${c.name} `;
        input.placeholder = `你想对${c.name}说什么、做什么？直接输入，如「问他这是什么地方」`;
        input.focus();
      });
      quick.append(b);
    }
  }
  for (const c of lastGmChoices.slice(0, 3)) {
    const b = el('button', 'quick-btn', c);
    b.addEventListener('click', () => { $('input').value = c; sendInput(); });
    quick.append(b);
  }
}

// ---- 自由行动：AI 对话轮 ----
$('send').addEventListener('click', () => sendInput());
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInput(); });

async function sendInput() {
  // 自由行动与命运节点阶段都接受自由输入（命运节点的固定选项始终保留，自由输入=自定义应对）
  if (busy || pendingEvent) { if (pendingEvent) addSys('先处理眼前的事件…'); return; }
  if (phase !== 'free' && phase !== 'keymoment') return;
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.placeholder = DEFAULT_INPUT_HINT; // 复位 @ 带来的动态提示
  await aiTurn(text);
}

async function aiTurn(userText) {
  busy = true;
  $('send').disabled = true;
  $('typing-hint').hidden = false;
  addBubble('me', userText, '');
  remember('me', userText);
  state.lastInput = userText;
  scrollBottom();

  let degraded = false;
  let d = null;
  state.mindAllowed = mindAllowed(novel, state);
  try {
    const r = await fetch('./api/gm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId, state, userInput: userText, novelOverride: state.novelOverride || null }) });
    d = await r.json();
    degraded = !!d.degraded;
  } catch { degraded = true; }

  if (!d || !d.ok) {
    addSys('（叙事引擎暂时失联，稍后再试）');
  } else {
    for (const rep of d.replies || []) {
      addBubble(rep.who, rep.text, rep.loc, degraded);
      remember('gm', `${charOf(rep.who)?.name || ''}：${rep.text}`);
    }
    // 更新在场者：本轮回应过玩家的角色就在场景中
    setPresent((d.replies || []).map((r) => r.who));
    if (d.narration) { addNarration(d.narration); remember('gm', d.narration); if (!degraded) $('scene-text').textContent = d.narration; }
    if (d.mind) addMind(d.mind);
    if (Array.isArray(d.choices) && d.choices.length) lastGmChoices = d.choices;
    const before = { ...state.attrs };
    const { state: next, rejected } = applyPatch(state, novel, d.state_patch || {});
    state = next;
    for (const m of (d.state_patch?.memories_add || [])) unsyncedMems.push(m);
    // 数值变化播报
    const diffs = Object.entries(d.state_patch?.attrs || {}).filter(([k]) => !rejected.includes(k));
    if (diffs.length) addSys(diffs.map(([k, v]) => {
      const def = novel.player.attributes.find((a) => a.key === k);
      return `${def?.name || k} ${Number(v) > 0 ? '+' : ''}${v}`;
    }).join(' ｜ '));
    // 关系变化播报
    const relDiffs = Object.entries(d.state_patch?.rels || {});
    for (const [npc, rp] of relDiffs) {
      const name = charOf(npc)?.name || npc;
      if (rp.favor) addSys(`${name} 对你的好感 ${rp.favor > 0 ? '+' : ''}${rp.favor}${rp.nature ? ` · 关系变为「${rp.nature}」` : ''}`);
    }
    checkBreakthrough(before);
    renderPanel();
    // 自由阶段只实时判软状态崩坏；剧情族结局在章末/命运节点结算
    const hit = checkDeathEnding(state, novel);
    if (hit) { finish(hit); return; }
  }

  $('typing-hint').hidden = true;
  $('send').disabled = false;
  state.chapterTurn += 1;
  renderTurnDots(); saveSession(); scrollBottom();
  busy = false;

  maybeDrawEvent();
  if (phase === 'free') {
    if (state.chapterTurn >= state.chapterBudget) {
      addSys('—— 命运的引力开始生效 ——');
      setTimeout(() => gotoKeyMoment(), 600);
    } else {
      renderQuick();
    }
  } else if (phase === 'keymoment') {
    // 命运节点阶段的自由输入后：重新渲染节点固定选项（不丢失），玩家仍可点选
    const node = nodeOf(novel, state.node);
    if (node?.choices?.length) renderKeyChoices(node);
  }
}

// ---- 命运节点（graph 骨架接管） ----
async function gotoKeyMoment() {
  if (busy || phase !== 'free') return;
  busy = true;
  phase = 'keymoment';
  pendingEvent = null;
  renderTurnDots();
  const quick = $('quick'); quick.replaceChildren();
  const node = keyMomentNode(novel, state.chapter);
  if (!node) { busy = false; await chapterEnd(); return; }
  state.node = node.id;
  if (!state.evt.includes(node.id)) state.evt.push(node.id);
  $('km-banner').hidden = false;
  $('stage').classList.remove('compact');
  addSys('—— 命运节点 · 此刻的选择将写进结局 ——');
  remember('gm', `[命运节点] ${node.text}`);
  await typeInto($('scene-text'), node.text);
  renderKeyChoices(node);
  busy = false;
}

function renderKeyChoices(node) {
  const quick = $('quick'); quick.replaceChildren();
  const evaluations = evalChoices(state, novel, node);
  evaluations.forEach(({ choice, ok, reason }, i) => {
    const b = el('button', 'quick-btn' + (ok && choice.requires ? ' fate' : ''), choice.text + (ok ? '' : ` 🔒${reason}`));
    b.disabled = !ok;
    if (ok && choice.requires) b.title = '改命之路 · 满足了隐藏条件';
    b.addEventListener('click', () => pickKeyChoice(node, i));
    quick.append(b);
  });
}

async function pickKeyChoice(node, choiceIndex) {
  if (busy) return;
  busy = true;
  const choice = node.choices[choiceIndex];
  const before = { ...state.attrs };
  addBubble('me', choice.text, '');
  remember('me', `[抉择] ${choice.text}`);
  state = applyChoice(state, novel, choiceIndex);
  checkBreakthrough(before);
  if (choice.set) {
    const diffs = Object.entries(choice.set);
    if (diffs.length) addSys(diffs.map(([k, v]) => {
      const def = novel.player.attributes.find((a) => a.key === k);
      return `${def?.name || k} ${Number(v) > 0 ? '+' : ''}${v}`;
    }).join(' ｜ '));
  }
  renderPanel();
  const hitEarly = checkEnding(state, novel, { allowFallback: false });
  if (hitEarly) { finish(hitEarly); return; }

  // 选项直接跨章（本章结局 → 下一章开场节点）：先章末结算，入口节点留给 startChapter
  const prevChapter = node.chapter ?? state.chapter;
  const chosen = nodeOf(novel, state.node);
  if (chosen && (chosen.chapter ?? state.chapter) !== prevChapter) {
    busy = false;
    await chapterEnd(chosen.chapter ?? prevChapter + 1, chosen, prevChapter);
    return;
  }

  // 同章：沿 goto 链演出到本章末/下一章开头
  const { state: next, visited, nextChapter } = advanceThrough(state, novel, chosen);
  state = next;
  for (const vn of visited.slice(1)) {
    if (vn.who !== 'narrator' && charOf(vn.who)) {
      addBubble(vn.who, vn.text, '');
      $('stage').classList.remove('compact');
      await typeInto($('scene-text'), vn.text.slice(0, 42));
    } else {
      $('stage').classList.remove('compact');
      await typeInto($('scene-text'), vn.text);
    }
    remember('gm', vn.text);
    const hit = checkEnding(state, novel, { allowFallback: false });
    if (hit) { finish(hit); return; }
  }
  saveSession();
  // 停在哪：仍有选项（同章连续命运节点）→ 继续；本章走完 → 章末结算
  const stay = nodeOf(novel, state.node);
  if (nextChapter == null && stay?.choices?.length && (stay.chapter ?? state.chapter) === state.chapter) {
    state.node = stay.id;
    $('km-banner').hidden = false;
    await typeInto($('scene-text'), stay.text);
    renderKeyChoices(stay);
    busy = false;
    return;
  }
  busy = false;
  await chapterEnd(nextChapter, null, prevChapter);
}

// ---- 章末结算 ----
async function chapterEnd(nextChapterTarget = null, entryNode = null, closingChapter = null) {
  phase = 'chapter-end';
  const closedCh = closingChapter ?? state.chapter;
  $('km-banner').hidden = true;
  const quick = $('quick'); quick.replaceChildren();
  // diff 结算卡
  const card = el('div', 'recap-card');
  card.append(el('div', 'recap-title', `—— 第${closedCh}章 · 命运结算 ——`));
  for (const def of novel.player.attributes) {
    const nowV = state.attrs[def.key] ?? 0;
    const wasV = chapterSnap.attrs[def.key] ?? 0;
    const d = nowV - wasV;
    if (!d) continue;
    const row = el('div', 'recap-row');
    row.append(el('span', null, def.name), el('b', d > 0 ? 'up' : 'down', `${wasV} → ${nowV}（${d > 0 ? '+' : ''}${d}）`));
    card.append(row);
  }
  for (const [npc, rel] of Object.entries(state.rels)) {
    const was = chapterSnap.rels[npc]?.favor ?? rel.favor;
    const d = rel.favor - was;
    if (!d) continue;
    const row = el('div', 'recap-row');
    row.append(el('span', null, `${charOf(npc)?.name || npc} 好感`), el('b', d > 0 ? 'up' : 'down', `${was} → ${rel.favor}`));
    card.append(row);
  }
  const dDiv = +(state.divergence - chapterSnap.div).toFixed(2);
  card.append(el('div', 'recap-sum', `偏离度 ${Math.round(chapterSnap.div * 100)}% → ${Math.round(state.divergence * 100)}%${dDiv > 0.14 ? ' · 世界修正力注意到了你' : ''}`));
  msgs.append(card); scrollBottom();

  // 摘要 + 云同步
  addSys('正在把这一章写进记忆…');
  const summary = await askSummary(closedCh);
  state.summaryChain.chapter = summary;
  state.summaries = [...(state.summaries || []), { chapter: state.chapter, summary }].slice(-8);
  addSys(`前情提要：${summary}`);
  await syncSave();
  saveSession();

  const nextCh = nextChapterTarget ?? (state.chapter + 1);
  if (chapterStartNode(novel, nextCh)) {
    startChapter(nextCh, { entryNode: (entryNode && (entryNode.chapter ?? nextCh) === nextCh) ? entryNode : null });
  } else {
    const hit = checkEnding(state, novel) || { ending: novel.endings[novel.endings.length - 1], cause: '' };
    finish(hit);
  }
}

// ---- 结局 ----
function finish(hit) {
  if (phase === 'ending') return;
  phase = 'ending';
  markPlayed(); // 完成一局 → 记入「玩过的书」
  const quick = $('quick'); quick.replaceChildren();
  const ending = hit.ending;
  currentEnding = ending;
  const gallery = JSON.parse(localStorage.getItem('cs_endings') || '{}');
  const got = new Set(gallery[bookId] || []);
  got.add(ending.id);
  gallery[bookId] = [...got];
  localStorage.setItem('cs_endings', JSON.stringify(gallery));
  state.endingsUnlocked = [...got];

  $('end-family').textContent = `—— ${ending.family}${hit.cause ? `（${hit.cause}）` : ''} · 结局 ——`;
  $('end-title').textContent = ending.title;
  $('end-tone').textContent = ending.tone || '';
  $('end-epilogue').textContent = ending.epilogue;
  $('end-rare').textContent = got.size >= novel.endings.length
    ? `🏆 全结局收集完成（${got.size}/${novel.endings.length}）`
    : `已收集结局 ${got.size}/${novel.endings.length} · 稀有度约 ${Math.round((ending.rarity || 0.1) * 100)}%`;
  const stats = $('end-stats'); stats.replaceChildren();
  for (const def of novel.player.attributes) {
    const s = el('span', 'stat');
    s.append(`${def.name} `, el('b', null, String(state.attrs[def.key] ?? 0)));
    stats.append(s);
  }
  const dv = el('span', 'stat');
  dv.append(`偏离原作 `, el('b', null, `${Math.round((state.divergence || 0) * 100)}%`));
  stats.append(dv);
  drawRecordCard(ending);
  $('end-overlay').hidden = false;
  syncSave(true);
  saveSession();
}

function drawRecordCard(ending) {
  const cv = $('record-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#14161C'); g.addColorStop(1, '#1E2230');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(240,206,131,.5)'; ctx.lineWidth = 2; ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8791A0'; ctx.font = '18px sans-serif';
  ctx.fillText('穿 书 引 擎 · 命 运 战 报', W / 2, 64);
  ctx.fillStyle = '#F2F4F8'; ctx.font = 'bold 34px serif';
  ctx.fillText(truncate(novel.meta.title, 14), W / 2, 122);
  ctx.fillStyle = '#9AA3B2'; ctx.font = '17px sans-serif';
  ctx.fillText(`穿成「${identityName()}」 · ${state.chapter} 章终`, W / 2, 156);
  ctx.fillStyle = '#F5D78E'; ctx.font = 'bold 44px serif';
  ctx.fillText(ending.title, W / 2, 232);
  ctx.fillStyle = '#C9CFD8'; ctx.font = '16px sans-serif';
  ctx.fillText(`【${ending.family}】${ending.tone || ''}`, W / 2, 266);
  // 属性条
  let y = 320;
  ctx.textAlign = 'left';
  for (const def of novel.player.attributes) {
    const v = state.attrs[def.key] ?? 0;
    ctx.fillStyle = '#C9CFD8'; ctx.font = '17px sans-serif';
    ctx.fillText(def.name, 70, y);
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(160, y - 13, 300, 16);
    ctx.fillStyle = '#4D9AFF'; ctx.fillRect(160, y - 13, 300 * Math.max(0, Math.min(1, v / (def.max ?? 10))), 16);
    ctx.fillStyle = '#F2F4F8'; ctx.fillText(String(v), 475, y);
    y += 44;
  }
  ctx.fillStyle = '#B8860B'; ctx.font = '17px sans-serif';
  ctx.fillText('偏离原作', 70, y);
  ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(160, y - 13, 300, 16);
  ctx.fillStyle = '#F0CE83'; ctx.fillRect(160, y - 13, 300 * Math.min(1, state.divergence || 0), 16);
  ctx.fillStyle = '#F0CE83'; ctx.fillText(`${Math.round((state.divergence || 0) * 100)}%`, 475, y);
  // 印记
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6E7684'; ctx.font = '14px sans-serif';
  ctx.fillText(`结局收藏 ${state.endingsUnlocked.length}/${novel.endings.length} · 记忆碎片 ${state.memories.length}`, W / 2, H - 92);
  ctx.fillStyle = '#4D639A'; ctx.font = '15px sans-serif';
  ctx.fillText('chuanshu-engine.xyz · 重开一段人生', W / 2, H - 58);
}
function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

$('btn-save-card').addEventListener('click', () => {
  if (!currentEnding) return;
  const a = document.createElement('a');
  a.download = `命运战报-${novel.meta.title}-${currentEnding.title}.png`;
  a.href = $('record-canvas').toDataURL('image/png');
  a.click();
});
$('btn-restart').addEventListener('click', () => {
  localStorage.removeItem(`cs_game_${bookId}`);
  localStorage.removeItem(`cs_saveid_${bookId}`);
  location.reload();
});
$('btn-home2').addEventListener('click', () => location.href = './index.html');
$('btn-back').addEventListener('click', () => location.href = './index.html');
$('btn-reset').addEventListener('click', () => {
  if (confirm('清空本地与云端进度，重新开始？')) {
    localStorage.removeItem(`cs_game_${bookId}`);
    localStorage.removeItem(`cs_saveid_${bookId}`);
    location.reload();
  }
});

// ============ 身份选择 ============
function showIdentityPicker() {
  phase = 'identity';
  // 防御：身份卡为空（拆书异常）→ 自动以默认身份直接开始，不让玩家卡在空浮层
  if (!(novel.player.identity_cards || []).length) {
    novel.player.identity_cards = [{ id: null, name: '穿成书中人', desc: '以穿越者的身份进入这个故事。', init: {} }];
    state = createState(novel, { identity: null });
    state.summaries = [];
    state.saveId = saveId;
    addSys('— 这本书的身份卡缺失，已按「穿成书中人」开始 —');
    showPrologue(novel.player.identity_cards[0]);
    return;
  }
  $('id-title').textContent = `《${novel.meta.title}》`;
  $('id-sub').textContent = novel.meta.intro;
  const list = $('id-list'); list.replaceChildren();
  (novel.player.identity_cards || []).forEach((card, i) => {    const cardEl = el('div', 'id-card');
    const h3 = el('h3', null, card.name);
    if (i === 0) h3.append(el('span', 'tag', '推荐'));
    const pc = resolvePlayerChar(novel, card.id);
    if (pc) {
      const ch = charOf(pc);
      h3.append(el('span', 'tag gray', `演 ${ch?.name || pc}`));
    }
    cardEl.append(h3, el('p', null, card.desc || ''));
    cardEl.addEventListener('click', () => {
      state = createState(novel, { identity: card.id });
      state.summaries = [];
      state.saveId = saveId;
      $('id-overlay').hidden = true;
      saveSession();
      showPrologue(card);
    });
    list.append(cardEl);
  });
  $('id-overlay').hidden = false;
}

// ============ 启动 ============
(async () => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    // 双源加载：静态文件 → API。注意 SPA 兜底会把 404 变成 200 的 HTML，
    // 必须以「JSON 解析成功且含 meta」为准，而不是 HTTP 状态码。
    let loaded = null;
    for (const url of [`./data/books/${bookId}.json`, `./api/books/${bookId}`]) {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.meta && data.graph) { loaded = data; break; }
      } catch { /* 尝试下一源（含 SPA 200 返回 HTML 的 JSON 解析失败） */ }
    }
    clearTimeout(timer);
    if (!loaded) throw new Error('书籍数据不可用（静态与 API 源均失败）');
    novel = loaded;
    novelBase = structuredClone(novel);
    applySceneTheme(1);
    if (/^(forge|world)_/.test(bookId)) markPlayed(); // 拆的新书/造的世界进入过游戏 → 入栏，下次免重拆重造
    document.title = `${novel.meta.title} · AI对话AVG`;
    $('book-title').textContent = novel.meta.title;
    state = null;

    // 云端存档恢复（跨设备）；本地较新则用本地
    saveId = localStorage.getItem(`cs_saveid_${bookId}`) || genSaveId();
    localStorage.setItem(`cs_saveid_${bookId}`, saveId);
    const local = JSON.parse(localStorage.getItem(`cs_game_${bookId}`) || 'null');
    let cloud = null;
    try {
      const ctrl2 = new AbortController();
      setTimeout(() => ctrl2.abort(), 3500);
      const r = await fetch(`./api/save/load?bookId=${encodeURIComponent(bookId)}&saveId=${saveId}`, { signal: ctrl2.signal });
      const d = await r.json();
      if (d?.ok && d.found) cloud = d;
    } catch { /* 无服务端 */ }

    if (cloud?.state && (!local?.state || (cloud.state.ts || 0) > (local.state.ts || 0))) {
      state = cloud.state;
      state.memories = (cloud.memories || []).map((m) => ({ ...m, turn: m.turn || 0, chapter: state.chapter }));
      state.summaries = cloud.summaries || state.summaries || [];
      addSys('— 已恢复云端进度 · 点右上 ↺ 重新开始 —');
    } else if (local?.state) {
      state = local.state;
      state.summaries = state.summaries || [];
      addSys('— 已恢复上次进度 · 点右上 ↺ 重新开始 —');
    }
    if (state) {
      if (!state.mapVisited) state.mapVisited = [];
      if (!state.playerChar) state.playerChar = resolvePlayerChar(novel, state.identity);
      applyNovelOverride();
      resumeGame();
    } else {
      showIdentityPicker();
    }
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    $('book-title').textContent = '加载失败';
    const hint = isTimeout ? '书籍数据加载超时（网络不稳定或域名被拦截），请重试' : '书籍数据加载失败：' + e.message;
    const retry = el('button', 'btn', '重试');
    retry.style.cssText = 'margin:12px auto;display:block';
    retry.addEventListener('click', () => location.reload());
    msgs.append(el('div', 'narration', hint), retry);
  }
})();

function resumeGame() {
  renderPanel();
  renderHUD();
  applySceneTheme(state.chapter);
  // 恢复在场者：最近对话里发言过的角色仍在场景中（recent 文本格式「角色名：台词」）
  const recentNames = (state.recent || []).slice(-8).filter((r) => r.role === 'gm')
    .map((r) => String(r.text || '').split('：')[0]);
  setPresent(recentNames.map((n) => (novel.characters || []).find((c) => c.name === n)?.id));
  const opener = (novel.characters || []).find((x) => x.role === 'lead');
  if (opener) $('panel-whoami').textContent = `${identityName()} · 第${state.chapter}章`;
  // 续档直接回到自由行动（演出从简）
  chapterSnap = { attrs: { ...state.attrs }, rels: Object.fromEntries(Object.entries(state.rels || {}).map(([k, v]) => [k, { ...v }])), div: state.divergence };
  chapterLog = [];
  if (state.chapterBudget == null) state.chapterBudget = rollBudget(state.chapter, state.identity);
  enterFree(true);
}
