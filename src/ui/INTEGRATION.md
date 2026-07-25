# 02｜UI 集成交接

## 公共入口

所有接收任务只从：

```ts
import { ... } from '../../ui/index.ts'
```

导入 UI。不要导入 `src/ui/**` 内部文件。

当前公开页面组件：

- `LearningAppPrototype`：纯展示应用壳；必须显式传入计划、进度和任务请求回调。
- `AssessmentIntroScreen`
- `AssessmentChoiceScreen`
- `AssessmentSpeechScreen`
- `AssessmentPausedScreen`
- `AssessmentResultsScreen`
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
- 不在 `src/app/**` 复制 UI 样式。

### 03

- 把 `PublicAssessmentItem`、`AssessmentPhase`、录音状态和 `AbilityProfile` 映射为
  assessment 页面 ViewModel。
- 选择项、提交中、跳过、反馈、暂停和结果状态由 03 控制。
- UI 不得收到私有 `scoring` 字段。

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

## 当前限制

- 开发环境可通过 `?ui-fixture=<id>` 打开 02 的视觉验收夹具；生产构建会移除该分支。
- `PlatformPrototype` 仍使用明确的演示数据，只用于视觉检查。01 不得把它当成真实
  `DailyPlan` 或 `ProgressSnapshot`。
- 真机麦克风、音频、离线和键盘行为最终由 09 验收。
