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
    for (let i = 0; i < book.endings; i++) {
      const chip = document.createElement('span');
      chip.className = 'end-chip' + (i < g ? ' got' : '');
      chip.textContent = i < g ? '✦ 已解锁' : '·';
      chip.title = book.title;
      strip.append(chip);
    }
  }
  $('gallery-count').textContent = `${got}/${total}`;
}

(async () => {
  const data = await (await fetch('/data/books.index.json')).json();
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
          <button class="mode-btn" data-mode="chat">① 剧情体验<small>穿成书中人 · 对话</small></button>
          <button class="mode-btn" data-mode="avg">② AVG 多结局<small>选择改变命运</small></button>
        </div>
      </div>`;
    card.querySelector('h3').textContent = book.title;
    card.querySelector('.author').textContent = `${book.author} · ${book.endings} 个结局`;
    card.querySelector('.intro').textContent = book.intro;
    card.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.mode === 'avg') location.href = `/avg.html?book=${book.id}`;
        else location.href = `/chat.html?book=${book.id}`;
      });
    });
    list.append(card);
  }
  renderGallery(data.books);

  // 入口卡片
  $('entry-create').addEventListener('click', () => location.href = '/create.html');
  $('entry-all').addEventListener('click', () => location.href = '/stories.html');
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
    const r = await fetch('/api/me');
    if (!r.ok) return;
    const me = await r.json();
    loginReady = true;
    if (me?.name) loginBtn.textContent = me.name;
  } catch { /* 静态托管下无 /api/me，保持提示行为 */ }
})();
