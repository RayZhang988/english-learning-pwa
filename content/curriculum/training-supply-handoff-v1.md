# 05 → 06 / 07 / 08｜连续训练内容供应交接（v1.1）

## 唯一内容入口

读取 `content/curriculum/package-index.v1.json` 的
`trainingSupplyIndexFile` 和 `trainingSupplyIndexSchemaFile`，当前分别为：

`content/curriculum/training-supply-index.v1.json`

`content/curriculum/training-supply-index.schema.v1.json`

该文件是 05 对 `LearningTaskSupplyRequest` 的公开、静态候选来源；不是 04 的
复习排序器，也不是模块状态机。读取后按 `domain`、`targetModuleId`、`mode`、
`targetDifficulty`、`cursor` 和 `excludeItemIds` 选择一个 `candidates[]` 项，原样作为
`LearningTaskSupplyItem` 返回，并把所选 `itemId` 作为 `nextCursor`。

`supplyVersion: 1.1.0` 以向后兼容方式补充了 R6 所需的
`candidate.variantFamilyId` 与 `supplyPolicy.extraTrainingPriority`。候选数量仍为 808；
不存在新增、重复或虚构练习。

`supplyVersion: 1.4.0` 新增 R15 的两个只读内容事实：
`candidate.knowledgePointId` 将同一正式教学内容的题型变体归一，
`candidate.semanticCategoryId` 用于语义冷却。它们由
`training-supply-semantic-taxonomy.v1.json` 和已发布题目事实确定性生成；
旧的 `itemId`、`variantFamilyId`、`source`、`contentRef`、答案、翻译及
`playbackContentId` 不变。下游不得用 scene/focus 标签自行重算这两个字段。

## 固定选择语义

1. 只接受 `schemaVersion: 1`，且 `domain === targetModuleId`；不匹配、未知 mode、
   非法 cursor 或无法读取索引均返回 `content-exhausted / provider-failure`。
2. 支持目标难度为 `0–5.5`。`0–<0.5` 使用初学者下限带 `0.5–2.5`；其余使用
   `abs(candidate.difficultyLevel - targetDifficulty) <= 1.5`。范围外且没有候选时返回
   `no-eligible-content`，不得偷偷改用远低于目标的题。
3. `allowedModes` 必须包含 request 的 `mode`。04 负责把错题、到期复习和重试需求放入
   请求/任务策略；05 不伪造这类优先级。
4. 从符合条件且不在 `excludeItemIds` 的候选中，使用计划/任务或额外训练会话身份
   形成稳定随机种子。相同恢复状态必须得到相同下一题，不同训练会话应得到不同顺序。
5. 最近 10 题用于题型平衡；最近 4 题的 `variantFamilyId` 进入同一对话冷却区，
   有其他合格内容时不得再次选择。同一题型不得连续出现，除非没有更合适的合格项。
6. `cursor` 继续验证恢复身份，但不再表示固定文件顺序中的下一项。
7. `excludeItemIds` 覆盖当前 900 秒流已经完成的全部 item ID。所有合格项均被排除时，
   返回 `all-eligible-content-recently-used`；绝不以另一个 ID 循环完全相同的题。

## R6 额外训练优先级接口

04 的 `ExtraTrainingSupplyRequest` 必须发布下面的附加输入，才能让 05 精确执行已批准的
优先级，而不是按课程顺序猜测学习历史：

```ts
readonly priorityItemIds: Readonly<Record<
  ExtraTrainingContentPriority,
  readonly string[]
>>
```

- `recent-error`、`due-review` 和 `same-day-variant` 的数组元素必须是本索引中已发布的
  `candidate.itemId`，不能是 `learningUnitId`、`contentRef`、词条 ID 或临时 UI ID。
  `new-optional-content` 必须为 `[]`。
- 每个数组按 04 已确认的优先顺序排列。05 只做确定性解析，不重排、不从学习单元反推错误题。
- 先尝试 `recent-error`，再尝试 `due-review`；命中项须与请求的 domain、mode、难度及
  `excludeItemIds` 同时兼容，返回该精确的已发布 itemId。
- `same-day-variant` 输入的是当天已经使用的 itemId。05 从相同
  `candidate.variantFamilyId` 中选择另一条合格且未排除的已发布候选。词汇族是同一词条的三种
  题面；听力和口语族是同一已发布 learning unit 内的不同练习，不会返回输入本身。
- 某优先桶没有合格项时，只能按
  `recent-error → due-review → same-day-variant → new-optional-content` 继续；最后一桶仍按
  `supplyOrder`/cursor 选择新候选。不得清空排除集或重复同一道题。
- 未知 priority itemId、坏 mode、坏 cursor、损坏索引均返回
  `content-exhausted / provider-failure`；全部合格候选被排除时返回
  `all-eligible-content-recently-used`；目标难度没有候选时返回 `no-eligible-content`。

04 提交 `16bed6d` 已将该字段持久化到额外训练会话，并在创建时校验四个组和全局去重；旧会话
兼容为空组。05 的 `validate-extra-training-priority-contract.v1.mjs` 直接读取该公开类型，
防止后续契约回退为只有优先级名称的普通顺序选题。

三个耗尽原因必须原样发布为 `learning.training.content.exhausted.v1`：

| 原因 | 含义 | 模块不得做的事 |
| --- | --- | --- |
| `no-eligible-content` | 当前目标难度/专项/mode 没有课程候选 | 擅自跨到不相称难度或报完成 |
| `all-eligible-content-recently-used` | 当前流的排除集合已覆盖全部合格候选 | 清空排除集合后循环旧题 |
| `provider-failure` | 索引损坏、版本不支持、cursor/source 无法解析 | 用任意首题替代或伪造新题 |

## 模块输入

| 接收方 | `source.sourceType` | 必须解析的已有内容 | 不能猜测 |
| --- | --- | --- | --- |
| 06 | `vocabulary-item` | `sourceId` 对应词条，`variantId` 是三种不同题面，`distractorItemIds` 是稳定选项来源 | 新词、正确答案、干扰项或变式 ID |
| 07 | `listening-extension`、`listening-core-check`、`listening-scene-quiz` | 对应 exercise/check/scene quiz，音频仍以现有 TTS/segment 引用播放 | 新脚本、音频文本、答案或 speaker 文本 |
| 08 | `speaking-prompt`、`speaking-scene-quiz` | 对应 prompt 或场景固定回答及其 `acceptedAnswers` | 开放式回答、未声明的匹配规则或专业发音评分 |

候选 `nominalEffectiveSeconds` 只用于内容容量审计，不能驱动 900 秒倒计时；有效时间
仍由 01/04/06/07/08 的真实前台片段决定。

## 容量与限制

发布索引有 808 个稳定候选：词汇 489（163 个词条 × 3 种不同题面）、听力 197、
口语 122。对支持的目标难度 0–5.5，验证器要求每个专项的合格候选同时达到：

- 词汇至少 50 项；
- 听力至少 24 项；
- 口语至少 18 项；
- 各自名义内容量至少 900 秒。

这保证正常单次 15 分钟流不会退化为循环同 6 题；它不可能承诺对无限快点击提供无限新题。
若用户在名义量耗尽前已经完成全部去重候选，必须诚实进入 `content-exhausted`，由 04 保持
blocked，而不是重复或伪造完成。

## 验证

运行：

```text
node content/curriculum/validate-training-supply.v1.mjs
node content/curriculum/validate-extra-training-priority-contract.v1.mjs
```

第一个校验器从四周课程与听力扩展重新生成 808 项，验证 source 引用、稳定顺序、变式族、
3 种词汇题面、每个支持难度带的容量、包入口总数、优先桶回退、游标恢复、排除、未知身份和
无短期重复。第二个校验器固定 04 必须提供的精确身份输入。

## 01 集成前置条件

本交付只创建内容入口，不修改 `src/app/**`。当前生产构建仍只发布核心课程和听力扩展
索引，尚未把 `trainingSupplyIndexFile` 作为独立构建资源或 PWA 预缓存资源输出。01 必须
将该路径接入课程资源加载和构建发布策略，再由 06/07/08 消费；在这之前模块不能假装
已经从生产包读取了连续供应索引。
