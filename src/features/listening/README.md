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
- 片段 ID 对 UI 保持不透明并原样回收；
- 重复模式为 `none`、`segment`、`all`；
- 优先选择设备本地 `en-US` 语音；语音列表暂时为空时使用 `lang = "en-US"`
  交给浏览器选择；
- 切换速度或片段时停止当前队列，下一次由用户明确重新播放；
- 后台切换会取消当前语音并暂停任务，恢复后从当前片段开头重播，不伪造精确音素续播。

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

- 资源已安装且设备存在可用语音：正常训练；
- 资源未安装：显示无法评分，发布 `failureCategory: "network"`；
- Web Speech 不存在或设备合成失败：显示设备故障，发布不可评分事件；
- 不下载、缓存或上传合成后的音频与用户答案音频。

## 验证

模块测试覆盖：

- 28 个核心听力单元与 84 道扩展题的引用和答案；
- 85 道核心理解题与 28 道场景测验的保留；
- 选择题、听写、规范化、反馈和辅助程度；
- 播放、暂停、速度、片段、重复和过期回调；
- 在线完成、离线资源、后台暂停、音频中断和不可评分事件；
- 会话恢复、事件 outbox、模块元数据和 UI ViewModel。

交付时全项目 `pnpm check` 通过。

## 已知限制

- Web Speech 不提供稳定的逐帧时长进度；当前播放器只可靠展示开始、暂停、结束和次数，
  不伪造秒级进度。
- 第一版使用设备声音，不为不同说话人分配不同真人或合成角色音色。
- 设备语音是否离线可用取决于 iPhone 已安装的系统语音；模块只能检测与降级，不能替
  用户安装系统声音。
- Web Speech 被后台或其他系统音频打断后从片段开头恢复，不承诺字词级续播。
- 真实 iPhone Safari、主屏幕 Web App、静音模式、来电和其他音频竞争仍由 09 做真机
  黑盒验收。
