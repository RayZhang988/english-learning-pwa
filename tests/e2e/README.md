# 09｜发布冒烟说明

`release-smoke.mjs` 不启动浏览器，也不要求新增 npm 依赖。

本地生产产物：

```bash
pnpm build
node tests/e2e/release-smoke.mjs
```

正式站 HTTP 冒烟（网络可用的 CI 或终端）：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/release-smoke.mjs
```

本脚本验证首页引用、Manifest、安装图标、Service Worker 及六个课程 JSON
预缓存关系。它不能替代真实浏览器的 Service Worker 生命周期、离线重载或 iPhone
主屏幕安装。

## Chrome DevTools 黑盒验收

这些脚本不依赖 Playwright npm 包，直接启动本机 Chrome 并通过 DevTools Protocol
控制临时浏览器数据目录：

```bash
node tests/e2e/platform-offline-accessibility.mjs
node tests/e2e/assessment-recovery-smoke.mjs
node tests/e2e/assessment-permission-denial.mjs
node tests/e2e/assessment-recording-fallback.mjs
node tests/e2e/browser-acceptance.mjs
```

`browser-acceptance.mjs` 覆盖全新数据、约 17 分钟正式评估、真实 `AbilityProfile`、
2700 秒首日计划、真实 `taskId`、口语录音、听力 7/7、词汇 6/6、生产事件和刷新
恢复。脚本会明确断言口语不可评分回放结束后计划推进、三项任务完成和刷新恢复；
失败不能改成跳过来制造通过。

正式站强制口语 fallback 全链路回归：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

`20c373d` 在 GitHub Pages run `30141142971` 部署后，上述命令 exit 0：
`completedTaskCount: 3`、计划 completed、听力/词汇正常完成且刷新恢复通过。

## R1 正式黑盒

当前活动需求 R1 使用独立脚本，不复用旧 v1 综合评估路径：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/r1-browser-acceptance.mjs
```

脚本使用隔离的临时 Chrome 数据目录，覆盖全新 R1 入口、5×30 抽样、改选/不确定/
导航/提交锁定、混合分数完整 150 题、v1/v2 保留迁移、损坏记录备份、刷新/离线/SW
更新恢复、schema 3 档案和首日保守计划。脚本不会清理日常浏览器中的用户数据。

这些 Chrome 结果不能替代真实 iPhone Safari、主屏幕安装、系统权限、VoiceOver、
后台回收和连续 14 天使用。
