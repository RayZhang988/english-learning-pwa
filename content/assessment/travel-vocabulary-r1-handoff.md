# R1｜03 下游交接

## 给 01：生产注册与存储迁移

新入口使用：

```ts
import {
  createTravelVocabularyAssessmentFeatureModuleR1,
  createTravelVocabularyAssessmentRuntimeR1,
  restoreTravelVocabularyAssessmentRuntimeR1,
  TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  VersionedAssessmentProfileRepository,
} from '@/features/assessment'
```

- 注册工厂：`createTravelVocabularyAssessmentFeatureModuleR1(routeElement)`
- 新会话：`createTravelVocabularyAssessmentRuntimeR1(options)`
- 恢复：`restoreTravelVocabularyAssessmentRuntimeR1({ snapshot, ...options })`
- R1 快照 key：`active-travel-vocabulary-assessment-r1-v1`
- R1 运行时、档案及模块 storage schema：`3`

01 的读取顺序应为：R1 key → 旧 v2 key `active-vocabulary-assessment-runtime-v2` →
旧 v1 key `active-assessment-runtime-v1`。R1 写入确认成功以前不得删除旧记录。

v1/v2 与 R1 的题库和估算模型不兼容。恢复旧快照时，03 会：

1. 用旧解析器严格验证原快照；
2. 完整保存在 `legacySource`；
3. 创建新的 R1 随机抽样；
4. 返回 intro 状态和
   `migrationNotice: "legacy-measurement-incompatible-new-sample-required"`。

不得把 v1/v2 正确率换算成 R1 五阶段成绩。损坏或未知版本会抛出错误；01 应保留原记录
并提供重试/重新开始，不能写空档案覆盖。

修补前的 R1 schema 3 快照和档案仍使用同一个 key 与记录版本。03 的读取器会在内存中
为缺失完成原因的旧活动会话补 `null`，为旧完成会话/档案补
`all-stages-completed`；不会回写或清空旧记录。新快照和档案必须保存显式完成原因。

完成回调：

```ts
const runtime = createTravelVocabularyAssessmentRuntimeR1({
  recentWordIds: previousR1Profile?.sampledWordIds,
  onCompleted: async (profile) => {
    await versionedProfileRepository.saveLatest(profile)
  },
})
```

`VersionedAssessmentProfileRepository` 可读取 schema 1/2/3，并按档案自身版本写入。
持久化事务、key 清理、路由和部署仍归 01。

快速作答新增调用：

```ts
// “下一题”：不要再映射到 navigate(current + 1)
runtime.advanceToNextQuestion()
await snapshotRepository.save(runtime.toSnapshot())

// 用户完成二次确认以后才调用；取消确认不调用核心动作
await runtime.finishRemainingUnknown()
await snapshotRepository.save(runtime.toSnapshot())
```

01 必须把每次运行时动作与快照保存放进现有串行操作队列；先由运行时完成单次状态变更，
再保存返回后的快照。`finishRemainingUnknown()` 在已经以
`remaining-marked-unknown` 完成后可安全重复调用，返回同一档案；01 仍应沿用现有
in-flight 去重和 `profileId` 提交去重。不得通过循环调用 UI 选择动作模拟批量补题。

## 公开运行状态

`TravelVocabularyAssessmentRuntimeStateR1` 的 lifecycle：

- `intro`：`start`
- `active`：`navigate`、`advanceToNextQuestion`、`selectChoice`、
  `markUncertain`、`clearAnswer`、`submitStage`、
  `finishRemainingUnknown`、`pause`
- `stage-summary`：查看锁定阶段结果、`continueToNextStage`、
  `finishRemainingUnknown`、`pause`
- `paused`：`resume`
- `completed`：只读 `profile`

主要展示字段：

- `stage`：当前阶段编号、名称、代表词数；
- `questions`：本阶段 30 个公开单词选择题；
- `currentQuestionIndex` 与 `draftAnswers`；
- `completionReason`：进行中为 `null`，完成后区分普通完成与快速完成；
- `remainingQuestionsToMarkUncertain`：二次确认将统一记为不会的精确题数；
- `progress`：当前阶段、当前题、阶段/总答题数、150 总题数和有效秒数；
- `latestStageResult`：阶段提交后正确数、错误数、不确定数、掌握比例、阶段估算及区间；
- `profile`：五阶段完成后的总结果。

状态没有音频、句子、语法、听力或口语动作。不要同时注册 v1、v2 和 R1 三个相同路由。

## 给 02：R1 页面状态

02 只实现 R1：

1. 介绍页：说明 5 阶段、每阶段 30 词、约 150 题、可保存退出；不显示时长承诺。
2. 阶段答题页：一次阶段内允许前后导航；显示单个英文词、四个中文释义和“不认识 /
   不确定”。
3. 提交检查页：使用 `draftAnswers` 标出未作答题号，并显示“还有 X 题未答，提交后将
   按不会记录”；活动阶段 `actions.canSubmitStage` 不再因未答而关闭。提交前允许回改。
4. 阶段结果页：展示正确数 / 30、掌握比例、代表词数、阶段估算和区间；无论分数多少
   都提供“进入下一阶段”。
5. 恢复页：按快照固定原题，显示当前阶段、题号和已答数量。
6. 总结果页：展示总估算、合理区间、五阶段明细、总作答数、有效时间、15 级标签及
   完整免责声明。
7. 迁移提示：旧测试只能重新开始 R1，不能显示为已完成的 R1。
8. 正常“下一题”调用 `advanceToNextQuestion`；题号导航仍调用 `navigate(index)`。
9. 在提交阶段操作附近提供“剩余全部不会，结束测试”。二次确认使用
   `remainingQuestionsToMarkUncertain`；取消不调用运行时，确认才调用
   `finishRemainingUnknown`。

02 不得自行计算答案、词汇量、区间或等级，也不得从 profile 生成综合 CEFR。

## 给 04：R1 档案输入

04 当前只处理 R1 所需的首日保守起点：

- 按 `schemaVersion` 读取 `AbilityProfileR1`；
- 使用 `resultLevel.id`、ordinal、估算区间决定保守词汇起点；
- 听力和口语看到 `pending-calibration` 时使用保守默认值，随后只通过正常训练校准；
- 不得插入强制听力/口语测试；
- 不得借本次接入实现训练顺序、时长、继续训练等排队需求。

## 给 09：验收重点

- 五个候选池均不少于 150，单次每阶段 30、总计 150 且无重复；
- 重测换题、最近一次避题、选项随机；
- 0%、20%、50%、100% 及混合比例；
- 任意分数继续、提交前修改、提交后锁定；
- 未答直接下一题自动写 `uncertain`，任意题号导航不自动写；
- 未答/部分作答阶段可提交并自动补齐；
- 取消快速结束不变更状态；确认后保留既有证据、后续阶段全为 `uncertain`；
- 首题、中间阶段、已提交阶段之后和最后阶段快速结束；
- `all-stages-completed` 与 `remaining-marked-unknown` 可区分；
- 重复确认不改变分数、不重复生成档案，完成快照刷新后可恢复；
- 15 个映射边界；
- 固定题目恢复、离线时间排除、损坏快照拒绝；
- v1/v2 原数据保留且不伪造迁移成绩；
- 正式页面和快照不泄露显式答案键；
- 正式站与真实 iPhone 完整路径。

03 本轮修补只解锁 00 审查和 02 的 R1 界面修补，不代表整条 R1 已完成。之后仍需 01
生产接入、部署、09 正式站/真机回归和用户实际入口验收。
