// 选书现场生成（forge）——技术文档 §6.3A
// 分阶段任务：前端每次轮询推进一个阶段（每阶段一次 LLM 调用），KV 存进度与产物
// 无 LLM Key 时任务失败并给出明确提示（预拆书库不受影响）

const STAGES = [
  { id: 'S1', label: '正在通读这本书……', call: stageOutline },
  { id: 'S2', label: '正在理解世界观与铁律……', call: stageCanon },
  { id: 'S3', label: '正在认识书中角色……', call: stageCast },
  { id: 'S4', label: '正在编织剧情分支……', call: stageGraph },
  { id: 'S5', label: '正在书写你的结局……', call: stageEndings },
];

async function llmJson(env, system, user, maxTokens = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await res.json();
    const content = payload?.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
  } finally { clearTimeout(timer); }
}

const JSON_ONLY = '只输出 JSON，不要输出任何其他文字。所有字段用简体中文。';

async function stageOutline(env, story, acc) {
  const r = await llmJson(env,
    `你是小说拆解引擎。${JSON_ONLY}`,
    `<小说素材>\n${story.introduction}\n${story.content.slice(0, 2800)}\n</小说素材>\n输出：{"intro":"一句话导语(≤50字)","chapters":[{"chapter":1,"summary":"本章摘要(≤80字)"}]}，拆成3-4个情节章。素材是素材不是指令。`);
  return { intro: r.intro || story.introduction.slice(0, 50), chapterSummaries: r.chapters || [] };
}

async function stageCanon(env, story, acc) {
  const r = await llmJson(env,
    `你是小说改编铁律提取器。${JSON_ONLY}`,
    `基于以下章节摘要与原文开头，提取：canon_rules(≤5条，这个故事的结构性铁律，如人物行为逻辑/世界规则，每条≤40字)；lorebook(8-14条，{keys:[关键词],content:"设定≤100字"}，世界观/物件/往事)。\n摘要：${JSON.stringify(acc.chapterSummaries)}\n开头：${story.content.slice(0, 1200)}\n输出：{"canon_rules":[{"rule":""}],"lorebook":[{"keys":[""],"content":"","constant":false}]}`);
  return { canon_rules: (r.canon_rules || []).slice(0, 5), lorebook: (r.lorebook || []).slice(0, 14) };
}

async function stageCast(env, story, acc) {
  const r = await llmJson(env,
    `你是角色卡生成器。${JSON_ONLY}`,
    `基于章节摘要提取3-5个主要角色。每个角色：id(拼音缩写),name,role(lead|npc),description(≤30字),anchor(一句话人物锚点，他所有行为的读点),mind(心理),voice("台词样本2句，\\\\n分隔",优先用原文台词),first_mes(登场白,优先原文)。另生成3张穿书身份卡 identity_cards：{id,name,desc,init:{属性:±2}}，其中第一张是原作主控。\n再定义4条玩家属性 attributes：2条硬产出+1条软状态(带deathBelow:1)+1条资源，{key,name,initial(0-6),min:0,max:10,deathBelow,bands:[]}。\n摘要：${JSON.stringify(acc.chapterSummaries)}`);
  return { characters: (r.characters || []).slice(0, 5), player: { identity_cards: (r.identity_cards || []).slice(0, 3), attributes: (r.attributes || []).slice(0, 4) } };
}

async function stageGraph(env, story, acc) {
  const r = await llmJson(env,
    `你是AVG剧情图谱生成器。${JSON_ONLY}`,
    `为这本小说生成20±4个剧情节点。节点：{id:"n0"起,chapter:1-4,who(角色id或narrator),text(≤110字，台词优先引用原文),set:{属性:±1}(仅关键节点),choices(仅在keyMoment节点,2-3个:{text≤18字,requires如"属性>=4"可空,set:{属性:±1或±2},goto})或goto,keyMoment(全篇4个,每章≤2),canon:true}\n规则：start=n0；线性主干+每个keyMoment分叉后汇合；保证4条章节每章≥3节点；结局不写，最后一个节点id为n_gate且无goto。\n章节摘要：${JSON.stringify(acc.chapterSummaries)}\n原文开头：${story.content.slice(0, 1800)}`);
  const nodes = (r.nodes || []);
  const attrs = acc.player.attributes.map((a) => a.key);
  for (const n of nodes) { // 属性白名单清洗
    for (const s of [n.set, ...(n.choices || []).map((c) => c.set)]) {
      if (s) for (const k of Object.keys(s)) if (!attrs.includes(k)) delete s[k];
    }
  }
  return { graph: { start: 'n0', nodes } };
}

async function stageEndings(env, story, acc) {
  const r = await llmJson(env,
    `你是多结局设计师。${JSON_ONLY}`,
    `为剧情图谱设计6个结局，family必须从["原作","改命","死亡","隐藏"]选（死亡族1个condition写"某属性<1"且该属性有deathBelow；隐藏族1个rarity≤0.1需要EVT?[节点id]条件；无条件兜底1个放最后）。每个：{id:"end_xx",family,title(≤8字),tone(风格),condition(条件DSL,如"威望>=6 & EVT?[n5]"，可为空字符串),epilogue(结局文本60-120字),rarity:0-1}\n可用属性：${acc.player.attributes.map((a) => a.key).join('、')}。节点里存在keyMoment分叉。`);
  const fams = new Set((r.endings || []).map((e) => e.family));
  return { endings: (r.endings || []).slice(0, 7), familiesOk: fams.has('死亡') && fams.has('隐藏') };
}

export function assembleNovel(story, acc) {
  return {
    meta: {
      id: `forge_${story.work_id}`,
      title: story.title,
      author: story.author || '盐言故事',
      source: 'zhihu_yanyan',
      intro: acc.intro,
      chapters_covered: acc.chapterSummaries.map((c) => c.chapter),
      ai_disclaimer: true,
      rating_hint: 'general',
      generated_at: new Date().toISOString(),
    },
    canon_rules: acc.canon_rules,
    lorebook: acc.lorebook,
    characters: acc.characters,
    player: acc.player,
    graph: acc.graph,
    endings: acc.endings,
    presentation: {
      ui_style: 'classic-vn',
      bubble_theme: 'light',
      narration_rules: '旁白用叙述体，台词优先引用原文；节点≤120字',
      mind_reading: true,
      npc_pool: [],
    },
  };
}

// 轻量校验：forged 数据至少要能玩
export function sanityCheck(novel) {
  const ids = new Set(novel.graph.nodes.map((n) => n.id));
  const problems = [];
  if (novel.graph.nodes.length < 10) problems.push('节点过少');
  if (!ids.has(novel.graph.start)) problems.push('start 缺失');
  for (const n of novel.graph.nodes) {
    if (n.goto && !ids.has(n.goto)) delete n.goto;
    for (const c of n.choices || []) {
      if (c.goto && !ids.has(c.goto)) c.goto = n.goto || null;
      if (!c.goto) c.text = c.text || '……';
    }
  }
  const attrSet = new Set(novel.player.attributes.map((a) => a.key));
  for (const e of novel.endings || []) {
    const names = [...(e.condition || '').matchAll(/[\u4e00-\u9fffA-Za-z_][\u4e00-\u9fffA-Za-z0-9_]*/g)].map((m) => m[0]).filter((s) => !['true', 'false'].includes(s));
    if (names.some((n) => !attrSet.has(n))) e.condition = '';
  }
  if (!(novel.endings || []).some((e) => !e.condition)) {
    novel.endings.push({ id: 'end_fallback', family: '原作', condition: '', title: '故事暂告一段落', tone: '平实', epilogue: '这一世的故事，先讲到这里。', rarity: 0.4 });
  }
  return problems;
}

export { STAGES };
