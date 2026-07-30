# 05 → 07/09｜结构化听力练习扩展交付（v1.0.0）

## 唯一入口

07 和 09 必须从以下文件进入本扩展：

`content/curriculum/listening-exercise-extension-index.v1.json`

不得扫描 `content/lessons/**` 猜测扩展文件。入口中的 `exerciseBundleFiles` 是有序、
完整的读取清单。

扩展 `survival-travel-american-listening-exercises@1.0.0` 只挂接
`survival-travel-american-4w@1.0.0`。这是只增不改的旁路扩展：

- 不修改核心包 `content/curriculum/package-index.v1.json`；
- 不修改四个周内容文件；
- 不修改既有 `learningUnitId` 或 `contentRef`；
- 06 可以继续只读取核心包入口；
- 原有听力 `activity.checks` 和听力 `sceneQuiz` 继续作为场景理解选择题保留。

## 规模与覆盖

| 项目 | 数量 |
| --- | ---: |
| 内容块 | 28 |
| 稳定音频片段 | 84 |
| 结构化练习 | 84 |
| `word-discrimination` | 28 |
| `short-sentence-choice` | 84 |
| `keyword-dictation` | 28 |

每个内容块恰好包含上述三种题型各一题。

## 题型与答案字段

`exercises[].type` 是唯一题型判别字段：

| `type` | 答案字段 | 用途 |
| --- | --- | --- |
| `word-discrimination` | `options[]`、`correctOptionId` | 单词、短语、数字或代码的辨音 |
| `short-sentence-choice` | `options[]`、`correctOptionId` | 对稳定短句片段作含义或细节选择 |
| `keyword-dictation` | `targetKeywords`、`standardAnswer`、`acceptedAnswers`、`normalizationHints` | 听写场景关键词或短语 |

选择题的 `correctOptionId` 必须命中同题唯一的 `options[].optionId`。它不是数组下标；
不得沿用旧 `correctOptionIndex` 的读取方式。

听写题中：

- `standardAnswer` 必须包含在 `acceptedAnswers`；
- `acceptedAnswers` 已显式列出数字、时间、连字符或缩写等允许变体；
- `normalizationHints` 只声明可做的轻量规范化，不是 05 实现的判题算法；
- 07 不得自行扩写可接受答案或用开放式语义判断替代受控答案。

## 音频来源

每题都通过 `audioSource.segmentId` 提供全扩展唯一的稳定片段 ID，且
`audioSource.locale` 固定为 `en-US`。

`audioSource.sourceType` 是音频来源判别字段：

1. `tts-text`
   - 直接使用 `audioSource.ttsText` 作为美式 TTS 源文本。
2. `transcript-line`
   - 先用 `audioSource.baseContentRef` 定位核心听力单元；
   - 再用零基 `audioSource.lineIndex` 定位 `activity.transcript` 行；
   - 加载出的 `transcript[lineIndex].text` 必须与 `audioSource.expectedText` 完全一致；
   - 不一致表示内容版本或引用损坏，不能猜测相邻行，也不能给学习者记错。

扩展不包含音频 Blob。07 负责 TTS、播放状态、离线降级和资源生命周期。

## 播放能力声明

每题都有 `playbackPolicy`：

- `allowSegmentSelection`：内容是否允许学习者选中本题稳定片段逐句训练；
- `allowRepeat`：内容是否允许重复播放；
- `allowedRates`：内容允许提供的速度集合，当前只使用 `0.75`、`1`、`1.25`。

这些字段只描述内容许可，不实现控制器、不规定按钮外观，也不保证设备一定支持。
07 必须把设备能力与内容许可取交集；设备或资源失败时按 07 契约降级。

## R3 名义音频时长

核心听力单元的 `durationBaseline.activeAudioSeconds` 按
`content/curriculum/duration-baseline-authoring.v1.json` 复算。它包含每道扩展题
primary 来源一次、完整 transcript 按核心检查数各一次、场景 `audioText` 一次。

`expectedAudioPlaythroughs` 固定为 1，表示正常完成每题的一次首播；内容允许重复不等于
预计必然重复，用户额外播放由真实有效计时和个人历史吸收。名义秒数以 1×、150
英文词元/分钟及版本化标点停顿计算，只是无历史时的内容基线，不声称等于某台设备的
Web Speech 实际时长。

## 07 接入顺序

1. 读取扩展唯一入口并验证其 Schema。
2. 验证核心包入口存在且为 `survival-travel-american-4w@1.0.0`。
3. 按 `exerciseBundleFiles` 读取并验证练习包。
4. 以 `listeningUnitId` 或 `baseContentRef` 挂接现有听力单元。
5. 根据 `exercises[].type` 分派题型。
6. 根据 `audioSource.sourceType` 无猜测定位 TTS 文本或 transcript 行。
7. 根据显式答案字段判定；内容故障上报不可评分。
8. 原有 `activity.checks` 和听力 `sceneQuiz` 继续用于场景理解题，不迁移、不删除。

## 09 验收基线

09 至少复现以下检查：

1. 扩展入口、入口声明的 Schema、练习包和文档全部存在。
2. 入口和练习包分别通过对应 Draft 2020-12 Schema。
3. 28 个核心 lesson、听力单元和 `baseContentRef` 一一对应。
4. 每课三种题型各一题，总计 84 题、84 个唯一 `segmentId`。
5. 所有 `transcript-line` 的引用行存在，且文本与 `expectedText` 完全一致。
6. 每道选择题的 `correctOptionId` 命中唯一选项。
7. 每道听写题的 `standardAnswer` 在 `acceptedAnswers` 中，目标关键词非空。
8. 每题 locale 为 `en-US`，播放速度只使用 Schema 允许值。
9. 核心包入口、四周文件、既有 ID 和 `contentRef` 没有被扩展覆盖。
10. 原有场景理解选择题仍可由 07 加载。

## 限制

- 本扩展提供内容事实，不提供播放器、TTS 实现、判题算法、事件上报或 UI。
- 单词辨音使用受控最小对比或近音干扰项，但不声称构成完整音系课程。
- `acceptedAnswers` 是首批受控答案集合；新增答案变体必须发布扩展的新兼容版本。
- 当前只统一标准美式 `en-US`；后续多口音只能新增明确变体，不得静默改写答案。
