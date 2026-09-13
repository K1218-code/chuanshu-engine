// AVG 页逻辑（外部模块，CSP 安全）
import { createState, nodeOf, applyChoice, advance, evalChoices, checkEnding, attrBand } from './engine.js';

window.addEventListener('error', (e) => {
  const el = document.getElementById('txt');
  if (el) el.textContent = '⚠ ' + (e.message || '脚本错误');
});
window.addEventListener('unhandledrejection', (e) => {
  const el = document.getElementById('txt');
  if (el) el.textContent = '⚠ Promise: ' + (e.reason?.message || e.reason);
});

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const bookId = params.get('book') || 'btg_room';
let novel = null, state = null;
let typing = null, typingText = '';

function nameOf(who) {
  if (who === 'narrator') return '';
  const c = novel.characters.find((x) => x.id === who);
  return c ? c.name : who;
}

function renderStatbar() {
  const bar = $('statbar');
  bar.replaceChildren();
  for (const def of novel.player.attributes) {
    const v = state.attrs[def.key];
    const band = attrBand(def, v);
    const el = document.createElement('span');
    el.className = 'stat' + (v <= (def.deathBelow ?? -1) + 1 ? ' danger' : '');
    el.innerHTML = `${def.name} <b>${v}</b>` + (band && band.label && v <= band.upTo ? `·${band.label}` : '');
    bar.append(el);
  }
  const dv = document.createElement('span');
  dv.className = 'stat';
  dv.innerHTML = `偏离 <b>${Math.round(state.divergence * 100)}%</b>`;
  bar.append(dv);
}

function showChapterBadge(ch) {
  const chMap = { 1: '入房', 2: '第一夜', 3: '台阶', 4: '大考' };
  const num = Number(ch) || 1;
  const badge = $('chapter-badge');
  badge.replaceChildren();
  const b = document.createElement('b');
  b.textContent = `第 ${num} 章`;
  badge.append(b, document.createTextNode(` · ${chMap[num] || ''}`));
  $('chapter-label').textContent = `第${num}章`;
}

function typeText(text) {
  clearInterval(typing);
  typingText = text;
  $('txt').textContent = '';
  $('next-hint').style.display = 'none';
  let i = 0;
  typing = setInterval(() => {
    i += 2;
    $('txt').textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(typing); typing = null; $('next-hint').style.display = ''; }
  }, 28);
}

function renderNode() {
  const node = nodeOf(novel, state.node);
  if (!node) { finish(); return; }
  showChapterBadge(node.chapter);
  renderStatbar();

  const who = nameOf(node.who);
  const tag = $('who');
  tag.textContent = who || '· 旁白 ·';
  tag.className = 'name-tag' + (who ? '' : ' narrator');

  const dlg = $('dialog');
  const old = dlg.querySelector('.km-flag'); if (old) old.remove();
  if (node.keyMoment) {
    const f = document.createElement('span');
    f.className = 'km-flag'; f.textContent = '命运节点';
    dlg.append(f);
  }
  typeText(node.text);

  const box = $('choices');
  box.replaceChildren();
  if (node.choices && node.choices.length) {
    for (const { choice, ok, reason } of evalChoices(state, novel, node)) {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.innerHTML = choice.text + (ok ? '' : `<span class="cond">🔒 ${reason}</span>`);
      b.disabled = !ok;
      b.onclick = () => { state = applyChoice(state, novel, node.choices.indexOf(choice)); save(); renderNode(); };
      box.append(b);
    }
  }
}

$('dialog').addEventListener('click', () => {
  if (typing) {
    clearInterval(typing); typing = null;
    $('txt').textContent = typingText;
    $('next-hint').style.display = '';
    return;
  }
  const node = nodeOf(novel, state.node);
  if (!node?.choices?.length) {
    const hit = checkEnding(state, novel);
    if (!node.goto) { finish(hit); return; }
    const next = advance(state, novel);
    if (!next || !nodeOf(novel, next.node)) { finish(hit); return; }
    state = next; save(); renderNode();
  }
});

function finish(hit) {
  const ending = hit?.ending || checkEnding(state, novel)?.ending || novel.endings[novel.endings.length - 1];
  const gallery = JSON.parse(localStorage.getItem('cs_endings') || '{}');
  const got = new Set(gallery[bookId] || []);
  got.add(ending.id);
  gallery[bookId] = [...got];
  localStorage.setItem('cs_endings', JSON.stringify(gallery));

  $('end-family').textContent = `—— ${ending.family} · 结局 ——`;
  $('end-title').textContent = ending.title;
  $('end-tone').textContent = ending.tone || '';
  $('end-epilogue').textContent = ending.epilogue;
  $('end-rare').textContent = got.size >= novel.endings.length
    ? `🏆 全结局收集完成（${got.size}/${novel.endings.length}）`
    : `已收集结局 ${got.size}/${novel.endings.length} · 此结局稀有度约 ${Math.round((ending.rarity || 0.1) * 100)}%`;
  const stats = $('end-stats'); stats.replaceChildren();
  for (const def of novel.player.attributes) {
    const s = document.createElement('span'); s.className = 'stat';
    s.innerHTML = `${def.name} <b>${state.attrs[def.key]}</b>`; stats.append(s);
  }
  const dvs = document.createElement('span'); dvs.className = 'stat';
  dvs.innerHTML = `偏离原作 <b>${Math.round(state.divergence * 100)}%</b>`; stats.append(dvs);
  $('end-overlay').hidden = false;
}

$('btn-restart').onclick = () => { localStorage.removeItem(`cs_save_${bookId}`); location.reload(); };
$('btn-back').onclick = () => location.href = '/';
$('btn-home2').onclick = () => location.href = '/';

function save() { localStorage.setItem(`cs_save_${bookId}`, JSON.stringify(state)); }

function showIdentityPicker() {
  $('id-title').textContent = `《${novel.meta.title}》`;
  $('id-sub').textContent = novel.meta.intro;
  const list = $('id-list'); list.replaceChildren();
  novel.player.identity_cards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'id-card';
    el.innerHTML = `<h3>${card.name}${i === 0 ? '<span class="tag">推荐</span>' : ''}${card.id === 'ic_lcy' ? '<span class="tag gray">二周目</span>' : ''}</h3><p>${card.desc}</p>`;
    el.onclick = () => {
      state = createState(novel, { identity: card.id });
      $('id-overlay').hidden = true;
      save(); renderNode();
    };
    list.append(el);
  });
  $('id-overlay').hidden = false;
}

(async () => {
  try {
    novel = await (await fetch(`/data/books/${bookId}.json`)).json();
    document.title = `${novel.meta.title} · 穿书引擎`;
    $('book-title').textContent = novel.meta.title;
    const saved = localStorage.getItem(`cs_save_${bookId}`);
    if (saved) {
      state = JSON.parse(saved);
      renderNode();
    } else showIdentityPicker();
  } catch (e) {
    $('book-title').textContent = '加载失败';
    $('txt').textContent = `书籍数据加载失败：${e.message}`;
  }
})();
