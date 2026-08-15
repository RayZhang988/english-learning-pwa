# 04｜学习计划、复习算法与进度契约

本目录是无页面、无内容、无设备能力的纯业务引擎。调用方注入 03 的
`AbilityProfile`、05 的可用学习单元和训练模块上报的标准事件；引擎只返回计划、
复习状态、续学决策和展示指标。

## 0. R1 能力档案与首日起点兼容

公开入口 `LearningAbilityProfile` 接受 schema 1、schema 2 和 schema 3。创建状态前，
`normalizeLearningAbilityProfile()` 会按版本校验并归一化；未知 schema、错误的
`assessmentKind`、不匹配的 R1 版本/等级、未包含点估计的合理区间，以及把
listening/speaking 伪造成已测量的 R1 档案都会被拒绝。不能依靠 TypeScript 类型断言
绕过运行时边界。

schema 1 与 schema 2 的可用 `0..12` 内部等级保持原值。R1 的 15 级 ordinal 是
`0..14` 的结果标签索引，不能直接当作训练难度。04 使用集中版本
`learning-r1-first-day-start-v1` 做保守转换：

```text
wordLevel(words) = 向下取 0.5 × (words / 3200 × 12)
首日词汇起点 = min(
  wordLevel(reasonableInterval.lower),
  wordLevel(estimatedWords),
  wordLevel(resultLevel.minimumEstimatedWords)
)
```

`resultLevel.id`、`ordinal` 和 `minimumEstimatedWords` 必须同时匹配 03 的 15 级映射；
`estimatedWords` 还必须落在该标签的词数区间。映射表集中在
`R1_FIRST_DAY_START_RULES`，阈值依次为
`0、150、300、450、600、750、900、1100、1300、1500、1750、2000、2250、2500、2850`。
“幼儿园”到“大学英语六级”都只是产品内部学习标签；这里不把它们解释为学校成绩、
学历或官方 CET 结果。

R1 的 listening/speaking 必须保持 `unknown / pending-calibration` 的原始语义：
起点使用安全默认难度 `2.5`、置信度为 `0`，但任务模式是普通 `learn`。后续正常训练
逐步形成证据，不插入强制听力/口语考试，也不从词汇结果推导两项能力。

`ProgressState` 仍使用持久化 schema 1。R1 新状态仅增加可选的
`r1VocabularyStartPlacement` 审计元数据，记录原始估算、合理区间、结果标签、三个
折算上限和最终起点；旧状态没有该字段时继续按原规则读取。schema 1 档案的 unavailable
专项仍保留既有 calibration 任务行为，避免静默改变旧计划。

## 0.5 R2 每日训练自由选择

`getPlanTaskAccess(PlanProgress)` 是 02/01 判断任务入口的唯一 04 业务契约，输出：

- `startableTaskIds`：active plan 中全部真实存在且未结束的 taskId；
- `recommendedTaskId`：非强制推荐，只决定突出项，不决定哪些任务可进入；
- `tasks`：逐任务的 `availability`、执行状态、目标模块、推荐标记和不可用原因。

`pending`、`active`、`paused`、`blocked` 都是未完成且可启动；`completed`、`skipped`
是终态。不可用原因只允许：

- `not-in-active-plan`：请求的 taskId 不存在；
- `task-finished`：任务已经完成或跳过；
- `invalid-task-data`：计划与执行状态的任务身份、数量或整体状态不一致。

没有“尚未轮到”“前一任务未完成”或数组位置锁定原因。推荐优先级为：
active → paused → blocked → retry → carry-over → due review → 其余任务按 sequence。
这个顺序只用于推荐；用户可以启动 `startableTaskIds` 中任意任务。
`evaluatePlanTaskStart()` 可校验单个 taskId，并返回同一逐任务契约。

`ResumeDecision.recommendedTaskId` 是同日恢复推荐；旧字段 `nextTaskId` 保留为兼容别名，
值与它相同，但不再代表唯一允许启动的任务。PlanProgress 和 active plan 不增加字段，
持久化 schema 仍为 v1；刷新后从现有任务状态重新派生可启动列表和推荐。

`LearningCandidate.prerequisitesMet` 只决定内容单元能否进入当天计划，表示跨日课程候选
资格。一旦 `LearningTask` 已进入 active plan，就不存在词汇、听力、口语之间的执行
前置条件。

## 0.75 R3 训练时长真实性

### 三种时间不能混用

- `DailyPlan.targetSeconds`：每日三个必做专项的有效训练总目标，固定 2700 秒。
- `DailyPlan.plannedSeconds` / `DomainAllocation.plannedSeconds`：为兼容 v1，仍是首个
  种子内容单元的 `estimatedSeconds` 汇总，不能用作完成条件或实际学习时间。
- `LearningTask.estimatedSeconds`：开始任务前展示的预计**有效练习**时间。调度器不再
  为了凑满 45 分钟改写它；预算有缺口时返回 `unfilledSeconds`。
- `TaskExecutionState.effectiveSeconds`：经片段规则确认的前台有效练习时间，与是否产生
  分数无关。
- `TaskExecutionState.spentSeconds`：接收到的片段总耗时诊断值，可能包含后台、暂停、
  空闲或等待。它不能作为 UI 的“实际练习时间”。

现状审计确认旧课程 84 个单元的 `estimatedSeconds` 全部为 900；01 原样投影后，三个
任务恰好构成 45 分钟。06/07/08 又用活动状态中相邻操作的墙钟差产生
`durationSeconds`，没有统一空闲上限，因此可能混入后台切换延迟、长时间无操作和等待。
R3 契约保留旧值作低置信迁移回退，但不再把它视为经过内容计算的精确结果。

### 内容基线与个人校准

新内容通过可选 `TaskDurationBaseline` 声明稳定 `contentType` 和内容量：

```text
raw = fixedSeconds
    + itemCount × secondsPerItem
    + activeAudioSeconds × expectedAudioPlaythroughs
    + interactionStepCount × secondsPerInteractionStep

contentEstimate = clamp(raw, minimumSeconds, maximumSeconds)
```

若缺少结构化基线，旧 `LearningCandidate.estimatedSeconds` 作为
`legacy-content-estimate` 回退，`confidence = low`，合理范围为该值的 50%–150%。
这只是诚实兼容，不表示旧 900 秒已经可靠；01/05 后续必须从真实题量、音频长度和操作
步骤提供结构化基线。

个人速度按 `domain | mode | contentType` 隔离。可用样本只包括完成任务后由
`recordTaskDurationSample()` 固化，且明确标记为
`source: timing-segments / reliable: true` 的前台有效计时：

- 只接受 5–7200 秒的可靠有效时长；
- 只取最近 9 个样本；
- 4 个以上样本使用中位绝对偏差排除极端异常值；
- 0–2 个样本仍返回内容基线，不声称已个人化；
- 至少 3 个样本后使用样本中位数，3–4 个为 medium、5 个以上为 high；
- 因为输出就是稳健中位数，个人估算与用于校准的历史中位数偏差为 0%，满足不超过
  25% 的目标。

`AttemptEvidence.durationSeconds` 无论是旧记录还是新 scored attempt，都不进入
`sampleCount`，也不能触发 `personal-history`。它缺少 foreground、idle、background
和片段来源证据；`contentTags` 或分组键同样不能证明计时可靠。即使存在 3 条、9 条或
更多普通 attempt，仍保持 `content-baseline / sampleCount: 0`。普通 attempt 与同 ID
可信 timing sample 同时存在时，只计算 timing sample 一次。

`LearningTask.durationEstimate` 同时输出 `estimateSeconds`、`sampleCount`、`basis`、
`confidence`、`reasonableRangeSeconds`、`contentType`、`profileKey` 和基线来源。
该字段是 additive v1；旧持久化任务缺失时仍使用原 `estimatedSeconds`。

### QA-011：15 分钟连续题流

新生成的每个词汇、听力、口语 `LearningTask` 都带有
`trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 }`。这是完成条件，
不是 `durationEstimate`，也不会被个人速度历史缩短。旧 active plan 缺少该字段时按旧
完成语义恢复，绝不在刷新时悄悄把已开始单元改为 15 分钟流。

`PlanProgress.tasks[].training` 是可持久化恢复状态：它保存剩余有效秒数、已完成 item ID、
不透明 `nextSupplyCursor` 和终态。有效片段累计到 900 秒时，状态从 `running` 变为
`finish-current-item`，剩余显示为 0；当前播放、作答、反馈、录音或回放必须自然结束。
随后模块先提交 `learning.training.item.completed.v1`，再提交
`learning.training.budget.completed.v1`，04 才把任务标为 `completed`。因此普通
`attempt.completed` 不再能让带预算任务在第 6 题提前结束。

训练模块通过 `buildLearningTaskSupplyRequest(execution)` 请求下一题。请求 ID 由 task ID、
已完成 item 数和 cursor 确定，刷新后保持不变；请求包含已完成 item ID，供 05 规避短期
重复。05 返回一个不透明 `LearningTaskSupplyItem` 或 `content-exhausted`。后者必须发布
`learning.training.content.exhausted.v1`；04 将任务留在 `blocked/content-exhausted`，
不增加完成数、不形成掌握证据，也不伪造每日完成。02/01 应显示并恢复这个真实错误。

供应器后来能够返回新题时，06/07/08 必须先发布
`learning.training.content.recovered.v1`，其中 `exhaustionRequestId` 精确等于先前耗尽
事件的 `requestId`。04 只接受同一 plan/task/localDate 且当前确为
`content-exhausted` 的恢复；恢复不增加有效时间、不改变 cursor、已完成 item 或排除集合。
它只清除耗尽错误，并按原 `remainingEffectiveSeconds` 回到 `running`，或在剩余为 0 时回到
`finish-current-item`。随后才可请求/使用新题。重复 event ID 无操作；错误请求、日期或状态
会被拒绝。

### 可恢复有效计时片段

01/06/07/08 通过 `learning.timing.segment.recorded.v1` 上报可序列化片段。payload 必须
包含标准任务身份、mode、phase、reason、前后台状态、start/end、整数 elapsed 秒和
`idleThresholdSeconds: 45`。平台事件 `id` 是唯一幂等键；04 把最近 500 个处理 ID
保存在 `PlanProgress`，刷新后重投不会重复累计。

集中计入规则：

| 片段 | 是否计入 `effectiveSeconds` | 单片段上限 |
| --- | --- | --- |
| 前台主动答题、查看反馈 | 是 | 45 秒；超过说明调用方没有在空闲边界切片，事件拒绝 |
| 前台主动播放学习音频、录音、录音回放 | 是 | 15 分钟 |
| 后台 | 否 | 只记诊断耗时 |
| 用户暂停、45 秒空闲超时 | 否 | 只记诊断耗时 |
| 内容/媒体加载、权限等待、网络等待 | 否 | 只记诊断耗时 |

“音频播放”只有用户在前台主动听学习材料时才是 `active-audio-listening`；缓冲或设备
等待必须报 `media-loading`，不能冒充听力练习。04 不读取浏览器状态，由 01 提供统一
前台/后台/空闲基础设施，模块只按契约上报片段。

只要存在计时片段，`attempt.durationSeconds` 和旧 pause duration 不再重复累加。没有
片段的旧计划继续使用事件时长兼容：scored 完成仍可为旧活动统计保留有效时长，但绝不
进入个人速度样本；旧
`unscorable-practice` 的 `durationSeconds` 没有前台/空闲来源证据，只保留在 spent，
不能升级为 effective。接入 timing 片段后，完整口语降级流程会保留真实录音/回放时间，
同时仍不产生掌握度证据。要求重试的不可评分故障同样只记 spent。

`ProgressState.durationSamples` 和执行态计时字段都是可选的 schema-1 扩展。仓储只
接受 `source: timing-segments` 的速度样本；旧引擎状态、旧 active plan 和旧 attempt
不迁移版本、不丢掌握度，但旧 attempt 只保留为训练证据和诊断数据。新字段损坏时仓储
明确拒绝，不静默清空。完成事件的集成顺序必须是：

1. `parseLearningEvent()`；
2. `applyPlanEvent()` 得到包含最终有效时间的计划状态；
3. attempt 事件交给 `applyLearningAttempt()` 更新可评分证据；
4. 再用 `recordTaskDurationSample()` 固化可靠片段样本；
5. 保存引擎状态和 active plan。

## 0.9 R6.1｜每日完成后的开放式可选训练

`ExtraTrainingSession` 是独立于 `PlanProgress` 的 schema-1 可恢复记录。它只可在同一
`localDate` 的每日计划已经完成 3/3 后创建；字段包括稳定 `sessionId`、专项身份、
`completionMode: open-ended`、累计有效秒数、供应 cursor、短期排除 item、完成题数、
开始/更新时间及终止原因。
它不会新增每日必做 `LearningTask`，也不会改写已完成计划的三个执行态。

会话事件使用独立的 `learning.extra-training.*.v1` 命名空间，并由
`parseExtraTrainingEvent()` / `applyExtraTrainingEvent()` 处理；它们没有 `planId` 或每日
`taskId`，因此传给 `applyPlanEvent()` 会被明确拒绝。可评分的
`learning.extra-training.attempt.completed.v1` 只交给
`applyExtraTrainingAttempt()`：它仍更新复习/掌握证据，但使用保留的
`planId: extra-training:<localDate>` 与 `taskId: <sessionId>` 证据身份，绝不冒充第四项每日
任务。不可评分尝试不更新掌握度。

计时沿用 R3 的前台、暂停、后台与 45 秒空闲片段规则，但累计时间只用于如实展示和记录，
不再作为完成条件。开放式会话不得发布 budget-completed，也不会进入
`finish-current-item`；完成一题后继续供应，直到用户主动退出。用户退出形成
`paused / user-exited` 并完整保留 cursor、排除集、题数与累计有效时间；重新 started 后
可恢复。内容耗尽、供应器和设备故障为 `failed`，不会回滚每日 3/3。
跨日清理由 `expireExtraTrainingSessions()` 把未结束会话标为 `expired / cross-day-expired`，
同样不触碰每日计划。

旧的 900 秒未完成会话在恢复时原地迁移：保留已练时间、题目游标、排除记录和分数，
删除目标/剩余倒计时，并把 `finish-current-item` 恢复为可继续的 `running`。历史上已经
完成的旧会话保持原记录，不伪造或重写。

`buildExtraTrainingSupplyRequest()` 把内容优先级明确交给 05/训练模块：
`recent-error → due-review → same-day-variant → new-optional-content`。创建会话时，01 必须把
已经由 05 发布的 candidate `itemId` 以四组 `priorityItemIds` 显式传入；04 按优先级全局去重、
拒绝空 ID 或缺组，并把这些身份保存到会话，在退出/刷新后原样请求。04 不选择、生成或猜测
课程内容；`new-optional-content` 始终由上游传空数组。旧持久化会话缺少该新增字段时，读取为
四组空数组，保持 schema-1 兼容。

### R15 语义多样性轮次

`createTrainingSupplyRound()` 的 schema-2 入口消费 05 发布的 `itemId`、
`knowledgePointId` 和 `semanticCategoryId`，不从 scene、focus 或题干重算语义。
普通供题先用可注入 seed 做确定性洗牌，再生成一次性固定顺序：
同一知识点不相邻，同一语义类别最多连续 2 题。只在剩余合格池无法满足时
按固定层级放宽：`0` 严格，`1` 仅放宽语义连续，`2` 放宽全部多样性限制。
该层级按题写入 `orderAudit`，轮次的最高层级写入 `relaxationTier`，不得用
“内容耗尽”掩盖可放宽的合法候选。

正式错题或到期复习可以通过 `priorityItems` 越过冷却，但每项必须携带
非空 `reason`，并原样持久化为 `priorityReason`。seed、order、cursor、
12 项短期身份/语义历史、逐题放宽层级和优先原因均为 JSON 可移植状态；
刷新、离线和退出恢复只继续现有顺序，不重洗。旧 schema-1 轮次仍严格校验并
原样推进，不伪造缺失的语义历史。

`LearningEngineState.recentTrainingSemanticHistory` 使用与 R11 相同的
`domain:mode:difficultyLevel` 边界，为每个边界保留最近 12 次已确认的
三字段语义身份。日常与额外训练只在 schema-2 `item.completed` 事件的
round acknowledgement 通过后，与训练进度在同一纯状态转换中追加它。
`trainingRecentSemanticHistory()` 是 01 创建新轮时的公开读取入口。旧状态或
schema-1 轮次继续保持缺省，不从 itemId、题干或课程标签反向伪造语义。

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
- 设备、权限、音频、识别或内容故障属于不可评分结果，不更新记忆模型。计划层即使
  允许完整的降级练习结束任务，也不会创建复习证据或改变掌握度。

新学任务每 7 天最多主动跳过两次；普通复习每天最多跳过一次；失败后的必需重试不能
通过“跳过”清除，只能中断并在续学时保留。达到限制时引擎返回 `blocked`，不会假装
任务完成。

## 4. 中断、完成、连续学习和阶段复测

- 同一天恢复原计划；active、paused 等中断状态只影响推荐优先级，所有未完成任务仍可
  由用户自由启动。
- 跨天时只结转已开始的任务、到期复习和重试；未开始的新学任务重新排程。
- `taskCompleted: true` 表示产生评分证据的正常完成。口语模块在全部提示均无法识别、
  但用户已经走完 08 定义的录音/回放或无录音降级流程时，仍合法发布
  `result: 'unscorable'`、`taskCompleted: false`。
- 对不带 `trainingBudget` 的旧计划，上述口语事件在计划层形成 `status: 'completed'`、
  `completionKind: 'unscorable-practice'`。它是“练习流程已结束、没有评分证据”，
  不是 `scored`，也不是 `user-skipped`。其他未完成任务始终保持可启动。
- 06/07 的不可评分事件以及口语的 `content` 故障默认保持 `paused`，
  因为这些事件不能证明完整降级练习已经走完。
- 当天至少完成一项任务，且有效学习达到
  `min(600 秒, max(300 秒, 计划时间 × 50%))` 才计连续学习日。短计划不会被强迫
  达到 10 分钟，设备失败耗时不计有效学习。
- 每累计 14 个有效学习日生成阶段复测建议。低置信或不可用专项在积累 8 条可靠日常
  证据后可提前建议专项复测。04 只安排和发出建议，复测题型与评分仍归 03。

## 5. 跨模块契约

05/01 向引擎提供 `LearningCandidate`，包含稳定内容引用、所属专项、内容等级，以及
由题量、音频和操作步骤构成的 `durationBaseline`。旧内容可暂时只给低置信
`estimatedSeconds`。04 返回带 `durationEstimate` 的 `LearningTask`；06/07/08 只
消费各自 `targetModuleId` 的任务。

训练模块通过 01 的 `PlatformEvent` 信封上报以下 v1 事件：

- `learning.task.started.v1`
- `learning.task.paused.v1`
- `learning.task.skipped.v1`
- `learning.attempt.completed.v1`
- `learning.timing.segment.recorded.v1`
- `learning.training.item.completed.v1`
- `learning.training.content.exhausted.v1`
- `learning.training.content.recovered.v1`
- `learning.training.budget.completed.v1`

事件时间必须是 ISO 8601 UTC；payload 必须带本地日期、计划、任务、内容引用和专项。
可评分尝试还必须提供表现、证据质量、辅助程度和错误标签。模块内部原始答案、录音、
识别音频和题型状态不进入学习引擎。

原 attempt v1 兼容规则不修改既有字段；R3 通过独立 timing v1 事件增加真实计时。对于
带 `trainingBudget` 的新任务，attempt 是单题学习证据而非任务终态；计划终态只能由预算
完成事件产生：

- `resolveAttemptPlanDisposition()` 将 `scored + taskCompleted` 解释为正常完成；
- 仅当来源、专项和目标模块均为 `speaking`，结果为 `unscorable`，且失败类别为
  `device`、`permission`、`network` 或 `interrupted` 时，解释为完整降级练习终态；
- 其他不可评分事件一律要求重试或恢复；
- `applyLearningAttempt()` 对所有不可评分事件仍返回 `evidenceAccepted: false`，不
  写入 attempts，不创建或更新复习状态。

02 可直接展示 `DailyPlan`、`PlanTaskAccess`、`ProgressSnapshot`、
`ResumeDecision` 和 `ReassessmentRecommendation`，但不得重新计算或改变其业务
语义。04 的可启动性输出只包含稳定状态和原因码，不生成 UI 文案。

集成层使用 `LEARNING_ENGINE_STORAGE_NAMESPACE` 创建 01 的 `NamespaceStore`，
再注入 `LearningEngineRepository`。04 保存业务状态，不直接访问 IndexedDB，也不
修改 01 的物理数据库版本。

## 6. 各任务接入清单

| 接收任务 | 只使用的公开契约 | 禁止自行改写的语义 |
| --- | --- | --- |
| 02 | `DailyPlan`、`PlanProgress.tasks[].training`、`PlanTaskAccess`、`ProgressSnapshot`、`ResumeDecision` | 展示剩余有效秒数、已完成题数和 content-exhausted；不得把推荐 taskId 改成唯一入口 |
| 05 | `LearningCandidate`、`LearningTaskSupplyRequest`、`LearningTaskSupplyResult` | 供应一个符合 domain/mode/difficulty 的新 item；用 cursor 和 excludeItemIds 去重；耗尽必须诚实返回错误 |
| 06 | `LearningTask`、`buildLearningTaskSupplyRequest()`、四种 training v1 事件 | 供应恢复后先发 recovered，再完成新题；900 秒到达后只完成当前题；长时间无操作必须切出 active 片段 |
| 07 | `LearningTask`、`buildLearningTaskSupplyRequest()`、四种 training v1 事件 | 供应恢复后先发 recovered；主动听音可计 effective，媒体加载和后台等待不可计入，且不得截断正在播放 |
| 08 | `LearningTask`、`buildLearningTaskSupplyRequest()`、四种 training v1 事件 | 供应恢复后先发 recovered；录音/回放可计 effective，权限/识别等待不可计入，不可评分 item 仍可推进预算 |
| 01 | `parseLearningEvent()`、`applyPlanEvent()`、公开 supply/budget 类型 | 串行保存 item、timing、预算完成与 cursor；刷新后不得重复累计或重新供应已完成 item |

建议集成顺序：

1. 用最近的 `AbilityProfile` 创建或从 `LearningEngineRepository` 恢复状态。
2. 将 05 当前可用且前置条件满足的候选单元交给 `generateDailyPlan()`。
3. 用 `createPlanProgress()` 建立当天执行状态，再用 `getPlanTaskAccess()` 把所有
   startable taskId 分发到各自训练模块；sequence 只参与稳定推荐，不是执行门禁。
4. 集成层先用 `parseLearningEvent()` 校验模块事件，再交给 `applyPlanEvent()`；只有
   `attempt.completed` 同时交给 `applyLearningAttempt()`，并在终态用
   `recordTaskDurationSample()` 固化可靠片段样本。
5. 每次状态变化后保存引擎和计划状态。各入口都按事件 ID 幂等，重复投递不会重复
   增加掌握度或学习时长。
6. 当天结束用 `summarizePlanActivity()` 和 `recordDailyActivity()` 更新连续学习，
   再生成进度快照和阶段复测建议。

## 7. R17｜分专项成长与升级测试

`GrowthState` 是独立的 schema 3 账本，分别保存 vocabulary、listening、speaking
三项的当前 15 级 ordinal（0–14）。它不读取课程答案，也不创建题目。旧 schema 1
账本在 `migrateGrowthState()` / `LearningEngineRepository.load()` 时只升级测试快照格式；
无法严格验证的损坏值拒绝读取，绝不清空其他学习数据。

唯一可计入的事件是 `learning.growth.training.completed.v1`，其 `source` 必须是
`daily-training` 或 `extra-training`，且必须有至少一道已评分题。错题复习、场景、
`trainingTest=30`、未提交/退出、不可评分及设备、网络、权限失败没有事件入口，因此不会
形成成长证据。调用方只能在正式会话真正结束后提交一个稳定 `eventId + source + sessionId`
摘要；重复事件幂等，冲突的 session identity 或非当前等级摘要会被拒绝。

成长进度和资格是两个独立指标：

```text
growthProgress = min(100, floor(当前等级累计已评分题数 / 50 × 100))
recentAccuracy = 最近 5 个当前等级正式会话的正确题数 / 已评分题数
eligible = 当前非最高级
        && 最近会话数 >= 5
        && 当前等级累计已评分题数 >= 50
        && recentAccuracy >= 80%
        && growthProgress == 100
```

失败升级测试后，`retryAvailableAfterEligibleSessionCount` 固定为当前会话计数加 2；
因此必须再完成两次同专项的正式训练才能重新测试。通过后只提升该专项一级，并把新等级
的累计题数和会话计数置零；历史会话仍保留。大学六级为最高级，不产生升级测试。

05 向 01 提供“下一等级、同专项”的稳定内容 ID 候选；01 显式传入种子和候选调用
`startGrowthUpgradeTest()`。04 使用确定性 Fisher–Yates 固化十个 `itemIds`，持久化
`seed/order/index(answers.length)/draft/feedback/score`，所以刷新、离线恢复与退出不会
重洗。06/07/08 只负责将用户答案评分为布尔 `correct` 并携带可显示的字符串 draft，
通过 `submitGrowthUpgradeAnswer()` 逐题写入；04 不猜测答案、翻译或发音。02 只渲染
`getGrowthEligibility()` 和快照；01 负责串行保存、候选解析和错误恢复。

### QA-R17-003 内容身份迁移

15级内容重建不改变上述升级门槛。每一级都有200个已发布候选，下一等级的10题升级
测试容量充足；等级只会在8/10升级测试通过后增加，题库换版本身不能升级或降级用户。

01 使用 `migrateDailyGrowthEvidence()` 原子迁移可按内容身份追溯的旧证据。只有05映射
中 `evidenceTransferAllowed=true` 的严格语义等价项可以转移：同级 `equivalent` 保留
升级窗口资格；`moved-equivalent` 改挂到新等级但标记
`countsTowardUpgradeWindow=false`，只能作为历史证据，必须在新等级重新完成正式训练才
能获得升级资格；`retired` 只进入退休历史，不进入活动证据。缺失、重复、目标不存在或
disposition与权限矛盾的映射全部拒绝。重复执行同一迁移版本幂等。

现有三专项 `currentLevelOrdinal`、累计进度和会话不因内容换版静默清零或降级；这些
聚合值不包含可供04拆分的内容身份，因此迁移器也不会猜测性重算。即使旧进度已经解锁
升级测试，真正升级仍必须通过新题库下一等级的10题测试。
