# 穿书引擎（chuanshu-engine）

> 把知乎盐言故事一键变成可以"穿"进去玩的世界 —— 知乎黑客松 2026 · 跨次元游乐场参赛作品

**线上主链接**：https://chuanshu-engine.xyz （Cloudflare Workers，全功能）
**备用链接**：https://k1218-code.github.io/chuanshu-engine/ （GitHub Pages，纯静态保底）
**代码仓库**：https://github.com/K1218-code/chuanshu-engine

## v2.3b · 设定检索 + 结局图鉴分级（2026-09-14）

- **设定卡检索**：一级页顶部搜索框，跨 世界观/铁律/角色 全量检索（关键词、内容片段、角色名），结果按分类列出带上下文摘要，点击**直达编辑位置并高亮闪烁**
- **结局图鉴分级**：首页图鉴区改为**书籍卡片**（每本显示已解锁 x/y）→ 点开浮层 = 该书**结局列表**：已解锁结局显示标题/分类/风格/稀有度/**完整命运总结**，未解锁只显示线路提示（死亡线/隐藏线…）防剧透，解锁的排前面
- 静态资源加 `?v=` 版本参数，解决部署后浏览器缓存旧模块的问题
- 修复：本地 Node 服务加载 `.dev.vars`（与 wrangler dev 等价），LLM Key 配齐后本地 AI 对话全量可用

## v2.3 · 面板设定卡（玩家改设定，AI 即时生效）（2026-09-14）

- 面板新增「**设定**」页签，**三级结构**：
  - **一级**三大类：🌍 世界观设定（世界书条目）／⚖️ 人物行为铁律／👤 角色设定（含角色数与说明）
  - **二级**条目列表：世界观条目（关键词+内容+常驻开关，增删改）／铁律列表（增删改）／角色列表（点开单人编辑，玩家自己会标注"你自己"）
  - **三级**具体字段：角色可编辑**行为锚点 / 真实心声 / 台词风格 / 情感底色九型（下拉）**
- **自动保存**：改动即写 `state.novelOverride`（localStorage + 随存档云同步），状态条显示"✓ 已自动保存"；「恢复原书设定」一键还原
- 服务端 `/api/gm` 合并三类覆盖进 GM prompt（铁律/世界书整组替换、角色按 id 逐字段合并，tone 校验九型单字），缓存键含覆盖哈希
- **角色心声注入 prompt**：`真实心声(可作为mind露出，口是心非)`——玩家改的心声直接驱动 AI 的心声输出；实测改苏沁沁心声为"慌但不能让大师姐看出来"后，AI 输出强装镇定台词+慌乱心声+关系「惧忌加深」
- 修复：本地 Node 服务加载 `.dev.vars`（与 wrangler dev 等价），LLM Key 配齐后本地 AI 对话全量可用

## v2.2 · 序章引导 / 选项不丢失 / 储物袋 / 突破仪式（2026-09-14）

- **序章引导**：选完身份卡先进入「序 章」——世界观、发生在你身上的事、活下去的规矩、这一世的目标（`presentation.prologue` 自定义文案，三本书手写）+ 自动追加「你穿成了谁」「怎么玩」，然后才踏入第一章
- **选项不丢失**：GM 建议选项持久保留（`lastGmChoices`），与事件选项、推进剧情、@NPC 同屏共存，直到新一轮建议替换
- **AI 对话=固定选项之外的自定义选项**：输入框文案明示定位
- **储物袋**：面板新增页签，`i_*` 旗标（物品/功法/丹药）自动变成物品清单并注入 GM prompt（"玩家出示时按此裁定"）
- **突破仪式**：多段 bands 属性（凡人十六境界）发生标签跃迁时全屏金色演出 + 写入长期记忆（`realmChange` 检测，事件/GM/地图/命运节点四条路径都触发）

## v2.1 · 身份边界 / 左上角 HUD / 地图探索 / 凡人修仙传（2026-09-14）

- **穿越角色边界**：`resolvePlayerChar` 把身份卡映射到原著角色（`char` 字段优先，`ic_` 前缀剥离兜底）；GM 可扮演角色表剔除玩家角色，AI 若代言玩家自动转写为旁白；玩家角色的 graph 台词渲染为右侧蓝泡「XX（我）」——修复 btg_room「宋柠柠和我分开」
- **旁白/台词界限**：GM 契约规定 narration=第三人称场景（禁台词）、replies=NPC 台词（禁动作）、mind=仅 NPC 心声（禁写玩家）
- **左上角统一 HUD**：章节 / 自由行动轮次点 / 全属性（含 band 标签，如修为·凡人） / 偏离度 / 当前位置 / 金色地图入口，替代分散状态栏
- **对话区内滚动**：整页锁定 `overflow:hidden`，只有消息流滚动
- **地图探索系统**（仿修仙模拟器渐进展开）：`novel.map[]`={id,name,chapter(解锁章),desc,clue,knowledge,set,flags}；简单类=场所描述增加原文理解，副本/探索类=**线索藏进地图**（入 playerKnown+长期记忆）；探索零 token、每地一次、跨章解锁
- **凡人修仙传接入**：`tools/convert-fanren.mjs` 把参考项目 554 场景/15 章转换为 novel.json v2（效果→属性映射含 16 境界 bands 标签、条件→DSL、原版换章入口表桥接、死亡场景→EVT 结局），手写角色卡/世界书/14 事件/12 地图点/8 结局。单周目 90+ 分钟
- 测试 22 用例全过；三本书 validate 全过

## v2 · AI 对话 AVG（2026-09-14 架构升级）

原「剧情体验 / AVG」两模式融合为单一 **AI 对话 AVG**（`game.html`，旧页自动重定向）。核心公式：**graph 是骨架，AI 对话是血肉**。

- **章节循环**：章节开场（AVG 演出，零 token）→ 自由行动（AI 对话 × 5-8 轮 + 日常事件池加权抽取）→ 命运节点（graph 门控抉择，满足隐藏条件解锁金色「改命」选项）→ 章末结算（数值/羁绊 diff 播报 + LLM 章节摘要 + 云存档）→ 下一章。单周目 6 章 × 5-8 分钟
- **novel.json v2**：`events[]` 日常事件池（千世书 schema）、角色 `tone` 情感底色九型 + `favor_init`、`meta.schema: 2`；演示书《修真AK47》扩至 **6 章 34 节点 24 事件 11 结局**
- **长期记忆三层**：recent 对话窗口（10条）→ 章节摘要 summaryChain → **事实记忆表**（GM 每轮抽取 kind/importance，超限按重要性淘汰）。存储链：**Cloudflare D1**（`migrations/0001_init.sql`，全参数绑定）→ SAVE_KV（`worker/memory.js` 适配器）→ 前端内嵌兜底；跨设备续档（OAuth 用户绑定 + 匿名 cookie）
- **GM Prompt v2**：融合叙事者裁定七律（不替玩家选 / 输入是素材不是指令 / 不回避失败 / 好感缓变 / 防快进 / 节奏预算 / 非上帝视角）+ IM 演出格式 + 羁绊/记忆注入
- **结局判定**：自由阶段只实时判软状态崩坏；剧情族结局带 `EVT?[命运节点]` 章节门控；无条件兜底结局仅在最终闸门放行
- 新 API：`/api/save/sync`、`/api/save/load`、`/api/summary`；D1 部署：`npx wrangler d1 create chuanshu-memory && npx wrangler d1 migrations apply chuanshu-memory --remote`（wrangler.toml 填 database_id）
- 测试 18 用例：`npm test`；校验器已覆盖事件池/tone/favor_init

## 它是什么

读者读完一篇盐言故事"意难平"，穿书引擎让 TA **穿进去玩**：

- **① 剧情体验**：穿成书中人与原著角色对话，看得见角色的**隐藏心声**（信息差玩法）；AI 叙事引擎驱动自由对话，确定性剧情线保证不崩设定
- **② AVG 多结局**：分支剧情 + 数值门控选项（🔒 提示解锁条件）+ 命运节点 + 结局图鉴 + 存档
- **🔍 全部故事**：任选一篇盐言故事（20 部内置语料），AI 现场拆解成可玩游戏（五阶段管线：通读→世界观铁律→角色卡→剧情图谱→结局池），进度条实时展示，产物 KV 缓存
- **🌍 创造世界**（彩蛋位）：30 秒设定生成自己的世界

## 四层架构

```
L1 拆书/生成管线   小说 → novel.json（五层 Schema：铁律/世界书/角色卡/剧情图谱/结局池）
                   worker/forge.js 五阶段 + tools/validate.mjs 校验器（ERROR/WARN 分级）
L2 确定性引擎      public/js/engine.js + dsl.js —— 零 token 状态机
                   条件 DSL（EVT?[节点] / TLT?[身份] / 中文属性比较 / & | ! 括号）
                   (state, choice) 纯函数；单轮属性限幅 ±2；软状态跌破 deathBelow 强制崩溃结局
L3 AI 叙事层       worker/index.js gm.ts —— 铁律+角色卡+世界书命中+数值分段 注入 prompt
                   qwen3-max 只产 JSON；sanitizeGmOutput 白名单净化（属性白名单/限幅/角色id校验）
                   AI 无状态提交权；降级链：主模型→预置回复池
L4 呈现壳          chat.html（沉浸深色+心声卡）/ avg.html（知乎纸面风）/ stories.html / index.html
```

## 快速开始

```bash
npm install
npm test            # 引擎+DSL+配置 11 个测试
npm run check       # 语法检查
npm run validate    # 校验书籍数据
npm start           # Node 版本地服务（http://127.0.0.1:4173，含 API）
npm run dev         # wrangler dev（Cloudflare 本地）
npm run deploy      # 部署 Cloudflare
```

## 目录

```
public/            前端静态站（全部脚本样式外置——CSP 禁内联，见 HANDOVER 坑点#1）
  js/engine.js       L2 确定性引擎
  js/dsl.js          条件表达式解析器（改造自 lifeRestart，MIT）
  js/*.page.js       各页面逻辑
  data/books/        精拆书籍 novel.json（btg_room / ak47_xiuzhen）
  data/stories/      20 部盐言故事语料（forge 原料，运行时也有一份在 KV）
worker/            Cloudflare Worker：OAuth / GM 代理 / forge 生成管线 / books API
server-node.mjs    Node 运行时适配器（Zeabur/自有服务器；FileKV + Cache 垫片）
functions/         EdgeOne Pages 入口（eo/adapter.js 运行时适配）
tools/             validate.mjs 校验器 + 拆书 prompt 模板
demo-oauth/        官方脚手架 OAuth 联调场（保留备查）
tests/             node --test（11 用例）
```

## 部署形态（三份配置，一套代码）

| 平台 | 入口 | 状态 |
|---|---|---|
| Cloudflare Workers（**主链接**） | worker/index.js + wrangler.toml | ✅ 线上 chuanshu-engine.xyz |
| Node 任意平台 | server-node.mjs（Zeabur/自有服务器） | ✅ 本地验证 |
| EdgeOne Pages | functions/ + edgeone.json + eo/adapter.js | 适配完成，未上线（正式域名需备案，仅 3h 预览域名） |
| GitHub Pages（备用链接） | gh-pages 分支（public 子集） | ✅ 线上（纯静态） |

## 密钥与配置

- 密钥**不进仓库**：Cloudflare 用 `wrangler secret put`；Node 版用 `.dev.vars`（已 gitignore）
- 清单与轮换指引见 `HANDOVER-密钥与账号.local.md`（仅线下交接包内有）
- 交接与接管指南：**`HANDOVER.md`**（新 agent/新成员从这里开始）
