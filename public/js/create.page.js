// 创造世界页逻辑：类型+设定(+可选封面) → forge 管线 create 模式 → 轮询进度 → 进入生成的世界
const $ = (id) => document.getElementById(id);
$('btn-back').addEventListener('click', () => location.href = './index.html');
const TYPES = [['修仙','⚔️'],['校园','🏫'],['宫廷','🏯'],['末世','🌅'],['现代都市','🏙️'],['悬疑','🔍']];
let sel = '校园';
let busy = false;
let polling = null;
let coverData = ''; // 压缩后的 data URL，随请求提交写进书籍 meta.cover
const grid = $('types');
for (const [name, ico] of TYPES) {
  const d = document.createElement('div');
  d.className = 'opt' + (name === sel ? ' sel' : '');
  d.innerHTML = `<span class="ico">${ico}</span>${name}`;
  d.addEventListener('click', () => {
    sel = name;
    grid.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
    d.classList.add('sel');
  });
  grid.append(d);
}

// ---- 封面上传：选图 → canvas 压缩（宽≤480/高≤720，JPEG 质量自适应到 ~180KB 内）→ 预览 ----
const coverBox = $('cover-box'), coverFile = $('cover-file'), coverPreview = $('cover-preview');
const MAX_COVER_CHARS = 180000; // data URL 长度上限（服务端 220000 兜底）

function compressCover(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)) return reject(new Error('请选择 JPG / PNG / WebP 图片'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, 480 / img.width, 720 / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; // JPEG 无透明通道，先铺白底防透明 PNG 变黑
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let q = 0.82, out = cv.toDataURL('image/jpeg', q);
        while (out.length > MAX_COVER_CHARS && q > 0.45) { q -= 0.15; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > MAX_COVER_CHARS) return reject(new Error('图片压缩后仍过大，请换一张'));
        resolve(out);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

function showCover(dataUrl) {
  coverData = dataUrl;
  coverPreview.src = dataUrl;
  coverPreview.hidden = !dataUrl;
  $('cover-placeholder').hidden = !!dataUrl;
  $('cover-change').hidden = !dataUrl;
  $('cover-clear').hidden = !dataUrl;
}

coverBox.addEventListener('click', (e) => {
  if (e.target.id !== 'cover-change') coverFile.click();
});
$('cover-change').addEventListener('click', () => coverFile.click());
$('cover-clear').addEventListener('click', () => {
  coverFile.value = '';
  showCover('');
});
coverFile.addEventListener('change', async () => {
  const f = coverFile.files && coverFile.files[0];
  if (!f) return;
  try {
    showCover(await compressCover(f));
  } catch (e) {
    coverFile.value = '';
    showCover('');
    $('status').textContent = `✕ ${e.message || '封面处理失败'}`;
  }
});

$('go').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  $('go').disabled = true;
  $('gen-overlay').hidden = false;
  $('gen-label').textContent = '正在创建任务……';
  $('gen-fill').style.width = '0%';
  $('gen-hint').textContent = 'AI 正在为你原创一个可玩世界，约需 3-7 分钟';
  try {
    const res = await fetch('./api/forge', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ world: { type: sel, free: $('free').value }, cover: coverData }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error?.message || '创建任务失败');
    pollForge(data.jobId);
  } catch (e) {
    overlayFail(e.message);
  }
});

function pollForge(jobId) {
  polling = setInterval(async () => {
    try {
      const r = await fetch(`./api/forge/status?jobId=${encodeURIComponent(jobId)}`);
      const d = await r.json();
      if (!d.ok) {
        if (d.error?.code === 'JOB_EXPIRED') { clearInterval(polling); return overlayFail('任务过期，请重新生成'); }
        throw new Error(d.error?.message || '生成失败');
      }
      $('gen-label').textContent = d.label || '';
      $('gen-fill').style.width = `${Math.round((d.progress || 0) * 100)}%`;
      if (d.done && d.bookId) {
        clearInterval(polling);
        $('gen-label').textContent = '世界成形，正在进入——';
        setTimeout(() => location.href = `/game.html?book=${encodeURIComponent(d.bookId)}`, 600);
      }
    } catch (e) {
      clearInterval(polling);
      overlayFail(e.message);
    }
  }, 2500);
}

function overlayFail(msg) {
  busy = false;
  $('go').disabled = false;
  $('gen-label').textContent = '✕ ' + msg;
  $('gen-hint').textContent = '稍后再试，或先去玩精选书库';
}

$('gen-cancel').addEventListener('click', () => {
  clearInterval(polling);
  $('gen-overlay').hidden = true;
  busy = false;
  $('go').disabled = false;
});
