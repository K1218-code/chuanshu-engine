# 部署手册 · EdgeOne Pages 版（主链接 · 免费 · 国内可达）

> 腾讯 EdgeOne Pages：免费、边缘函数全功能（OAuth/AI/现场生成）、默认域名国内可访问。
> 代码已适配完毕：`functions/` 目录（路由入口）+ `eo/adapter.js`（运行时适配）+ `edgeone.json`（输出目录 public）。

## 一、注册并创建项目（约 5-8 分钟）

1. 打开 https://console.cloud.tencent.com 用**微信扫码**注册/登录，按提示完成**学生身份证实名**
2. 控制台搜索 **EdgeOne Pages**（或直达 https://console.cloud.tencent.com/edgeone/pages ）
3. **创建项目 → 导入 Git 仓库** → 授权 GitHub → 选 `chuanshu-engine` 仓库，分支 `main`
4. 构建设置（一般会自动读取仓库里的 edgeone.json，确认即可）：
   - 构建命令：**留空**
   - 输出目录：**public**
5. 部署完成后得到默认域名（形如 `xxx.edgeone.app`）

## 二、KV 与环境变量（项目设置里）

1. **KV 存储**：创建两个命名空间，绑定名分别叫 **`SESSION_KV`** 和 **`SAVE_KV`**（名字必须一致，代码按全局变量读）
2. **环境变量**：

| 变量 | 值 |
|---|---|
| `ZHIHU_OAUTH_APP_ID` | `442` |
| `ZHIHU_OAUTH_APP_KEY` | （.dev.vars 里的值） |
| `ZHIHU_OAUTH_REDIRECT_URI` | `https://<你的edgeone域名>/auth/callback` |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | （可选） |

3. 改完**重新部署**一次使配置生效

## 三、验收（发我域名，我来跑）

- `https://<域名>/api/health` 返回 `{"ok":true}`
- 手机流量打开首页：两本书可玩
- 「全部故事」选一本生成（需配 LLM Key）
- 点知乎登录 → 授权页 → 回调 → 首页右上角显示昵称
- 通过后：把 `https://<域名>/auth/callback` **登记到黑客松赛事页**，域名作为**提交主链接**

## 常见问题

- 函数 500：检查 KV 绑定名是否精确为 `SESSION_KV` / `SAVE_KV`
- OAuth 报 NOT_CONFIGURED：环境变量没生效，重新部署
- 输出目录报错：确认项目设置输出目录 = `public`（或仓库 edgeone.json 已被读取）
