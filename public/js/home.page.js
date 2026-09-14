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

// 登录态闭环：双入口并存——「知乎登录」走真实授权；「演示登录」（mock 开启时显示）一键建立演示身份
const loginBtn = $('login-btn');
const demoBtn = $('demo-btn');
let loggedIn = false;
let oauthMock = false;

function renderLogin(me) {
  loggedIn = !!me;
  loginBtn.replaceChildren();
  if (me) {
    if (me.avatarUrl) {
      const img = document.createElement('img');
      img.className = 'login-avatar';
      img.src = me.avatarUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer'; // 知乎 CDN 防防盗链拦截
      loginBtn.append(img);
    }
    loginBtn.append(document.createTextNode(me.name || '知乎用户'));
    loginBtn.title = '点击退出登录';
    loginBtn.classList.add('logged-in');
    demoBtn.hidden = true; // 登录后演示入口隐藏
  } else {
    loginBtn.textContent = '知乎登录';
    loginBtn.title = '跳转知乎授权，登录后存档永久保留';
    loginBtn.classList.remove('logged-in');
    demoBtn.hidden = !oauthMock;
    demoBtn.title = '演示模式：一键建立演示身份，存档永久保留';
  }
}

loginBtn.addEventListener('click', () => {
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (loggedIn) {
    if (confirm('退出登录？\n登录期间的存档会永久保留，退出后将以游客身份继续（游客存档 24 小时后清除）。')) location.href = '/auth/logout';
  } else if (isLocal) {
    toast('本地预览不支持知乎授权——请在 chuanshu-engine.xyz 上登录，或用「演示登录」体验');
  } else {
    location.href = '/auth/zhihu/login';
  }
});

demoBtn.addEventListener('click', () => { location.href = '/auth/demo/login'; });

// OAuth 回跳反馈 + 清理 URL 参数
(function handleOAuthReturn() {  const params = new URLSearchParams(location.search);
  const oauth = params.get('oauth');
  if (!oauth) return;
  if (oauth === 'success') {
    fetch('./api/me').then((r) => r.ok ? r.json() : null).then((me) => {
      if (me?.name) {
        renderLogin(me);
        toast(me.mock ? '已进入演示身份——存档永久保留，完整功能可体验' : `知乎登录成功，欢迎 ${me.name}——存档已永久保留`);
      }
    }).catch(() => {});
  } else if (oauth === 'logout') {
    renderLogin(null);
    toast('已退出登录。游客数据将在 24 小时后清除');
  } else if (oauth === 'state_mismatch') {
    toast('登录失败：安全校验未通过，请重试');
  } else if (oauth === 'token_failed' || oauth === 'error') {
    toast('登录失败：知乎授权未完成，请重试');
  }
  params.delete('oauth');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
})();

(async () => {
  try {
    const r = await fetch('./api/me');
    const body = await r.json().catch(() => null);
    oauthMock = !!body?.oauthMock;
    renderLogin(r.ok && body?.ok ? body : null);
  } catch { renderLogin(null); /* 静态托管下无 /api/me */ }
})();

// ---- 新手指南：常驻入口（hero 按钮）+ 首次访问自动弹出一次（状态留存于 localStorage） ----
const GUIDE_SEEN_KEY = 'cs_guide_seen';
const guideOverlay = $('guide-overlay');

function openGuide() { guideOverlay.hidden = false; }
function closeGuide(markSeen) {
  guideOverlay.hidden = true;
  if (markSeen) { try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch { /* 隐私模式静默 */ } }
}

$('guide-btn').addEventListener('click', () => openGuide());
$('guide-close').addEventListener('click', () => closeGuide(true));
guideOverlay.addEventListener('click', (e) => { if (e.target === guideOverlay) closeGuide(true); });

// 首次访问（未看过指南）自动弹出一次
try { if (!localStorage.getItem(GUIDE_SEEN_KEY)) setTimeout(openGuide, 600); } catch { /* 读不到就不自动弹 */ }
