# 穿书引擎

> 把知乎盐言故事一键变成可以"穿"进去玩的世界 —— 知乎黑客松 2026 · 跨次元游乐场

读完一篇故事意难平？穿书引擎让你**穿进去玩**：

- **① 剧情体验**：穿成书中人，与原著角色对话，看得见他们的隐藏心声
- **② AVG 多结局**：分支剧情，选择导向不同结局，生成可分享的命运报告
- **🌍 创造世界**：30 秒设定，AI 现场拆解出一个属于你的世界
- **🔍 全部故事**：任选一本盐言故事，AI 现场拆解成游戏

## 架构（四层）

```
L1 拆书管线   小说/设定 → novel.json（五层 Schema + 校验器）
L2 确定性引擎  状态机 + 条件DSL + 结局判定（零 token，(state,choice) 纯函数）
L3 AI 叙事层  世界书注入 + 摘要记忆 + state_patch 白名单合并（LLM 无状态提交权）
L4 呈现壳     聊天壳 / AVG 壳 / 造世界向导
```

- 前端：原生 ES modules 多页（无框架无构建），知乎设计语言
- 后端：Cloudflare Workers + Hono（静态 Assets 同域 + API + 知乎 OAuth）
- 数据：`public/data/books/*.json`（拆书产物，`tools/validate.mjs` 校验）

## 快速开始

```bash
npm install
npm test           # 引擎 + DSL + 配置测试
npm run check      # 语法检查
npm run validate   # 校验书籍数据
npm start          # 本地静态预览（端口 4173；OAuth 需公网回调，见 demo-oauth/）
npm run dev        # wrangler dev（需先建 KV，见 wrangler.toml）
```

## 目录

```
public/      前端静态站（首页 / avg / chat / create + js 引擎 + 书籍数据）
worker/      Cloudflare Worker（OAuth / GM 代理 / 造世界）
tools/       拆书管线与校验器
tests/       node --test
demo-oauth/  官方脚手架 OAuth 联调场（保留备查）
.codex/      项目级官方 zhihu skill（随包安装）
```

## OAuth 说明（zhihu-hackathon 脚手架保留条款）

- 本地地址只能预览页面，真实知乎登录需先部署到 Cloudflare 等平台并配置公网回调，再运行官方 Skill 的 `configure_callback.mjs`；授权确认必须由用户本人完成。
- 部署时 `ZHIHU_OAUTH_APP_KEY` 等密钥使用平台 Secret 配置，不进代码包。
- Windows 本地开发：app_key 放 `.dev.vars`（已 gitignore），经环境变量注入。

## 声明

互动内容由 AI 基于知乎盐言故事（黑客松授权内容）改编生成，仅供比赛演示。盐选故事与刘看山形象仅限比赛期间使用。
