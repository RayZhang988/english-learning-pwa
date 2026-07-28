# 08｜口语训练模块交接

## 公共入口

其他任务只从 `src/features/speaking/index.ts` 导入，不读取本目录内部文件。

主要交付：

- `SpeakingTrainingRoute`：接收 04 的口语 `LearningTask`、事件接收器和退出回调；
- `createSpeakingFeatureModule()`：返回 01 可注册的 `FeatureModule`；
- `CurrentSpeakingContentSource`：按 05 的唯一课程入口加载 28 个口语单元；
- `SpeakingTrainingRuntime`：协调权限、录音、回放、识别、降级、恢复和事件 outbox；
- `BrowserSpeakingRecorder`：基于 `getUserMedia`、`MediaRecorder` 和本地 Blob URL；
- `BrowserSpeakingRecognition`：特性探测 `SpeechRecognition` 或
  `webkitSpeechRecognition`；
- `SpeakingSessionRepository`：在 `feature.speaking` 命名空间恢复可移植会话状态。

模块不修改 `src/app/**`。最终路由注册由 01 在集成步骤完成。

## R3 真实有效计时

08 只声明业务阶段，不读取浏览器可见性、不创建时钟、45 秒空闲计时器、快照或
`learning.timing.segment.recorded.v1` 事件 ID。上述能力仍由 01 的
`ProductionEffectiveTimingSessionFactory` 负责。

唯一生产注入点是：

```tsx
<SpeakingTrainingRoute
  timingSessionFactory={productionEffectiveTimingSessions}
  trainingBudgetStatus={restoredSpeakingBudgetStatus}
  {...routeProps}
/>
```

`SpeakingEffectiveTimingSessionFactoryPort` 与 01 的生产 factory 结构兼容；不传
factory 的旧调用保持原行为。

## QA-011 连续题流

当且仅当 01 为带 `trainingBudget` 的任务注入 `trainingBudgetStatus` 时，08 读取 05 在
`package-index.v1.json` 声明的 `trainingSupplyIndexFile`。供应器只消费已发布的
`speaking-prompt` 与 `speaking-scene-quiz`，以稳定 `itemId`、cursor 和本流已完成 ID
恢复；不创建新提示、不改写 `acceptedAnswers`，也不循环已排除题目。

每道题自然进入反馈、用户明确推进后，按 outbox 顺序发布有限匹配/不可评分 attempt 与
`learning.training.item.completed.v1`。未进入 `finish-current-item` 时下一题继续；已经
进入该状态也不会中断当前录音、识别等待、回放或反馈，而是在该题推进后才发布
`learning.training.budget.completed.v1`。候选耗尽会保留排除集、发布原始耗尽原因并进入
可重试错误态，绝不清空集合回绕旧题。没有预算端口的旧任务维持原本单元完成路径。

阶段声明遵循真实底层信号：

- 内容、会话和业务状态持久化：`loading / content-loading`，不计时；
- 麦克风权限请求：`permission-wait / permission-wait`，不计时；
- `MediaRecorder` 真正发出 `start` 后：
  `recording / active-recording`；
- 录音暂停、停止、错误或页面后台化立即关闭录音片段；
- 识别结果等待：`network-wait / network-wait`，不计时；
- 本地录音媒体真正发出 `playing` 后：
  `playback / active-playback`；
- 回放的 `pause`、`ended`、`error`、`waiting` 和 `seeking` 会立即停止或排除
  回放时间；
- 目标表达页面：`answering / active-answering`；
- 结果反馈页面：`feedback / active-feedback`。

回答和反馈的 45 秒空闲截断、后台/前台生命周期和连续媒体上限由 01 统一执行。前台
恢复不会自动重新开始录音、回放或计时；用户必须明确恢复任务或媒体必须重新发出真实
开始事件。刷新只恢复阶段声明，不补算页面关闭期间的时间。

完成路径（包括合法的 `unscorable-practice`）必须先成功执行 timing `finish()`，保存并
发布最后一个 timing segment，之后才发布口语 `learning.attempt.completed.v1` 并通知
完成页面。`finish()` 失败时口语完成事件保留在 outbox，重试成功前不会发布。启用 R3
timing 后，口语完成和暂停事件的旧墙钟 `durationSeconds` 固定为 0；04 只使用
`source = timing-segments` 的可信片段累计有效时间。

未完成退出会停止录音、回放和识别，并等待 timing `dispose()`。权限提示或识别服务迟迟
不返回时，退出/后台信号会解除运行时等待；迟到返回的麦克风流会立即停止全部 track。
React StrictMode cleanup/setup 探测不会创建第二个 timing session，快速重复录音、停止
和完成操作也不会产生重叠媒体或重复完成事件。

## 输入

### 学习任务

只接受：

```ts
task.schemaVersion === 1
task.domain === 'speaking'
task.targetModuleId === 'speaking'
```

`learningUnitId` 和 `contentRef` 必须同时命中课程单元，不能只按其中一个猜测。

### 课程

唯一入口：

`content/curriculum/package-index.v1.json`

模块显式读取入口声明的课程清单和四周 lesson 文件，不扫描目录。当前只接受：

- `fixed-response`
- `guided-roleplay`

每道提示使用 05 提供的 `partnerLine`、`cueZh`、`modelAnswer` 和
`acceptedAnswers`。`requiredConcepts` 仅作为内容语义标签，不直接变成逐词判分规则。
未知活动类型、空答案集合或任务引用漂移会显式报内容错误。

## 平台能力结论

- iPhone Safari 从 iOS 11 起可在 HTTPS 页面通过 `getUserMedia` 请求麦克风。
- Safari 14.1 已支持 `MediaRecorder`；运行时优先探测 `audio/mp4`，再探测 WebM/Ogg。
- Safari 14.1 起提供由 Siri 同源语音引擎支持的 Web Speech 识别。系统必须启用 Siri，
  运行时仍可能因权限、网络、系统服务或无可用文本而失败。
- 因此语音识别是可选证据，不是继续学习的前置条件。

依据：

- <https://webkit.org/blog/7726/announcing-webrtc-and-media-capture/>
- <https://webkit.org/blog/11353/mediarecorder-api/>
- <https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/>

## 状态和交互

会话阶段：

- `practicing`
- `feedback`
- `paused`
- `completed`
- `error`

录音状态：

- `permission`
- `ready`
- `recording`
- `processing`
- `review`
- `unavailable`
- `error`

识别状态独立于录音状态：

- `idle`
- `listening`
- `processing`
- `recognized`
- `unavailable`
- `error`

分离状态的直接结果是：识别失败不会销毁成功录到的音频。

## 录音、回放与隐私

- 麦克风只在用户明确点击录音时请求。
- 停止录音后立即停止所有 `MediaStreamTrack`。
- 录音只保存在当前页面内存的 Blob 中，通过临时 Blob URL 本地回放。
- 回放结束或模块释放时撤销 Blob URL。
- 不上传录音，不把录音 Blob 写入 IndexedDB、Cache Storage 或课程包。
- 页面刷新、后台中断或离开任务后，旧录音不会恢复；课程进度和事件 outbox 可以恢复。

## 识别和有限文本匹配

- 语言固定为 `en-US`。
- 最多读取浏览器返回的 3 个识别候选，并选择与本题 `acceptedAnswers` 最接近的候选。
- 规范化范围仅包括大小写、Unicode、标点、空白、常见英文缩写和 `&`/`and`。
- 使用受控答案集合内的词序编辑距离与词覆盖率，结果只有：
  `match`、`close`、`partial`、`different`。
- 用户只看到诚实的文字说明和识别文本，不展示伪精确百分比。
- 反馈明确写明“这是文本接近度，不是发音评分”。
- 模块不判断口音、音素、重音、语调、官方等级或专业发音质量。

## 失败与降级

### 离线、Siri 不可用或识别失败

录音继续工作。停止录音后进入 `review`，允许回放、重新录音或继续下一题。本题不生成
文本接近度，也不记为答错。

### 麦克风权限拒绝

没有麦克风音频就不可能提供录音回放。模块明确说明这一事实，允许用户不评分继续，不
伪造录音或识别结果。用户可以在 Safari 网站设置中重新允许后再录。

### 录音失败

如果 `MediaRecorder` 不存在、启动失败、返回空 Blob 或设备中断，本题标为不可评分并
允许继续。设备故障不会压低口语表现分。

### 后台切换

活动录音和识别立即停止，任务上报 `app-backgrounded` 暂停。恢复后从当前提示重新录，
不声称恢复被中断的音频。

## 学习事件

模块发布 04 定义的四类 v1 事件：

- `learning.task.started.v1`
- `learning.task.paused.v1`
- `learning.task.skipped.v1`
- `learning.attempt.completed.v1`

预算任务额外发布 `learning.training.item.completed.v1`、
`learning.training.content.exhausted.v1` 和
`learning.training.budget.completed.v1`。最后一个事件仍在 timing `finish()` 成功后发布；
逐题事件不会提前结束有效计时会话。

事件先写入会话 outbox，再发布；成功后按事件 ID 删除。

至少一题得到识别文本时，完成事件可携带：

- 受控文本匹配产生的 `performanceScore`
- 按可识别题占比折减的 `evidenceQuality`
- 示范表达和重录产生的 `assistanceLevel`

这里的 `performanceScore` 只代表课程目标文本接近度，不代表发音质量。低接近度只使用
通用 `other` 错误标签，避免伪造“发音”“流利度”或“语法”诊断。

全部提示都因权限、网络或设备原因无法识别时，上报 `unscorable`：

- `performanceScore: null`
- `evidenceQuality: 0`
- `taskCompleted: false`
- 对应 `failureCategory`

用户仍可以完成模块内的录音/回放流程；04 不会把不可评分证据当成掌握度下降。

### QA-002 终态门禁

不可评分完成事件同时满足以下条件才允许创建和发布：

- 所有口语提示已经逐题进入过反馈并走完；
- `session.phase === "completed"`；
- 来源为 `speaking`；
- `result: "unscorable"` 且 `taskCompleted: false`；
- `failureCategory` 只能是 `device`、`permission` 或 `network`。

单题失败只保存在当前答案中，继续下一题时不发布完成事件。初始化失败或课程内容故障只
发布 `learning.task.paused.v1`（`content-failure`）；后台切换只发布暂停事件；中断类
不可评分证据在最后一题仍保持暂停，不伪造终态。事件构造器自身也拒绝为非
`completed` 会话创建不可评分完成事件。

## 验证

模块测试覆盖：

- 28 个口语单元、94 个固定提示和两类活动；
- 课程引用、未知活动类型和任务身份漂移；
- 文本规范化、受控答案匹配及四级接近度；
- MP4 优先探测、录音 Blob、麦克风轨道释放和本地回放；
- Safari 前缀识别、候选文本、网络失败和能力探测；
- 权限拒绝、无麦克风、离线、无识别文本和后台中断；
- 会话恢复、录音不跨页面恢复、事件 outbox、模块元数据和 UI ViewModel；
- 可评分与不可评分学习事件。

R3 的确定性测试使用手动单调时钟，不依赖真实 sleep，覆盖权限等待、录音真实
start/pause/resume/stop/error、回放 playing/pause/waiting/seeking/ended/error、识别
网络等待、回答/反馈与 45 秒空闲、慢持久化、后台中断、退出/刷新恢复、可评分完成、
不可评分完成、最终事件顺序、`finish()` 失败重试、StrictMode 和无 factory 旧调用。

最新测试数字和全项目检查结果以本轮 08 交接为准；01 尚未注入生产 factory 前，不得把
08 模块通过称为 R3 已完成。

## 已知限制

- Web Speech 结果取决于 Safari、系统 Siri 设置、网络和设备环境，不承诺每次可用。
- 文本识别可能把正确口语转写错误，也可能把发音不清的音频转写成目标文本；因此结果
  只能作为有限文本证据。
- 第一版不做开放式 AI 对话。该能力仍属于总纲批准后的第二阶段。
- 第一版不提供专业口音、音素、重音、语调或官方发音评分。
- 录音只在当前页面内存存活，刷新后不能恢复回放。
- 真实 iPhone Safari、主屏幕 Web App、Siri 关闭、静音模式、来电、蓝牙设备和其他
  音频竞争仍由 09 做真机黑盒验收。
