@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 穿书引擎 git 提交 ===
git add -A
git commit -m "feat: 用户数据体系+登录双入口+新手指南+造世界放宽+第四本书上线" -m "- 用户数据体系: 匿名24h过期(expires_at滚动续期)+登录永久+OAuth登录迁移+Cron每小时清理过期档(migration 0003)" -m "- 登录双入口: 知乎登录(真实OAuth原样保留)+演示登录(/auth/demo/login,OAUTH_MOCK开关), 退出端点/auth/logout" -m "- 新手指南: 首页hero常驻入口+首次访问自动弹出一次(cs_guide_seen留存)+四步玩法说明" -m "- SPA路由修复: not_found_handling=none(SPA fallback吞掉/auth/*页面级302导致登录跳转失效的根因)+裸路径重定向兜底" -m "- 造世界: 设定放宽50000字, TYPE_GENRE题材映射, S1创作分支+书名生成, 限流3次/天, S3身份卡char绑定" -m "- server-node: worker默认导出{fetch,scheduled}兼容+env补OAUTH_MOCK+API/静态分流修复" -m "- 第四本书《被无情道小师弟倒追了》上线: 修仙言情romance主题, 115节点/5章/6结局/20事件validate全绿" -m "- 测试: 45/45(新增用户数据体系6用例)"
echo.
echo === 提交结果 ===
git log --oneline -1
echo.
pause
