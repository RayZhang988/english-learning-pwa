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
- 状态：`16b9788`
- GitHub Pages run：`30326369853`，`success`
- 正式资产：`assets/index-CDUEKV0C.js`
- 本地候选：01 `4e49d7f`、05 `b803bd1`、06 `c86d879`
- 本地生产资产：`assets/index-Cm31haDv.js`

状态只使用：`通过`、`本地通过，待正式回归`、`正式站通过`、`待正式回归`、
`待用户真机`、`不通过`。

| ID | R3 要求 | 自动化与黑盒证据 | 通过门槛 | 状态 |
| --- | --- | --- | --- | --- |
| R3-01 | 正式发布必须是指定 run/asset | Actions API、首页、Manifest、SW、资产 | run `30326369853` 为 `completed/success`；首页引用 `index-CDUEKV0C.js`；三项资源 HTTP 200 | 正式站通过 |
| R3-02 | 首日三项预计时长来自题量、音频与交互步骤，不是固定 15 分钟或 45 分钟等分 | 本地候选从 R1 生成真实档案和计划；QA 自动化与隔离 Chrome 均得到 `123/211/181`、计划 515、目标 2700 | 三项均有 `structured-content` 基线；不得全为 900 秒；Today/Training 显示任务自身估算 | 本地通过，待正式回归（QA-009） |
| R3-03 | 预计时长在 Today、Training 和真实 Route 一致；推荐不改时间或锁定其他任务 | `c86d879` 后本地 Today/Training 同 taskId 同估算；真实词汇 Route 保持 123 秒并加载“已完成 0 / 6”题面 | 同一 taskId 三处秒数和 basis 一致，推荐变化不改值，且真实 Route 可训练 | 本地通过，待正式回归（QA-010） |
| R3-04 | 词汇只计 answering/feedback；加载、持久化、后台、暂停、空闲不计 | 06 定向 10 文件/32 项；R3 QA 分类契约通过 | 正式路由生成可信 timing segment，排除项不增加 effectiveSeconds | 待正式回归 |
| R3-05 | 听力只在真实 speech `onstart/onresume` 后计时；暂停、结束、错误、取消和后台停止 | 07 定向 14 文件/59 项；生产 factory 已注入 | 正式 Route 在真实 utterance 生命周期产生 audio segment；按钮到 onstart 的等待不计 | 待正式回归 |
| R3-06 | 口语权限/网络/加载等待不计；MediaRecorder `start` 和回放 `playing` 才计 | 08 定向 14 文件/51 项；生产 factory 已注入 | 正常与不可评分正式路径均保存真实录音/回放时间；无伪评分 | 待正式回归 |
| R3-07 | 后台、隐藏、用户暂停、45 秒空闲、加载与等待均排除；前台/pageshow 不自动恢复 | 01 生命周期与 session 定向测试；R3 QA 分类契约通过 | CDP 生命周期后 effective 不增长；需真实活动或媒体 resume 才重新开始 | 待正式回归 |
| R3-08 | 刷新不补算离线时间；pending 事件稳定 ID 重放且不重复；完成和返回幂等 | 01 快照、event sink、route host 自动化通过 | 正式 IndexedDB open segment 丢弃；pending ID 不变；重复完成只累计一次 | 待正式回归 |
| R3-09 | 旧 active plan/schema/legacy duration 恢复时不以墙钟冒充实际有效时长 | UI 与 01 ViewModel 自动化；R3 QA partial summary 通过 | 旧记录显示“本次暂无可靠用时”，不能回退 spentSeconds/legacy duration | 待正式回归 |
| R3-10 | 完成页保留原成绩/反馈，再显示实际有效练习；PlanProgress 与显示一致 | 01 route host 与 02 duration surface 自动化 | 三模块正式完成页的秒数等于 `timing-segments`，成绩/反馈不消失 | 待正式回归 |
| R3-11 | speaking 正常与 `unscorable-practice` 均保留真实时长；后者无掌握或伪评分 | 04/08/01 自动化基线 | 不可评分完成可产生可信时间样本，但不产生评分/掌握证据 | 待正式回归 |
| R3-12 | Today 汇总区分 reliable/unavailable；partial 不把缺失当 0；complete 总和正确 | `r3-truthful-duration.acceptance.test.ts` 与 02/01 ViewModel 测试 | 每模块状态独立；partial 只加可信项；complete 等于三项之和 | 通过 |
| R3-13 | 1–2 个可信同类样本仍为 content baseline；第 3 个起使用最近 9 个稳健中位数；普通 attempt 不计 | R3 QA 个人化测试及 04 `timing.test.ts` | 样本隔离键正确；第 3 个后 `personal-history`；估算对历史中位数偏差 ≤25% | 通过 |
| R3-14 | 320/390px、200% 字体与读屏语义不横向阻断 | 02 duration surface 自动化已通过；正式页面待修复后回归 | 两个入口、完成页、每日汇总无横向溢出；语义包含预计/实际和可靠性 | 待正式回归 |
| R3-15 | SW 预缓存、离线、缓存更新不覆盖 timing 新状态 | `pnpm check` PWA 基线；正式缓存更新待修复后执行 | 当前资产和课程进入预缓存；刷新/更新保留计划与 timing 快照 | 待正式回归 |
| R3-16 | iPhone Safari/主屏幕 Web App 的锁屏、后台、媒体、语音识别与主观时间体验 | `iphone-checklist.md` R3 小节 | 用户在真实设备逐项确认；桌面和参数探针不能替代 | 待用户真机 |

## 当前门禁

旧正式部署资源可访问，但仍是 QA-009 的 900 秒失败版本。本地候选已经以
`123/211/181` 和 `plannedSeconds=515` 通过 R3-02；84 单元总计 17,566 秒，日均约
10.5 分钟，不能靠虚假时长补足 45 分钟目标。

QA-010 已由 06 `c86d879` 本地修复：真实词汇 Route 在保留 123 秒动态估算和旧 900 秒
内容兼容字段的同时加载 6 题。R3/09 专项、全量、类型、lint、构建、课程与 PWA 均
通过。当前剩余门禁是由 00 部署，再由 09 在正式站重跑 QA-009/010 和完整浏览器门禁；
之后才交给用户执行 R3 真机清单。在此之前不得激活“继续训练”或开始 14 天计时。
