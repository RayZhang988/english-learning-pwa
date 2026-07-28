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

- 输入：05 的课程包入口、课程清单、按清单顺序提供的 lesson 文件、连续供应索引，以及
  04 的 `LearningTask`。
- 题目输出：`VocabularyQuestion`，包含稳定 ID、提示语言、选项、正确选项、解释和
  标准错误标签。
- 会话输出：可移植的 `VocabularySession`，用于本地恢复和事件 outbox。
- 学习输出：04 定义的 started、paused、skipped、attempt.completed v1 和训练流
  `item-completed` / `content-exhausted` / `budget-completed` 事件；注入
  01 计时 factory 后，由共享 session 另行发布
  `learning.timing.segment.recorded.v1`。

`VocabularyTrainingScreen` 只接收本模块映射后的 ViewModel；选项视觉状态始终由本模块
状态机决定。

## 运行时接入

公开入口为 `src/features/vocabulary/index.ts`。

- `currentVocabularyContentSource.install()`：通过 01 的
  `OfflineAssetStore` 显式安装包入口、供应索引、课程清单和四个 lesson 文件。
- `currentVocabularyContentSource.load()`：优先读取已安装离线包，缺失时才访问打包后的
  课程资源，并按 05 的清单顺序构建 `VocabularyCatalog`。
- `VocabularyTrainingRoute`：接收一条 04 下发的词汇 `LearningTask`、`localDate`、
  `PlatformEventSink`、可选 `timingSessionFactory` 和退出/完成回调，负责加载、恢复、
  UI 映射与事件 outbox。
- `createVocabularyFeatureModule(routeElement)`：返回匹配 01 预留槽位的
  `FeatureModule`。最终加入 `src/app/module-registry.ts` 仍由 01 负责。

集成层必须先由 04 决定任务，再把同一 `LearningTask` 交给本模块；不得直接按
`recommendedDay` 构造计划。事件接收端应先调用 04 的 `parseLearningEvent()`，再交给
`applyPlanEvent()`；可评分完成事件同时交给 `applyLearningAttempt()`。

课程解析只把 `schemaVersion`、`domain`、`targetModuleId`、`contentRef`、
`learningUnitId`、`difficultyLevel` 和 `tags` 作为发布内容身份。04 在每次计划生成时
计算的 `estimatedSeconds` / `durationEstimate` 是动态执行元数据，不得与课程 schema
为兼容旧调用方保留的 `estimatedSeconds` 做等值比较。旧任务可以继续使用课程中的
900 秒兼容值；结构化基线或个人历史生成的任务则原样保留本次真实估算。

### R3 有效计时接入

- 06 公开 `VocabularyEffectiveTimingSessionFactoryPort`，其结构与 01 的
  `ProductionEffectiveTimingSessionFactory` 兼容。06 不读取浏览器可见性、不创建时钟、
  快照、事件 ID 或空闲定时器。
- 初始化、课程读取、会话恢复、业务事件发布和模块仓储等待声明为
  `loading / content-loading`；可作答阶段声明为
  `answering / active-answering`，反馈查看声明为
  `feedback / active-feedback`，业务暂停调用共享 `pause()`。
- 选择、提交、下一题和恢复会记录 activity。01 统一处理 DOM 活动、45 秒空闲、
  页面后台和崩溃快照；06 不补算离线时间。
- 旧计划的最后一题，以及预算任务的 `budget-completed`，都必须先让最后一个 timing
  segment 成功结算；失败时事件保留在模块 outbox，重试仍先重试同一 timing session。
- 01 的精确生产接入点是
  `src/app/learning/training-route-hosts.tsx` 中的 `VocabularyTrainingRoute`：
  传入 `timingSessionFactory={productionEffectiveTimingSessions}`。这项应用集成不属于
  06 文件所有权。

## 状态、恢复与错误

- 回答中、反馈中、暂停、完成和不可评分错误均保存在
  `feature.vocabulary` 命名空间，记录版本为 1。
- 恢复身份使用 `taskId`、`planId`、`learningUnitId`、`contentRef`、`domain`、
  `targetModuleId` 和 `mode`。动态预计时长变化不会拒绝已有会话，也不会把已落盘
  session 中的原任务静默替换；后续完成事件继续使用该会话实际持有的任务估算。
- 具有 `trainingBudget` 的新计划改为单题连续流：供应索引的 `itemId` 是题目身份，
  每次已评分题目先写入 `completedItemIds`、`nextSupplyCursor` 与事件 outbox，刷新后以
  相同排除集请求下一题，绝不回绕重复。没有 `trainingBudget` 的旧计划仍使用原六题单元
  与原完成语义。
- 04 将预算置为 `finish-current-item` 后，06 保留正在作答或查看反馈的题；该题完成后才
  发布 `learning.training.budget.completed.v1`。供应器返回内容耗尽时发布明确
  `content-exhausted` 原因，保存当前 cursor/排除集并停在可恢复错误态；`retrySupply()`
  只能从该状态重试，不能清空排除集或伪造 task completion。
- 已发布 `content-exhausted` 后，供应恢复成功会先以稳定 outbox ID 发布
  `learning.training.content.recovered.v1`，其 `exhaustionRequestId` 精确对应此前耗尽
  请求；该事件成功后才保存并展示新题。恢复发布失败可跨刷新重试同一事件，且不重置
  cursor、排除集或已完成题目。
- started、paused、skipped 和 attempt.completed 先写入会话 outbox，再发布；发布成功
  后才移除。崩溃后的重复发布沿用同一事件 ID，由 04 幂等处理。
- 选择、提交、下一题、暂停/退出及 outbox 更新进入同一运行时队列；即使本地仓库写入
  变慢或 Promise 乱序完成，持久化顺序仍与用户操作顺序一致。
- Route 只通过 `VocabularyTrainingRuntime.subscribe()` 接收会话更新；操作 Promise
  不再直接回写 UI，避免旧操作完成后覆盖较新的题目状态。
- Route 在操作持久化完成前禁用题目与主操作，重复点击由同步门禁忽略；退出仍排入
  runtime 队列，确保先保存当前操作再保存暂停状态。
- 未完成任务退出或真实 Route 卸载会 `dispose()` 计时 session；React StrictMode 的
  cleanup/setup 探测不会误关仍在使用的 session。完成任务调用 `finish()`，不保留
  可恢复计时快照。
- 切到后台或退出会暂停任务；恢复后保留当前题、选择和反馈阶段。
- 内容损坏、未知活动、任务元数据不匹配、离线且课程未安装等情况上报
  `result: "unscorable"`，不会生成答错证据或完成任务。
- 离线但内容已安装时训练继续，并通过 02 的 `OfflineNotice` 明示状态。

## 验证

- QA-011 本地定向：11 个测试文件、37 项测试通过。
- 覆盖真实 4 周课程包、28 个词汇单元、四类题型、复习引用、判定与非法转换、
  UI ViewModel、四类学习事件、离线读取、恢复和 outbox 重试。
- QA-005 回归使用可控慢仓库覆盖乱序选择写入、旧题选项到达新题、下一题乐观发布、
  选择→提交→下一题→退出的持久化顺序，以及跨微任务订阅状态单调性。
- R3 使用真实 `EffectiveTimingSession` 与手动单调时钟覆盖内容加载、慢持久化、
  answering/feedback、45 秒空闲、后台、刷新恢复、卸载、完成事件顺序及失败重试。
- QA-010 覆盖课程旧 900 秒与结构化任务 123 秒并存、`durationEstimate` 有/无、旧任务、
  静态身份损坏、恢复不覆盖原任务及 completion 保留真实任务估算。本地生产浏览器从
  首日真实 123 秒词汇入口成功进入 6 题训练，不再进入不可评分错误页。
- QA-011 覆盖供应索引稳定选择、排除集不回绕、已批准变式映射、逐题事件、跨题不重复及
  `finish-current-item` 后才产生预算完成事件。

## 已知限制

1. 01 仍须在正式路由注入 04 已恢复的 `trainingBudgetStatus`，并把供应索引列入应用级
   PWA 预缓存；06 的默认本地供应器只保证模块资产读取，不能替代 01 的正式集成。
2. 02 当前把 `VocabularyTrainingScreen` 的主提示固定标注为 `lang="en-US"`。
   `meaning-to-term` 和部分场景题的中文提示可正常显示，但语言元数据不准确；应由 02
   扩展公开 ViewModel 后由 01 集成，09 需复验 VoiceOver。
3. 第一版只做受控选择，不做自由拼写、模糊文本匹配、游戏化或 AI。
4. 自动测试验证了离线资源接口和恢复语义；真实 iPhone 的安装、后台回收、VoiceOver
   和离线重启仍属于 09 的真机验收。
