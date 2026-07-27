# 02｜UI 集成交接

## 公共入口

所有接收任务只从：

```ts
import { ... } from '../../ui/index.ts'
```

导入 UI。不要导入 `src/ui/**` 内部文件。

当前公开页面组件：

- `LearningAppPrototype`：纯展示应用壳；生产入口必须显式传入计划、进度、训练模块
  ViewModel 和请求回调。
- `AssessmentIntroScreen`
- `AssessmentChoiceScreen`
- `AssessmentSpeechScreen`
- `AssessmentPausedScreen`
- `AssessmentResultsScreen`
- `TravelVocabularyR1IntroScreen`
- `TravelVocabularyR1QuestionScreen`
- `TravelVocabularyR1StageReviewScreen`
- `TravelVocabularyR1FinishConfirmationScreen`
- `TravelVocabularyR1StageResultScreen`
- `TravelVocabularyR1ResumeScreen`
- `TravelVocabularyR1MigrationScreen`
- `TravelVocabularyR1ResultsScreen`
- `TravelVocabularyR1StatusScreen`
- `VocabularyTrainingScreen`
- `ListeningTrainingScreen`
- `SpeakingTrainingScreen`
- `ProgressOverviewScreen`

当前公开展示原语：

- `TrainingScreen`
- `ChoiceList`
- `AudioPlayer`
- `ListeningPlaybackControls`
- `KeywordDictationField`
- `Recorder`
- `FeedbackPanel`
- `SystemStateCard`
- `SystemBanner`
- `MicrophonePermissionCard`
- `LoadingState`
- `EmptyState`
- `ErrorState`
- `OfflineNotice`

## 集成责任

### 01

- 保持 `src/index.css` 对 `src/ui/styles/app.css` 的导入。
- 挂载顶层应用壳、404、错误边界和 PWA 状态。
- 注册业务模块公开的 `FeatureModule`。
- 为 `LearningAppPrototype.onTaskRequested(taskId)` 注入真实任务协调器；根据活动计划中的
  `LearningTask.targetModuleId` 决定路由，UI 不接收路由表。
- 为训练页注入四个稳定模块的可用状态；专项训练的启用态必须携带精确
  `LearningTask.taskId`，水平测试使用独立 `onAssessmentRequested()`。
- 不在 `src/app/**` 复制 UI 样式。

### 03

- 把 `PublicAssessmentItem`、`AssessmentPhase`、录音状态和 `AbilityProfile` 映射为
  assessment 页面 ViewModel。
- 选择项、提交中、跳过、反馈、暂停和结果状态由 03 控制。
- UI 不得收到私有 `scoring` 字段。
- R1 使用独立的 `TravelVocabularyR1*ViewModel`；03 的随机抽样、答案判定、阶段比例、
  词汇量、区间和等级映射结果只能由 01 适配为最终展示字段，02 不重算。

### 04

- 把 `DailyPlan`、`PlanProgress`、`ProgressSnapshot`、`ResumeDecision` 和
  `ReassessmentRecommendation` 映射成应用壳和进度 ViewModel。
- `DailyTaskViewModel.id` 必须原样使用 `TaskExecutionState.task.taskId`。
- 把 `ResumeDecision.nextTaskId` 映射到 `DailyPlanPrimaryActionViewModel`；逐任务是否可请求
  映射到 `DailyTaskRequestViewModel`，UI 不根据数组顺序推导。
- 分钟、进度、趋势、连续学习和复测到期只做格式化，不能在 UI 内重算。

### 06

- 把词汇题型、选择、判定、反馈和例句可见性映射为
  `VocabularyScreenViewModel`。
- `ChoiceViewModel.state` 必须来自 06 的状态机。

### 07

- 把播放器状态映射为 `AudioPlayerViewModel`，把可选速度、片段和重复状态映射为
  `ListeningPlaybackControlsViewModel`。
- 使用 `ListeningScreenViewModel.question.kind` 分支单选题与关键词听写，不能给听写题
  伪造空 `choices`，也不能给单选题伪造空 `textInput`。
- 播放次数、当前速度、当前片段、重复方式、输入禁用、提交状态、音频错误和答后原文
  可见性均由 07 控制。
- 片段和答后原文使用内容层提供的稳定 ID；UI 原样回传，不根据数组位置生成业务 ID。

### 08

- 把权限、录音、识别、回放和降级映射为 `RecorderViewModel`。
- 设备失败时通过 `FeedbackViewModel.tone === "device"` 呈现，不能映射成答错。

## ViewModel 约束

- 所有进度值使用 `0..100` 的展示值，由适配层提供。
- 时间、等级、区间、置信度和百分比由适配层格式化为最终可读字符串。
- UI 组件不接收 IndexedDB、Cache Storage、MediaStream、Blob 或识别器对象。
- 回调表达用户意图，例如 `onSubmit`、`onToggleAudio`、`onRecorderAction`；是否允许
  执行由业务状态决定。
- 加载、空白、错误使用 01 的 `AsyncDataState<T>` 在集成层分支，UI 不主动加载。

## 01 / 04｜真实学习任务启动契约

01 只从 `src/ui/index.ts` 导入：

```ts
import {
  LearningAppPrototype,
  type DailyPlanPrimaryActionViewModel,
  type DailyPlanViewModel,
  type DailyTaskRequestViewModel,
  type DailyTaskViewModel,
  type LearningAppPrototypeProps,
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type TrainingPracticeModuleId,
} from '../../ui/index.ts'
```

生产入口必须显式传入回调：

```tsx
<LearningAppPrototype
  plan={planViewModel}
  progress={progressViewModel}
  offline={offline}
  onTaskRequested={(taskId) => {
    // 01 在活动计划中解析 taskId，再注入真实训练路由。
  }}
/>
```

字段语义：

| 字段 | 来源 | 约束 |
| --- | --- | --- |
| `DailyTaskViewModel.id` | `LearningTask.taskId` | 原样复制，禁止使用模块 ID、数组索引或重新生成 |
| `task.request` | `TaskExecutionState` 与模块可用状态 | `enabled` 才可点击；`disabled` 必须提供可读原因 |
| `plan.primaryAction.taskId` | 通常为 `ResumeDecision.nextTaskId` | 必须匹配同一 ViewModel 中可请求的任务 |
| `onTaskRequested(taskId)` | 用户点击主行动或可执行任务行 | 返回 `DailyTaskViewModel.id` 原值 |

UI 的防御规则：

- 已完成任务始终禁用，即使适配层错误地把 `request.state` 标为 `enabled`。
- 主行动引用缺失、已完成或不可请求任务时禁用，不回退到其他任务。
- 任务行和“继续今日计划”使用同一个 `onTaskRequested` 回调。
- UI 不查找首个未完成任务、不读取 `targetModuleId`、不注册路由、不保存活动计划，也不
  发布学习事件。

`demoPlan` 仅存在于 `visual-fixture.tsx`，并通过独立 `LearningAppVisualDemo` 注入演示
回调。生产 `learning-app-prototype.tsx` 不导入视觉夹具，也没有演示计划、演示 ID 或
默认任务请求行为。开发环境可通过 `?ui-fixture=today-task-request` 单独验证此契约。

## 01｜训练页公开入口契约

01 继续使用 `LearningAppPrototype.onTaskRequested(taskId)` 启动真实专项训练，并额外
导入：

```ts
import {
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type TrainingPracticeModuleId,
} from '../../ui/index.ts'
```

稳定模块 ID 为：

```ts
type PracticeModuleId =
  | 'assessment'
  | 'vocabulary'
  | 'listening'
  | 'speaking'
```

`moduleId` 只承担卡片身份、视觉映射和自动化定位，不能当作任务 ID 或路由 ID。生产
ViewModel 应包含四个模块且每个 ID 恰好出现一次：

```ts
const practiceModules = [
  {
    moduleId: 'assessment',
    request: {
      state: 'disabled',
      label: '已完成',
      reason: '首次水平测试已完成，第一版暂不支持重复测试。',
    },
  },
  {
    moduleId: 'vocabulary',
    request: {
      state: 'enabled',
      label: '进入训练',
      taskId: vocabularyLearningTask.taskId,
    },
  },
  {
    moduleId: 'listening',
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '当前没有可执行的听力任务。',
    },
  },
  {
    moduleId: 'speaking',
    request: {
      state: 'enabled',
      label: '进入训练',
      taskId: speakingLearningTask.taskId,
    },
  },
] satisfies readonly PracticeModuleViewModel[]
```

生产入口：

```tsx
<LearningAppPrototype
  plan={planViewModel}
  progress={progressViewModel}
  practiceModules={practiceModules}
  onAssessmentRequested={() => {
    // 01 进入正式水平测试入口。
  }}
  onTaskRequested={(taskId) => {
    // 01 在活动计划中校验原始 taskId，再进入真实专项训练。
  }}
/>
```

输入输出约束：

| 输入 / 输出 | 语义 | 强制约束 |
| --- | --- | --- |
| `PracticeModuleViewModel.moduleId` | 稳定 UI 身份 | 只允许四个公开字面量；不表示任务或路由 |
| 专项训练 `request.taskId` | 精确 `LearningTask.taskId` | 只存在于 `enabled`；UI 原样传给 `onTaskRequested` |
| `onAssessmentRequested()` | 用户请求水平测试 | 水平测试不是 `LearningTask`，不生成 `taskId` |
| `disabled.reason` | 当前不可执行原因 | 卡片直接展示、使用原生禁用态且不绑定点击动作 |

已有能力档案时，01 必须把 `assessment` 映射为禁用态，并使用文案
“首次水平测试已完成，第一版暂不支持重复测试”。词汇、听力和口语是否有可执行任务、
使用哪个 `taskId`、以及最终进入哪条路由，全部由 01 / 04 的真实状态决定；UI 不按标题、
模块 ID、数组顺序或计划文案猜测。

为避免尚未更新的应用壳在类型迁移期间中断，`practiceModules` 与
`onAssessmentRequested` 可以同时省略；此时四张卡片全部显示为“入口尚未接入”并禁用，
不会再进入内部“暂无可用训练”占位页。该状态只用于迁移兼容，不满足生产集成验收；
01 发布前必须显式传入两项。

## 07｜听力 UI 公开契约

07 只从 `src/ui/index.ts` 导入：

```ts
import {
  ListeningTrainingScreen,
  type ListeningPlaybackControlsViewModel,
  type ListeningQuestionInputIntent,
  type ListeningQuestionViewModel,
  type ListeningRepeatMode,
  type ListeningScreenViewModel,
  type ListeningTrainingScreenCallbacks,
} from '../../ui/index.ts'
```

题目是判别联合：

```ts
type ListeningQuestionViewModel =
  | {
      kind: 'single-choice'
      prompt: string
      choices: readonly ChoiceViewModel[]
    }
  | {
      kind: 'keyword-dictation'
      prompt: string
      textInput: {
        label: string
        value: string
        placeholder: string
        disabled: boolean
        state: 'empty' | 'ready' | 'submitting' | 'submitted'
        description?: string
        statusLabel?: string
      }
    }
```

`ListeningTrainingScreenCallbacks` 只回传用户意图：

| 回调 | UI 输出 | 07 的责任 |
| --- | --- | --- |
| `onToggleAudio()` | 播放或暂停 | 决定下一播放器状态 |
| `onPlaybackRateChange(value)` | 用户选择的数值速度 | 验证并应用速度 |
| `onSegmentChange(segmentId)` | 内容层提供的稳定片段 ID | 切换播放片段 |
| `onRepeatModeChange(mode)` | `none` / `segment` / `all` | 控制重复行为 |
| `onQuestionInput(intent)` | 选择 ID 或最新听写文本 | 更新题目状态 |
| `onAction()` | 用户触发当前主操作 | 提交、继续或重试 |
| `onExit()` | 用户要求退出 | 暂停、保存或导航 |

`ListeningPlaybackControlsViewModel` 必须明确提供：

- 速度 `currentValue` 和可选数值/标签；
- 片段 `currentId` 和带稳定 `id` 的选项；
- 重复 `currentMode` 和可用模式；
- 控件级或选项级禁用状态。

UI 不调用 Web Speech、Audio、TTS 或计时 API，不验证速度、不判断答案、不计算播放次数，
也不决定提交按钮何时可用。

## 03 / 01｜正式评估运行时 UI 契约

01 只从 `src/ui/index.ts` 导入：

```ts
import {
  AssessmentChoiceScreen,
  AssessmentPausedScreen,
  AssessmentSpeechScreen,
  type AssessmentChoiceScreenProps,
  type AssessmentChoiceSelectionIntent,
  type AssessmentChoiceViewModel,
  type AssessmentLastSubmissionViewModel,
  type AssessmentPausedScreenProps,
  type AssessmentPausedViewModel,
  type AssessmentQuestionTarget,
  type AssessmentSpeechAudioViewModel,
  type AssessmentSpeechScreenProps,
  type AssessmentSpeechViewModel,
} from '../../ui/index.ts'
```

题目 ViewModel 必须原样承载正式运行时标识：

| UI 字段 | 03 来源 | 约束 |
| --- | --- | --- |
| `sessionId` | `AssessmentRuntimeState.sessionId` | 原样复制，UI 不生成、不缩写 |
| `itemId` | `AssessmentRuntimeState.item.id` | 原样复制，所有题目动作都带回该值 |
| `submission.itemId` | `lastSubmission.itemId` | 原样复制，不替换成当前索引 |
| `primaryAction.kind` | `lifecycle` / `actions` | `submit` 调用 `onSubmit`；`continue` 只调用 `onContinue` |
| `skipAction` | `actions.canSkip` | 是否显示、是否禁用均由适配层明确提供 |
| `pauseAction` | `actions.canPause` | UI 不自行保存或暂停 |
| `AssessmentSpeechViewModel.audio` | `item.stimulus.audioText` 与外部播放器状态 | 仅有跟读示例音频时提供；UI 不合成音频 |

题目页回调：

| 回调 | UI 输出 | 01 / 03 集成责任 |
| --- | --- | --- |
| `onSelect(intent)` | `{ sessionId, itemId, optionId }` | 调用 `selectChoice(itemId, optionId)` |
| `onSubmit(target)` | `{ sessionId, itemId }` | 按题型调用 `submitChoice` 或 `submitSpeech` |
| `onContinue(target)` | `{ sessionId, itemId }` | 仅在 `canContinue` 时调用 `continue()` |
| `onSkip(target)` | `{ sessionId, itemId }` | 仅在 `canSkip` 时调用 `skip(itemId)` |
| `onPause(target)` | `{ sessionId, itemId }` | 仅在 `canPause` 时调用 `pause()` |
| `AssessmentSpeechScreen.onToggleAudio(target)` | `{ sessionId, itemId }` | 播放或暂停跟读示例音频 |
| `onExit(sessionId)` | 原始会话 ID | 路由层决定关闭、确认或保存 |

`AssessmentQuestionPrimaryActionViewModel` 是判别联合。反馈态必须传
`{ kind: "continue", label: "继续下一题", ... }`；不能继续传 `submit`，也不能让
`onSubmit` 代理 `continue()`。按钮可用性、忙碌态及禁用原因全部来自适配层，UI 不通过
“是否选了答案”或录音状态重算。

跟读题的示例音频使用
`AssessmentSpeechViewModel.audio?: AssessmentSpeechAudioViewModel`。01 仅在
`PublicSpeechAssessmentItem.stimulus.audioText` 存在时提供该字段，并通过
`onToggleAudio(target)` 处理播放/暂停。回调收到的 `sessionId` / `itemId` 是 ViewModel
原值；02 不读取音频文本、不调用 TTS、不累计播放次数，也不决定是否达到 `maxPlays`。
朗读和简单表达题不提供 `audio`，页面不渲染示例播放器。录音回放继续使用独立的
`onPlayback(target)`，两种音频动作不能混用。

`AssessmentLastSubmissionViewModel` 保留 03 的 `status`、`failureReason` 和 fallback
种类，同时要求集成层提供最终中文 `feedback` 与 fallback 文案。UI 只展示，不把
`recognition-failed`、`audio-unavailable`、`audio-playback-failed`、`skipped` 或
其他 `unscorable` 状态解释成答错。支持的 fallback 为：

- `recording-playback`
- `retry-audio`
- `device-check`

暂停状态使用 `AssessmentPausedScreen`：

| 回调 | UI 输出 | 运行时动作 |
| --- | --- | --- |
| `onResume(sessionId)` | 原始会话 ID | `await runtime.resume()` |
| `onStop(sessionId)` | 原始会话 ID | `await runtime.stop()`，生成部分档案 |
| `onExit(sessionId)` | 原始会话 ID | 由路由层决定离开行为 |

03 没有 restart 动作，因此 UI 不公开 `onRestart`，也不把“结束并保留部分结果”伪装成
重新开始。恢复页面的可用性必须来自 `actions.canResume` / `actions.canStop`。

## R1｜旅游英语分阶段词汇测试 UI 契约

R1 已用于正式评估入口；现有 v1 页面仍作为兼容组件保留，不得删除或改写
`AssessmentIntroScreen`、`AssessmentChoiceScreen` 等公开组件。

01 只从 `src/ui/index.ts` 导入 R1 页面和类型：

```ts
import {
  TravelVocabularyR1FinishConfirmationScreen,
  TravelVocabularyR1IntroScreen,
  TravelVocabularyR1MigrationScreen,
  TravelVocabularyR1QuestionScreen,
  TravelVocabularyR1ResultsScreen,
  TravelVocabularyR1ResumeScreen,
  TravelVocabularyR1StageResultScreen,
  TravelVocabularyR1StageReviewScreen,
  TravelVocabularyR1StatusScreen,
  type TravelVocabularyR1QuestionViewModel,
  type TravelVocabularyR1FinishConfirmationViewModel,
  type TravelVocabularyR1ResultsViewModel,
  type TravelVocabularyR1StageReviewViewModel,
} from '../../ui/index.ts'
```

### 生命周期映射

| 03 `TravelVocabularyAssessmentRuntimeStateR1` | 02 页面 | 01 适配责任 |
| --- | --- | --- |
| `intro`，无迁移提示 | `TravelVocabularyR1IntroScreen` | 映射 `sessionId`、`actions.canStart` |
| `intro`，存在 `migrationNotice` | `TravelVocabularyR1MigrationScreen` | 显示旧 v1/v2 不兼容，不伪造成绩 |
| `active` | `TravelVocabularyR1QuestionScreen` | 映射当前题、四个选项、草稿答案、30 题状态与动作 |
| `active` 的 UI 提交检查子状态 | `TravelVocabularyR1StageReviewScreen` | 明确提供未答题列表和提交后果；不改变 runtime lifecycle |
| `active` / `stage-summary` 的 UI 提前结束确认子状态 | `TravelVocabularyR1FinishConfirmationScreen` | 映射 `remainingQuestionsToMarkUncertain`；首次请求不调用 runtime |
| `stage-summary` | `TravelVocabularyR1StageResultScreen` | 映射 `latestStageResult` 的最终显示字符串 |
| `paused` | `TravelVocabularyR1ResumeScreen` | 显示固定原题恢复事实并调用 `resume()` |
| `completed` | `TravelVocabularyR1ResultsScreen` | 映射 schema 3 `profile`，听力/口语保持待校准 |
| 外层加载、错误、仅可本机恢复 | `TravelVocabularyR1StatusScreen` | 01 提供最终事实和重试/恢复动作 |

`TravelVocabularyR1StageReviewScreen` 是提交前的纯 UI 子状态。点击
`onReviewStage(sessionId)` 后，01 显示检查页；只有检查页的
`onSubmitStage(sessionId)` 才调用 `runtime.submitStage()`。返回补答只关闭检查页或导航
到指定题，不能提前提交。检查页存在未答题时仍可提交，运行时负责统一记为
`uncertain`。

“剩余全部不会，结束测试”使用独立的 UI 确认子状态：

1. `onRequestFinishRemainingUnknown(sessionId)` 只打开
   `TravelVocabularyR1FinishConfirmationScreen`；
2. `onCancelFinishRemainingUnknown(sessionId)` 只关闭确认状态并回到作答；
3. `onConfirmFinishRemainingUnknown(sessionId)` 才调用
   `await runtime.finishRemainingUnknown()`。

不得在首次请求时调用最终动作，也不得在 UI 中循环补写 `uncertain`。

### 字段映射

| UI 字段 | R1 来源 | 强制约束 |
| --- | --- | --- |
| `sessionId` | `state.sessionId` | 原样复制，所有会话动作原样回传 |
| `question.id` | `state.questions[index].id` | 原样复制，不使用单词文本或题序替代 |
| `question.index` | `state.currentQuestionIndex` | 零基题序原样复制 |
| `options[4].id/label` | `PublicTravelVocabularyQuestionR1.options` | 必须正好四项；公开模型没有正确答案键 |
| `question.answerState` | `state.draftAnswers[question.id]` | 只映射选中/不确定/未答，不判断正确性 |
| `questionMap` | 30 个公开题目与草稿 | 每项显式提供题号、题 ID、题序、当前态和作答态 |
| `unansweredQuestions` | 草稿中缺失的题目 | 由 01 显式提供；02 不从数量推导可提交性 |
| `unansweredCountLabel` | `state.progress` 与未答映射结果 | 由 01 提供完整显示字符串，例如“还有 2 题未答，提交后将按不会记录” |
| `submitAction.busy` | 01 串行操作状态 | 存在未答题不禁用提交；只在提交中的防重状态禁用 |
| `finishRemainingAction` | `state.actions.canFinishRemainingUnknown` | 只负责打开确认页，不直接执行最终动作 |
| `remainingQuestionCountLabel` | `state.remainingQuestionsToMarkUncertain` | 由 01 格式化；02 不计算当前阶段或后续阶段剩余数 |
| 阶段结果各 `*Label` | `latestStageResult` | 在适配层格式化，02 不计算比例、估算或区间 |
| 总结果各 `*Label` | `state.profile` | 在适配层格式化，02 不计算总词数、等级或时间 |

所有 `headerProgress.value` 都由 01 映射为 `0..100`。UI 不使用
`answeredOverall / totalQuestions`、`correctCount / validQuestionCount` 或阶段代表词数进行
任何计算。测试中允许传入非公式化字符串，以验证页面确实原样显示外部结果。

### 回调

| 页面回调 | UI 原样输出 | 01 / 03 动作 |
| --- | --- | --- |
| `onStart(sessionId)` | 会话 ID | `runtime.start()` |
| `onSelectChoice(intent)` | `sessionId/questionId/questionIndex/optionId` | `runtime.selectChoice(questionId, optionId)` |
| `onMarkUncertain(target)` | `sessionId/questionId/questionIndex` | `runtime.markUncertain(questionId)` |
| `onClearAnswer(target)` | 同上 | `runtime.clearAnswer(questionId)` |
| `onNavigate(target)` | 目标题 ID 与零基题序 | 校验目标后 `runtime.navigate(questionIndex)` |
| `onAdvanceToNextQuestion(intent)` | 当前 `sessionId/questionId/questionIndex` 和固定意图类型 | 校验当前题后 `runtime.advanceToNextQuestion()`；不得改用 `navigate(current + 1)` |
| `onReviewStage(sessionId)` | 会话 ID | 只打开提交检查，不调用 runtime |
| `onSubmitStage(sessionId)` | 会话 ID | `await runtime.submitStage()` |
| `onRequestFinishRemainingUnknown(sessionId)` | 会话 ID | 只打开 UI 二次确认 |
| `onCancelFinishRemainingUnknown(sessionId)` | 会话 ID | 只关闭 UI 二次确认，不调用 runtime |
| `onConfirmFinishRemainingUnknown(sessionId)` | 会话 ID | `await runtime.finishRemainingUnknown()` |
| `onContinueToNextStage(sessionId)` | 会话 ID | `runtime.continueToNextStage()` |
| `onPause(sessionId)` | 会话 ID | `runtime.pause()` 并由 01 持久化快照 |
| `onResume(sessionId)` | 会话 ID | `runtime.resume()` |
| `onStartNewAssessment(sessionId)` | 新 R1 会话 ID | 对迁移后 intro 状态调用 `runtime.start()` |
| `onContinue(sessionId)` | 已完成会话 ID | 01 保存档案并进入后续正式入口 |

按钮是否可用、忙碌和禁用原因全部由 ViewModel 提供。阶段结果页固定使用“进入下一阶段”
动作，不根据 `correctCountLabel` 设置满分门槛；0/30、6/30、15/30、30/30 的页面结构和
回调完全相同。

`onAdvanceToNextQuestion` 与检查页的快速结束入口在类型中暂时保留可选兼容桥，目的只是让
尚未更新的 01 适配器在所有权交接期间继续编译。UI 不会回退到旧 `onNavigate` 语义；
生产接入必须显式提供这些新增字段和回调，否则对应控件保持禁用或不显示。

### 恢复、迁移和结果诚实性

- 暂停恢复页明确说明继续使用快照中的原题和原选项顺序；02 不重新抽题。
- `legacy-measurement-incompatible-new-sample-required` 映射到迁移页固定提示
  “需要重新开始新的旅游英语词汇测试”，不能展示旧测试为 R1 已完成。
- 总结果必须提供 5 条阶段明细、总作答数、有效时间、估算词数、合理区间、内部等级和
  两条免责声明。
- `listeningCalibrationLabel` 与 `speakingCalibrationLabel` 的公开类型固定为“待校准”，
  不能传入数字、CEFR 或从词汇结果推导的等级。
- 加载、错误和离线/本机恢复状态只显示 01 提供的事实，不主动读取网络、快照或存储。

视觉检查夹具：

```text
?ui-fixture=travel-r1-intro
?ui-fixture=travel-r1-question
?ui-fixture=travel-r1-review
?ui-fixture=travel-r1-finish-confirmation
?ui-fixture=travel-r1-stage-result
?ui-fixture=travel-r1-resume
?ui-fixture=travel-r1-migration
?ui-fixture=travel-r1-results
?ui-fixture=travel-r1-status
```

## 当前限制

- 开发环境可通过 `?ui-fixture=<id>` 打开 02 的视觉验收夹具；生产构建会移除该分支。
- `PlatformPrototype` 仍使用明确的演示数据，只用于视觉检查。01 不得把它当成真实
  `DailyPlan` 或 `ProgressSnapshot`。
- 真机麦克风、音频、离线和键盘行为最终由 09 验收。
