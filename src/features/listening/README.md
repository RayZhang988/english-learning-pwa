# 07｜听力训练模块交接

## 公共入口

其他任务只从 `src/features/listening/index.ts` 导入，不读取本目录内部文件。

主要交付：

- `ListeningTrainingRoute`：接收 04 的听力 `LearningTask`、事件接收器和退出回调；
- `createListeningFeatureModule()`：返回 01 可注册的 `FeatureModule`；
- `CurrentListeningContentSource`：按 05 的两个唯一入口加载核心包和听力扩展；
- `ListeningTrainingRuntime`：会话、持久化、事件 outbox、播放器和故障降级；
- `BrowserListeningSpeechSynthesis`：设备 Web Speech 合成语音适配器；
- `ListeningSpeakerVoiceProfiles`：会话级说话人—音色映射和单音色降级；
- `ListeningSessionRepository`：`feature.listening` 命名空间内的会话恢复。

模块不会修改 `src/app/**`。最终路由注册由 01 在集成步骤完成。

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
- `speaker` 只用于片段标签和音色映射，传给 Web Speech 的 `text` 永远只取台词正文；
- 正常播放从当前句依次排到末句；`segment` 重复当前句，`all` 在末句后回到首句；
- 片段 ID 对 UI 保持不透明并原样回收；
- 重复模式为 `none`、`segment`、`all`；
- `ListeningSpeechPort.voices()` 只公开设备本地 `en-US` voice，远程 voice 不进入角色映射；
- 同一运行时会话按 transcript 中的说话人顺序建立一次 profile 并跨题共享，同一
  speaker 的 `voiceId`、`pitch` 和速率微调不会在题间变化；
- 本地 voice 数量足够时每位 speaker 使用不同 `voiceId`，保持 `pitch = 1` 且不微调
  用户速度；
- voice 不足时循环使用已有本地 voice，并只用 `pitch 0.94–1.06`、速率倍率
  `0.98–1.02` 做轻微区分；最终有效速度会限制在本题 `allowedRates` 的最小值与最大值
  之间；
- 单人叙述或播报始终使用一个中性 profile；
- 语音列表暂时为空时使用 `voiceId = null` 和 `lang = "en-US"` 交给浏览器的系统默认
  voice；列表在首次实际解析 profile 时读取，之后为保证角色稳定不在会话中重排；
- 切换速度或片段时停止当前队列，下一次由用户明确重新播放；
- 后台切换会取消当前语音并暂停任务，恢复后从当前片段开头重播，不伪造精确音素续播。

`ListeningSpeechRequest` 的 `pitch` 和 `voiceId` 是可选公开字段，未提供时分别按 `1`
和系统默认 voice 处理，以保持 01/03 已有的单音色调用兼容。`ListeningSpeechVoice`
只描述本地 `en-US` voice 的稳定 ID，不保存或上传设备个人数据。

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

- 资源已安装且设备存在本地 `en-US` voice：正常训练；
- 设备未枚举本地 voice：尝试系统默认 voice；若 Safari 合成失败则按设备故障降级，
  不声称该 voice 可离线使用；
- 资源未安装：显示无法评分，发布 `failureCategory: "network"`；
- Web Speech 不存在或设备合成失败：显示设备故障，发布不可评分事件；
- 不下载、缓存或上传合成后的音频与用户答案音频。

## 验证

模块测试覆盖：

- 28 个核心听力单元与 84 道扩展题的引用和答案；
- 85 道核心理解题与 28 道场景测验的保留；
- 选择题、听写、规范化、反馈和辅助程度；
- 播放、暂停、速度、片段、重复和过期回调；
- 21 段双人对话、143 行台词不朗读 speaker 标签并按 transcript 排队；
- A/B/A 映射稳定、双 voice 分离、跨题共享 profile；
- 零 voice、单 voice、双 voice、异步 voice 列表和单人叙述降级；
- 单 voice 的 pitch/rate 差异上限与有效速度边界；
- 旧 speaker 前缀会话的无损恢复迁移；
- 在线完成、离线资源、后台暂停、音频中断和不可评分事件；
- 恢复 `abc` 后同周期追加为 `abcdef` 并立即提交或退出时，慢写存储中的最终草稿、
  答案和终态都保持 `abcdef`；
- 会话恢复、事件 outbox、模块元数据和 UI ViewModel。

交付时全项目 `pnpm check` 通过。

## 已知限制

- Web Speech 不提供稳定的逐帧时长进度；当前播放器只可靠展示开始、暂停、结束和次数，
  不伪造秒级进度。
- 不同系统 voice ID 不等于真机上必然有明显的听感差异；实际可区分度取决于 iPhone
  已安装的声音，仍需 09 真机验收。
- 如果首次播放时 voice 列表仍为空，本会话会冻结为单 voice 降级；Safari 后续才加载
  的新 voice 不会在半途重排角色，重新进入听力任务后才会重新探测。
- 设备语音是否离线可用取决于 iPhone 已安装的系统语音；模块只能检测与降级，不能替
  用户安装系统声音。
- Web Speech 被后台或其他系统音频打断后从片段开头恢复，不承诺字词级续播。
- 真实 iPhone Safari、主屏幕 Web App、静音模式、来电和其他音频竞争仍由 09 做真机
  黑盒验收。
