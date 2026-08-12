# 05 → 06/07/08/09｜首批课程包交付（v1.0.0）

## 交付状态

课程包 `survival-travel-american-4w@1.0.0` 已发布。唯一入口：

`content/curriculum/package-index.v1.json`

接收任务不得扫描目录猜文件，也不得复制后形成各自不一致的内容版本。

## 包规模

| 项目 | 数量 |
| --- | ---: |
| 周 | 4 |
| 顺序内容块 | 28 |
| 学习单元 | 84 |
| 词汇单元 | 28 |
| 听力单元 | 28 |
| 口语单元 | 28 |
| 场景测验项 | 84 |
| 旧版候选兼容时长 | 75,600 秒 |
| R3 结构化内容基线 | 17,566 秒 |
| 其中：词汇 / 听力 / 口语 | 4,740 / 7,238 / 5,588 秒 |
| 词汇项（含综合日复用项） | 163 |
| 场景 | 10 |

难度覆盖内部等级 `0.5–5.5`。高于此范围的用户可以使用内容补缺，但接收任务不得把
该包宣传为 B2–C2 课程。

## 共同接入要求

1. 先验证 `schemaVersion === 1` 和 `packageVersion === 1.0.0`。
2. 按包入口的 `lessonFiles` 顺序读取，不依赖文件系统排序。
3. 从学习单元字段投影 04 的 `LearningCandidate`；只在运行时计算
   `prerequisitesMet`。
4. 必须原样投影 `durationBaseline`。`estimatedSeconds = 900` 只在旧内容恢复或
   缺少结构化字段时作为低置信回退，不得标记为 `structured-content`。
5. 训练模块只消费 `LearningTask.targetModuleId` 与本模块相同的任务。
6. 完成、暂停、跳过和不可评分结果按 04 的 v1 事件契约上报。
7. 未识别 activity、损坏 `contentRef` 或缺失资源必须按内容故障处理，不能算学习者
   做错。
8. `recommendedDay` 是解锁顺序，不是固定每日计划；不得绕开 04 自己拼 45 分钟课表。

R3 作者规则：

- `content/curriculum/duration-baseline-authoring.v1.json`
- `content/curriculum/validate-duration-baselines.v1.mjs`

## 交付给 06｜词汇训练

消费：

- `domain === "vocabulary"` 的 28 个单元；
- `activity.type` 为 `vocabulary-set` 或 `vocabulary-review`；
- lesson 中 `domain === "vocabulary"` 的 `sceneQuiz`。

关键字段：

- `items[].term`
- `items[].partOfSpeech`
- `items[].meaningZh`
- `items[].exampleEn`
- `items[].exampleZh`
- `reviewItemIds`

限制：

- 中文义和中文例句用于解释，不直接充当唯一字符串答案。
- `reviewItemIds` 已验证均指向更早出现的词汇项。
- 06 负责题型、答案判定和反馈；不得回写或扩写课程内容。

建议错误标签：`meaning-recall`、`form-recall`、`word-choice`、
`task-understanding`。

## 交付给 07｜听力训练

核心场景理解内容消费：

- `domain === "listening"` 的 28 个单元；
- 三类 activity：`listening-dialogue`、`listening-narrative`、
  `listening-announcement`；
- lesson 中 `domain === "listening"` 的 `sceneQuiz`。

新增结构化练习的唯一入口：

`content/curriculum/listening-exercise-extension-index.v1.json`

该扩展是只增不改的旁路包，挂接当前核心课程 `1.0.0`。07 不得扫描目录猜文件。
详细接入与验收见：

`content/curriculum/listening-exercise-handoff-v1.md`

关键字段：

- 新题型判别：`exercises[].type`
- 新音频来源判别：`audioSource.sourceType`
- 稳定片段：`audioSource.segmentId`
- TTS 来源：`audioSource.locale`、`audioSource.ttsText`
- transcript 引用：`audioSource.baseContentRef`、`lineIndex`、`expectedText`
- 新选择题答案：`options[].optionId`、`correctOptionId`
- 听写答案：`targetKeywords`、`standardAnswer`、`acceptedAnswers`、
  `normalizationHints`
- 内容播放许可：`playbackPolicy`
- `tts.locale === "en-US"`
- `tts.defaultRate`
- `transcript[].speaker`
- `transcript[].text`
- `transcript[].translationZh`
- `checks[].skill`
- `checks[].options`
- 零基 `checks[].correctOptionIndex`
- `checks[].rationaleZh`

限制：

- 当前 `mediaAssets` 为空，脚本是语音合成源；07 决定合成、播放、速度和离线资源。
- 新选择题使用 `correctOptionId`，不得当作旧的零基 `correctOptionIndex`。
- `transcript-line` 引用必须同时核对 `lineIndex` 和 `expectedText`；不一致是内容故障。
- `playbackPolicy` 只是内容许可，07 仍负责实际控制和设备降级。
- 关键词听写只能使用显式可接受答案与规范化提示，07 不自行编写答案。
- 原有 `activity.checks` 和听力 `sceneQuiz` 继续保留为场景理解选择题。
- 翻译只在答后解释阶段显示，不应在首听时泄露。
- 设备、音频或内容故障必须上报不可评分。

建议错误标签：`sound-discrimination`、`detail-missed`、`inference`、
`task-understanding`。

## 交付给 08｜口语训练

消费：

- `domain === "speaking"` 的 28 个单元；
- `activity.type` 为 `fixed-response` 或 `guided-roleplay`；
- lesson 中 `domain === "speaking"` 的 `sceneQuiz`。

关键字段：

- `partnerLine`
- `cueZh`
- `modelAnswer`
- `acceptedAnswers`
- `requiredConcepts`

限制：

- `modelAnswer` 是示范，不是唯一正确字符串。
- `acceptedAnswers` 是受控备选，不构成通用语义评分器。
- `requiredConcepts` 是内容标签，不是 05 制定的逐词命中算法。
- 08 自行定义有限文本匹配；不得升级为开放式 AI 对话或专业发音评分。
- 权限、网络和识别失败必须降级到录音回放，并上报不可评分。

建议错误标签：`pronunciation`、`fluency`、`grammar`、`word-choice`、
`task-understanding`。

## 交付给 09｜测试与验收

内容包最低验收基线：

1. 包入口声明的全部文件存在且 JSON 可解析。
2. 三份 JSON Schema 分别验证包入口、课程清单和四个周内容文件。
3. 28 个 `recommendedDay` 连续且不重复。
4. 每个内容块恰有 vocabulary、listening、speaking 各一个单元。
5. 84/84 个单元都有完整 `durationBaseline`；`estimatedSeconds === 900` 仅作为旧版
   兼容字段保留。
6. 全包 `learningUnitId`、`contentRef`、lesson ID、题目 ID 唯一。
7. 前置链只指向前一天同专项单元，无缺失、逆向或循环。
8. 所有选择题答案索引在选项范围内。
9. 所有固定口语示范答案均包含在 `acceptedAnswers` 中。
10. 所有复用词汇 ID 指向更早的有效词汇项。
11. 目标语言为 `en-US`，无 TODO、TBD 或占位内容。
12. 简单求助课存在安全说明，不提供诊断或固定紧急电话号码。
13. 结构化听力扩展有 28 课、84 题、84 个唯一片段，三种新题型各 28 题。
14. 所有 transcript 行引用存在且与 `expectedText` 完全一致。
15. 新选择题答案 ID 命中唯一选项；听写标准答案位于可接受答案集合。
16. 核心包、周内容和既有 `contentRef` 未被扩展修改。
17. 每个 baseline 与实际题量、prompt、听力片段和作者规则逐字段一致。
18. 听力名义秒数可由词元、标点、核心检查次数、扩展 primary 片段及场景音频复算。
19. 三个专项内部均随内容量变化，84 个结果不是 900 秒常数；首日三项也不是机械
    等分。

09 还需在真实模块中验证：

- 06/07/08 是否能通过 `contentRef` 加载正确 activity；
- 04 是否只把前置条件满足的单元加入候选；
- 离线状态下词汇和已安装听力资源是否可用；
- iPhone Safari 的实际美式语音音色、断句和速度；
- 识别、权限、音频和内容故障是否按不可评分处理。

## 已验证证据

内容专项检查：

- 核心包 3 份 Schema、1 份包入口、1 份课程清单和 4 份周内容 JSON 全部通过；
- 28 课、84 单元、84 测验项与清单计数一致；
- vocabulary/listening/speaking 各 28 单元；
- 旧版候选兼容时长 75,600 秒；
- 84 个结构化内容基线合计 17,566 秒，词汇/听力/口语分别为
  4,740/7,238/5,588 秒；
- 163 个词汇项；
- 前置链和复用引用完整；
- 听力扩展 2 份 Schema、1 份入口和 1 份练习包全部通过；
- 听力扩展覆盖 28 课、84 题和 84 个稳定片段，三种新题型各 28 题；
- transcript 引用、选择题答案和听写答案完整；
- 无 TODO、TBD、PLACEHOLDER、待补或占位内容。

项目级检查：

```text
05 / QA-009 定向：5 个测试文件、38 项测试通过
全量：113 个测试文件、585 项测试通过
lint、TypeScript、Vite build、课程发布资源校验、PWA 20 项预缓存通过
```

当前全量并非全绿：`tests/qa/first-use-production.acceptance.test.ts` 仍断言
`plannedSeconds === 2700`，R17 扩充日常词汇库后，生产首日计划按结构化内容事实得到 1033 秒，因此全量结果为
1 个测试文件 / 1 项失败。该断言属于 09 所有权，05 不得把内容重新膨胀为 2700 秒来
换取通过。`tests/e2e/r3-duration-baseline-regression.mjs` 在当前受限环境中又因本地
socket `EPERM` 未能启动；需由 00/09 在允许浏览器连接的环境中复验。

## 已知限制

- 首批内容只覆盖内部等级 `0.5–5.5`。
- 当前没有预录音频；不同 Safari 系统音色的自然度需要 07/09 实机验证。
- 结构化基线是无个人历史时的透明估算，不是设备 TTS 精确测量。
- 当前新内容平均每天约 10.5 分钟，明显少于 45 分钟目标；不得通过回填 900 秒掩盖，
  内容扩充需另立需求。
- 新听力题型已提供内容与播放许可，但播放控制、设备支持和判定仍需 07 实现并验证。
- 固定口语答案集合不是开放式语言理解，08 必须保持能力声明诚实。
- 机场、酒店、退换货、税、小费和紧急服务规则会因地点变化；课程只教语言意图，
  使用时以现场规则为准。
