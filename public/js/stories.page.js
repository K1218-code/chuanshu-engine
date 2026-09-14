// 全部故事页逻辑：列表 + forge 进度轮询
const $ = (id) => document.getElementById(id);
$('btn-back').addEventListener('click', () => location.href = './index.html');

const PREBUILT = { '2050600604976803918': 'btg_room', '1716453753710972928': 'ak47_xiuzhen' };
let polling = null;

(async () => {
  const [data, books] = await Promise.all([
    fetch('./data/stories.index.json').then((r) => r.json()),
    fetch('./data/books.index.json').then((r) => r.json()).catch(() => ({ books: [] })),
  ]);
  const prebuiltCovers = new Map((books.books || []).map((book) => [book.id, book.cover]));
  const list = $('list');
  data.stories.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'card story-row';
    const h = document.createElement('h4'); h.textContent = s.title;
    const p = document.createElement('p'); p.textContent = s.intro || s.author;
    const num = document.createElement('div'); num.className = 'num';
    const prebuiltId = PREBUILT[s.work_id];
    const coverUrl = prebuiltCovers.get(prebuiltId);
    if (coverUrl) {
      const img = document.createElement('img');
      img.src = coverUrl;
      img.alt = '';
      num.append(img);
    } else {
      num.textContent = String(i + 1).padStart(2, '0');
    }
    const info = document.createElement('div'); info.className = 'info';
    info.append(h, p);
    const go = document.createElement('div');
    go.className = 'go' + (PREBUILT[s.work_id] ? ' pre' : '');
    go.textContent = PREBUILT[s.work_id] ? '已拆解 ✓' : '生成 ▸';
    row.append(num, info, go);
    row.addEventListener('click', () => {
      if (PREBUILT[s.work_id]) { location.href = `/game.html?book=${PREBUILT[s.work_id]}`; return; }
      startForge(s);
    });
    list.append(row);
  });
})();

async function startForge(story) {
  const overlay = $('gen-overlay');
  $('gen-title').textContent = `《${story.title}》`;
  $('gen-label').textContent = '正在创建任务……';
  $('gen-fill').style.width = '0%';
  overlay.hidden = false;
  try {
    const res = await fetch('./api/forge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workId: String(story.work_id) }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error?.message || '创建任务失败');
    if (data.cached) { location.href = `/game.html?book=${data.bookId}`; return; }
    pollForge(data.jobId);
  } catch (e) {
    $('gen-label').textContent = '✕ ' + e.message;
    $('gen-hint').textContent = '现场生成需要部署后的 AI 服务——先去玩精选书库吧';
  }
}

function pollForge(jobId) {
  clearInterval(polling);
  polling = setInterval(async () => {
    try {
      const r = await fetch(`./api/forge/status?jobId=${encodeURIComponent(jobId)}`);
      const d = await r.json();
      if (!d.ok) {
        if (d.error?.code === 'JOB_EXPIRED') { clearInterval(polling); overlayHidden(); return; }
        throw new Error(d.error?.message || '生成失败');
      }
      $('gen-label').textContent = d.label || '';
      $('gen-fill').style.width = `${Math.round((d.progress || 0) * 100)}%`;
      if (d.done && d.bookId) {
        clearInterval(polling);
        $('gen-label').textContent = '拆解完成，正在进入世界——';
        setTimeout(() => location.href = `/game.html?book=${d.bookId}`, 600);
      }
    } catch (e) {
      clearInterval(polling);
      $('gen-label').textContent = '✕ ' + e.message;
    }
  }, 2500);
}

function overlayHidden() { $('gen-overlay').hidden = true; }
$('gen-cancel').addEventListener('click', () => { clearInterval(polling); overlayHidden(); });
