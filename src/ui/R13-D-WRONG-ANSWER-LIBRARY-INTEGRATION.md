# R13-D 统一错题库 UI 接口

`WrongAnswerLibraryEntry` 是训练页中的一个公共学习工具入口。它不属于日常训练、场景训练或 AI 对话三个一级区域，且 0 条时仍必须显示。

01 负责把 04 的 `WrongAnswerLibraryState` 映射为 `WrongAnswerLibraryViewModel` 与 `WrongAnswerReviewViewModel`，保存状态、注册路由并调用运行时。02 不读取仓储、不会随机、不会计算连续答对、正确率或活动状态。

回调只传递意图：入口 `onOpen`；库页 `onExit`、`onSwitchTab`、`onStartRound`、`onResumeRound`、`onRetry`；复习页 `onExit`、`onSubmit`、`onAdvance`、`onRetry`、`onNewRound`。01 不应重写这些 UI，也不应将其解释成计分或洗牌动作。

复习壳的 `questionSlot` 是 `vocabulary | listening | speaking` 联合。06、07、08 各自继续拥有原题型的题面与动作：词汇/场景目标词发音、听力播放和听写、口语录音与不可评分语义均由其 slot 原样渲染。slot 外的壳只渲染上游数字、反馈和壳层意图。

`unscorable` 必须映射为 `phase: 'unscorable'`，且 accuracy 为上游已派生的值（没有可评分答案时为 `null`）。不得把它映射成错误、答错或发音问题。
