// 首页逻辑（外部模块，CSP 安全）
const $ = (id) => document.getElementById(id);
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('toast-root').append(t); setTimeout(() => t.remove(), 2600);
}

function renderGallery(index) {
  const gallery = JSON.parse(localStorage.getItem('cs_endings') || '{}');
  const strip = $('gallery'); strip.replaceChildren();
  let total = 0, got = 0;
  for (const book of index) {
    total += book.endings;
    const g = (gallery[book.id] || []).length; got += g;
    const row = document.createElement('div');
    row.className = 'gallery-book';
    const cover = document.createElement('div');
    cover.className = 'gb-cover';
    cover.textContent = book.cover_label || book.title.slice(0, 2);
    const info = document.createElement('div');
    info.className = 'gb-info';
    const b = document.createElement('b');
    b.textContent = book.title;
    const span = document.createElement('span');
    span.textContent = `${g}/${book.endings} 个结局已解锁`;
    if (g >= book.endings && book.endings > 0) span.className = 'done';
    info.append(b, span);
    const arrow = document.createElement('span');
    arrow.className = 'gb-arrow';
    arrow.textContent = '›';
    row.append(cover, info, arrow);
    row.addEventListener('click', () => openEndingsModal(book));
    strip.append(row);
  }
  $('gallery-count').textContent = `${got}/${total}`;
}

// 结局图鉴浮层：书籍 → 不同结局与评价总结（未解锁只显示分类提示）
async function openEndingsModal(book) {
  const overlay = $('endings-overlay');
  $('eg-title').textContent = `《${book.title}》· 结局图鉴`;
  $('eg-sub').textContent = '解锁的结局可查看命运总结；未解锁的只提示所属线路——换张身份卡、走另一条命运线试试';
  const list = $('eg-list');
  list.replaceChildren(Object.assign(document.createElement('div'), { className: 'eg-loading', textContent: '正在翻开图鉴……' }));
  overlay.hidden = false;
  let novel = null;
  try {
    novel = await (await fetch(`./data/books/${book.id}.json`)).json();
  } catch { /* 静态托管缺书时兜底 */ }
  list.replaceChildren();
  if (!novel?.endings?.length) {
    list.append(Object.assign(document.createElement('div'), { className: 'eg-loading', textContent: '图鉴数据加载失败，稍后再试' }));
    return;
  }
  const gallery = JSON.parse(localStorage.getItem('cs_endings') || '{}');
  const unlocked = new Set(gallery[book.id] || []);
  const endings = [...novel.endings].sort((a, b) =>
    (unlocked.has(b.id) ? 1 : 0) - (unlocked.has(a.id) ? 1 : 0) || (a.rarity ?? 1) - (b.rarity ?? 1));
  for (const e of endings) {
    const isGot = unlocked.has(e.id);
    const card = document.createElement('div');
    card.className = 'eg-card' + (isGot ? '' : ' eg-locked');
    const head = document.createElement('div');
    head.className = 'eg-head';
    const title = document.createElement('b');
    title.textContent = isGot ? e.title : '？？？';
    const family = document.createElement('span');
    family.className = 'eg-family' + (e.family === '死亡' ? ' death' : (e.family === '隐藏' || e.family === '改命') ? ' gold' : '');
    family.textContent = e.family + (isGot ? '' : '线');
    const rare = document.createElement('span');
    rare.className = 'eg-rare';
    rare.textContent = `稀有度约 ${Math.round((e.rarity || 0.1) * 100)}%`;
    head.append(title, family, rare);
    card.append(head);
    if (isGot) {
      const tone = document.createElement('div');
      tone.className = 'eg-tone';
      tone.textContent = e.tone || '';
      const p = document.createElement('p');
      p.textContent = e.epilogue;
      card.append(tone, p);
    } else {
      const p = document.createElement('p');
      p.className = 'eg-hint';
      p.textContent = '尚未解锁。命运节点的抉择、数值的走向，都会通向不同的结局。';
      card.append(p);
    }
    list.append(card);
  }
}

$('eg-close').addEventListener('click', () => { $('endings-overlay').hidden = true; });

// ---- 玩过的书：完成过一局、或拆解生成过的书；点击直接续玩（forge 书走服务端缓存，免重拆） ----
function timeAgo(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return '30 天前';
}

function renderPlayed() {
  const section = $('played-section');
  let played = {};
  try { played = JSON.parse(localStorage.getItem('cs_played') || '{}'); } catch { /* 坏数据当空 */ }
  const entries = Object.entries(played).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  if (!entries.length) { section.hidden = true; return; }
  section.hidden = false;
  $('played-count').textContent = `${entries.length} 本 · 存档都在`;
  const list = $('played-list');
  list.replaceChildren();
  const gallery = JSON.parse(localStorage.getItem('cs_endings') || '{}');
  for (const [id, info] of entries) {
    const got = (gallery[id] || []).length;
    const row = document.createElement('div');
    row.className = 'gallery-book';
    const cover = document.createElement('div');
    cover.className = 'gb-cover';
    cover.textContent = (info.title || '书').slice(0, 2);
    const infoBox = document.createElement('div');
    infoBox.className = 'gb-info';
    const b = document.createElement('b');
    b.textContent = info.title || id;
    const span = document.createElement('span');
    span.textContent = `${info.author ? info.author + ' · ' : ''}${got}/${info.endings || '?'} 结局 · ${timeAgo(info.at)}玩过`;
    infoBox.append(b, span);
    const arrow = document.createElement('span');
    arrow.className = 'gb-arrow';
    arrow.textContent = '继续玩 ›';
    row.append(cover, infoBox, arrow);
    row.addEventListener('click', () => { location.href = `/game.html?book=${encodeURIComponent(id)}`; });
    list.append(row);
  }
}

(async () => {
  const data = await (await fetch('./data/books.index.json')).json();
  const list = $('book-list');
  for (const book of data.books) {
    const card = document.createElement('div');
    card.className = 'card book-card';
    const tags = book.tags.map((t) => `<span class="tag gray">${t}</span>`).join('');
    card.innerHTML = `
      <div class="cover">${book.cover_label || book.title.slice(0, 4)}</div>
      <div class="book-info">
        <h3></h3>
        <div class="author"></div>
        <div class="intro"></div>
        <div class="book-tags">${tags}</div>
        <div class="mode-pick" style="margin-top:10px">
          <button class="mode-btn" data-mode="game">进入游戏<small>AI对话AVG · 自由行动 × 命运节点</small></button>
        </div>
      </div>`;
    card.querySelector('h3').textContent = book.title;
    card.querySelector('.author').textContent = `${book.author} · ${book.endings} 个结局`;
    card.querySelector('.intro').textContent = book.intro;
    card.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.href = `/game.html?book=${book.id}`;
      });
    });
    list.append(card);
  }
  renderGallery(data.books);
  renderPlayed();

  // 入口卡片
  $('entry-create').addEventListener('click', () => location.href = './create.html');
  $('entry-all').addEventListener('click', () => location.href = './stories.html');
})();

// 登录态（部署后由 Worker 提供 /api/me；本地静态托管无此服务时按钮改为提示）
const loginBtn = $('login-btn');
let loginReady = false;
loginBtn.addEventListener('click', () => {
  if (loginReady) location.href = '/auth/zhihu/login';
  else toast('知乎登录随部署开放（本地预览不支持）');
});
(async () => {
  try {
    const r = await fetch('./api/me');
    if (!r.ok) return;
    const me = await r.json();
    loginReady = true;
    if (me?.name) loginBtn.textContent = me.name;
  } catch { /* 静态托管下无 /api/me，保持提示行为 */ }
})();
