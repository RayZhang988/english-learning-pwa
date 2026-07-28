# 09｜R3 训练时长真实性自动化报告（2026-07-28）

## 结论

**QA-009 与 QA-010 均已在本地修复通过，仍待部署后的正式站回归。**

01 `4e49d7f` 与 05 `b803bd1` 已让本地生产计划使用 `123/211/181` 秒的结构化内容
基线；06 `c86d879` 又解除动态任务时长与旧课程 900 秒兼容字段的错误身份耦合。当前
本地生产链路与全部工程门禁均通过，但旧正式站尚未重新部署，因此两项缺陷都不能提前
关闭。

## 验收版本

- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- 04：`0900cab`
- 01 共享计时：`c3d3071`
- 06：`a514f87`
- 07：`5c27e69`
- 08：`0af7857`
- 02：`1457252`
- 01 正式集成：`9ab305a`
- 状态：`16b9788`
- Pages run：`30326369853`，`completed / success`
- run head SHA：`16b97888d7bda8c0d200bf0a7da53c03e4f9c018`
- 正式资产：`assets/index-CDUEKV0C.js`

本地候选：

- 01 结构化投影：`4e49d7f`
- 05 84 单元内容基线：`b803bd1`
- 06 动态词汇时长兼容：`c86d879`
- 本地 HEAD：`c86d879`
- 本地生产资产：`assets/index-Cm31haDv.js`
- 正式站尚未重新部署；本轮没有用旧正式站否决本地候选，也没有把本地预览冒充正式证据

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
功能修复，不能替代 QA-009/010 的正式部署回归。

## 责任与回退

- QA-009 本地修复：01 `4e49d7f` 投影课程候选，05 `b803bd1` 提供公开内容事实；
  当前只差部署和正式回归。
- 无需返工：02 正确显示上游值；04 的计算和个人化算法已生效；06/07/08 的计时阶段
  不是 QA-009 根因。
- QA-010 已由 06 `c86d879` 本地修复；01 任务字段契约没有回退。
- 下一步：由 00 部署当前候选，09 使用正式 run/asset 重跑 QA-009/010。

## 本轮未冒充通过的项目

QA-009 与 QA-010 都只能记为“本地修复通过、待正式部署回归”，不能关闭。旧正式
资产仍是 QA-009 失败版本，因此没有把部署后正式计时、缓存更新或窄屏结果写成通过；
本地全绿也不能关闭 R3。

真实 iPhone 的锁屏、后台、MediaRecorder、SpeechSynthesis、语音识别、主屏幕缓存更新
和主观时间合理性也未执行。重新部署并通过 QA-009/010 正式站回归后，才应执行
`iphone-checklist.md` 的 R3 小节。
