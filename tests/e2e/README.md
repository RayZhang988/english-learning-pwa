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
```

`browser-acceptance.mjs` 保留为 R1 以前的旧 v1 综合链路和 QA-006/QA-007 历史
回归证据；它包含当时固定任务顺序的断言，不代表当前 R2，不应拿它替代下面的 R1/R2
正式脚本。

正式站强制口语 fallback 全链路回归：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

`20c373d` 在 GitHub Pages run `30141142971` 部署后，上述命令 exit 0：
`completedTaskCount: 3`、计划 completed、听力/词汇正常完成且刷新恢复通过。

## R1 正式黑盒

已关闭需求 R1 使用独立脚本，不复用旧 v1 综合评估路径：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/r1-browser-acceptance.mjs
```

脚本使用隔离的临时 Chrome 数据目录，覆盖全新 R1 入口、5×30 抽样、改选/不确定/
导航/提交锁定、未答下一题、部分阶段提交、剩余全部不会的取消/确认与防重复、混合分数
完整 150 题、旧 schema 3 与 v1/v2 保留兼容、损坏记录备份、刷新/离线/SW 更新恢复、
schema 3 档案和首日保守计划。脚本不会清理日常浏览器中的用户数据。

这些 Chrome 结果不能替代真实 iPhone Safari、主屏幕安装、系统权限、VoiceOver、
后台回收和连续 14 天使用。

## R2 正式黑盒

当前活动需求 R2 使用独立隔离脚本：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/r2-browser-acceptance.mjs
```

脚本核对 Pages run `30254660989`、正式资产 `index-CgCA6fnf.js`，从正式 R1 链路生成
schema 3 档案与 schema 1 active plan，再在独立临时 Chrome profile 中验证“今天”和
“训练”的三个真实 taskId、三个首项入口、全部六种完成顺序、18 次逐项刷新、快速重复
操作、暂停推荐不锁定、旧 schema 1 派生、缺失/损坏/完成 taskId 拒绝，以及 320/390px
无横向溢出。脚本不会读取或清除日常浏览器数据。

该结果不能替代用户在真实 iPhone Safari/主屏幕 Web App 对三个入口触摸自由选择的
确认。

## R3 正式时长回归

R3 当前先用独立脚本阻断旧 900 秒重新包装为“内容估算”：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_R3_EXPECTED_ASSET=index-Cm31haDv.js \
QA_R3_PAGES_RUN=30330487187 \
  node tests/e2e/r3-duration-baseline-regression.mjs
```

正式运行时，脚本核对 Pages run `30330487187`、正式资产 `index-Cm31haDv.js`，再用
隔离临时 Chrome profile 从正式 R1 生成 schema 3 档案和真实首日计划。它同时读取
Today、Training 和 IndexedDB，要求三个生产任务携带 `structured-content` 基线，
不得全部回退为 900 秒或约 15 分钟，并点击真实词汇 task 检查 6 题 Route。最后核对
SW 已接管且隔离 profile 只缓存当前 index 资产。

本地候选可这样运行：

```bash
pnpm build
pnpm preview --host 127.0.0.1

QA_BASE_URL=http://127.0.0.1:4173/ \
  node tests/e2e/r3-duration-baseline-regression.mjs
```

当前正式候选与本地候选均完整通过：目标 2700 秒、实际计划 515 秒，词汇/听力/口语为
`123/211/181` 秒，Today/Training taskId 与估算一致；真实词汇 Route 显示
“已完成 0 / 6”和生产题面，不再出现不可评分错误。QA-009/010 已关闭；真实 iPhone
锁屏、后台、媒体和主屏幕缓存更新仍需用户验收。

QA-014 使用用户等价的无预算旧计划，在同一浏览器实例中推进24小时并触发前台恢复，
验证计划自动跨日且三个模块都升级为900秒预算：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_EXPECTED_ASSET=index-ByLSTdMG.js \
QA_PAGES_RUN=30414938099 \
QA_EXPECTED_HEAD_SHA=3cf373ec1cbf847077fbbd9ff60efba928725ea5 \
QA_ROLLOVER_ONLY=1 \
  node tests/e2e/qa-013-legacy-plan-portability.mjs
```

该正式回归不会读取或清除用户设备数据，且必须观察到旧计划日期变化、三项
`targetEffectiveSeconds=900` 和初始化后的 `running` 预算状态。

同日旧计划升级使用最新正式资产运行：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_EXPECTED_ASSET=index-BW16H4eG.js \
QA_PAGES_RUN=30415214326 \
QA_EXPECTED_HEAD_SHA=46091ea48c37e3fe814e6e0f8aa11b5229b08ef3 \
QA_SAME_DAY_UPGRADE_ONLY=1 \
  node tests/e2e/qa-013-legacy-plan-portability.mjs
```

它必须保留完成单元历史，在相同本地日期生成新的计划ID，并把三个模块全部升级为
900秒running预算。
