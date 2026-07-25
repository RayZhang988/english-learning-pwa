# 06｜词汇训练模块

## 边界

本模块只消费 04 下发的 `targetModuleId === "vocabulary"` 任务和 05 已发布的课程包，
负责题目生成、答题状态、反馈、恢复与标准学习事件。模块不扩写课程、不计算全局掌握度、
不修改 UI 设计系统，也不直接注册应用路由。

## 已批准题型

| 类型 | 输入 | 判定 | 解释来源 |
| --- | --- | --- | --- |
| `term-to-meaning` | 原课程英文词或短语 | 选择对应 `meaningZh` 的稳定选项 ID | 原课程例句与中文解释 |
| `meaning-to-term` | 原课程 `meaningZh` | 选择对应 `term` 的稳定选项 ID | 原课程例句与中文解释 |
| `example-comprehension` | 原课程 `exampleEn` | 选择目标词对应的 `meaningZh` 选项 ID | 原课程 `exampleZh` |
| `scene-word-choice` | 同 lesson 的 vocabulary `sceneQuiz` | 使用原 `correctOptionIndex`，或将 `intent-matching` 按 pair 拆题 | 原课程 `rationaleZh` |

所有干扰项只来自同一学习单元及其合法复习引用，模块不编写新词义或例句。中文解释不是
自由文本判题答案。答错标签只使用 04 已批准的 `meaning-recall`、`form-recall` 和
`word-choice`。

## 输入与输出

- 输入：05 的课程包入口、课程清单、按清单顺序提供的 lesson 文件，以及 04 的
  `LearningTask`。
- 题目输出：`VocabularyQuestion`，包含稳定 ID、提示语言、选项、正确选项、解释和
  标准错误标签。
- 会话输出：可移植的 `VocabularySession`，用于本地恢复和事件 outbox。
- 学习输出：04 定义的 started、paused、skipped、attempt.completed v1 事件。

`VocabularyTrainingScreen` 只接收本模块映射后的 ViewModel；选项视觉状态始终由本模块
状态机决定。

## 运行时接入

公开入口为 `src/features/vocabulary/index.ts`。

- `currentVocabularyContentSource.install()`：通过 01 的
  `OfflineAssetStore` 显式安装包入口、课程清单和四个 lesson 文件。
- `currentVocabularyContentSource.load()`：优先读取已安装离线包，缺失时才访问打包后的
  课程资源，并按 05 的清单顺序构建 `VocabularyCatalog`。
- `VocabularyTrainingRoute`：接收一条 04 下发的词汇 `LearningTask`、`localDate`、
  `PlatformEventSink` 和退出/完成回调，负责加载、恢复、UI 映射与事件 outbox。
- `createVocabularyFeatureModule(routeElement)`：返回匹配 01 预留槽位的
  `FeatureModule`。最终加入 `src/app/module-registry.ts` 仍由 01 负责。

集成层必须先由 04 决定任务，再把同一 `LearningTask` 交给本模块；不得直接按
`recommendedDay` 构造计划。事件接收端应先调用 04 的 `parseLearningEvent()`，再交给
`applyPlanEvent()`；可评分完成事件同时交给 `applyLearningAttempt()`。

## 状态、恢复与错误

- 回答中、反馈中、暂停、完成和不可评分错误均保存在
  `feature.vocabulary` 命名空间，记录版本为 1。
- started、paused、skipped 和 attempt.completed 先写入会话 outbox，再发布；发布成功
  后才移除。崩溃后的重复发布沿用同一事件 ID，由 04 幂等处理。
- 切到后台或退出会暂停任务；恢复后保留当前题、选择和反馈阶段。
- 内容损坏、未知活动、任务元数据不匹配、离线且课程未安装等情况上报
  `result: "unscorable"`，不会生成答错证据或完成任务。
- 离线但内容已安装时训练继续，并通过 02 的 `OfflineNotice` 明示状态。

## 验证

- 06 专项：7 个测试文件、17 项测试通过。
- 覆盖真实 4 周课程包、28 个词汇单元、四类题型、复习引用、判定与非法转换、
  UI ViewModel、四类学习事件、离线读取、恢复和 outbox 重试。
- 项目级 `pnpm check`：27 个测试文件、84 项测试通过；lint、TypeScript、Vite
  生产构建和 PWA 生成通过。
- 模块公开入口另以 Vite SSR 构建验证，57 个模块完成转换。

## 已知限制

1. 01 尚未把真实词汇路由加入生产注册表，因此当前默认 PWA 构建不会包含 06 的业务
   chunk 或触发课程安装；这是 01 步骤 8 的集成工作，不应由 06 修改 `src/app/**`。
2. 02 当前把 `VocabularyTrainingScreen` 的主提示固定标注为 `lang="en-US"`。
   `meaning-to-term` 和部分场景题的中文提示可正常显示，但语言元数据不准确；应由 02
   扩展公开 ViewModel 后由 01 集成，09 需复验 VoiceOver。
3. 第一版只做受控选择，不做自由拼写、模糊文本匹配、游戏化或 AI。
4. 自动测试验证了离线资源接口和恢复语义；真实 iPhone 的安装、后台回收、VoiceOver
   和离线重启仍属于 09 的真机验收。
