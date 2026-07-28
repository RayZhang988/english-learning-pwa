# 09｜R3 训练时长真实性自动化报告（2026-07-28）

## 结论

**QA-011 与 QA-012 已在正式站关闭；新发现的 QA-013 已在 HEAD `c29c63a` 本地
修复通过，但尚未部署。R3 真机验收暂停在旧计划兼容回归，不能提前关闭。**

正式候选 head `ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8` 已由 Pages run
`30341029089` 成功部署为 `index-DuWWQrUe.js`。隔离 Chrome 从正式 R1 生成首日计划，
Today/Training 使用同一三个真实 taskId，并分别显示 15 分钟有效训练。

## QA-011/012 正式关闭（run `30341029089`）

用户在真实 iPhone 上用 12 秒完成首日 6 题词汇任务，证明“显示真实估算”并未解决
每日任务在 15 分钟目标前耗尽的问题。当前产品链已改为三模块各 900 秒有效预算、
连续内容供应和到时完成当前题后结束。09 已完成迁移与本地黑盒：

- 正式首日计划的三项 task 均携带 `targetEffectiveSeconds=900`；
- 单个词汇、听力或口语 item/attempt 完成后，task 保持 active；
- 1 秒初始有效训练加 898 秒后仍为 running/剩余 1 秒；
- 第 900 秒只进入 `finish-current-item`，当前题自然完成并发布
  `budget.completed` 后对应 task 才完成；
- 测试夹具已改为加载与生产相同的 808 候选正式索引，未再用固定 6/7/3 题目录
  冒充连续供应。

QA-012 的 08 修复 `b878965` 让完整 122 个口语候选可解析，其中包含 28 个
`speaking-scene-quiz`。原稳定失败的 first-use 生产链路现为 1/1 通过；三模块均完成
899/900 秒与自然收尾，因此 QA-012 达到本地关闭门槛。

新增 `qa-011-continuous-training.acceptance.test.ts` 以 7/7 通过证明：

- Today/Training 三项均为“15 分钟有效训练”，同一 taskId 不再显示内容估算作为完成
  条件；
- 三模块正式 provider 的 cursor/exclude 在序列化恢复后不回绕、不短期重复；
- 后台、暂停和 45 秒空闲不扣预算；899 秒继续，900 秒只进入
  `finish-current-item`；
- 三模块 `content-exhausted → retry → content.recovered → continue` 保留剩余时间、
  cursor 和排除集合；错误 recovery 被拒绝，重复 recovery 幂等；
- 听力到时不取消正在播放的系统语音，口语到时不取消正在进行的录音；媒体和答题自然
  结束后才发布 item/budget 完成事件。

正式站隔离 Chrome 使用真实 R1 档案、active plan、taskId 和正式供应索引：

- Today/Training 三卡均显示 15 分钟有效训练；
- 连续完成 6 个不同词汇 item 后，第 7 题
  `supply-v1-vocabulary-w1d1-v3-term-to-meaning-choice` 正常出现；
- vocabulary execution 保持 `active/running`，剩余 900 秒，整日计划仍
  `in-progress`；
- 刷新后仍是同一第 7 题，已完成 6 个 itemId 和排除集合不变；
- 口语真实 taskId 初始化为 `supply-v1-speaking-w1d1-s1` / `practicing`，没有
  `provider-failure`；同一正式供应索引包含 122 个口语候选及 28 个 scene 候选；
- SW 仅缓存当前 `index-DuWWQrUe.js`，课程 JSON 精确 9 个；离线 CacheStorage 可读取
  808 候选供应索引，离线刷新仍恢复词汇第 7 题；
- 首页、Manifest、SW 和资产均 HTTP 200；正式 release smoke 通过。

当前门禁：09 专项 9 文件/56 项、R3 专项 24 文件/199 项、全量 122 文件/666 项，
typecheck、lint、生产构建、84 单元、808 候选、PWA、dist smoke 和 preview smoke
全部通过。构建生成 21 项预缓存，9 个课程资源进入预缓存；lint 仅有既有的 Fast
Refresh 非阻断警告。

本轮必要专项为 11 文件/60 项通过，808 供应校验通过。QA-011 与 QA-012 已达到正式
关闭门槛。随后用户原 iPhone 旧计划暴露 QA-013；必须先部署并在不清数据的前提下
恢复听力/口语，才能继续 `iphone-checklist.md` 的锁屏、后台、真实媒体生命周期和
900 秒自然收尾。

## QA-013 本地修复验收（HEAD `c29c63a`）

用户真实 iPhone 保留 QA-011 前生成的旧计划：词汇已完成 12 秒，听力和口语没有
`trainingBudget`。进入任一模块发布事件时，仓储曾报
`value.activePlan.tasks[n].training is not JSON-portable`。

- 04 `1f847d3` 在旧任务上完全省略 `training`，不再写入 `undefined`；
- 01 `c29c63a` 使用严格 portable 仓储覆盖旧计划的 listening/speaking 生产事件链；
- 09 新增外部验收 1/1：listening 的 started→7 秒 timing→attempt、speaking 的
  started→9 秒 timing→attempt 每步均保存并用新仓储实例刷新加载；
- 每次恢复都保留词汇 `completed / scored / 12 秒` 和原 completedLearningUnitId；
- 最终三项 completed、学习引擎新增两次 attempt，原计划三项仍无 `trainingBudget`
  或 execution `training`，没有静默改造、清空或重建用户计划。
- QA-013 专项 3 文件/42 项、09 专项 10 文件/57 项、R3 专项 27 文件/203 项、全量
  123 文件/669 项通过；`pnpm check`、84 单元、808 供应、PWA 与本地 release smoke
  全部通过。

当前结论只能是“QA-013 本地修复通过，待正式站及用户原 iPhone 回归”。正式部署由
00 统一执行；09 不部署，也不得要求用户清除网站数据。

## 验收版本

- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- 04：`0900cab`
- 01 共享计时：`c3d3071`
- 06：`a514f87`
- 07：`5c27e69`
- 08：`0af7857`
- 02：`1457252`
- 01 正式集成：`9ab305a`
- QA 验收同步：`79d90b6`
- Pages run：`30330487187`，`completed / success`
- run head SHA：`79d90b67601669f050031d2ddece9f5ba64af7fa`
- 正式资产：`assets/index-Cm31haDv.js`
- QA-011 本地候选 HEAD：`b878965`
- QA-011 本地生产资产：`assets/index-DuWWQrUe.js`
- QA-012 修复：08 `b878965`
- QA-011/012 正式验收 head：`ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8`
- QA-011/012 Pages run：`30341029089`，`completed / success`
- QA-011/012 正式资产：`assets/index-DuWWQrUe.js`
- QA-013 修复：04 `1f847d3`
- QA-013 01 仓储回归 / 当前 HEAD：`c29c63a`

## QA-011/012 正式站关闭证据

- Actions API 确认 run `30341029089` 为 `completed/success`，head 精确匹配
  `ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8`。
- 正式 R3 E2E `status=passed`：R1→计划、Today/Training 三个真实 taskId、三项
  `targetEffectiveSeconds=900`、词汇第 7 题、`active/running` 与刷新恢复全部通过。
- QA-012 正式口语首题进入 `supply-v1-speaking-w1d1-s1` / `practicing`，完整供应目录
  初始化未返回 `provider-failure`；离线索引证明其中包含 122 个口语候选和 28 个
  `speaking-scene-quiz`，确定性供应专项验证 scene 引用可解析。
- Workbox 预缓存中只有当前 `index-DuWWQrUe.js`，课程 JSON 精确 9 个；离线直接读取
  供应索引得到 808 项，离线刷新继续恢复同一词汇第 7 题。
- 正式 release smoke 验证首页、Manifest、SW、资产与 4 个图标；必要专项 11 文件/
  60 项和 808 供应校验均通过。

修复链：

- 01 结构化投影：`4e49d7f`
- 05 84 单元内容基线：`b803bd1`
- 06 动态词汇时长兼容：`c86d879`
- QA 正式验收：`79d90b6`

## QA-009/010 历史正式站关闭证据

- Actions API 确认 run `30330487187` 为 `completed/success`，head 与指定
  `79d90b6` 一致。
- 首页、`manifest.webmanifest`、`sw.js` 和 `assets/index-Cm31haDv.js` 均
  HTTP 200；正式 smoke 同时验证 4 个 PWA 图标。
- 隔离 profile 没有读取或清理用户日常浏览器数据，从正式 R1 生成 schema 3
  `AbilityProfile` 和三个不同的真实 taskId。
- `targetSeconds=2700`、`plannedSeconds=515`；词汇、听力、口语分别
  `123/211/181` 秒，三项 `baselineSource=structured-content`、
  `durationBasis=content-baseline`。
- Today 与 Training 的 taskId/秒数逐项一致；推荐语义没有改变其他任务可用性。
- 正式词汇 Route 显示“已完成 0 / 6”、第一题 `hi` 和提交按钮，不含不可评分或
  identity mismatch。
- 当前 Service Worker 已接管页面；隔离 profile 的唯一 index 预缓存是
  `index-Cm31haDv.js`，未残留旧 index 资产。

## 本地候选证据

### 内容与 QA-009

`validate-duration-baselines.v1.mjs` 通过：

- 84/84 单元都有结构化基线；
- 首日词汇/听力/口语为 `123/211/181` 秒；
- 模块总计为 `4,740 / 7,238 / 5,588` 秒；
- 全课程合计 `17,566` 秒，28 天日均约 `10.5` 分钟。

每日 `targetSeconds=2700` 仍是目标；实际首日
`plannedSeconds=123+211+181=515`。现有内容不足以提供 45 分钟，不能靠虚增预计
时长制造“已填满”。

QA-009 定向自动化 2 个文件、13 项全部通过。隔离 Chrome 本地生产黑盒也证明：

| 页面 | 词汇 | 听力 | 口语 |
| --- | ---: | ---: | ---: |
| Today | 123 秒 | 211 秒 | 181 秒 |
| Training | 123 秒 | 211 秒 | 181 秒 |

两个页面使用同一三个真实 taskId，三项 `baselineSource=structured-content`、
`durationBasis=content-baseline`，计划目标 2700 秒、实际计划 515 秒。首页、Manifest、
SW 与 `index-Cm31haDv.js` 均 HTTP 200，本地 PWA 冒烟通过。

### QA-010 本地修复

失败候选曾在点击真实词汇卡后进入：

```text
本次词汇任务无法评分
Learning task ... does not match its course unit.
重新加载
```

06 `c86d879` 已把动态执行时长从静态课程身份中移除，同时保留真正的 schema、模块、
contentRef、learningUnitId、难度和 tags 校验。修复后：

- first-use 生产链路通过并完成词汇、听力、口语三模块；
- 本地真实词汇 Route 显示“已完成 0 / 6”、第一题 `hi` 和提交按钮；
- 页面不再出现“本次词汇任务无法评分”或 `does not match its course unit`；
- QA-009 的 123 秒词汇估算与旧课程 900 秒兼容字段同时保留，没有靠回退估算绕行。

## 旧正式版本证据（QA-009 历史失败）

### 正式发布

- 首页、`manifest.webmanifest`、`sw.js` 和正式资产均 HTTP 200。
- 首页引用 `assets/index-CDUEKV0C.js`。
- GitHub Actions API 确认 run `30326369853` 成功。

### 正式隔离浏览器

正式 Chrome 使用临时 profile，不读取或清除日常浏览器数据。脚本从正式 R1 入口生成：

- schema 3 `AbilityProfile`；
- schema 1 active plan；
- vocabulary、listening、speaking 三个不同生产 taskId；
- targetSeconds 与 plannedSeconds 均为 2700。

实际卡片：

| 页面 | 模块 | 文本 | 持久化秒数 |
| --- | --- | --- | ---: |
| 今天 | 词汇 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |
| 今天 | 听力 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |
| 今天 | 口语 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |
| 训练 | 词汇 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |
| 训练 | 听力 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |
| 训练 | 口语 | `预计有效练习 / 约 15 分钟 / 内容估算` | 900 |

正式证据同时说明 R2 推荐仍不锁定：三个入口均可点击，只有词汇标记“建议先做”。
这不能抵消时间标签错误。

### R3 外部验收

```text
pnpm exec vitest run tests/qa/r3-truthful-duration.acceptance.test.ts
结果：1 个文件，6 项；5 项通过，1 项失败
```

通过项：

- 1–2 个可信样本保持 `content-baseline`，第 3 个转为 `personal-history`；
- 最近 9 个可信样本使用稳健中位数，偏差门槛 ≤25%；
- active answering 计入，后台、暂停、加载、媒体加载、权限及网络等待排除；
- UI 不把每日 targetSeconds 当单项时长；
- partial 汇总只合计可信项，旧记录和缺失项不当 0。

失败项：

```text
projects released course facts into non-uniform structured duration baselines
expected candidate.durationBaseline to be defined
```

发布课程经 `projectLearningCandidates()` 投影后没有 `durationBaseline`，因此调度器只能
使用 `legacy-content-estimate=900`。这与正式浏览器的六张 15 分钟卡完全一致。

### 当前相关集成与完整门禁

```text
R3 相关集成：26 个文件、181 项全部通过
```

```text
pnpm test
Vitest：114 个文件、588 项全部通过
09 外部验收：8 个文件、49 项全部通过
```

```text
lint：通过
TypeScript：通过
生产构建：通过
课程时长校验：通过
PWA：8 个课程资源发布并预缓存，Service Worker 20 个预缓存条目
```

本地产物为 `assets/index-Cm31haDv.js`；存在既有的主 JS chunk 超过 500 kB 非阻断
警告。课程包 8 个资源全部发布并进入 PWA 预缓存，Service Worker 共 20 个预缓存条目。

`release-smoke.mjs` 原来只匹配旧 Workbox 文本 `SKIP_WAITING`，当前生成器等价输出为
`self.skipWaiting()`。09 已在测试文件内修正该兼容断言，并同时检查 `clientsClaim()`
和过期预缓存清理；本地 dist 与正式站发布冒烟均通过。这是 QA 测试维护，不是生产
功能修复；本轮正式 smoke 与浏览器缓存检查已补齐 QA-009/010 的部署证据。

## 责任与回退

- QA-009 已关闭：01 `4e49d7f` 投影课程候选，05 `b803bd1` 提供公开内容事实。
- 无需返工：02 正确显示上游值；04 的计算和个人化算法已生效；06/07/08 的计时阶段
  不是 QA-009 根因。
- QA-010 已关闭：06 `c86d879` 修正词汇课程身份校验；01 任务字段契约没有回退。
- 下一步：用户按 `iphone-checklist.md` 执行 R3 真机验收。

## 本轮未冒充通过的项目

QA-009/010 已有正式站证据并关闭，但这只证明桌面正式站、发布资源、结构化估算和
词汇入口。它不能证明 iOS 的锁屏、后台回收、真实媒体事件或主观时间体验。

真实 iPhone 的锁屏、后台、MediaRecorder、SpeechSynthesis、语音识别、主屏幕缓存更新
和主观时间合理性仍未执行。下一步应执行 `iphone-checklist.md` 的 R3 小节，不得把
本轮正式 Chrome 结果冒充真机通过。
