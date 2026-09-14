// 旧入口重定向：剧情体验 / AVG 已融合为 AI 对话 AVG（game.html）
const book = new URLSearchParams(location.search).get('book') || '';
location.replace(`./game.html?book=${encodeURIComponent(book)}`);
