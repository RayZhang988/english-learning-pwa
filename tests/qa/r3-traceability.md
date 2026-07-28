# 09｜R3 训练时长真实性追踪表

验收版本：

- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- 04：`0900cab`
- 01 共享计时：`c3d3071`
- 06：`a514f87`
- 07：`5c27e69`
- 08：`0af7857`
- 02：`1457252`
- 01 正式集成：`9ab305a`
- QA 验收同步：`79d90b6`
- GitHub Pages run：`30330487187`，`success`
- 正式资产：`assets/index-Cm31haDv.js`
- 本地候选：01 `4e49d7f`、05 `b803bd1`、06 `c86d879`
- 本地生产资产：`assets/index-Cm31haDv.js`
- QA-011 本地候选：HEAD `b878965`，08 修复 `b878965`
- QA-011 本地生产资产：`assets/index-DuWWQrUe.js`
- QA-011/012 正式 head：`ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8`
- QA-011/012 GitHub Pages run：`30341029089`，`success`
- QA-011/012 正式资产：`assets/index-DuWWQrUe.js`
- QA-013 修复：04 `1f847d3`；01 仓储回归 `c29c63a`
- QA-013 正式 head：`ac915a39a3adb0e7fa6888ff2383d7787f0604cc`
- QA-013 GitHub Pages run：`30345631519`，`success`
- QA-013 正式资产：`assets/index-yjGhjGzs.js`

状态只使用：`通过`、`本地修复通过，待正式站`、`本地候选通过，待正式站`、
`自动化通过，待真机`、`正式自动化通过，待用户原 iPhone 确认`、`正式站通过`、
`正式站通过，待真机`、`待用户真机`、`不通过`。

## QA-011 修订门禁（正式 run `30341029089`）

QA-009/010 的表格是历史正式发布证据。用户真实 iPhone 的 6 题/12 秒结果已证明每日
任务仍在 900 秒目标前耗尽，因此 R3 由 QA-011 重新打开。当前候选必须另外满足：

| ID | QA-011 要求 | 当前证据 | 通过门槛 | 状态 |
| --- | --- | --- | --- | --- |
| QA011-01 | Today/Training 三项均显示 15 分钟有效训练，不把内容估算当完成预算 | 正式隔离 Chrome：两个页面同 taskId、三项 `targetEffectiveSeconds=900` | 两个页面同三个 taskId，三项均为 `targetEffectiveSeconds=900` | 正式站通过 |
| QA011-02 | 单个 attempt/item 不得完成预算任务 | first-use 1/1：词汇、听力、口语首题后均保持 active | 三模块均需通过；不得回退固定单元完成语义 | 正式站通过 |
| QA011-03 | 899 秒继续；900 秒只进入 finish-current-item；当前题自然结束后才 budget.completed | first-use 与外部 QA-011 7/7；听力播放和口语录音到时未被取消 | 三模块和应用持久化均通过，听力/口语媒体不得截断 | 正式站通过 |
| QA011-04 | 连续供题、cursor/exclude 刷新恢复、短期不重复 | 三模块正式 provider 序列化恢复不重复；正式 Chrome 6 个 item 唯一，第 7 题与排除集刷新保留 | 三模块跨题、刷新后题目/游标/排除集一致 | 正式站通过 |
| QA011-05 | 三模块耗尽后 retry/recovered/continue；错误 recovery 拒绝且重复幂等 | 09 外部逐模块验收与模块 runtime 专项通过 | 三模块同构通过，错误 request/date/state 不改变状态 | 正式站通过 |
| QA011-06 | 正式生产浏览器跨过词汇原 6 题，第 7 题出现且任务未完成 | `r3-duration-baseline-regression.mjs` 正式 `status=passed`：第 7 题出现，task=`active/running`，刷新及离线恢复 | 隔离 profile 的真实 taskId 在第 7 题仍 active，刷新可恢复 | 正式站通过 |
| QA011-07 | 09/R3/全量、类型、lint、build、84、808、PWA、release smoke 全绿 | 候选完整门禁全绿；正式 R3/release smoke 通过；本轮必要专项 11/60、808 校验通过 | 所有门禁零失败 | 正式站通过 |

QA-012（S1）已正式关闭：08 `b878965` 可解析完整 122 个口语候选，包括 28 个
`speaking-scene-quiz`；原 first-use 失败用例 1/1 通过。正式隔离 Chrome 的真实口语
taskId 已进入 `supply-v1-speaking-w1d1-s1` / `practicing`，没有 `provider-failure`；
离线正式索引复核 122/28，供应专项验证 scene 引用可解析。

## QA-013 旧计划 JSON-portable 门禁（正式 run `30345631519`）

用户真实 iPhone 保留的是 QA-011 前生成的旧计划：词汇已经完成 12 秒，听力/口语
任务没有 `trainingBudget`。进入后生产保存曾因 `training: undefined` 被严格仓储拒绝。

| ID | QA-013 要求 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| QA013-01 | 旧任务 create/start/timing/attempt 后完全省略 execution.training | 04 `1f847d3` 与学习引擎专项；正式隔离 E2E 全程检查 raw IndexedDB 无 undefined/`training` | 通过 |
| QA013-02 | listening started+timing+attempt 每步保存并刷新恢复 | 正式 E2E 各步刷新；用户原 iPhone 实际完成听力并显示 38 秒 | 通过 |
| QA013-03 | speaking started+timing+attempt 每步保存并刷新恢复 | 正式 E2E 各步刷新；用户原 iPhone 实际完成 3 个固定口语提示 | 通过 |
| QA013-04 | 既有词汇 completed/scored/12 秒及 completedLearningUnitId 全程保留 | 正式每个检查点深比较同一 execution；用户未清数据继续原计划 | 通过 |
| QA013-05 | 不清数据；正式部署后原 iPhone 旧计划可继续 | 用户未清数据、未重做水平测试，听力与口语均实际完成 | 通过 |
| QA013-06 | QA-013、09、R3、全量和工程门禁零失败 | 本地 3/42、10/57、27/203、123/669 及完整工程门禁已通过；正式 QA-013 E2E 自然 exit 0 | 通过 |

| ID | R3 要求 | 自动化与黑盒证据 | 通过门槛 | 状态 |
| --- | --- | --- | --- | --- |
| R3-01 | 正式发布必须是指定 run/asset | Actions API、首页、Manifest、SW、资产 | run `30341029089` 为 `completed/success`；head `ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8`；首页引用 `index-DuWWQrUe.js`；资源 HTTP 200 | 正式站通过 |
| R3-02 | 内容规模仍由题量、音频与交互步骤形成结构化基线；每日完成规则独立为三项各 900 秒有效训练 | 正式隔离 Chrome 保留 `123/211/181`、计划 515，同时 Today/Training 显示独立 900 秒预算 | 三项均保留 `structured-content`；不得用内容估算或个人速度缩短 900 秒预算 | 正式站通过 |
| R3-03 | Today、Training 和真实 Route 使用同一 taskId 与 900 秒预算；推荐不改预算或锁定其他任务 | 正式两个入口同 taskId/900 秒；词汇真实 Route 连续进入第 7 题并保持 active，刷新恢复 | 三处预算一致，推荐不改值，目标前持续供应且真实 Route 可训练 | 正式站通过 |
| R3-04 | 词汇只计 answering/feedback；加载、持久化、后台、暂停、空闲不计 | 06 定向 10 文件/32 项；R3 QA 分类契约通过 | 生产代码同构自动化生成可信 timing segment，排除项不增加 effectiveSeconds；iOS 生命周期待真机 | 自动化通过，待真机 |
| R3-05 | 听力只在真实 speech `onstart/onresume` 后计时；暂停、结束、错误、取消和后台停止 | 07 定向 14 文件/59 项；生产 factory 已注入 | 自动化验证 utterance 生命周期；真实 iOS 系统语音事件待真机 | 自动化通过，待真机 |
| R3-06 | 口语权限/网络/加载等待不计；MediaRecorder `start` 和回放 `playing` 才计 | 08 定向 14 文件/51 项；生产 factory 已注入 | 自动化验证正常与不可评分路径；真实 iOS MediaRecorder/权限待真机 | 自动化通过，待真机 |
| R3-07 | 后台、隐藏、用户暂停、45 秒空闲、加载与等待均排除；前台/pageshow 不自动恢复 | 01 生命周期与 session 定向测试；R3 QA 分类契约通过 | 桌面/自动化排除逻辑通过；iOS 锁屏与后台回收待真机 | 自动化通过，待真机 |
| R3-08 | 刷新不补算离线时间；pending 事件稳定 ID 重放且不重复；完成和返回幂等 | 01 快照、event sink、route host 自动化通过 | open segment 丢弃、pending ID 与重复完成自动化通过；iOS 中断待真机 | 自动化通过，待真机 |
| R3-09 | 旧 active plan/schema/legacy duration 恢复时不以墙钟冒充实际有效时长 | UI 与 01 ViewModel 自动化；R3 QA partial summary 通过 | 旧记录显示“本次暂无可靠用时”，不能回退 spentSeconds/legacy duration | 自动化通过，待真机 |
| R3-10 | 完成页保留原成绩/反馈，再显示实际有效练习；PlanProgress 与显示一致 | 01 route host 与 02 duration surface 自动化 | 三模块同构集成测试验证秒数、成绩和反馈；真机媒体路径待用户 | 自动化通过，待真机 |
| R3-11 | speaking 正常与 `unscorable-practice` 均保留真实时长；后者无掌握或伪评分 | 04/08/01 自动化基线 | 不可评分完成保留时间、不产生评分/掌握证据；iOS 降级待真机 | 自动化通过，待真机 |
| R3-12 | Today 汇总区分 reliable/unavailable；partial 不把缺失当 0；complete 总和正确 | `r3-truthful-duration.acceptance.test.ts` 与 02/01 ViewModel 测试 | 每模块状态独立；partial 只加可信项；complete 等于三项之和 | 通过 |
| R3-13 | 内容估算可在第 3 个可信同类样本后使用最近 9 个稳健中位数，但个人速度不得缩短每日 900 秒预算；普通 attempt 不计 | R3 QA 个人化测试及 04 `timing.test.ts`；QA-011 first-use/外部验收 | 样本隔离键正确，内容估算可个人化；完成预算始终为 900 秒 | 通过 |
| R3-14 | 320/390px、200% 字体与读屏语义不横向阻断 | 02 duration surface 自动化通过；正式 390px 入口文本和 task 卡通过 | 自动化无横向阻断；iOS 大号文字与 VoiceOver 待真机 | 自动化通过，待真机 |
| R3-15 | SW 预缓存、离线、缓存更新不覆盖 timing、预算与供应状态 | 正式 `index-DuWWQrUe.js` 为唯一 index 缓存；9 个课程 JSON 完整；离线读取 808 供应并恢复第 7 题 | 当前资产和供应资源进入预缓存；iOS 安装态更新与预算数据保留待真机 | 正式站通过，待真机 |
| R3-16 | iPhone Safari/主屏幕 Web App 的锁屏、后台、媒体、语音识别与主观时间体验 | `iphone-checklist.md` R3 小节 | 用户在真实设备逐项确认；桌面和参数探针不能替代 | 待用户真机 |

## 当前门禁

QA-009/010 的正式历史证据仍有效：内容结构估算为 `123/211/181`、
`plannedSeconds=515`。QA-011 不再把这些估算当每日完成预算；三个模块各自使用 900
秒有效训练目标，内容单元结束只推进供应 cursor。

run `30345631519` / head `ac915a39a3adb0e7fa6888ff2383d7787f0604cc` /
`index-yjGhjGzs.js` 已通过正式 R3/release smoke 及 QA-013 等价旧计划回归；QA-011、
QA-012 与 QA-013 均已关闭。下一步必须由用户在原 iPhone 上使用新版预算计划，
继续验证锁屏、后台、MediaRecorder、SpeechSynthesis、语音识别、三模块 900 秒自然
收尾和安装态缓存更新。完成前不能开始 14 天计时，也不能关闭 R3。
