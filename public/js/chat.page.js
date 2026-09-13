// 剧情体验页逻辑（当前为占位态，Day2 接入 GM 服务）
const $ = (id) => document.getElementById(id);
$('btn-back').addEventListener('click', () => location.href = '/');
$('btn-avg').addEventListener('click', () => location.href = '/avg.html?book=btg_room');
