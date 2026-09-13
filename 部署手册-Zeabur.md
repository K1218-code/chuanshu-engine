# 部署手册 · Zeabur 版（主链接方案，国内可达）

> 背景：workers.dev 在国内（校园网+手机热点）均被阻断，不可作为提交链接。
> Zeabur 的 *.zeabur.app 域名国内一般可直达，且支持完整 Node 后端（OAuth/AI/现场生成全保留）。

## 一、注册并部署（约 5 分钟）

1. 打开 https://zeabur.com （打不开就开代理或切手机热点）
2. 点 **Sign in with GitHub**，用你的 GitHub 账号授权（此时需要仓库已推送最新代码）
3. **Create Project**（区域选 Hong Kong 或亚洲就近）
4. **Add Service → Git →** 选择 `chuanshu-engine` 仓库，分支 `main`
5. Zeabur 自动识别 Node 项目：安装依赖后执行 `npm start`（= `node server-node.mjs`，端口自动适配）
6. **Networking →** 为服务生成域名（形如 `xxx.zeabur.app`）

## 二、环境变量（Service → Variables）

| 变量 | 值 |
|---|---|
| `ZHIHU_OAUTH_APP_ID` | `442` |
| `ZHIHU_OAUTH_APP_KEY` | （.dev.vars 里的值） |
| `ZHIHU_OAUTH_REDIRECT_URI` | `https://<你的zeabur域名>/auth/callback` |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | （可选，配了才有 AI 对话/现场生成） |

## 三、验收

- 手机流量打开 `https://<域名>/`：两本书可玩
- 点知乎登录能跳授权页 → **把 `https://<域名>/auth/callback` 登记到黑客松赛事页**（这才是最终回调）
- 该域名同时作为**项目提交的主链接**

## 备用：GitHub Pages（纯静态保底）

代码已全站相对路径化，支持子路径部署。本地执行（需 github 可达）：

```bash
git subtree split --prefix=public -b gh-pages   # 或手工建分支
git push origin gh-pages
# 仓库 Settings → Pages → Branch 选 gh-pages → Save
# 地址形如 https://k1218-code.github.io/chuanshu-engine/
```

注意：Pages 版无 OAuth/AI（登录按钮会提示"随部署开放"），只作应急备用链接。
