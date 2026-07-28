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
- `TaskDurationEstimate`
- `ActualEffectiveDuration`
- `TrainingCompletionDurationScreen`
- `DailyEffectiveDurationSummary`
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

- 通过 `getPlanTaskAccess(PlanProgress)` 提供逐任务 `availability`、`taskStatus`、
  `recommended` 与 `unavailableReason`；01 只把这些业务状态格式化为 UI ViewModel。
- `DailyTaskViewModel.taskId` 必须原样使用 `PlanTaskAvailability.taskId`。
- `recommendedTaskId`（以及兼容别名 `nextTaskId`）只映射为对应任务的
  `recommended: true`，不得改变任何其他任务的 `availability`。
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
- 等级、区间、置信度和百分比由适配层格式化为最终可读字符串。R3 训练时长例外：
  适配层传入可信秒数和来源，UI 使用集中格式化函数生成文案。
- UI 组件不接收 IndexedDB、Cache Storage、MediaStream、Blob 或识别器对象。
- 回调表达用户意图，例如 `onSubmit`、`onToggleAudio`、`onRecorderAction`；是否允许
  执行由业务状态决定。
- 加载、空白、错误使用 01 的 `AsyncDataState<T>` 在集成层分支，UI 不主动加载。

## 01 / 04｜真实学习任务启动契约

01 只从 `src/ui/index.ts` 导入：

```ts
import {
  LearningAppPrototype,
  type DailyPlanViewModel,
  type DailyTaskViewModel,
  type LearningAppPrototypeProps,
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type StartableTrainingTaskStatus,
  type TrainingPracticeModuleId,
  type TrainingTaskAccessViewModel,
  type TrainingTaskStatus,
  type TrainingTaskUnavailableReason,
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
| `DailyTaskViewModel.taskId` | `PlanTaskAvailability.taskId` | 原样复制，禁止使用模块 ID、数组索引或重新生成 |
| `moduleId` | `LearningTask.targetModuleId` | 只作为稳定 UI 身份，不替代 `taskId` |
| `availability` | `PlanTaskAvailability.availability` | 唯一的可用性来源；UI 不从状态、顺序或推荐反推 |
| `status` | `PlanTaskAvailability.taskStatus` | 原样传入；用于显示真实 pending / active / paused / blocked / completed / skipped |
| `recommended` | `PlanTaskAvailability.recommended` | 只显示“建议先做”，不改变其他任务的按钮状态 |
| `trainingBudget` / `durationEstimate` | `LearningTask.trainingBudget`；仅旧无预算任务使用已有估算 | 两者互斥；预算任务显示有效训练目标，旧任务显示估算 |
| `unavailableReason` | `PlanTaskAvailability.unavailableReason` | 只允许 `not-in-active-plan`、`task-finished`、`invalid-task-data` |
| `onTaskRequested(taskId)` | 用户点击任一 `startable` 任务 | 返回该卡片 `taskId` 原值，一次点击只发送一次 |

`TrainingTaskAccessViewModel` 是判别联合：

- `availability: "startable"`：必须提供非空 `taskId`、非终态 `status`、
  `recommended`、`statusLabel`、`actionLabel`，以及二选一的 `trainingBudget` /
  `durationEstimate`。
- `availability: "unavailable"`：提供 `taskId | null`、`status | null`、
  `recommended: false`、`statusLabel`、`unavailableReason` 和
  `unavailableDescription`。

01 应分别把同一份逐任务访问数据扩展为带标题/图标的 `DailyTaskViewModel`，以及训练页的
`PracticeModuleViewModel`。两个入口必须使用同一 `availability` 和 `taskId`，不能各自
计算出不同权限。

UI 的防御规则：

- `availability === "startable"` 的词汇、听力、口语任务全部保持可点击，即使其中某项
  `recommended === true`。
- `completed` / `skipped` 使用 `task-finished` 终态展示，不能作为未完成每日必做重新启动。
- `not-in-active-plan` 直接说明不在当前计划；`invalid-task-data` 使用错误状态。两者均不
  绑定点击动作。
- 页面没有单一“继续今日计划”权限入口，不消费 `recommendedTaskId` / `nextTaskId`，
  不查找首个未完成任务，也不根据数组位置或模块顺序决定权限。
- `TodayTaskList` 和 `PracticeModuleGrid` 使用同一个 `onTaskRequested` 输出契约；UI 不
  注册路由、不保存活动计划，也不发布学习事件。

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
    taskId: vocabularyLearningTask.taskId,
    availability: 'startable',
    status: 'pending',
    statusLabel: '未完成',
    recommended: false,
    actionLabel: '开始训练',
    trainingBudget: {
      targetEffectiveSeconds:
        vocabularyLearningTask.trainingBudget.targetEffectiveSeconds,
    },
  },
  {
    moduleId: 'listening',
    taskId: listeningLearningTask.taskId,
    availability: 'startable',
    status: 'active',
    statusLabel: '进行中',
    recommended: true,
    actionLabel: '继续训练',
    trainingBudget: {
      targetEffectiveSeconds:
        listeningLearningTask.trainingBudget.targetEffectiveSeconds,
    },
  },
  {
    moduleId: 'speaking',
    taskId: speakingLearningTask.taskId,
    availability: 'startable',
    status: 'pending',
    statusLabel: '未完成',
    recommended: false,
    actionLabel: '开始训练',
    trainingBudget: {
      targetEffectiveSeconds:
        speakingLearningTask.trainingBudget.targetEffectiveSeconds,
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
| 专项训练 `taskId` | 精确 `LearningTask.taskId` | `startable` 必须存在；UI 原样传给 `onTaskRequested` |
| 专项训练 `availability` | 逐任务权限 | 只消费 04 的明确结果，不读取推荐或相邻任务 |
| 专项训练 `recommended` | 非强制推荐 | 只改变边框、徽标与读屏说明；其他 `startable` 卡保持可点 |
| `onAssessmentRequested()` | 用户请求水平测试 | 水平测试不是 `LearningTask`，不生成 `taskId` |
| `unavailableDescription` | 当前不可执行原因 | 卡片直接展示、使用原生禁用态且不绑定点击动作 |

已有能力档案时，01 必须把 `assessment` 映射为禁用态，并使用文案
“首次水平测试已完成，第一版暂不支持重复测试”。词汇、听力和口语是否有可执行任务、
使用哪个 `taskId`、以及最终进入哪条路由，全部由 01 / 04 的真实状态决定；UI 不按标题、
模块 ID、数组顺序、`nextTaskId` 或计划文案猜测。“建议先做”只是视觉建议，不能让其他
未完成任务变灰、显示顺序等待文案或移除操作。

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

## R3｜训练预计时长与实际有效时长

01、06、07、08 只从 `src/ui/index.ts` 导入：

```ts
import {
  ActualEffectiveDuration,
  DailyEffectiveDurationSummary,
  TaskDurationEstimate,
  TrainingBudgetProgress,
  TrainingBudgetTarget,
  TrainingCompletionDurationScreen,
  formatEffectiveDuration,
  formatEstimatedDuration,
  formatTrainingBudgetClock,
  type ActualEffectiveDurationViewModel,
  type DailyEffectiveDurationSummaryViewModel,
  type TaskDurationEstimateViewModel,
  type ListeningTrainingScreenProps,
  type SpeakingTrainingScreenProps,
  type TrainingBudgetProgressViewModel,
  type TrainingBudgetTargetViewModel,
  type TrainingCompletionDurationViewModel,
  type VocabularyTrainingScreenProps,
} from '../../ui/index.ts'
```

### 旧任务的预计时长

`TaskDurationEstimateViewModel` 必须由 01 从 04 已计算结果映射：

```ts
const taskDurationEstimate: TaskDurationEstimateViewModel = {
  estimateSeconds:
    task.durationEstimate?.estimateSeconds ?? task.estimatedSeconds,
  basis: task.durationEstimate?.basis ?? 'content-baseline',
  sampleCount: task.durationEstimate?.sampleCount ?? 0,
  confidence: task.durationEstimate?.confidence ?? 'low',
}
```

禁止把 `PlanProgress.plannedSeconds`、`DailyPlan.targetMinutes`、任务分配分钟数、每日预算或
旧的“15 分钟”字符串写入 `estimateSeconds`。`basis: "personal-history"` 只能来自 04
已经认定的个人历史估算；UI 不根据 `sampleCount` 自行升级 basis。

公开接入点：

| 页面 | 字段 / 组件 | 01 的注入责任 |
| --- | --- | --- |
| “今天”任务行 | startable `DailyTaskViewModel.durationEstimate` | 每个可启动任务传自己的真实估算；`contentSummary` 只放题量或内容范围 |
| “训练”模块卡 | startable `TrainingTaskAccessViewModel.durationEstimate` | 与“今天”使用同一任务、同一估算，不因推荐改变 |
| 词汇 / 听力 / 口语过程页 | `TrainingHeaderViewModel.durationEstimate?` | 启动真实任务时注入；音频 `durationLabel` 仍只表示媒体长度 |
| 其他纯展示位置 | `TaskDurationEstimate` | 直接传同一 ViewModel，不重算 |

集中格式化规则：

- `0..59` 秒显示“不足 1 分钟”，不向上虚报为多分钟；
- `60` 秒起使用整分钟近似，例如 `60` 秒为“约 1 分钟”、`125` 秒为“约 2 分钟”；
- 内容基线显示“内容估算”；个人历史显示“按你的近期速度”；
- 组件读屏名同时包含“预计有效练习”、时长和 basis。

### QA-011｜新预算任务的 15 分钟有效训练

`LearningTask.trainingBudget` 存在时，它是完成条件，不能再把
`durationEstimate` 当成入口时长。入口判别联合固定为：

```ts
type StartableTrainingTaskDurationViewModel =
  | {
      trainingBudget: TrainingBudgetTargetViewModel
      durationEstimate?: never
    }
  | {
      trainingBudget?: undefined
      durationEstimate: TaskDurationEstimateViewModel
    }
```

01 对同一真实任务在“今天”和“训练”两个入口使用同一映射：

```ts
const durationPresentation = task.trainingBudget
  ? {
      trainingBudget: {
        targetEffectiveSeconds:
          task.trainingBudget.targetEffectiveSeconds,
      },
    }
  : {
      durationEstimate: toTaskDurationEstimateViewModel(task),
    }
```

新预算任务固定显示“15 分钟有效训练”；旧无预算任务继续显示已有内容估算或个人历史估算。
不得同时提供 `trainingBudget` 和 `durationEstimate`，不得把个人历史速度用于缩短
900 秒预算。推荐和任务可用性仍只来自 `PlanTaskAccess`，时长字段不参与权限判断。

词汇、听力、口语训练页统一把上游预算快照映射为：

```ts
type TrainingBudgetProgressViewModel =
  | {
      status: 'running' | 'finish-current-item' | 'completed'
      targetEffectiveSeconds: number
      remainingEffectiveSeconds: number
      completedItemCount: number
    }
  | {
      status: 'content-exhausted'
      targetEffectiveSeconds: number
      remainingEffectiveSeconds: number
      completedItemCount: number
      contentExhausted: {
        reason:
          | 'no-eligible-content'
          | 'all-eligible-content-recently-used'
          | 'provider-failure'
        description: string
      }
      retryAction: {
        label: string
        disabled?: boolean
        loading?: boolean
        disabledReason?: string
      }
    }
```

精确输入来源：

| UI 字段 | 01 / 模块来源 | 约束 |
| --- | --- | --- |
| `targetEffectiveSeconds` | `LearningTask.trainingBudget.targetEffectiveSeconds` / `TaskExecutionState.training.targetEffectiveSeconds` | 原样复制；当前契约为 900 |
| `remainingEffectiveSeconds` | `TaskExecutionState.training.remainingEffectiveSeconds` | 原样复制；UI 不扣秒 |
| `status` | `TaskExecutionState.training.status` 或模块公开 budget status | 原样复制；UI 不从剩余秒数反推 |
| `completedItemCount` | 模块公开 stream 的 `completedItemCount`，或 01 已形成的显式计数 | UI 不遍历内容、事件或 ID 集合求值 |
| `contentExhausted.reason/description` | 模块的供应耗尽状态 | 描述必须说明题库暂时不足且任务未完成 |
| `retryAction` | 01 / 06 / 07 / 08 的供应重试状态 | 忙碌时禁用，不能重复触发 |

三个训练页面都接受 `onRetryTrainingContent?()` 并原样透传到统一
`TrainingBudgetProgress`。生产中一旦传入 `status: "content-exhausted"`，01 / 模块必须
同时提供真实重试回调；回调只请求上游重新供应，不选择下一题、不发布
`item-completed` / `budget-completed`，也不把耗尽态改成完成态。

状态文案固定：

- `running`：有效训练进行中；
- `finish-current-item`：时间已到，完成本题后结束；
- `content-exhausted`：题库暂时不足，训练尚未完成，并显示上游说明与“重新获取题目”；
- `completed`：有效训练目标已由运行时确认完成。

`TrainingHeaderViewModel` 使用 `trainingBudget` 与 `durationEstimate` 的判别联合。新预算训练页
传 `trainingBudget`；旧训练页继续传 `durationEstimate`。`TrainingCompletionDurationViewModel`
对新预算任务额外传 `trainingBudget: { status: "completed", ... }`，随后仍用
`actualDuration` 显示可信 timing-segments 真值。

02 只把秒数格式化为 `15:00`、`12:22` 等可读时钟，不建立 interval，不读取
`Date.now()` / `performance.now()`，不自行暂停、扣秒、选择题目或决定完成。

### 实际有效时长

实际用时是判别联合，02 不接受一个无来源的裸数字：

```ts
type ActualEffectiveDurationViewModel =
  | {
      state: 'reliable'
      effectiveSeconds: number
      source: 'timing-segments'
    }
  | {
      state: 'unavailable'
      reason: 'missing-timing-segments' | 'legacy-event-duration'
    }
```

只有 `TaskExecutionState.effectiveTimeSource === "timing-segments"` 时，01 才能构造
`state: "reliable"`，并原样复制 `effectiveSeconds`。`spentSeconds`、旧 attempt
duration、页面墙钟和 `legacy-event-duration` 都不能回退成实际有效时长。无可信来源时
传 `state: "unavailable"`，页面固定显示“本次暂无可靠用时”。

任务结束页如果现有模块没有通用完成入口，06 / 07 / 08 将模块原有成绩和反馈保留在自己的
结果页，并在其中嵌入 `ActualEffectiveDuration`；若需要独立完成页，可使用：

```tsx
<TrainingCompletionDurationScreen
  viewModel={completionDurationViewModel}
  onAction={onReturnToPlan}
/>
```

此组件只显示外部 `title`、`description`、可选的已完成预算快照、实际有效时长和动作，
不计算成绩、不保存事件、不决定路由。

### 每日可信汇总

`DailyEffectiveDurationSummaryViewModel.items` 可同时提供词汇、听力、口语三个模块的
独立状态。`total` 必须由 01 / 04 提供，UI 不对列表求和：

- `coverage: "complete"`：三个模块都有可信 timing segments；
- `coverage: "partial"`：只显示上游已确认合计，并明确缺失项没有按 0 处理；
- `coverage: "unavailable"`：不提供数字，也不显示推测总时长。

`DailyPlanViewModel.effectiveTimeSummary?` 是“今天”页的唯一现成汇总插槽。每日计划卡的
`planTargetLabel` 只是计划目标文案，不能替代任一任务的预计时长或今日实际有效时长。

视觉检查夹具：

```text
?ui-fixture=today-task-request
?ui-fixture=vocabulary
?ui-fixture=listening
?ui-fixture=speaking
?ui-fixture=r3-training-completion
?ui-fixture=r3-daily-duration-summary
```

02 不调用 `Date.now()`、`performance.now()`，不计算中位数、可信样本数或校准偏差，也不
读写 timing segment。上述数据采集、恢复、可靠性判定、历史样本保存和生产路由全部属于
01 / 04 / 06 / 07 / 08。

## 当前限制

- 开发环境可通过 `?ui-fixture=<id>` 打开 02 的视觉验收夹具；生产构建会移除该分支。
- `PlatformPrototype` 仍使用明确的演示数据，只用于视觉检查。01 不得把它当成真实
  `DailyPlan` 或 `ProgressSnapshot`。
- 真机麦克风、音频、离线和键盘行为最终由 09 验收。
