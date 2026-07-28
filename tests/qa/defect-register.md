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
| QA-008 | 已关闭 | S2 | 底部“训练”页四个公开入口全部进入“暂无可用训练”占位页 | 失败资产 `index-DQn2F3sQ.js`；修复 `1b504c9` / `a326f97` | 01 主责，02 公开入口契约协同；08 无需返工 | Pages run `30149442712`；资产 `index-BAJtI4Qx.js`；正式完整 E2E exit 0，占位命中 0/4 |
| QA-009 | 已关闭 | S2 | R3 正式首日计划仍把词汇、听力、口语全部标为固定 15 分钟 | 失败 `16b9788` / `9ab305a`；修复 `4e49d7f` / `b803bd1` | 01 主责，05 内容事实协同；09 回归 | run `30330487187`、head `79d90b6`、资产 `index-Cm31haDv.js`；正式 V/L/S=`123/211/181`、计划 515 |
| QA-010 | 已关闭 | S1 | 结构化时长任务被真实词汇路由拒绝，首日词汇无法进入 | 失败候选 `4e49d7f` / `b803bd1`；修复 `c86d879` | 06 主责，01 任务契约协同；09 回归 | 同一正式 run/asset；真实词汇入口加载 `0/6` 题面，无不可评分或 identity mismatch |
| QA-011 | 待回归 | S2 | 15 分钟目标前固定单元题目耗尽并提前完成任务 | 用户真实 iPhone / 正式 `79d90b6`；本地候选 HEAD `2b75173` | 04/05/06/07/08/01/02 已交付；09 验收 | 用户首日词汇仅 6 题、12 秒即完成；连续供应候选尚未通过完整 09 门禁 |
| QA-012 | 已交回 | S1 | 正式 808 供应索引使口语预算任务首题即进入内容耗尽 | 本地候选 HEAD `2b75173` | 08 主责；05/01 无需以绕过方式返工 | `first-use-production.acceptance.test.ts` 生产链路稳定失败：`provider-failure` / “当前没有可继续的口语题目” |

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

## QA-008｜“训练”页四个公开入口全部落入占位页

```text
状态：已关闭
严重度：S2
环境：GitHub Pages 正式站；390×844 移动端视口；全新 Chrome 测试档案
失败正式资产：assets/index-DQn2F3sQ.js
修复提交：1b504c9（02 公开入口契约）；a326f97（01 生产任务/结果路由）
QA 登记提交：c2f56a8
前置条件：从空数据完成正式水平测试，生成真实 AbilityProfile、2700 秒 active-plan
和口语/听力/词汇三个真实计划任务；未使用 demoPlan 或测试任务
复现步骤：
1. 在正式站完成水平测试并进入真实首日计划。
2. 点击底部“训练”。
3. 依次点击“水平测试”“词汇”“听力”“口语”四张可用卡片。
4. 每次记录 URL、正文和可操作按钮，再点“返回训练”检查下一项。
实际结果：四项都没有进入正式评估或 03/06/07/08 训练路由；URL 全部保持
https://rayzhang988.github.io/english-learning-pwa/#/。
页面只把标题替换为对应模块名，并统一显示“暂无可用训练”“训练内容接入后会显示在
这里。你可以先返回选择其他训练。”。可操作按钮只有两个“返回训练”以及底部
“今天”“训练”“进度”；没有题目、任务内容或开始按钮。
期望结果：“水平测试”进入真实评估入口；词汇、听力、口语在存在对应 active-plan
任务时使用真实 taskId 进入正式模块。若确实没有可用任务，入口应禁用并说明原因，
不得显示可点击的“进入训练”后再落入统一占位页。
影响：四个公开入口 4/4 不可用，用户从“训练”页无法进入任何承诺的功能。真实每日
计划仍可通过“今天”页启动并完成 3/3，数据未丢失，存在明确绕行，因此客观定为 S2
而不是 S1；作为公开核心入口的系统性失效，在关闭前阻止第一版通过和 14 天计时。
```

正式黑盒证据：

| 点击入口 | URL | 页面正文 | 可操作按钮 |
| --- | --- | --- | --- |
| 水平测试 | `/#/` | `水平测试 / 暂无可用训练 / 训练内容接入后会显示在这里` | 两个“返回训练”；“今天 / 训练 / 进度” |
| 词汇 | `/#/` | `词汇 / 暂无可用训练 / 训练内容接入后会显示在这里` | 两个“返回训练”；“今天 / 训练 / 进度” |
| 听力 | `/#/` | `听力 / 暂无可用训练 / 训练内容接入后会显示在这里` | 两个“返回训练”；“今天 / 训练 / 进度” |
| 口语 | `/#/` | `口语 / 暂无可用训练 / 训练内容接入后会显示在这里` | 两个“返回训练”；“今天 / 训练 / 进度” |

责任边界：

- `01` 主责：底部训练表面状态、正式路由、评估入口，以及把 active-plan 中对应模块的
  真实 taskId 注入 06/07/08 路由。当前四项都未离开 `/#/`，失败发生在功能模块路由
  之前。
- `02` 只负责公开入口契约协同：卡片必须向 01 发出稳定的模块意图，并明确可用、禁用
  和无任务状态；02 不负责生成 taskId 或实现 03/06/07/08 业务路由。
- `08` 当前无需返工：同一正式版本通过真实计划 taskId 的口语录音回放 fallback 和
  计划推进；本缺陷在进入 08 路由之前发生。只有 01 接入有效口语 taskId 后仍失败，
  才把新证据派回 08。相同原则适用于 03/06/07。

修复后回归要求：

1. 从全新数据完成正式评估，保留真实 AbilityProfile、active-plan 和三个 taskId。
2. “训练 → 水平测试”必须进入真实 `#/assessment?mode=results`，显示已保存的三项
   能力结果，不显示占位正文。
3. “训练 → 词汇/听力/口语”在有对应 active-plan 任务时分别进入真实模块，URL 或
   可见状态必须包含可核对的真实 taskId，且能作答、退出并返回训练页。
4. 没有可用任务时，卡片必须在点击前明确禁用或解释，不得承诺“进入训练”后显示
   “训练内容接入后会显示在这里”。
5. 回归“今天”页真实计划 3/3、刷新恢复、QA-006 听写耐久性和 QA-007 听感路径；
   不得为修复公开入口而引入 demoPlan、测试任务或绕开生产路由。
6. 在 390×844 正式站重跑四入口黑盒；四项占位命中必须为 0/4。

修复与关闭证据：

- `1b504c9` 补齐 02 的公开训练卡契约，`a326f97` 接入 01 的正式评估结果路由和
  active-plan 任务路由；QA 登记提交为 `c2f56a8`。
- GitHub Pages run `30149442712` 成功；正式资产 `index-BAJtI4Qx.js`，首页、
  Manifest 和 Service Worker 均 HTTP 200。
- 正式站从空数据完成 19 道真实评估，生成真实 AbilityProfile、2700 秒 active-plan
  和三个生产 taskId；未使用 demoPlan 或测试任务。
- “训练 → 水平测试”进入 `#/assessment?mode=results`，显示词汇、听力和口语三项
  已保存结果；不再进入占位页。
- 初始状态下口语卡携带 task 1 并进入真实口语模块，听力和词汇在未轮到时于点击前
  禁用并显示“尚未轮到”；口语完成后听力卡携带 task 2，听力完成后词汇卡携带
  task 3，三次 URL 的 `taskId` 都与 active-plan 完全一致。
- 已完成卡片于点击前禁用并显示“今天的……训练任务已经完成 / 已完成”；计划 3/3
  后三类专项全部为准确完成态。跳过和缺失状态无法在正常正式计划中自然制造，使用
  已有契约测试补充验证；4 个文件、19 项测试通过。
- 增强后的正式完整 E2E 连续三次 exit 0、`status=passed`，所有训练页均断言不得包含
  “暂无可用训练”或“训练内容接入后会显示在这里”，占位命中由 4/4 降至 0/4。
- “今天”页当前任务继续携带真实 task 1 进入口语；计划刷新恢复和最终 3/3、
  `planCompleted=true` 通过。
- QA-006 继续通过：`pausedValue=abc`、`restoredValue=abc`、
  `submittedValue=abcdef`、`persistedPhase=feedback`。
- QA-007 的连续单一正文、无 speaker 标签、`voice=null`、`pitch=1` 和用户 rate
  自动化契约继续通过；此前真实用户听感关闭证据不变。
- `pnpm check` 通过：78 个测试文件、299 项测试，以及 lint、类型检查、生产构建、
  课程资源和 PWA 预缓存验证全部通过。

## QA-009｜R3 正式计划仍使用固定 15 分钟

```text
状态：已关闭
严重度：S2
环境：GitHub Pages 正式站；390×844；全新隔离 Chrome profile
失败版本：01 集成 9ab305a；状态 16b9788；Pages run 30326369853；
正式资产：assets/index-CDUEKV0C.js
前置条件：清空隔离 profile；从正式 R1 生成 schema 3 AbilityProfile 和真实首日计划
复现步骤：
1. 打开正式站并完成 R1，进入“今天”。
2. 读取词汇、听力、口语三张任务卡的预计有效练习文本和 data-estimate-seconds。
3. 进入底部“训练”，重复读取三张专项卡。
4. 读取 IndexedDB 的 app.learning-runtime / active-plan。
实际结果：两个页面的六张卡全部显示“预计有效练习 / 约 15 分钟 / 内容估算”；
active plan 的三个任务均为 estimatedSeconds=900，三个任务合计恰好 2700 秒。
正式候选没有 durationBaseline，durationEstimate.baselineSource 仍为
legacy-content-estimate。
期望结果：每项预计时长由该任务真实题量、音频长度和交互步骤计算；不得继续使用
旧 900 秒或把每日 45 分钟平均分成三份。Today 与 Training 应显示同一任务自身估算。
影响：R3 的入口时间真实性核心门槛不通过。用户仍能训练，因此不是 S1；但预计时间
继续系统性误导，属于影响 MUST 的 S2，阻止 R3、真机门禁和后续需求解锁。
建议责任任务：01 主责修复课程候选投影和正式计划集成，把现有内容事实转成 04 的
TaskDurationBaseline。只有现有课程结构确实无法表达必要事实时，才由 05 补公开内容
元数据。02 已诚实显示上游值，04 算法及 06/07/08 计时接入无需为本缺陷返工。
```

正式站证据：

- Actions API 返回 run `30326369853` 为 `completed/success`，head SHA 为
  `16b97888d7bda8c0d200bf0a7da53c03e4f9c018`。
- 首页引用 `assets/index-CDUEKV0C.js`；Manifest、Service Worker 和正式资产均
  HTTP 200。
- 正式 R1 生成真实 schema 3 档案、schema 1 active plan 和三个不同生产 taskId，
  没有使用 `demoPlan`、视觉夹具或测试任务。
- Today：
  - 词汇：`900` 秒，约 15 分钟，内容估算；
  - 听力：`900` 秒，约 15 分钟，内容估算；
  - 口语：`900` 秒，约 15 分钟，内容估算。
- Training 使用相同三个 taskId，三张卡仍全部为 `900` 秒和约 15 分钟。
- `tests/qa/r3-truthful-duration.acceptance.test.ts` 的生产内容投影断言稳定失败：
  已发布候选没有 `durationBaseline`；其余 5 项算法、排除和汇总契约通过。

最短回归命令：

```bash
pnpm exec vitest run tests/qa/r3-truthful-duration.acceptance.test.ts

QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/r3-duration-baseline-regression.mjs
```

修复后回归范围：

1. 已发布课程的三个首日候选必须携带结构化 `durationBaseline`，不得只复制旧 900 秒。
2. 新计划的三个 `durationEstimate.baselineSource` 必须为 `structured-content`；
   至少按模块真实内容量产生非等分估算，不能三项全为 900。
3. Today、Training 和三个正式训练 Route 显示同一任务自身估算；推荐变化不得改时间。
4. 保留 R2 三入口自由选择与真实 taskId；不得为修时长重新引入顺序锁。
5. 修复部署后重新执行 R3 正式浏览器的三模块实际计时、排除、恢复、汇总、窄屏与缓存
   全套门禁；当前因第一道预计时长门槛失败，后续正式黑盒不构成通过证据。

应回退步骤：R3 回到实施顺序第 5 步的 `01` 正式计划集成，补齐结构化内容基线并重新
部署；修复前不得进入用户真机 R3 确认，也不得激活“继续训练”。

本地候选回归（2026-07-28）：

- 01 `4e49d7f` 已投影结构化内容基线，05 `b803bd1` 已为 84/84 单元提供可校验事实。
- `validate-duration-baselines.v1.mjs` 通过：首日词汇/听力/口语分别为
  `123/211/181` 秒，84 单元总计 `17,566` 秒。
- QA-009 定向自动化 2 个文件、13 项通过；`targetSeconds=2700`，
  `plannedSeconds=123+211+181=515`，三项 `baselineSource` 均为
  `structured-content`，旧 `estimatedSeconds=900` 只保留为内容 schema 兼容字段。
- 当前本地生产资产 `index-Cm31haDv.js` 的首页、Manifest、SW 和资产均 HTTP 200；隔离
  Chrome 从真实 R1 生成 schema 3 档案和首日计划后，Today/Training 使用相同三个
  taskId，均显示 `123/211/181` 秒，不再全为 15 分钟。
- 课程现有 28 天内容总时长折合日均约 `17,566 ÷ 28 ÷ 60 ≈ 10.5` 分钟。45 分钟是
  每日目标，不是伪造时长的许可证；内容不足必须如实暴露，不能放大单元秒数补齐。

在本地候选阶段，QA-009 已达到“本地修复通过”门槛；首次完整链路发现的独立 QA-010
随后由 `c86d879` 修复。两项当时仍须等待部署后的正式 URL 回归，关闭证据如下。

关闭证据（2026-07-28）：

- GitHub Pages run `30330487187` 为 `completed/success`，head
  `79d90b67601669f050031d2ddece9f5ba64af7fa`，正式资产
  `assets/index-Cm31haDv.js`。
- 隔离、无旧缓存 Chrome 从正式 R1 生成 schema 3 档案和首日计划：
  `targetSeconds=2700`、`plannedSeconds=515`，词汇/听力/口语分别
  `123/211/181` 秒且均为 `structured-content`。
- Today/Training 使用相同三个真实 taskId 和估算；三项没有回退 900 秒。
- 当前 SW 已接管页面，唯一缓存的 index 资产是 `index-Cm31haDv.js`，没有旧 index
  资产残留；首页、Manifest、SW 和资产均 HTTP 200。

## QA-010｜结构化时长任务被词汇路由拒绝

```text
状态：已关闭
严重度：S1
环境：本地生产预览；390×844；全新隔离 Chrome profile
候选版本：01 4e49d7f；05 b803bd1；HEAD 00d45f7
生产资产：assets/index-CTOzFSgF.js
前置条件：从 R1 生成真实 schema 3 AbilityProfile 和首日 active plan
复现步骤：
1. 在“训练”读取真实词汇 taskId，确认其预计有效时间为 123 秒。
2. 点击词汇卡，进入 #/vocabulary?taskId=<真实 taskId>。
3. 等待正式课程资源加载完成。
实际结果：页面显示“本次词汇任务无法评分”和
“Learning task ... does not match its course unit.”，仅提供“重新加载”；
同一失败在 first-use 生产集成验收中表现为 phase=error、questionCount=0。
期望结果：结构化 durationEstimate 只改变任务预计有效时间，不应破坏同一
learningUnitId/contentRef 的课程身份校验；词汇题目应正常加载并可完成。
影响：三个核心训练模块之一完全无法进入且没有可接受降级，符合 S1 定义，立即阻止
完整测试、候选部署、R3 正式回归和真机验收。
责任任务：06 主责修正词汇正式内容解析对新任务时长契约的兼容；01 协同确认
LearningTask.estimatedSeconds 与 durationEstimate 的公开含义。09 只回归，不改源码。
```

可复现证据：

- `tests/qa/first-use-production.acceptance.test.ts`：真实计划词汇 task
  `estimatedSeconds=123`，初始化后得到
  `task-incompatible / does not match its course unit`。
- `tests/e2e/r3-duration-baseline-regression.mjs`：本地生产黑盒先证明 Today/Training
  三项时长和 taskId 一致，再点击真实词汇卡稳定进入上述错误页，exit 1。
- R3 专项：24 个文件、166 项中 165 通过、1 失败。
- 全量：114 个文件、586 项中 585 通过、1 失败；typecheck、lint、生产构建、8 个
  课程资源发布和 20 项 PWA 预缓存均通过。

回归门槛：

1. 保留 QA-009 的 `123/211/181`、`plannedSeconds=515` 和 `structured-content`。
2. 保留旧 schema/课程 `estimatedSeconds=900` 的恢复与读取兼容，不能把新估算回退
   成 900 来绕过错误。
3. first-use 真实三模块链路恢复全绿；本地生产黑盒点击真实词汇 taskId 后出现题目，
   不得进入不可评分错误页。
4. 全量测试必须零失败；修复提交后由 00 重新构建、部署，再由 09 回归 QA-009/010。

本地修复回归（2026-07-28）：

- 06 `c86d879` 已把动态 `estimatedSeconds` / `durationEstimate` 从静态课程身份中移除，
  同时继续校验 schema、domain、targetModuleId、learningUnitId、contentRef、难度和
  tags；旧 900 秒任务兼容测试保留。
- R3 专项 26 个文件、181 项全部通过；09 外部验收 8 个文件、49 项全部通过。
- 全量 114 个文件、588 项全部通过；typecheck、lint、生产构建、课程时长校验和 PWA
  均通过。
- 本地生产资产 `index-Cm31haDv.js` 的首页、Manifest、SW 和资产均 HTTP 200；
  隔离 Chrome 从真实 R1 生成计划后，Today/Training 仍为 `123/211/181` 秒、
  `plannedSeconds=515`，没有回退 900 秒。
- 点击正式词汇 taskId 后进入真实词汇训练，显示“已完成 0 / 6”和第一题 `hi`，没有
  “本次词汇任务无法评分”或 `does not match its course unit`。

QA-010 在本地候选阶段达到“修复通过”门槛，但当时尚不能关闭；部署后的正式关闭
证据如下。

关闭证据（2026-07-28）：

- `c86d879` 已包含在 Pages run `30330487187` / head `79d90b6` /
  `index-Cm31haDv.js`。
- 正式词汇 task 保持 123 秒结构化估算，点击后显示“已完成 0 / 6”、第一题 `hi` 和
  提交按钮；没有“本次词汇任务无法评分”或 `does not match its course unit`。
- R3 专项 26/181、09 外部 8/49、全量 114/588、typecheck、lint、构建、课程校验和
  PWA 全部通过。

## QA-012｜口语正式供应索引无法完整解析

```text
状态：已交回
严重度：S1
环境：本地生产同构验收；HEAD 2b75173
前置条件：使用正式 package-index、四周课程和
content/curriculum/training-supply-index.v1.json；生成带 900 秒
trainingBudget 的首日真实口语 taskId
复现步骤：
1. 通过 createProductionTrainingSupplyProviders() 为正式三模块创建供应器。
2. 使用真实首日 speaking task 初始化 SpeakingTrainingRuntime。
3. 让运行时按 taskId 请求第一道正式供应题。
实际结果：口语 session 进入 phase=error，failure.category=content，
页面语义为“当前没有可继续的口语题目”；stream.exhaustionRequestId 等于首个
supply request，生产适配器返回 provider-failure。
期望结果：首个请求返回可解析的 speaking item，口语进入 practicing；单个 item
完成后继续供应下一题，不能把供应器构造错误伪装成内容耗尽。
影响：新预算口语任务完全不可开始，用户无法完成每天三项 15 分钟训练，阻止
QA-011、R3、候选部署和真机验收。
责任任务：08 主责。05 已按公开交付生成 122 个口语候选，01 正确加载并注入正式
供应器；不得通过 01 过滤候选或 09 放宽门槛绕过。
```

根因证据：

- 正式索引同时包含 `speaking-prompt / activity-prompt` 和
  `speaking-scene-quiz / scene-fixed-response`。
- 08 的 `SpeakingCatalogSupplyProvider` 在构造时会校验全部 122 个口语候选。
- 08 的 `resolveSpeakingSupplyPrompt()` 只在 `unit.prompts` 中查找
  `sourceId`；`w1d1-q3` 等 scene quiz 不属于该数组，因此校验抛出
  `content-reference-missing`。
- 01 的延迟生产适配器按契约把该构造异常转为
  `content-exhausted / provider-failure`，所以问题表现为首题即耗尽，而不是显式崩溃。

稳定复现命令：

```bash
pnpm exec vitest run tests/qa/first-use-production.acceptance.test.ts
```

失败证据：

```text
Speaking stream did not load its first real item
phase=error
failure.category=content
failure.message=当前没有可继续的口语题目。
stream.activeRequestId=...:task:3:supply:1:initial
stream.exhaustionRequestId=...:task:3:supply:1:initial
task.mode=learn
task.difficultyLevel=1
```

应回退步骤与回归门槛：

1. 请先到 `08｜口语训练` 修复正式供应解析：两类公开候选都必须解析为真实
   `SpeakingPrompt`，不得删除 scene quiz、过滤索引或回退固定三题。
2. 08 专项必须覆盖 production 122/122 候选可解析、第一题可启动、跨题不重复、
   `finish-current-item` 不截断录音/识别/回放，以及耗尽恢复。
3. 回到 09 重跑当前失败的 first-use 生产链路；口语第一题必须为 item 而非
   provider-failure。
4. 之后才继续 QA-011 的三模块恢复、899/900 秒、本地第 7 题、全量和浏览器门禁。

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
