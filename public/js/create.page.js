// 创造世界页逻辑：类型+设定 → forge 管线 create 模式 → 轮询进度 → 进入生成的世界
const $ = (id) => document.getElementById(id);
$('btn-back').addEventListener('click', () => location.href = './index.html');
const TYPES = [['修仙','⚔️'],['校园','🏫'],['宫廷','🏯'],['末世','🌅'],['现代都市','🏙️'],['悬疑','🔍']];
let sel = '校园';
let busy = false;
let polling = null;
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
      body: JSON.stringify({ world: { type: sel, free: $('free').value } }) });
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
