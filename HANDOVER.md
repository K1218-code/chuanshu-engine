# HANDOVER · 新 Agent 接管指南
> 更新：2026-09-14 凌晨 · 移交对象：下一个接管本项目的 AI agent 或开发者
> 阅读顺序：本文 → README.md → 技术文档-v1.md（技术事实源）→ 开发计划.md（进度）

## 0. 一分钟现状

- **产品**：「穿书引擎」——盐言故事 → 可玩的穿书世界（剧情对话 + AVG 多结局 + 选书现场生成）。知乎黑客松 2026「跨次元游乐场」参赛作品。
- **线上**：主链接 https://chuanshu-engine.xyz （Cloudflare Workers + 自有域名，全功能在线：两本精拆书、任选故事 AI 现场生成、知乎 OAuth 登录）。备用：GitHub Pages 纯静态。
- **截止**：9/15（周二）10:00 提交；9/17 入围公布；9/19 决赛路演（3 分钟 Demo + 2 分钟 Q&A）。
- **已提交**：项目广场提交状态待用户确认；OAuth 回调是否已登记赛事页待用户确认。

## 1. 立即待办（按优先级）

| # | 任务 | 说明 | 谁做 |
|---|---|---|---|
| 1 | 赛事页登记 OAuth 回调 | `https://chuanshu-engine.xyz/auth/callback`（一字不差） | 用户 |
| 2 | 项目广场提交作品 | Demo=主链接；仓库=github.com/K1218-code/chuanshu-engine；测试账号栏填"知乎真实登录无需测试账号" | 用户 |
| 3 | 产品说明计划书 | 初审重点（AI 场景价值 40%+创新 25%）。素材全在 D:\知乎黑客松\research\ 与本文档 | Agent 写初稿 |
| 4 | 手机流量实测主链接 | 用户手机曾不通 workers.dev；chuanshu-engine.xyz 是新域名需复测 | 用户 |
| 5 | 演示视频（加分） | 脚本见 开发计划.md 演示主线 | Agent 可录屏辅助 |
| 6 | 2 小时提醒/AI 标识合规巡检 | chat/avg 页脚已有 AI 标识；2h 提醒组件尚未实现（P0-10 遗留） | Agent |

## 2. 关键文件地图

| 文件 | 作用 |
|---|---|
| `技术文档-v1.md`（D:\知乎黑客松\） | **技术事实源**：Schema/DSL 文法/GM 契约/路由/部署全在这里。改代码先对文档 |
| `chuanshu-engine/public/js/engine.js` | L2 引擎：createState/applyChoice(纯函数±2限幅)/checkEnding/applyPatch |
| `chuanshu-engine/public/js/dsl.js` | 条件 DSL（`EVT?[n5] & 清醒>=2`），改造自 lifeRestart condition.js |
| `chuanshu-engine/public/data/books/*.json` | 两本精拆书（五层 Schema 范例，validate 零错误） |
| `chuanshu-engine/worker/index.js` | 全部 API：OAuth/GM/forge/books。**fetch 目标必须字面量**（Mimosa 红线，见坑点#4） |
| `chuanshu-engine/worker/forge.js` | 选书生成 S1-S5 五阶段 + advanceJob 后台推进 + sanityCheck + 结局合成器 |
| `chuanshu-engine/tools/validate.mjs` | novel.json 校验器（新书写完必跑，ERROR=0 才能上） |
| `chuanshu-engine/tests/engine.test.mjs` | 引擎 9 用例（改引擎必跑） |

## 3. 常改常新场景怎么做

- **加一本书**：story-cache 或 /api/forge 生成 → 手工按五层 Schema 精修（台词用原文）→ `node tools/validate.mjs <file>` 零错误 → 加进 `public/data/books.index.json`（含 endings 数量，图鉴按它渲染）→ 静态书记得 KV 种子 `book:{id}`（`wrangler kv key put "book:{id}" --path file --binding SAVE_KV --remote`）
- **调 GM 人格**：改 `worker/index.js gmSystemPrompt()`（铁律/角色卡/演出规格都在里面拼装）；输出规范改 `sanitizeGmOutput()`
- **改 OAuth**：回调地址在 wrangler.toml `ZHIHU_OAUTH_REDIRECT_URI`（与赛事页登记值逐字符一致）；协议细节在本文档 §5

## 4. 坑点清单（全部踩过，勿重蹈）

1. **CSP 禁内联**：server/Worker 的 CSP 是 `script-src 'self'`——HTML 里不能有内联 script/style/onclick，全部外置 `.page.js`/`.css`，事件用 addEventListener
2. **`[hidden]` 被 display:flex 覆盖**：tokens.css 必须有 `[hidden]{display:none!important}`
3. **Mimosa（安全钩子）**：任何「非字面量 URL 的 fetch」= 高危拦截（SSRF）。最终解法：静态书 fetch 字面量逐点写、动态数据全走 KV（零动态 fetch）。Bash 里 `echo > 源文件` 也会被拦，一律用 Write/Edit
4. **Worker 内 fetch 自己域名**：被环回保护静默失败（返回 null 不报错）——进程内读数据用 ASSETS/KV 绑定，不发自请求
5. **ASSETS.fetch 假主机名**：`https://assets.internal/...` 本地 wrangler dev 能跑，生产静默失败——静态书要么字面量真域名，要么进 KV
6. **wrangler secret put 与 [vars] 重名**：报 "Binding name already in use"——先从 wrangler.toml 删同名 var
7. **KV 最终一致**：连续读写 job 可能读到旧值（stage 回退假象）；写后立刻读自己用同一 edge 通常没问题
8. **wrangler OAuth token 约 1h 过期**：API 直调报 9109 Invalid access token——跑任意 wrangler 命令自动刷新
9. **Windows 专项**：Git Bash `pkill` 杀不掉 node（用 netstat -ano 找 PID + `taskkill //F //PID`）；`wrangler subdomain`/`login` 偶发 libuv assert 崩溃（重试或走 CF API）；Hono `c.executionCtx` 只读，用 `Object.defineProperty(c,'executionCtx',{value})` 注入
10. **EdgeOne Pages**：新项目只给 3 小时预览域名，正式域名要 ICP 备案——本赛期放弃上线，functions/ 适配保留

## 5. 线上环境速查

| 项 | 值 |
|---|---|
| Cloudflare 账号 | Vb73228215xifug@163.com（Account ID ed457563197b486adc1914d15cd7378e） |
| Worker 名 | chuanshu-engine（domain: chuanshu-engine.xyz，zone 94befc0b…已 active） |
| KV | SESSION_KV=f7304fb341c04f75a7fa10b8f74b3029 / SAVE_KV=d9a081dc65544cc6b048be41ae5e05da |
| Secrets | ZHIHU_OAUTH_APP_KEY、LLM_API_KEY（`wrangler secret list` 验证） |
| Vars | ZHIHU_OAUTH_APP_ID=442、ZHIHU_OAUTH_REDIRECT_URI=https://chuanshu-engine.xyz/auth/callback、LLM_BASE_URL=https://api.openai-next.com/v1、LLM_MODEL=qwen3-max |
| 知乎 OAuth | App ID 442；授权 openapi.zhihu.com/authorize；**回调参数名是 authorization_code**（换 token 时才叫 code）；token 端点 POST openapi.zhihu.com/access_token |
| GitHub | K1218-code（gh CLI 已登录）；Pages=gh-pages 分支 |

## 6. QA 验收清单（交付/改版后必跑）

- [ ] `/api/health` 200
- [ ] 首页两本书卡片渲染、结局图鉴计数正确
- [ ] AVG：身份选择→通关→结局页→图鉴+1→↺重开正常
- [ ] chat：剧情推进→心声卡出现→命运节点选项→自由输入（有 Key 时非降级）
- [ ] stories：列表 20 部→生成一本→进度条→进入可玩
- [ ] OAuth：登录跳知乎→授权→回跳显示昵称（需在非受限网络）
- [ ] `npm test` 11/11、`npm run validate` 双书 ok

## 7. 已知债务（赛后处理）

- 2h 提醒组件未实现（合规四件套缺一）
- chat 摘要链章节级摘要未接（summaryChain.chapter 静态为空，不影响当前体验）
- EdgeOne functions/ 适配未实战验证
- LLM Key 与 OAuth AppKey 在开发过程中暴露于对话——**赛后立即作废重建**（见密钥交接文件轮换指引）
