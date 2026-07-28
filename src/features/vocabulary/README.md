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
- 学习输出：04 定义的 started、paused、skipped、attempt.completed v1 事件；注入
  01 计时 factory 后，由共享 session 另行发布
  `learning.timing.segment.recorded.v1`。

`VocabularyTrainingScreen` 只接收本模块映射后的 ViewModel；选项视觉状态始终由本模块
状态机决定。

## 运行时接入

公开入口为 `src/features/vocabulary/index.ts`。

- `currentVocabularyContentSource.install()`：通过 01 的
  `OfflineAssetStore` 显式安装包入口、课程清单和四个 lesson 文件。
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
- 最后一题的 `finish()` 必须成功后，06 才发布
  `learning.attempt.completed.v1`。失败时 completion 保留在模块 outbox，重试仍先重试
  同一 timing session 的 pending event。
- 01 的精确生产接入点是
  `src/app/learning/training-route-hosts.tsx` 中的 `VocabularyTrainingRoute`：
  传入 `timingSessionFactory={productionEffectiveTimingSessions}`。这项应用集成不属于
  06 文件所有权。

## 状态、恢复与错误

- 回答中、反馈中、暂停、完成和不可评分错误均保存在
  `feature.vocabulary` 命名空间，记录版本为 1。
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

- 06 专项：10 个测试文件、32 项测试通过。
- 覆盖真实 4 周课程包、28 个词汇单元、四类题型、复习引用、判定与非法转换、
  UI ViewModel、四类学习事件、离线读取、恢复和 outbox 重试。
- QA-005 回归使用可控慢仓库覆盖乱序选择写入、旧题选项到达新题、下一题乐观发布、
  选择→提交→下一题→退出的持久化顺序，以及跨微任务订阅状态单调性。
- R3 使用真实 `EffectiveTimingSession` 与手动单调时钟覆盖内容加载、慢持久化、
  answering/feedback、45 秒空闲、后台、刷新恢复、卸载、完成事件顺序及失败重试。
- 项目级 `pnpm check`：105 个测试文件、513 项测试通过；lint、TypeScript、Vite
  生产构建、课程资源校验和 PWA 生成通过。

## 已知限制

1. R3 的 06 port 尚未由 01 注入正式 Route，也未部署或经 09 正式站回归；当前生产
   词汇训练仍不会创建有效计时 session。
2. 02 当前把 `VocabularyTrainingScreen` 的主提示固定标注为 `lang="en-US"`。
   `meaning-to-term` 和部分场景题的中文提示可正常显示，但语言元数据不准确；应由 02
   扩展公开 ViewModel 后由 01 集成，09 需复验 VoiceOver。
3. 第一版只做受控选择，不做自由拼写、模糊文本匹配、游戏化或 AI。
4. 自动测试验证了离线资源接口和恢复语义；真实 iPhone 的安装、后台回收、VoiceOver
   和离线重启仍属于 09 的真机验收。
