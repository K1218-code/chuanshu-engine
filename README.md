# 穿书引擎（chuanshu-engine）

> 把知乎盐言故事一键变成可以"穿"进去玩的世界 —— 知乎黑客松 2026 · 跨次元游乐场参赛作品

**线上主链接**：https://chuanshu-engine.xyz （Cloudflare Workers，全功能）
**备用链接**：https://k1218-code.github.io/chuanshu-engine/ （GitHub Pages，纯静态保底）
**代码仓库**：https://github.com/K1218-code/chuanshu-engine

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
