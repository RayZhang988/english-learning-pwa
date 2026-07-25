# 03 → 01｜正式水平测试运行入口交接（v1）

## 结论

03 已提供可注册的 headless 正式评估运行时。它直接复用既有 60 道专用题、自适应引擎、
评分规则和 `buildAbilityProfile()`，没有另建演示数据或平行评分逻辑。

公开入口：

```ts
import {
  ASSESSMENT_RUNTIME_SCHEMA_VERSION,
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  AssessmentRuntimeError,
  createAssessmentFeatureModule,
  createPlacementAssessmentRuntime,
  restorePlacementAssessmentRuntime,
  type AssessmentRuntimeSnapshotV1,
  type AssessmentRuntimeState,
  type AbilityProfile,
} from '../features/assessment/index.ts'
```

## 生命周期

```text
intro
  └─ start() ─→ active
                  ├─ submit / skip / failure ─→ feedback
                  │                              └─ continue() ─→ active / completed
                  ├─ pause() ─→ paused ─→ resume()
                  └─ stop() ─→ completed(partial)
```

`AssessmentRuntimeState` 是展示适配层唯一需要读取的状态：

- `lifecycle`：`intro`、`active`、`feedback`、`paused`、`completed`。
- `item`：已移除私有 `scoring` 的 `PublicAssessmentItem`。
- `selectedOptionId`：当前选择；口语题始终为 `null`。
- `progress`：专项、有效测试秒数、题量上下限和已尝试数量。
- `lastSubmission`：只说明已记录、不可评分或跳过，以及降级动作；不泄露正确答案。
- `profile`：仅在完成后存在，是真实 v1 `AbilityProfile`。
- `actions`：当前允许的动作，路由层不得自行推断。

所有题目动作都要求传入当前 `item.id`。陈旧页面或重复点击提交旧题时会抛出
`AssessmentRuntimeError`，不会产生第二条证据。

## 01 的创建、恢复和保存

新会话：

```ts
const runtime = createPlacementAssessmentRuntime({
  onCompleted: async (profile) => {
    await assessmentProfileRepository.saveLatest(profile)
  },
})
```

恢复会话：

```ts
const runtime = restorePlacementAssessmentRuntime({
  snapshot: storedUnknownValue,
  onCompleted: async (profile) => {
    await assessmentProfileRepository.saveLatest(profile)
  },
})
```

恢复后的活动会话一律进入 `paused`，必须由用户触发 `resume()`；应用关闭期间不计入
20 分钟硬限制。损坏、未来版本、题库不匹配、重复答题记录或计数不一致的快照会被
`parseAssessmentRuntimeSnapshot()` 拒绝，01 必须显示恢复错误，不得猜字段或静默生成
假档案。

每次成功动作后，01 应把 `runtime.toSnapshot()` 保存到：

- 命名空间：`feature.assessment`
- key：`ASSESSMENT_RUNTIME_SNAPSHOT_KEY`
- record schema：`ASSESSMENT_RUNTIME_SCHEMA_VERSION`

快照是普通可移植 JSON 数据，不含 Blob、录音、MediaStream、识别器实例或答案键。
存储服务、事务和损坏记录处理仍归 01。

## 动作映射

| 用户意图 | 运行时动作 |
| --- | --- |
| 开始 | `await runtime.start()` |
| 选择答案 | `runtime.selectChoice(item.id, optionId)` |
| 提交选择题 | `await runtime.submitChoice(item.id)` |
| 提交口语证据 | `await runtime.submitSpeech(item.id, observation)` |
| 上报识别失败 | `await runtime.reportRecognitionFailure(item.id, failedObservation)` |
| 上报音频/题目故障 | `await runtime.reportItemFailure(item.id, reason)` |
| 跳过 | `await runtime.skip(item.id)` |
| 确认本题结果并继续 | `await runtime.continue()` |
| 暂停 / 恢复 | `runtime.pause()` / `await runtime.resume()` |
| 主动结束并生成部分档案 | `await runtime.stop()` |

识别失败、权限拒绝、离线和播放故障不会被算作答错。`lastSubmission.fallback` 会明确
返回 `recording-playback`、`retry-audio`、`device-check` 或 `null`。选择题主动跳过按
既有蓝图记零分；口语跳过记为不可评分证据。

## production spoken-response 证据转换

简单口语表达不能使用 `deriveFixedSpeechMetrics()`：该函数只适用于有
`referenceText` 的朗读和跟读。01 应把平台公开的
`AssessmentRecognitionOutcome` 原样传给 03 的转换器：

```ts
import {
  evaluateSpokenResponseEvidence,
  type SpeechAssessmentItem,
} from '../../features/assessment/index.ts'

const observation = evaluateSpokenResponseEvidence({
  item: privateBankItem as SpeechAssessmentItem,
  recognition: recognitionOutcome,
  durationMs: recording.durationMs,
  recordingAvailable: true,
  online: networkStatus.online,
})

if (observation.status === 'scored') {
  await runtime.submitSpeech(privateBankItem.id, observation)
} else {
  await runtime.reportRecognitionFailure(
    privateBankItem.id,
    observation,
  )
}
```

输入字段没有别名：成功结果使用 `status: "recognized"`、
`transcript`、`confidence`；失败结果使用 `status: "failed"`、`code`。另外必须传入
真实录音 `durationMs`、`recordingAvailable` 和当前 `online` 状态。转换器同步、纯函数
且可重复调用；它不保存录音、转写或会话状态。

当前浏览器识别层没有独立的可懂度或语法分析。01 不得猜造这些值。若未来已有经过说明
的本地分析器，可通过 `signals` 传入 0–1 的 `intelligibility`、`fluency` 或
`languageControl`；不得传姓名、音色、口音类别、设备型号或其他身份/生物特征。
省略的可懂度和有限语言控制使用中性值，识别置信度仍只影响证据可靠性。

以下情况统一输出 `FailedSpeechObservation`，因此不会按答错处理：

- 低识别置信度、空转写、置信度缺失或无效；
- 权限拒绝、识别器不可用、离线、无语音和其他识别错误；
- 无效录音时长，或缺少真实评分所需的题库概念组。

公开导出名：

- `evaluateSpokenResponseEvidence`
- `productionSpokenResponseEvidenceEvaluator`
- `SpokenResponseEvidenceInput`
- `SpokenResponseEvidence`

## 完成后衔接

`onCompleted(profile)` 和 `runtime.profile` 提供的是同一个真实档案。01 必须按顺序：

1. 保存 `AbilityProfile` 到现有 `latest-ability-profile`。
2. 保存或清理已完成快照。
3. 重新执行 `LearningAppCoordinator.initialize()`。
4. 让 04 使用档案创建真实学习状态和首日计划。

不得在回调失败时改用 fixture、平均等级或硬编码档案。回调抛错后档案仍保留在
`runtime.profile` 和快照中，01 可以安全重试持久化。

## FeatureModule 注册

03 继续提供：

```ts
createAssessmentFeatureModule(createElement(AssessmentRouteHost))
```

其元数据固定为：

- `id: "assessment"`
- `routeBase: "assessment"`
- `storage.namespace: "feature.assessment"`
- `storage.schemaVersion: 1`

`AssessmentRouteHost` 由 01 持有，负责注入存储、导航、录音/识别适配器和 02 展示组件。
03 不修改 `src/app/**`、`src/ui/**` 或 `src/storage/**`。

## 现有 02 展示契约的精确缺口

正常 intro、选择题、口语题和结果页已有组件。要无歧义覆盖运行时全部状态，02 仍缺：

1. `AssessmentChoiceScreen` 没有 `onSkip`，也没有可配置的次行动。
2. `AssessmentChoiceScreen` 和 `AssessmentSpeechScreen` 的主按钮文案固定为“提交”，
   无法在 `feedback` 状态诚实显示“继续下一题”。
3. 两个答题页都没有 `lastSubmission` / 设备降级提示输入，无法显示
   `recording-playback`、`retry-audio` 或 `device-check`。
4. 没有 assessment 专用 `paused` 恢复页面或 `onResume` 契约。

在 02 补齐前，01 可以用其公开 `FeedbackPanel`、`SystemStateCard` 和 `EmptyState`
组合上述状态，但不能把“继续”伪装成再次提交，也不能隐藏不可评分事实。
