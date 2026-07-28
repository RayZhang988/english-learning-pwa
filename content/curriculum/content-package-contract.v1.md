# 05｜课程内容数据契约（v1）

## 1. 包入口

消费者先读取：

`content/curriculum/package-index.v1.json`

再按 `manifestFile` 和 `lessonFiles` 读取课程。所有路径均相对于项目根目录，不允许消费
者猜测目录或通过文件名排序替代清单。

## 2. 版本

课程包同时维护两个版本：

- `schemaVersion`：数据形状版本，当前固定为整数 `1`；
- `packageVersion`：内容版本，当前为 `1.0.0`。

消费方遇到未知 `schemaVersion` 必须停止读取并报告内容版本错误，不能按 v1 猜字段。

内容版本规则：

1. 修正标点、翻译或不影响答案的措辞：补丁版本。
2. 新增兼容内容块、答案变体或资源：次版本。
3. 改变 ID、删除内容、改变答案语义或破坏兼容：主版本。
4. `learningUnitId` 表示跨版本学习进度身份；纯文字修订可以保留。
5. `contentRef` 指向精确包版本。已经进入复习状态的旧 `contentRef` 必须仍可解析，
   或由文件所有者提供显式迁移；不得静默让旧引用读取新语义。
6. `durationBaseline` 是对既有训练内容量的附加运行时事实，不改变题目、答案、
   `learningUnitId` 或 `contentRef`。为修复 QA-009，当前 `1.0.0` 包在不改变教学语义
   的前提下补齐该字段；旧 `estimatedSeconds` 继续保留用于 schema 1 恢复。

## 3. 课程清单

`curriculum-manifest` 顶层包含：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 内容格式版本 |
| `documentType` | 固定为 `curriculum-manifest` |
| `packageVersion` | 内容版本 |
| `courseId` | 稳定课程 ID |
| `targetLocale` | 目标语言与 TTS 基线，当前 `en-US` |
| `supportLocale` | 解释语言，当前 `zh-CN` |
| `recommendedDays` | 推荐解锁长度，不是 04 的每日计划 |
| `dailyCandidateSeconds` | 旧版 2700 秒兼容值，不再是预计时长真值 |
| `lessonFiles` | 必须读取的周内容文件 |
| `totals` | 包级期望数量，用于完整性检查 |
| `difficultyScale` | 03/04 内部等级范围及非认证声明 |
| `sceneOrder` | 场景顺序 |
| `scenes` | 场景目标、核心词汇和句型 |

## 4. 周内容文件

每个 `lesson-week` 文件包含 7 个 `lessons`。每个 lesson 必须有：

- 唯一 `lessonId`；
- `recommendedDay`，范围 `1–28`；
- 至少一个 `sceneId`；
- 至少两个可观察目标；
- 三个 `learningUnits`，分别属于 vocabulary、listening、speaking；
- 至少三个 `sceneQuiz` 项。

推荐日只决定内容解锁顺序。04 仍根据能力、复习、重试和可用时间生成实际每日计划。

## 5. 学习单元

每个 `learningUnit` 必须包含：

| 字段 | 规则 |
| --- | --- |
| `learningUnitId` | 全包唯一、稳定、非空 |
| `contentRef` | 全包唯一，格式为 `lesson://<course>/<package>/<day>/<domain>` |
| `domain` | `vocabulary`、`listening`、`speaking` 之一 |
| `difficultyLevel` | 03/04 的 `0–12` 内部等级 |
| `estimatedSeconds` | 旧版兼容值；当前保留 900，不再作为新任务预计时长真值 |
| `durationBaseline` | 04 原生 schema v1 内容量基线，必须由作者规则复算 |
| `tags` | 只放可移植字符串，用于内容筛选和事件上报 |
| `prerequisiteUnitIds` | 前置学习单元 ID；空数组表示首个单元 |
| `activity` | 该专项的训练内容 |

当前活动类型：

- 06：`vocabulary-set`、`vocabulary-review`
- 07：`listening-dialogue`、`listening-narrative`、`listening-announcement`
- 08：`fixed-response`、`guided-roleplay`

未知活动类型必须显式失败，不能降级成另一题型后仍上报可评分结果。

## 6. 向 04 投影 `LearningCandidate`

05 不复制候选列表。集成方从所有当前已安装的 `learningUnits` 投影：

```ts
{
  schemaVersion: 1,
  learningUnitId: unit.learningUnitId,
  contentRef: unit.contentRef,
  domain: unit.domain,
  difficultyLevel: unit.difficultyLevel,
  estimatedSeconds: unit.estimatedSeconds,
  durationBaseline: unit.durationBaseline,
  tags: unit.tags,
  prerequisitesMet: runtimeHasCompleted(unit.prerequisiteUnitIds)
}
```

只有 `prerequisitesMet` 是运行时状态。05 只声明 `prerequisiteUnitIds`，不得代替 04
决定用户是否满足前置条件，也不得在课程包中预排当天任务。

### 6.1 R3 内容量基线

公开作者规则位于：

`content/curriculum/duration-baseline-authoring.v1.json`

可复现校验位于：

`content/curriculum/validate-duration-baselines.v1.mjs`

04 使用的原生公式为：

```text
raw = fixedSeconds
    + itemCount × secondsPerItem
    + activeAudioSeconds × expectedAudioPlaythroughs
    + interactionStepCount × secondsPerInteractionStep

estimate = round(clamp(raw, minimumSeconds, maximumSeconds))
```

首批包的统一作者常量：

| 专项 | `fixedSeconds` | `secondsPerItem` | 每题交互步数 | `secondsPerInteractionStep` | 范围 |
| --- | ---: | ---: | ---: | ---: | ---: |
| vocabulary | 15 | 12 | 2 | 3 | 90–600 秒 |
| listening | 20 | 10 | 3 | 3 | 150–900 秒 |
| speaking | 25 | 36 | 4 | 4 | 90–720 秒 |

这些常量表达无个人历史时的内容作者假设：

- 各专项 `fixedSeconds` 只覆盖进入任务和阅读一次说明；`secondsPerItem` 覆盖题目本身
  的阅读、判断、准备或简短作答；交互步时间只覆盖实际按钮动作和反馈推进，不含加载、
  权限、网络或后台等待。
- 词汇 `itemCount` 是去重后的新词/复习词训练题，加实际生成的场景题；没有内容音频，
  因此 `activeAudioSeconds` 和播放次数均为 0。
- 听力 `itemCount` 是三道扩展题、全部核心检查和一题场景测验。正常完成假设每题首播
  一次，`expectedAudioPlaythroughs = 1`；用户主动重复是个体行为，不预先虚增。
- 口语 `itemCount` 是实际 prompt 数。`partnerLine` 当前只显示，用户录音与回放不是
  内容拥有的固定音频，因此 `activeAudioSeconds = 0`；准备、录音、回放决定和反馈由
  每题时间与交互步骤表达。
- min/max 是损坏数据或未来异常稀疏/密集内容的保护，不是把短内容填满到 15 分钟的
  手段。当前 84 个 raw 值都落在各专项范围内，没有靠边界制造结果。

听力名义音频秒数不是设备实测。作者规则以产品 1×、`en-US`、150 个英文词元/分钟
为基线，每词元 0.4 秒；逗号、分号、冒号各加 0.18 秒，句号、问号、感叹号各加
0.32 秒，每个 utterance 至少 0.8 秒。词元、标点正则和舍入方式都在规则 JSON 中
版本化。

听力一轮正常完成的 `activeAudioSeconds` 包含：

1. 每道扩展题的 primary TTS 或 transcript 片段一次；
2. 完整 transcript 按核心检查题数量各播放一次；
3. 场景测验 `audioText` 一次。

当前发布包的结构化总量为 17,566 秒：词汇 4,740、听力 7,238、口语 5,588。
旧 `candidateSeconds = 75,600` 只保留兼容。04/01 不得用每日 45 分钟预算反向改写
单元预计时长，也不得在 `durationBaseline` 缺失或非法时静默假装成结构化内容。

投影时还必须排除：

- 未安装或损坏的内容文件；
- `contentRef` 无法解析的单元；
- 目标训练模块尚未交付的单元；
- 未识别的 schema 或活动类型。

## 7. 06 词汇消费规则

- `items` 提供词/短语、词性、中文义、英文例句和中文解释。
- `vocabulary-review.reviewItemIds` 引用本包已出现的词汇项；引用不存在时内容损坏。
- `meaningZh` 和 `exampleZh` 是教学解释，不是判题输入。
- 06 自己决定题型状态机和标准化表现分；不得把所有例句的表面字符串完全相同当作
  唯一正确条件。

## 8. 07 听力消费规则

- `tts.locale` 当前固定 `en-US`；`defaultRate` 是内容建议，不是播放器强制值。
- `transcript[].text` 是合成语音源文本，`translationZh` 仅用于答后解释。
- `checks[].correctOptionIndex` 为从 `0` 开始的数组索引。
- `skill` 为 `gist`、`detail`、`inference` 或 `sequence`。
- 首批包不嵌入音频 Blob；07 可据脚本合成或安装离线媒体，但媒体生命周期不归 05。

原有 `activity.checks` 和 lesson 中 `domain === "listening"` 的 `sceneQuiz` 是场景理解
选择题，继续保留，不被扩展题型替换。

### 8.1 结构化听力练习扩展

单词辨音、短句听辨和关键词听写通过独立的只增不改扩展交付。唯一入口：

`content/curriculum/listening-exercise-extension-index.v1.json`

扩展只挂接 `survival-travel-american-4w@1.0.0`，不修改核心包入口、周内容、
`learningUnitId` 或既有 `contentRef`。因此旧消费者可以忽略扩展，07 则必须显式读取
扩展入口，不能扫描目录猜文件。

题型由 `exercises[].type` 判别：

- `word-discrimination`：`options[]` 与 `correctOptionId`；
- `short-sentence-choice`：`options[]` 与 `correctOptionId`；
- `keyword-dictation`：`targetKeywords`、`standardAnswer`、`acceptedAnswers` 与
  `normalizationHints`。

新选择题使用稳定的 `correctOptionId`，不是旧场景题的零基 `correctOptionIndex`。

音频来源由 `audioSource.sourceType` 判别：

- `tts-text` 直接读取 `ttsText`；
- `transcript-line` 通过 `baseContentRef`、零基 `lineIndex` 和 `expectedText` 定位核心
  transcript 行。实际文本不等于 `expectedText` 时必须判为内容损坏，不得猜相邻行。

每个来源都包含全扩展唯一 `segmentId` 与固定 `locale: "en-US"`。
`playbackPolicy` 的 `allowSegmentSelection`、`allowRepeat` 和 `allowedRates` 只声明内容
允许能力；播放控制、设备能力探测和降级仍由 07 实现。

听写题的轻量规范化由 `normalizationHints` 描述。07 只能在显式
`acceptedAnswers` 范围内判定，不能自行扩写内容答案或引入开放式语义评分。

## 9. 08 口语消费规则

- `partnerLine` 是播放或展示给学习者的固定对方话语。
- `modelAnswer` 是示范，不表示只有这一句正确。
- `acceptedAnswers` 是受控可接受表达集合。
- `requiredConcepts` 是内容语义标签，不是现成评分算法或逐字关键词要求。
- 08 负责有限文本匹配、设备失败和录音回放降级；05 不定义相似度阈值、发音分或
  开放式对话。

## 10. 场景测验

当前格式：

- `single-choice`：使用 `options` 与零基 `correctOptionIndex`；
- `fixed-response`：使用 `modelAnswer`、`acceptedAnswers` 和 `requiredConcepts`；
- `intent-matching`：使用 `pairs`。

每个测验项的 `domain` 决定由哪个训练模块消费。模块可以逐题呈现，但不得改变答案
语义。测验分数如何进入学习事件由 06/07/08 负责，整体掌握和复习仍由 04 负责。

## 11. 数据与隐私

- JSON 只包含可移植内容数据，不包含函数、日期对象、Blob 或录音。
- 电话使用北美虚构 `555` 号码，邮箱使用保留域 `example.com`。
- 不包含真实护照、订单、酒店预订、支付或个人联系方式。
- 当前 `mediaAssets` 为空；以后新增媒体必须进入独立资源清单并保留许可证信息。
- 结构化听力扩展同样只含原创文本与引用，不含音频 Blob 或第三方录音。
