# R1｜旅游英语分阶段随机单词水平测试契约

## 版本与范围

- 题库：`travel-vocabulary-zh-cn-r1-v1`
- 题库数据：`travel-vocabulary-pools-r1-v1`
- 估算模型：`travel-vocabulary-estimation-r1-v1`
- 结果映射：`travel-vocabulary-level-map-r1-v1`
- 运行时与档案 schema：`3`
- 测试类型：`staged-travel-vocabulary`

R1 只测试单个英文单词的中文释义，不包含句子、图片、音频、语法、听力或口语。旧 v1
继续供正式站使用和兼容；旧逐题自适应 v2 已废止，不得注册到新入口。

2026-07-27 快速作答修补是 schema 3 的向后兼容增量：题库、五阶段代表词数、估算模型、
合理区间和 15 级阈值均未改版。新记录增加完成原因；旧 schema 3 记录缺少该字段时按
本文“完成原因与兼容”规则读取。

## 五个抽样阶段

| 阶段 | 候选词数 | 每次抽样 | 代表旅游词数 |
|---|---:|---:|---:|
| 基础出行词汇 | 150 | 30 | 300 |
| 核心旅行词汇 | 150 | 30 | 500 |
| 独立旅行词汇 | 150 | 30 | 650 |
| 进阶旅行词汇 | 150 | 30 | 800 |
| 高阶旅行词汇 | 150 | 30 | 950 |
| 合计 | 750 | 150 | 3200 |

每个英文单词在五个词库中全局唯一。一次测试在每阶段无放回抽取 30 个单词，并为每题从
同阶段抽取三个错误释义，与正确释义一起独立打乱。新测试重新抽样；传入上一份档案的
`sampledWordIds` 后，在每阶段仍有至少 120 个未使用词，因此首版可以完全避开最近一次
的 30 题。恢复只读取快照中固定的题目与选项顺序，不重新抽样。

## 答题与阶段提交

- 题干只显示一个英文单词，答案为四个中文释义。
- 用户也可以选择“不认识 / 不确定”，该项计入有效题数但不计正确。
- 阶段提交前，`selectChoice`、`markUncertain`、`clearAnswer` 和 `navigate` 可以反复
  修改或检查 30 题。
- `advanceToNextQuestion` 是有默认不会语义的顺序前进动作：当前题未答时，在同一次
  运行时状态变更中先写入 `uncertain` 再前进；当前题已答时保持答案。返回后仍可修改。
- `navigate(index)` 只是任意题号导航，不自动补答案，不能用它代替“下一题”。
- 活动阶段的 `canSubmitStage` 始终为 `true`。`submitStage` 会先把本阶段所有未答题
  批量补为 `uncertain`，再调用同一阶段估算公式并锁定结果。
- 整阶段提交后答案和分数锁定；0/30、6/30、15/30、30/30 都进入下一阶段。
- `finishRemainingUnknown` 可在答题态或阶段结果态调用。它保留既有答案和已提交阶段，
  把当前阶段未答题及所有后续阶段题目补为 `uncertain`，再用同一提交与估算函数生成
  五阶段完整结果。
- 快速结束后再次调用 `finishRemainingUnknown` 返回同一完成结果，不重算、不重复生成
  档案；正常完成的会话不能被改写为快速结束。
- 五个阶段全部完成才生成正式 `AbilityProfileR1`。
- R1 不设目标时间或最长时间；运行时只记录前台有效时间，暂停和离线时间不累计。

公开题目没有 `wordId`、`meaningZh`、`correctOptionId` 或 `scoring`。快照固定题目、选项
与草稿，但同样不保存显式答案键。已提交阶段可以公开正确/错误/不确定结果。

## 词汇量估算

每阶段：

```text
掌握比例 = 正确数 / 30
阶段点估算 = 掌握比例 × 该阶段代表词汇数量
阶段点估算按 10 词四舍五入
```

总点估算是五个已经舍入的阶段点估算之和。例：核心阶段 6/30 为 20%，估算
`0.2 × 500 = 100` 个；独立旅行阶段 15/30 为 50%，估算
`0.5 × 650 = 325`，按规则显示 330 个。

合理区间使用每阶段约 90% Wilson 二项抽样区间。四选一自然猜中概率为 25%，因此区间
下界再执行：

```text
保守下界比例 = max(0, (Wilson 下界 - 0.25) / 0.75)
```

上界保留 Wilson 上界。五阶段区间分别换算、按 10 词舍入后相加。点估算仍严格使用
总纲要求的正确率，不暗中改成猜测校正分；区间和免责声明负责诚实表达抽样误差与猜测
风险。这不是精确词数或正式统计认证。

## 15 个结果等级

阈值为“含下界”，集中定义在 `TRAVEL_VOCABULARY_RESULT_LEVELS_R1`：

| 最低估算词数 | 内部标签 |
|---:|---|
| 0 | 幼儿园 |
| 150 | 小学一年级 |
| 300 | 小学二年级 |
| 450 | 小学三年级 |
| 600 | 小学四年级 |
| 750 | 小学五年级 |
| 900 | 小学六年级 |
| 1100 | 初中一年级 |
| 1300 | 初中二年级 |
| 1500 | 初中三年级 |
| 1750 | 高中一年级 |
| 2000 | 高中二年级 |
| 2250 | 高中三年级 |
| 2500 | 大学英语四级 |
| 2850 | 大学英语六级 |

这些名称只是本软件的旅游英语学习标签，不代表学历、学校成绩或官方年级。“大学英语
四级 / 六级”只表示大致难度参照，不代表通过 CET-4 / CET-6。

## 完成原因与兼容

新会话与档案使用集中类型 `TravelVocabularyCompletionReasonR1`：

- `all-stages-completed`：普通路径提交完五个阶段；
- `remaining-marked-unknown`：用户确认“剩余全部不会，结束测试”。

进行中会话的 `session.completionReason` 固定为 `null`。新完成档案明确写
`profile.completionReason`；该字段在 TypeScript 档案类型中保持可选，只为兼容修补前
已经存在的 schema 3 下游夹具和存储记录，新生产档案不会省略。

读取修补前 schema 3 时：

- 进行中会话缺字段，内存中补为 `null`；
- 已完成会话或档案缺字段，内存中补为 `all-stages-completed`；
- 不回写、不清空原记录；
- 未知原因、会话/档案原因不一致或伪造结果仍拒绝恢复。

## AbilityProfileR1

`schemaVersion: 3` 的档案包含：

- `completionReason`，区分正常完成与剩余题统一标为不会；
- `travelVocabulary.estimatedWords`、`reasonableInterval`、五阶段结果及 150 题汇总；
- `resultLevel` 及三个版本号；
- `sampledWordIds`，供下一次测试优先避开最近题目；
- `durationSeconds`，只记录有效时间；
- `abilities.vocabulary.calibrationState: "estimated"`；
- `abilities.listening` 和 `abilities.speaking` 固定为
  `status: "unavailable"`、`calibrationState: "pending-calibration"`、
  `internalLevel: null`、`cefrEstimate: "unknown"`、`confidence: 0`。

不得从旅游词汇量推导听力、口语、综合 CEFR、学历或官方考试成绩。
