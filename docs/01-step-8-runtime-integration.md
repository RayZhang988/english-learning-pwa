# 01｜首次评估、真实每日计划与训练路由集成交接

## 本次交付

应用入口已停止使用演示计划，改为以下生产链路：

```text
全新设备
  → feature.assessment/active-assessment-runtime-v1
  → 03 PlacementAssessmentRuntime
  → feature.assessment/latest-ability-profile
  → LearningEngineState
  → 05 released course package
  → generateDailyPlan()
  → versioned active PlanProgress
  → LearningAppPrototype.onTaskRequested(taskId)
  → targetModuleId route
  → 06 / 07 / 08
  → validated PlatformEvent
  → plan + engine persistence
```

正式模块注册表和入口：

| 模块 | Hash 路由 | 注入组件 |
| --- | --- | --- |
| `assessment` | `#/assessment` | `AssessmentRouteHost` |
| `vocabulary` | `#/vocabulary?taskId=<LearningTask.taskId>` | `VocabularyTrainingRoute` |
| `listening` | `#/listening?taskId=<LearningTask.taskId>` | `ListeningTrainingRoute` |
| `speaking` | `#/speaking?taskId=<LearningTask.taskId>` | `SpeakingTrainingRoute` |

路由不能自行创建任务。`taskId` 必须属于当前日期的活动计划，且
`targetModuleId` 必须与路由一致。完成或已跳过的任务不能从刷新后的地址重新启动。

## 本地状态

生产状态使用三个公开仓库：

- `feature.assessment/active-assessment-runtime-v1`：03 的 v1 运行快照；
- `feature.assessment/latest-ability-profile`：03 的最新能力档案；
- `learning.engine/current-state`：04 的学习引擎状态；
- `app.learning-runtime/active-plan`：01 的活动计划运行时。

评估快照由 01 原样保存并在读取时调用
`parseAssessmentRuntimeSnapshot()`。未来版本、题库不匹配或损坏数据会进入明确错误
状态，原记录不会被静默删除。活动或反馈状态刷新后一律恢复为暂停态；关闭应用的时间
不计入 20 分钟限制，已验证间隔 24 小时仍保留原有效作答时长。

完成评估的可靠顺序固定为：

1. 幂等保存真实 `latest-ability-profile`；
2. 保存带同一档案的 completed runtime snapshot；
3. 重新执行 `LearningAppCoordinator.initialize()`；
4. 使用 05 发布课程包和 04 引擎生成或恢复当天计划。

任一步失败都保留完成档案和快照供重试。重复回调不会在同一协调器实例内重复创建计划；
刷新后重新初始化会恢复同一 `planId`。

`app.learning-runtime` 当前 schema 为 `1`，保存：

- 活动 `DailyPlan` 和 `PlanProgress`；
- 跨日继续使用的已完成学习单元 ID；
- 全局已处理学习事件 ID；
- 04 跳过规则需要的历史记录。

未来版本和损坏记录会进入错误状态，不会静默清空或伪造新计划。

## 生产事件协调

所有模块共用 `ProductionLearningEventSink`：

1. 先用 `parseLearningEvent()` 校验事件。
2. 校验 plan、task、日期、模块、mode、难度和预计时长与计划一致。
3. 按全局 `event.id` 幂等。
4. 用 `applyPlanEvent()` 更新活动计划。
5. `learning.attempt.completed.v1` 同时调用 `applyLearningAttempt()`。
6. 用 `recordDailyActivity()` 保存当天真实活动。
7. 先保存引擎、后保存活动计划；第二次写入失败时，同一事件可安全重试。

完成、暂停、跳过和不可评分事件都会落盘。退出模块回到 `#/` 后，应用壳从协调器的
最新状态重新展示计划。

## 跨日和空状态

- 同一天刷新：恢复原 `planId`、任务状态和下一任务。
- 跨日：使用 `getResumeDecision()` 获取可结转任务，再由 `generateDailyPlan()`
  生成新计划。
- 没有 `AbilityProfile`：显示“需要先完成水平测试”，不创建假计划。
- 没有合格候选：保存真实的 empty 计划并显示空状态。
- 课程包离线或损坏：显示可重试/不可恢复错误，不使用测试 fixture。

课程候选只读取 05 发布入口列出的四个 lesson 文件。`prerequisitesMet` 来自生产完成
事件保存的学习单元账本；未注册模块、损坏文件、未知活动或无效 `contentRef` 会被拒绝。

## 09 黑盒入口

本地桌面验证：

```bash
pnpm build
pnpm preview --host 0.0.0.0
```

入口：

- 今日计划：`http://localhost:4173/#/`
- 正式水平测试：`http://localhost:4173/#/assessment`
- 三个训练路由只能通过今日计划点击进入；不要手工编造 `taskId`。

HTTPS 部署后入口：

- `https://rayzhang988.github.io/english-learning-pwa/#/`

09 开始训练链路前必须满足：

1. 使用新构建首次联网打开一次，使 Service Worker 安装包含课程 JSON 的应用版本。
2. iPhone 麦克风和主屏幕安装必须使用 HTTPS，不能用局域网 HTTP 代替。
3. 清除网站数据后应先看到 assessment-required，点击后进入 `#/assessment`。
4. 评估完成后应生成真实首日计划；刷新不得改变 `planId` 或重复完成事件。
5. 09 应分别验证任务点击、刷新恢复、重复事件、错误 taskId、跨日、离线、后台中断和
   权限拒绝。

## 当前集成状态

评估路由、快照、档案和计划衔接已经存在。03 的 production
`evaluateSpokenResponseEvidence()` 已接入：简单表达只走该转换器，朗读/跟读继续走
`deriveFixedSpeechMetrics()`。识别失败、低置信度或缺少置信度都保留录音回放降级，
不会被计为答错。

02 的 `AssessmentSpeechViewModel.audio` 和 `onToggleAudio(target)` 已完成接线。
`repeat` 题目的 `audioText` 通过系统 `en-US` 语音合成播放，支持播放、暂停、恢复、
最大播放次数和失败上报；朗读及简单表达题不渲染示例音频。换题或退出后，旧播放回调
会被作废，不能污染下一题。

01 已接入真实麦克风、录音、回放和 Web Speech 识别置信度。识别器不返回置信度时，
该证据明确标为不可评分，不会硬编码置信度。本地工程门禁已全部通过；真实 iPhone
上的语音合成、麦克风权限、后台中断和主屏幕安装结论归 09。

GitHub Pages 工作流已存在；本地构建不会自动发布。生产地址只有在本次代码进入部署
分支且工作流成功后才会更新。

## 可复现验证

本轮可复现结果：

```text
pnpm check：通过
pnpm lint / pnpm typecheck：通过
pnpm test：68 个测试文件、222 项测试通过
pnpm build：通过
PWA generateSW：预缓存 18 项 / 1031.37 KiB
首次使用生产集成：完整正式评估档案 → 05 四周课程 → 首日计划 → 真实模块路由 → 刷新恢复
```
