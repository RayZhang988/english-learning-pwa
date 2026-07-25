# 09｜缺陷登记

只登记已经复现的缺陷。推测、未执行项和真机待验证项分别留在追踪表，不伪装成缺陷。

| 缺陷 ID | 状态 | 严重度 | 标题 | 环境/版本 | 责任任务 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| QA-001 | 已关闭 | S1 | 完成评估后课程索引无法读取，不能生成首日计划 | 正式站验收版本 `e98e522`；修复 `3ae5c9f` | 01 | Pages run `30139578460` 成功；`assessment-recovery-smoke.mjs` 正式站通过 |
| QA-002 | 已关闭 | S1 | 口语识别失败降级完成后不推进计划，后续任务锁定 | 失败 `3ae5c9f`；修复 `20c373d` | 01 主责，04/08 契约协同 | Pages run `30141142971`；正式站强制 fallback 回归 exit 0 |
| QA-003 | 已关闭 | S1 | 旧 PWA 缓存永久等待更新，真实用户停留在技术底座 | 旧缓存策略；修复 `d1e9379` | 01 | Pages run `30141749051`；真实 Chrome 同标签页切换到 `index-WPTS1Fa6.js` |
| QA-004 | 已关闭 | S2 | 关键词听写快速输入时旧状态异步回写，出现单次输入扩增或答案回退 | 失败为用户真实浏览器；修复 `45e97e1` | 07 | Pages run `30143745055`；正式站生产 E2E 的 `listening-dictation-race-recovery` 通过 |
| QA-005 | 已关闭 | S2 | 词汇训练切题后旧选项到达新题，进入不可继续错误态 | 失败 `45e97e1`；修复 `4a15e1e` | 06 主责，09 回归 | Pages run `30144364133`；正式资产 `index-R31Brx_E.js`；完整生产 E2E exit 0 |
| QA-006 | 已关闭 | S2 | 正式站关键词听写立即提交时，反馈态持久化旧答案 | 失败 `64d884c`；修复 `56ca8f1` | 07 主责，09 回归 | Pages run `30146889205`；正式资产 `index-DARWx41s.js`；one/two voice 完整 E2E 均 exit 0 |
| QA-007 | 已关闭 | S2 | 多 voice、变调变速和逐句 utterance 的真实听感机械、不自然 | 失败方案 `64d884c`；修复候选 `724565b`；验收同步 `98ffb1b` | 07 主责，09/用户听感回归 | run `30147986654` 与正式自动化通过；用户真实听感确认自然单 voice 候选“已经解决” |

## QA-001｜课程索引未随生产版本发布

```text
状态：已关闭
严重度：S1
环境：本地生产预览、GitHub Pages 正式站
失败验收版本：e98e522
修复版本：3ae5c9f
前置条件：全新浏览器数据
复现步骤：
1. 进入正式水平测试并至少提交一题。
2. 暂停并刷新，确认评估可恢复。
3. 结束并保存结果，再进入今日计划。
实际结果：显示“课程文件暂时无法读取：content/curriculum/package-index.v1.json”，
能力档案和学习引擎已写入，但没有 active-plan。
期望结果：读取发布后的课程索引，生成 2700 秒首日计划。
影响：首次用户无法进入任何日常训练。
责任任务：01（课程资产构建、发布和运行时读取）
```

关闭证据：

- `3ae5c9f` 已把 8 个课程资产输出并预缓存，0 个课程 JSON 内联。
- GitHub Pages run `30139578460` 已成功部署 `3ae5c9f`。
- 本地 `pnpm check` 和 `node tests/e2e/release-smoke.mjs` 通过。
- 正式站执行 `assessment-recovery-smoke.mjs`，暂停/刷新恢复、部分档案、45 分钟三项
  首日计划和 `active-plan` 全部通过。

## QA-002｜识别失败降级终态不推进每日计划

```text
状态：已关闭
严重度：S1
环境：本地生产预览、GitHub Pages 正式站
失败版本：3ae5c9f
修复版本：20c373d
前置条件：全新浏览器数据；浏览器可录音但语音识别失败
复现步骤：
1. 完成约 17 分钟正式评估，进入生成的 45 分钟首日计划。
2. 从计划的真实 taskId 启动首项口语训练。
3. 对 3 个提示分别开始录音、停止录音；在识别失败后保留录音回放。
4. 每题继续，直到页面显示“口语练习已结束”。
5. 点“返回今日计划”。
实际结果：计划仍显示“已完成 0 项”；口语任务显示“继续”；听力和词汇仍为锁定状态。
IndexedDB 中口语 session 已 completed，但 active-plan 的口语 execution 未完成或跳过。
期望结果：识别失败不评分、不压低能力，但完成回放降级后能结束该任务并进入下一项；
若产品语义是跳过，也必须产生明确、持久化且可继续的终态。
影响：第一版首日核心链路被阻断；用户没有可见绕行，无法进入后续听力和词汇。
建议责任任务：01 主责；04 核对 unscorable/skip/计划终态契约；08 核对口语终态事件。
```

本地复现命令：

```bash
node tests/e2e/browser-acceptance.mjs
```

正式站最短自动回归：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

稳定失败断言：

```text
A completed recording-playback speaking fallback did not advance the daily plan.
false !== true
```

关闭证据：

- `20c373d` 已推送，GitHub Pages run `30141142971` 成功。
- 在 `20c373d` 正式站以与原失败相同的强制条件执行：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

- 进程 exit 0。
- 口语不可评分回放完成后计划推进，没有虚假掌握度证据。
- 听力和词汇正常完成，最终 `completedTaskCount: 3`、`planCompleted: true`。
- 刷新后同一计划及 3/3 完成状态保留。

真机遗留不是缺陷关闭条件的一部分：Safari 麦克风、录音、系统语音、VoiceOver、
后台中断和缓存更新仍必须按真机清单验证。

## QA-003｜旧 PWA 缓存永久 waiting

```text
状态：已关闭
严重度：S1
环境：用户真实 Chrome、GitHub Pages 正式站
失败策略：registerType='prompt'、skipWaiting=false，应用没有可见更新入口
修复版本：d1e9379
前置条件：浏览器仍由旧 Service Worker 和旧预缓存控制
复现步骤：
1. 用已有浏览器数据打开正式地址。
2. 页面只显示“技术底座已运行，尚未接入训练模块”。
3. 确认加载旧资产 index-CGAg-Eo9.js / index-DaT6cIjA.css。
4. 普通 reload。
实际结果：仍加载旧资产和旧技术底座；服务器已经提供新版本，但新 Service Worker
永久停在 waiting，用户没有可见入口触发激活。
期望结果：已发布新版本自动接管现有客户端，在受控 reload 后显示当前应用，同时保留
本地学习数据。
影响：既有用户无法进入评估、计划或任何训练模块；普通刷新无效，没有用户可见绕行。
根因：prompt 注册策略要求应用主动处理更新，但产品没有更新提示或激活入口；
skipWaiting=false 使新 Service Worker 无法自动接管。
责任任务：01（PWA 生命周期、更新激活和缓存清理）
```

关闭证据：

- `d1e9379` 改为 `autoUpdate`、`skipWaiting: true`、`clientsClaim: true`，保留过期预缓存
  清理，并增加单次 reload guard。
- GitHub Pages run `30141749051` 成功发布。
- 76 个测试文件、262 项测试通过。
- 正式用户保持同一 Chrome 标签页和原学习数据：发布后第一次 reload 仍为旧页面；
  等待 3 秒后第二次 reload 切换到 `index-WPTS1Fa6.js`。
- 更新后页面显示“需要先完成水平测试 / 开始水平测试”，不再显示旧技术底座。
- 未清除网站数据或学习数据。

关闭范围只覆盖桌面真实 Chrome。iPhone Safari 和主屏幕 Web App 的 Service Worker
激活、后台恢复、缓存更新与数据保留仍属于真机门禁。

## QA-004｜关键词听写旧状态异步回写

```text
状态：已关闭
严重度：S2
环境：用户真实浏览器、本地生产预览、GitHub Pages 正式站
失败版本：当前正式版本的听力关键词听写链路
修复版本：45e97e1
前置条件：从真实每日计划 taskId 进入听力训练，并到达“关键词听写”题
复现步骤：
1. 播放关键词听写题音频。
2. 在听写输入框快速连续输入，或输入后立即提交、退出/暂停。
3. 观察受控输入框显示值；退出后重新进入并检查恢复值。
实际结果：用户报告偶发“打一个字出现很多字”；旧异步操作可能把较早输入再次写回
受控输入，并可能让较旧快照覆盖较新持久化记录。
期望结果：每次输入只产生对应字符；快速连续输入、立即提交、立即退出/暂停后，
页面值、提交答案和恢复值都等于最后一次用户输入。
影响：听力模块的关键词听写题会出现明显错误输入或错误恢复，但听力选择题及其他模块
仍可使用，且重新输入属于临时绕行；因此不是整个核心链路无绕行的 S1。该问题影响
G3 数据韧性和核心听力作答准确性，作为影响 MUST 门槛的 S2，在关闭前仍阻止验收通过。
根因：运行时保存 Promise 可并发乱序完成；路由层又把各旧 Promise 返回的 session
二次写入 React 状态，较早结果可覆盖较新受控输入。
建议责任任务：07（听力运行时保存顺序与路由状态协调）
```

关闭证据：

- `45e97e1` 已把运行时操作与持久化按调用顺序协调，并移除路由旧 Promise
  对受控输入的二次回写。
- GitHub Pages run `30143745055` 已成功部署；正式资产为 `index-BO_FD2n1.js`。
- 正式站生产 E2E 从空数据完成正式评估并使用真实每日计划 `taskId` 进入听力。
- `listening-dictation-race-recovery` 检查点通过：
  `pausedValue=abc`、`restoredValue=abc`、`submittedValue=abcdef`、
  `persistedPhase=feedback`。
- 同次执行继续完成听力任务并成功上报。随后词汇模块的独立失败登记为
  `QA-005`，发生在 QA-004 全部断言之后，不反向否定本缺陷关闭证据。

## QA-005｜词汇切题后旧选项到达新题

```text
状态：已关闭
严重度：S2
环境：GitHub Pages 正式站
失败版本：45e97e1；Pages run 30143745055；资产 index-BO_FD2n1.js
修复版本：4a15e1e；Pages run 30144364133；资产 index-R31Brx_E.js
前置条件：从空数据完成正式评估和此前计划任务，再通过真实 taskId 进入词汇训练
复现步骤：
1. 连续完成词汇任务前两题并进入下一题。
2. 在第 3 题点击页面当前显示的可用选项。
3. 观察路由状态和浏览器 E2E 结果。
实际结果：页面进入“词汇训练暂时无法继续”，E2E 退出码为 1；错误为：
Option st4w-w1d1-vocabulary:example-comprehension:w1d1-v3:item:w1d1-v2
does not belong to the active question.
期望结果：切题后的可见选项必须属于当前题；快速作答不能把旧题交互送入新题状态，
词汇任务应能继续完成并上报。
影响：正式自动化中，首日计划的词汇任务在第 3 题中断；问题由快速连续交互触发，
不是所有正常速度路径都稳定阻断，因此最终定为 S2。
根因：运行时操作和持久化未统一串行，Route 又允许前一操作完成前继续交互并用旧
Promise 结果回写 UI，旧题选项因此可能到达已经切换的新题。
建议责任任务：06 主责复核词汇操作顺序和当前题身份；09 负责同一生产 E2E 复现、
稳定性压力和修复回归。
修复后回归范围：连续选择、提交、立即下一题、快速点击新题、退出/暂停、刷新恢复，
以及真实首日计划词汇完成与 3/3 进度。
```

修复与关闭证据：

- `4a15e1e` 已加入运行时操作串行化、订阅驱动单调状态、Route
  `operationPending` 同步防重入和全交互禁用，以及竞态单元回归。
- 06 专项通过：7 个测试文件、23 项测试，覆盖乱序保存、旧题选项跨题、状态单调性、
  快速连续操作和 operation pending 交互门禁。
- `pnpm check` 通过：76 个测试文件、272 项测试，lint、类型检查、生产构建、PWA
  和课程构建校验均通过。
- GitHub Pages run `30144364133` 成功部署 `4a15e1e`，正式资产为
  `index-R31Brx_E.js`。
- 部署后在正式站运行
  `QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ node tests/e2e/browser-acceptance.mjs`，
  exit 0、`status=passed`。
- 正式回归中 QA-004 检查点继续通过，听力 7/7、词汇 6/6、整日计划 3/3 和刷新恢复
  全部通过，没有再出现 QA-005 错误。

## QA-006｜正式站立即提交持久化旧听写答案

```text
状态：已关闭
严重度：S2
环境：GitHub Pages 正式站
失败版本：64d884c；Pages run 30146382499；资产 index-igXDg-nF.js
修复版本：56ca8f1；Pages run 30146889205；资产 index-DARWx41s.js
前置条件：全新浏览器数据；从正式评估生成真实首日计划；通过真实 taskId 进入听力；
口语按录音回放 fallback 完成
复现步骤：
1. 运行正式 browser acceptance，进入关键词听写题。
2. 快速输入 abc 后立即退出听力训练。
3. 刷新并恢复，确认 paused.dictationInput 为 abc。
4. 继续训练，快速追加 def 后立即点“提交答案”，不增加人为等待。
5. 页面进入反馈态后读取 IndexedDB 中的 listening session。
实际结果：正式 UI 已进入关键词听写反馈态，但 session.answers 最后一项 response 仍为
abc；断言 Immediate submit used a stale dictation value，'abc' !== 'abcdef'。
期望结果：反馈态和持久化答案都必须使用提交瞬间的最终输入 abcdef。
影响：用户可能看到已提交反馈，却永久保存旧答案，影响听力判定、恢复和学习证据。
存在重新作答的有限绕行，因此定为 S2；该问题直接影响 MUST 的听力完成和数据韧性，
在关闭前阻止正式浏览器门槛、真机门槛和 14 天实测。
已知范围：同一脚本对本地 production preview exit 0，正式站 exit 1。差异说明真实
网络/持久化时序能暴露问题，但不能据此臆测唯一根因。
建议责任任务：07（听力输入、提交、保存队列与持久化完成顺序）
```

正式站复现命令：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_TTS_NEUTRAL_PROBE=1 \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

证据：

- 正式站加载 `assets/index-igXDg-nF.js`，HTTP 200。
- `pausedValue=abc` 与 `restoredValue=abc` 已通过，失败发生在恢复后追加并立即提交。
- 页面已经进入反馈态；IndexedDB 中 session phase 为 `feedback`，但最终 response
  仍是 `abc`。
- 进程 exit 1。09 未修改 `src/**`，也没有放慢立即提交节奏来掩盖竞态。

修复后回归范围：

1. 快速连续输入、立即退出/暂停、刷新恢复、恢复后追加、立即提交。
2. 页面输入值、反馈态、`dictationInput`、最终 answer response 和刷新恢复必须一致。
3. 在本地 production preview 及部署后的正式站分别运行，不能放慢立即提交节奏。
4. 听力 7/7、词汇 6/6、口语 fallback、整日计划 3/3 与刷新恢复必须完成。
5. 听力播放机制后续变更时，`abc → abcdef` 耐久性检查必须作为独立回归继续通过。

修复与关闭证据：

- `56ca8f1` 在提交和退出前等待同一事件周期内最新输入草稿登记并完成持久化，只有
  耐久终态写入成功后才向 UI 发布 `feedback`、`paused` 等状态。
- GitHub Pages run `30146889205` 成功，正式入口资产为 `index-DARWx41s.js`。
- 正式站 one voice 完整 E2E exit 0、`status=passed`：
  `pausedValue=abc`、`restoredValue=abc`、`submittedValue=abcdef`、
  `persistedPhase=feedback`；Maya/Leo/Maya 使用同一 voice，pitch/rate 分别稳定为
  `0.97/0.98`、`1.03/1.02`、`0.97/0.98`。
- 正式站 two voices 完整 E2E exit 0、`status=passed`：同一听写耐久检查点通过；
  Maya 使用 `qa-local-a`，Leo 使用 `qa-local-b`，A/B/A 均为 `1/1` 且稳定。
- 两次正式完整回归都完成口语 fallback、听力 7/7、词汇 6/6、计划 3/3 和刷新恢复。
- `pnpm check` 通过：77 个测试文件、291 项测试，lint、类型检查、生产构建、课程发布
  与 PWA 均通过。
- 自然单 voice 候选 `724565b` 经 Pages run `30147986654` 部署后，正式完整 E2E
  再次通过同一耐久检查点：`pausedValue=abc`、`restoredValue=abc`、
  `submittedValue=abcdef`、`persistedPhase=feedback`。

QA-006 的关闭范围是听写草稿和终态耐久性。旧回归中的 voiceId、pitch、rate 只属于
当时的技术路径证据，不能证明自然度；其真实听感失败另行登记为 QA-007。

## QA-007｜多音色逐句合成真实听感不自然

```text
状态：已关闭
严重度：S2
环境：用户真实听感验收；GitHub Pages 正式方案
失败方案：64d884c 的按 speaker 多 voice、单 voice pitch/rate 差异和逐句 utterance
候选版本：724565b；验收同步：98ffb1b；Pages run 30147986654；
正式资产：index-DQn2F3sQ.js（HTTP 200）
前置条件：从真实计划进入包含多人对话的听力任务
复现步骤：
1. 播放完整多人对话。
2. 连续听完不同 speaker 的台词切换和逐句衔接。
3. 比较语音自然度、清晰度、节奏和长时间可用性。
实际结果：虽然 one/two voice、voiceId、pitch、rate 和 A/B/A 稳定性自动化均通过，
但用户真实听感认为音色和逐句衔接明显不自然，实际可用性低于第一版要求。
期望结果：完整对话自然、清晰、连贯；speaker 标签不朗读。没有经过真实听感验证的
多 voice 时，使用一个系统默认中性 voice，pitch 固定 1，rate 只来自用户选择。
影响：听力任务仍能完成，但第一版核心训练体验明显错误；影响 MUST 的真实听感门槛，
因此定为 S2，并阻止第一版、完整真机清单和连续 14 天实测通过。
建议责任任务：07 负责播放机制；09 和用户负责真实听感回归。
```

自动化证据的边界：

- 旧 one/two E2E 只证明参数按旧设计传递，不能证明自然度；其成功结果不关闭本缺陷。
- 07 候选 `724565b` 已撤除 speaker profile、隐藏 rateScale 和逐句 utterance，改为完整
  对话单一连续正文、`voice=null`、`pitch=1`、精确用户 rate。
- 09 验收同步提交为 `98ffb1b`。首次 run `30147956114` 因部署提交只包含 07，
  CI 仍读取旧 09 多音色断言而失败；这是候选与验收未同步的门禁失败，不是新生产
  播放链路的运行时失败。
- Pages run `30147986654` 随后成功部署，正式入口资产为
  `assets/index-DQn2F3sQ.js`，HTTP 200。
- 新外部验收 1 个文件、8 项测试通过；完整门禁 77 个测试文件、291 项测试通过。
- 正式站执行以下完整浏览器回归，exit 0、`status=passed`：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
```

- 正式回归继续通过 QA-006：`pausedValue=abc`、`restoredValue=abc`、
  `submittedValue=abcdef`、`persistedPhase=feedback`；同时完成计划 3/3、
  `planCompleted=true` 和刷新恢复。
- 上述自动化只能证明旧多音色/变声风险机制已撤除、正文与控制链路符合契约，以及
  正式计划可完成；它不能证明声音在真实 iPhone 上自然、连贯或可长期使用。
  QA-007 当时继续保持 S2 打开。
- 随后用户在真实听感验收中明确反馈自然单 voice 候选“已经解决”。该反馈补齐了
  自动化无法提供的自然度、连续性和可用性证据，QA-007 因此关闭。
- 本次用户反馈没有记录 iPhone 型号、iOS 版本，也不覆盖安装、离线、后台、权限、
  VoiceOver 或口语模块；这些项目仍按真机清单独立验收。

关闭与后续回归范围：

1. 正式完整 E2E 已通过；继续把单一连续 utterance、正文顺序、无 speaker 标签、
   `voice=null`、`pitch=1` 和精确 `0.75/1/1.25` rate 保留为自动化回归。
2. QA-006 的 `abc → abcdef` 暂停、恢复和立即提交已在新候选正式站再次通过，后续
   播放改动仍必须保留该检查点。
3. 用户真实听感已经确认修复后的自然度、连续性和可用性；QA-007 关闭。
4. 后续播放机制、正式资产或系统语音路径变化时，仍须重复自动化与真实听感回归。

## 缺陷模板

```text
缺陷 ID：
状态：新建 / 已交回 / 待回归 / 已关闭
严重度：S0 / S1 / S2 / S3
标题：
环境：
版本或提交：
前置条件：
复现步骤：
1.
2.
3.
实际结果：
期望结果：
影响：
证据：
建议责任任务：
修复后回归范围：
```
