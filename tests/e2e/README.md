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

`browser-acceptance.mjs` 和 `lib/cdp-browser.mjs` 是并发任务留下的浏览器检查草稿。
本次临时恢复任务按明确禁令没有运行它；脚本当前只覆盖首次入口、评估介绍和第一题，
不得作为完整浏览器验收证据。
