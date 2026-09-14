// 创造世界页逻辑（外部模块）
const $ = (id) => document.getElementById(id);
$('btn-back').addEventListener('click', () => location.href = './index.html');
const TYPES = [['修仙','⚔️'],['校园','🏫'],['宫廷','🏯'],['末世','🌅'],['现代都市','🏙️'],['悬疑','🔍']];
let sel = '校园';
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
  $('status').textContent = '生成服务随部署开放（Day2）——先体验精选书库';
  setTimeout(() => location.href = './game.html?book=btg_room', 1600);
});
