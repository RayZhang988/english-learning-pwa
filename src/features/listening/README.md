# 07｜听力训练模块交接

## 公共入口

其他任务只从 `src/features/listening/index.ts` 导入，不读取本目录内部文件。

主要交付：

- `ListeningTrainingRoute`：接收 04 的听力 `LearningTask`、事件接收器和退出回调；
- `createListeningFeatureModule()`：返回 01 可注册的 `FeatureModule`；
- `CurrentListeningContentSource`：按 05 的两个唯一入口加载核心包和听力扩展；
- `ListeningTrainingRuntime`：会话、持久化、事件 outbox、播放器和故障降级；
- `BrowserListeningSpeechSynthesis`：设备 Web Speech 合成语音适配器；
- `ListeningSessionRepository`：`feature.listening` 命名空间内的会话恢复。

模块不会修改 `src/app/**`。最终路由注册由 01 在集成步骤完成。

### R3 有效计时接入

- 07 公开 `ListeningEffectiveTimingSessionFactoryPort`，其结构与 01 的
  `ProductionEffectiveTimingSessionFactory` 兼容。07 不读取浏览器可见性、不创建
  时钟、45 秒空闲定时器、快照或 timing event ID。
- 课程、会话、voice/media 初始化和恢复使用 `loading / content-loading`；调用
  `speechSynthesis.speak()` 后到真实 `onstart` 前使用
  `loading / media-loading`，按钮点击本身不会预先计入听音。
- 只有当前有效 utterance 的 `onstart` 或 `onresume` 才进入
  `audio-listening / active-audio-listening`。`onpause`、`onend`、`onerror`、取消、
  切换速度、切句、后台暂停和卸载会立即关闭真实听音片段。
- 完整连续场景、明确选择的单句、`segment`/`all` 重复和三个批准速度共用同一套
  utterance 生命周期；计时接入没有改变单一中性系统 voice、连续正文、`pitch = 1`
  或用户选择的原始 rate。
- 音频结束或用户真实作答后进入 `answering / active-answering`；提交后的反馈页进入
  `feedback / active-feedback`。选择、输入、提交、下一题和恢复会报告 activity。
  01 统一处理 DOM 活动、后台和 45 秒空闲，07 不补算离线或崩溃间隔。
- 听力会话仓储和业务事件发布期间切到 excluded loading。关键词听写仍先同步发布最新
  草稿，再串行保存；多个草稿并发时，直到最新写入完成才恢复有效阶段。
- 真实完成必须先成功调用 timing `finish()`，发布并保存最后一个
  `learning.timing.segment.recorded.v1`，随后才允许发布
  `learning.attempt.completed.v1` 并向 UI 通知 completed。失败重试复用同一 timing
  pending event 和听力 outbox。
- 注入新计时后，paused/unscorable/completed 业务事件的旧墙钟
  `durationSeconds` 固定为 0，由 04 只使用 `source = timing-segments` 的可信片段累计
  有效时长；未注入 factory 的旧调用方继续保留原兼容行为。
- 未完成退出与真实 Route 卸载会等待最新草稿、播放状态和 outbox 后调用 `dispose()`；
  React StrictMode cleanup/setup 探测通过模块内延迟释放避免重复 session。

01 的唯一生产注入点是
`src/app/learning/training-route-hosts.tsx` 中的 `ListeningTrainingRoute`：
传入 `timingSessionFactory={productionEffectiveTimingSessions}`。该应用集成不属于
07 文件所有权，本次模块交付没有修改或部署 `src/app/**`。

## 输入

### 学习任务

只接受：

```ts
task.schemaVersion === 1
task.domain === 'listening'
task.targetModuleId === 'listening'
```

`learningUnitId` 和 `contentRef` 必须同时命中课程单元，不能只按其中一个猜测。

### 课程

核心包入口：

`content/curriculum/package-index.v1.json`

结构化听力扩展入口：

`content/curriculum/listening-exercise-extension-index.v1.json`

运行时严格按入口声明的文件列表读取，不扫描目录。扩展的 `transcript-line` 必须同时
命中 `baseContentRef`、`lineIndex` 和 `expectedText`。

## 题型与判定

- `word-discrimination`：使用内容给出的 `correctOptionId`，错误标签为
  `sound-discrimination`。
- `short-sentence-choice`：使用 `correctOptionId`，错误标签为
  `detail-missed`。
- `keyword-dictation`：只接受内容给出的 `acceptedAnswers`。规范化严格受
  `normalizationHints` 控制，不做语义扩写或模糊匹配。
- 原有 `activity.checks`：作为 `core-information` 保留；`inference` 错误使用
  `inference` 标签，其余使用 `detail-missed`。
- 原有听力 `sceneQuiz`：作为 `scene-comprehension` 保留。

提交前必须至少实际开始播放本题主片段一次，并提供与题型匹配的输入。翻译、原文和
理由只在提交后显示。

## 播放

- 语言固定为 `en-US`；
- 速度只允许内容声明的 `0.75`、`1`、`1.25`；
- 完整场景使用 `sequenceMode = "all-segments"`，每行 transcript 是一个独立片段；
- 默认完整场景把所有片段的 `text` 按原顺序用一个空格连接，只向 Web Speech 提交一次
  连续 utterance；保留正文原有句末标点，不拼入 `speaker`、人名或角色名；
- 用户明确选择某句后，下一次播放只提交该句正文；
- `none` 播放一次当前范围，`segment` 循环当前句，`all` 循环完整场景；整段循环只在
  一轮连续 utterance 自然结束后重新提交下一轮；
- 片段 ID 对 UI 保持不透明并原样回收；
- 重复模式为 `none`、`segment`、`all`；
- 当前生产适配器始终设置 `utterance.lang = "en-US"`、`utterance.pitch = 1`、
  `utterance.voice = null`，由浏览器和系统选择自然中性默认 voice；
- `utterance.rate` 严格等于用户选择的 `0.75`、`1` 或 `1.25`，不存在按 speaker
  追加的倍率或隐藏速度；
- `ListeningSpeechPort.voices()` 只保留为设备能力诊断，不参与生产 voice 选择，不按
  `voiceURI` 或 `name` 排序后自动挑选角色 voice；
- `speaker` 结构继续供 UI 显示，并为未来经验证的 voice 白名单或预生成音频保留；
- 播放中切换速度或片段会取消当前 utterance，下一次由用户明确重新播放；
- 播放中的暂停/恢复交给同一个系统 utterance；后台切换会取消语音并暂停任务，恢复后
  从当前范围开头重播，不伪造精确音素或逐句进度。

旧版会话若仍保存单个 `${speaker}: ${text}` 完整场景片段，恢复时会根据会话内已有
transcript 迁移为逐句片段，并把旧完整场景的播放次数转移到首句；不会继续朗读旧标签。

## 输入草稿与耐久终态

- 关键词听写草稿先同步发布给受控输入框，再按产生顺序串行写入会话仓库；
- 提交、用户退出和后台暂停会先等待同一事件周期内的最新输入完成登记和持久化，再从
  最新会话快照生成终态；
- `feedback`、`paused`、`completed` 等非草稿状态只在对应会话写入成功后通知 UI；
- 退出回调还会等待暂停事件 outbox 清空后的最终会话写入，不能把仅存在于内存的输入
  当作已经保存。

## 学习事件

模块发布 04 定义的四类 v1 事件：

- `learning.task.started.v1`
- `learning.task.paused.v1`
- `learning.task.skipped.v1`
- `learning.attempt.completed.v1`

可评分完成事件包含表现分、辅助程度、错误标签和有效时长。辅助程度由慢速、重复模式和
额外播放次数确定。设备、网络、内容或中断故障发布 `unscorable`，不得完成任务或压低
听力掌握度。

事件先写入会话 outbox，再发布；发布成功后按事件 ID 删除，恢复时不会重复生成结果。

## 离线与降级

`CurrentListeningContentSource.install()` 安装 8 个运行时 JSON 资源：核心入口、课程
清单、四周课程、扩展入口和练习包。

离线时：

- 资源已安装且系统默认 `en-US` voice 可离线合成：正常训练；
- 设备未枚举本地 voice：仍尝试系统默认 voice；若 Safari 合成失败则按设备故障降级，
  不声称该 voice 一定可离线使用；
- 资源未安装：显示无法评分，发布 `failureCategory: "network"`；
- Web Speech 不存在或设备合成失败：显示设备故障，发布不可评分事件；
- 不下载、缓存或上传合成后的音频与用户答案音频。

## 验证

模块测试覆盖：

- 28 个核心听力单元与 84 道扩展题的引用和答案；
- 85 道核心理解题与 28 道场景测验的保留；
- 选择题、听写、规范化、反馈和辅助程度；
- 播放、暂停、速度、片段、重复和过期回调；
- 完整场景只提交一个按 transcript 顺序拼接、且不含 speaker 标签的连续正文
  utterance；
- 生产 utterance 固定 `pitch = 1`、使用系统默认 voice，rate 严格等于用户选择；
- 明确逐句选择只朗读该行，重复当前和循环全部使用各自真实范围；
- 零 voice、多个 voice 和异步 voice 列表都不会触发自动角色 voice 选择；
- 旧 speaker 前缀会话的无损恢复迁移；
- 在线完成、离线资源、后台暂停、音频中断和不可评分事件；
- 恢复 `abc` 后同周期追加为 `abcdef` 并立即提交或退出时，慢写存储中的最终草稿、
  答案和终态都保持 `abcdef`；
- 会话恢复、事件 outbox、模块元数据和 UI ViewModel。
- R3 使用真实 `EffectiveTimingSession` 和手动单调时钟覆盖：
  `onstart/onpause/onresume/onend/onerror/cancel`、语音启动等待、完整/单句共用播放
  语义、后台/前台不自动续算、45 秒空闲、答题/反馈、慢速持久化、快速听写、
  刷新/卸载不补时、StrictMode、完成事件顺序和 `finish()` 失败重试。

交付时全项目 `pnpm check` 通过。

本轮 R3 复验：07 专项 14 个测试文件、59 项测试通过；全量 108 个测试文件、528 项测试
通过，lint、构建型 TypeScript、Vite 生产构建、PWA 20 项预缓存和 8 个课程资源发布
校验均通过。

## 已知限制

- Web Speech 不提供稳定的逐帧时长进度；当前播放器只可靠展示开始、暂停、结束和次数，
  不伪造秒级进度。
- Web Speech 无法可靠生成自然的多人物对话；第一版当前有意使用一个中性系统 voice，
  不再伪装人物音色差异。
- 完整场景是一个连续 utterance，因此不会在播放中伪造当前说话人或逐句进度；逐句训练
  需要用户明确选择某行。
- 系统默认 voice 的具体音色由 iPhone 与 Safari 决定，自动化只能证明参数和文本路径，
  不能证明自然度。本版本部署后仍只是候选，必须由 09 和用户真实听音。
- 只有经过真实 iPhone 听感验证的系统 voice 白名单，或未来明确批准的预生成音频，才
  能重新启用多人物音色；第一版当前两者都没有。
- 设备语音是否离线可用取决于 iPhone 已安装的系统语音；模块只能检测与降级，不能替
  用户安装系统声音。
- Web Speech 被后台或其他系统音频打断后从片段开头恢复，不承诺字词级续播。
- 真实 iPhone Safari、主屏幕 Web App、静音模式、来电和其他音频竞争仍由 09 做真机
  黑盒验收。
- R3 的 07 factory 尚未由 01 注入生产 Route，也未部署或经 09 正式站回归；当前生产
  听力训练仍不会创建有效计时 session。模块自动化只能验证阶段与事件顺序，不能替代
  真机后台、中断和听感验收。
