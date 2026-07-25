# 04｜学习计划、复习算法与进度契约

本目录是无页面、无内容、无设备能力的纯业务引擎。调用方注入 03 的
`AbilityProfile`、05 的可用学习单元和训练模块上报的标准事件；引擎只返回计划、
复习状态、续学决策和展示指标。

## 1. 指标定义

所有比例指标均为 `0..1`，能力和内容难度均沿用 03 的 `0..12` 内部等级。

- `mastery`：某个学习单元的长期掌握估计。可评分尝试通过指数更新；设备失败、
  内容损坏和用户中断不改变掌握度。
- `stabilityDays`：当前记忆在无复习情况下保持的时间尺度。它和经过天数共同计算
  `retrievability = exp(-elapsedDays / stabilityDays)`。
- `memoryDifficulty`：该单元对当前用户的记忆难度，不等于内容等级。失败会提高，
  稳定成功会降低。
- `performanceScore`：训练模块标准化后的本次表现，`0` 表示完全未达成，`1` 表示
  完全达成。04 不读取模块内部题型细节。
- `evidenceQuality`：本次表现作为学习证据的可信度。低质量证据影响更小，不会被
  当成强烈的成功或失败。
- `recentPerformance`：专项近期表现的指数移动平均。
- `retentionScore`：专项复习任务的近期提取表现；新学任务不直接抬高它。
- `progressScore`：用于展示和短板排序的综合指标：
  `45% mastery + 35% recentPerformance + 20% retention`。
- `trend`：最近最多 14 条可靠证据分成前后两半，后半均值比前半高/低至少 `0.05`
  时分别为上升/下降；少于 6 条为证据不足。
- `commonErrors`：错误标签按 14 天半衰期衰减聚合，至少出现两次才展示，按
  `衰减次数 × 错误率 × 平均证据质量` 排序。

初测专项不可用不等于 0 级。安全起点为内部等级 `2.5`，并标记需要校准。低置信度
可以采用 03 的估计值，但更保守地选难度并更快吸收新证据。触及初测下限时再降
`0.5` 级；触及上限不直接视为 C2 或免除基础证据收集。

## 2. 每日约 45 分钟计划

默认目标为 2700 秒。调用方可传入当天真实可用时间，引擎接受 300–2700 秒，
不会因为用户当天只有短时间就伪造完成 45 分钟。

三项能力先各保留至少 20% 的新学时间，再按以下短板分提高到最多 50%：

`45% 等级缺口 + 35% (1 - progressScore) + 20% (1 - confidence)`

复习和失败后的重试先于新学：

- 正常日复习目标至少占 25%；
- 到期积压可把复习提高到 55%；
- 可用时间不超过 15 分钟时，积压复习最多可占 75%；
- 已开始但未完成的任务先于未开始的新任务；
- 不存在合适内容时返回 `unfilledSeconds` 和原因，不复制任务、不虚构内容。

专项目标难度以当前能力等级为中心。近期表现至少 `0.85` 且保持率至少 `0.8` 时上调
`0.5`；近期表现低于 `0.6`、趋势下降或初测触及下限时下调 `0.5`。低置信度先再
下调 `0.5`，并优先选择靠近目标难度的候选单元。

## 3. 间隔复习与重试

评分表现至少 `0.6` 视为成功：

- 成功会提高掌握度和稳定期；连续成功的增长更快，但单次间隔最多 60 天；
- 失败将稳定期压缩到原来的约 35%，掌握度下降，并在 10–30 分钟后安排同日重试；
- 同日重试成功后仍在次日安排一次巩固，不允许一次补答直接恢复长间隔；
- `mastery >= 0.9` 且 `stabilityDays >= 21` 标记为已掌握，但仍保留远期复习；
- 设备、权限、音频、识别或内容故障属于不可评分结果，不更新记忆模型。

新学任务每 7 天最多主动跳过两次；普通复习每天最多跳过一次；失败后的必需重试不能
通过“跳过”清除，只能中断并在续学时保留。达到限制时引擎返回 `blocked`，不会假装
任务完成。

## 4. 中断、完成、连续学习和阶段复测

- 同一天恢复原计划，从 `active`、`paused`、`pending` 中优先级最高的未完成任务继续。
- 跨天时只结转已开始的任务、到期复习和重试；未开始的新学任务重新排程。
- 一条 `attempt.completed` 只有在 `taskCompleted: true` 时才完成任务。不可评分、
  暂停和跳过都不算完成。
- 当天至少完成一项任务，且有效学习达到
  `min(600 秒, max(300 秒, 计划时间 × 50%))` 才计连续学习日。短计划不会被强迫
  达到 10 分钟，设备失败耗时不计有效学习。
- 每累计 14 个有效学习日生成阶段复测建议。低置信或不可用专项在积累 8 条可靠日常
  证据后可提前建议专项复测。04 只安排和发出建议，复测题型与评分仍归 03。

## 5. 跨模块契约

05 向引擎提供 `LearningCandidate`，只包含稳定内容引用、所属专项、内容等级和预计
时长。04 返回 `LearningTask`；06/07/08 只消费各自 `targetModuleId` 的任务。

训练模块通过 01 的 `PlatformEvent` 信封上报以下 v1 事件：

- `learning.task.started.v1`
- `learning.task.paused.v1`
- `learning.task.skipped.v1`
- `learning.attempt.completed.v1`

事件时间必须是 ISO 8601 UTC；payload 必须带本地日期、计划、任务、内容引用和专项。
可评分尝试还必须提供表现、证据质量、辅助程度和错误标签。模块内部原始答案、录音、
识别音频和题型状态不进入学习引擎。

02 可直接展示 `DailyPlan`、`ProgressSnapshot`、`ResumeDecision` 和
`ReassessmentRecommendation`，但不得重新计算或改变其业务语义。

集成层使用 `LEARNING_ENGINE_STORAGE_NAMESPACE` 创建 01 的 `NamespaceStore`，
再注入 `LearningEngineRepository`。04 保存业务状态，不直接访问 IndexedDB，也不
修改 01 的物理数据库版本。

## 6. 各任务接入清单

| 接收任务 | 只使用的公开契约 | 禁止自行改写的语义 |
| --- | --- | --- |
| 02 | `DailyPlan`、`PlanProgress`、`ProgressSnapshot`、`ResumeDecision`、`ReassessmentRecommendation` | 分钟分配、连续学习、趋势和复测到期 |
| 05 | `LearningCandidate` | 候选单元只声明内容事实，不预排用户每天的主课程 |
| 06 | `LearningTask` 中 `targetModuleId === 'vocabulary'` 的任务；四类 `LearningEvent` | 不在词汇模块内另算掌握度或全局复习时间 |
| 07 | `LearningTask` 中 `targetModuleId === 'listening'` 的任务；四类 `LearningEvent` | 设备或音频失败必须上报不可评分，不得算学习失败 |
| 08 | `LearningTask` 中 `targetModuleId === 'speaking'` 的任务；四类 `LearningEvent` | 权限、离线、识别失败必须上报不可评分，不得压低口语能力 |

建议集成顺序：

1. 用最近的 `AbilityProfile` 创建或从 `LearningEngineRepository` 恢复状态。
2. 将 05 当前可用且前置条件满足的候选单元交给 `generateDailyPlan()`。
3. 用 `createPlanProgress()` 建立当天执行状态，并按 `sequence` 分发给三个训练模块。
4. 集成层先用 `parseLearningEvent()` 校验模块事件，再交给 `applyPlanEvent()`；只有
   `attempt.completed` 同时交给 `applyLearningAttempt()`。
5. 每次状态变化后保存引擎和计划状态。两个入口都按事件 ID 幂等，重复投递不会重复
   增加掌握度或学习时长。
6. 当天结束用 `summarizePlanActivity()` 和 `recordDailyActivity()` 更新连续学习，
   再生成进度快照和阶段复测建议。
