# 09｜R6 完成每日计划后继续训练追踪表

最终验收版本：`692ff4b`，Pages run `30440708978`，正式资产 `index-Clq8Eo2f.js`。
当前结论：**外部契约、本地与正式站生产浏览器、完整工程门禁及用户实际入口验收全部通过；R6已关闭。**

状态只使用：`自动化通过`、`本地浏览器通过`、`待正式站`、`待真机`、`不通过`。

| ID | MUST 需求 | 失败优先证据 / 验收方法 | 责任模块 | 当前状态 |
| --- | --- | --- | --- | --- |
| R6-001 | 只有同一本地日期的真实每日计划完成 3/3 后才出现“继续训练”；额外练习明确不影响今日完成 | 浏览器必须从空隔离 Profile 完成 R1、生成真实计划，并通过三个正式训练路由完成当前题形成 3/3；不得直接渲染内部组件或种入 completed plan | 01/02/04/09 | 本地浏览器通过 |
| R6-002 | 选择页同时提供词汇、听力、口语；每次创建真实、稳定、JSON 可移植的 `sessionId` 和 900 秒预算；快速双击不重复创建 | `r6-extra-training.acceptance.test.ts` 验证准入、900 秒、稳定 ID、JSON 与并发 start 幂等；浏览器双击词汇卡并核对持久化会话数 | 01/02/04/09 | 自动化通过 |
| R6-003 | 三模块进入真实生产题面/播放器/录音降级；退出保存并刷新后恢复同 session/item/cursor/remaining；可再选另一模块 | `r6-extra-training-browser-acceptance.mjs` 逐模块检查正式路由、模块专属仓储和 IndexedDB 恢复；拒绝 demo/fixture 路径 | 01/05/06/07/08/09 | 本地浏览器通过 |
| R6-004 | 899 秒仍继续；900 秒只进入 `finish-current-item`，不得截断当前作答、听力播放、口语录音/回放；完成当前题后才结束 | 外部契约以 45 秒合法片段推进 899→900，排除后台/暂停/空闲；浏览器用受控持久状态加真实题面完成事件验证三模块自然收尾 | 01/04/06/07/08/09 | 自动化通过 |
| R6-005 | 完成页“再练 15 分钟”回选择并创建新 session；“返回今日完成”保持 3/3，不能产生第四每日任务 | 浏览器比较新旧 sessionId、active-plan 深度和三个每日 execution 的深度相等；外部事件测试证明 extra 证据使用保留身份 | 01/02/04/09 | 本地浏览器通过 |
| R6-006 | 内容优先级固定为近期错题→到期复习→当天变式→新内容；前两级精确命中正式 itemId；排除后正确回退；未知 ID 失败 | 外部验收直接加载正式 808 候选和三个生产 provider，词汇/听力/口语各验证 exact recent、due、same-family variant、new fallback 和 unknown/provider-failure，共 3×路径 | 04/05/06/07/08/01/09 | 自动化通过 |
| R6-007 | 内容耗尽、provider/device 故障只重试同 session；重复事件幂等；失败写入刷新后以同 ID 重放 | 外部验收覆盖三种 failure→started 同 ID/session 恢复及重复幂等；专用 event sink 模拟首次 durable write 失败后同 event ID 仅接受一次 | 04/06/07/08/01/09 | 自动化通过 |
| R6-008 | 可评分额外 attempt 更新掌握/复习证据，但不创建第四每日任务；不可评分不得伪造掌握证据 | 外部 event sink 使用正式候选写入 scored attempt，断言 `planId=extra-training:<date>`、`taskId=sessionId`、每日 3/3 不变；口语离线只接受不可评分降级 | 04/08/01/09 | 自动化通过 |
| R6-009 | 跨日未完成 extra session 变为 expired，不回滚日计划；旧数据没有 `extraTraining` 字段仍可读 | 外部验收检查 `cross-day-expired`、剩余 900、completed daily plan 不变及旧 LearningEngineState 仓储往返 | 04/01/09 | 自动化通过 |
| R6-010 | 320/390 px、快速操作、刷新无阻断；PWA 只使用当前 index，9 个课程/供应资源预缓存；离线可进入选择、词汇、听力，口语诚实降级 | 本地生产浏览器检查布局宽度、SW cache、training-supply-index、断网 reload 与三模块离线路径；正式部署后必须同脚本重跑 | 01/02/05/06/07/08/09 | 本地浏览器通过 |
| R6-011 | 正式站版本、缓存更新及真实 iPhone Safari/主屏幕 App 的触摸、后台、锁屏、音频/录音行为必须单独验收 | 最终Pages run `30440708978`、正式资产`index-Clq8Eo2f.js`；正式URL完整黑盒通过；用户确认实际入口可用 | 01/09/用户 | 用户验收通过 |

## 自动化通过门槛

1. `tests/qa/r6-extra-training.acceptance.test.ts` 全部通过，且未知优先 ID 必须得到
   `provider-failure`，不能回退到普通首题。
2. `tests/e2e/r6-extra-training-browser-acceptance.mjs` 必须从真实 R1→计划→三个正式路由
   的完成事件得到 3/3，再进入额外训练；种入 completed plan 不算通过。
3. 浏览器必须证明三个模块的 session/item/cursor/remaining 可退出、刷新和恢复；至少一次
   快速双击不得创建第二个会话。
4. 899→900 的确定性契约、三模块媒体不截断、故障恢复、outbox 同 ID 重放、掌握证据隔离、
   跨日过期和旧数据兼容全部通过。
5. 09 定向、R6 跨层、全量 `pnpm check`、84 单元、808 供应候选、优先级契约、PWA 和
   本地 release smoke 全绿，且 diff 只在 `tests/e2e/**`、`tests/qa/**`。

## 本地候选之后仍必须重跑

- GitHub Pages 正式 URL 的 R6 完整浏览器脚本，显式核对 HEAD、Pages run 和正式资产；
- 正式 Service Worker 缓存更新：旧标签切换到新 index，旧 cache 清理，3/3 与 extra session
  不丢失；
- 真实 iPhone Safari/主屏幕 Web App 的触摸、退出/恢复、后台/锁屏不扣时、SpeechSynthesis、
  MediaRecorder、识别失败降级和离线核心内容。

上述限制适用于候选阶段。正式部署、正式站黑盒和用户实际入口现均已通过，R6已经关闭。

## 30 秒开发测试模式

- 只有URL参数`?trainingTest=30`启用；普通入口保持900秒。
- 页面顶部必须持续显示测试警示。
- 测试数据只写入`english-learning-pwa-training-test-30s`，不得读取或覆盖正式数据库。
- 初版只加速内部计时但仍显示15:00，该展示缺口已由`26af6a0`修复；测试模式现在把
  900秒内部预算换算为`00:30`墙钟目标和倒计时，额外训练文案也显示30秒。
- 正式站Pages run`30439609560`、资产`index-5i2bPJKW.js`实测从`00:30`开始，
  30.231秒进入`finish-current-item`并完成当前词汇题；普通URL仍显示15分钟并使用
  正式数据库。
- 该模式只缩短开发回归，不替代最终真实iPhone 15分钟验收。

## 底部“训练”页入口

- 3/3完成后，训练页的词汇、听力、口语卡片必须显示“继续训练”并可直接点击，不能继续
  以每日任务已完成为由永久禁用。
- 点击具体模块后直接开始、恢复或重试该模块的额外训练；不创建第四个每日任务，也不回滚
  今日3/3。
- `692ff4b` 已由Pages run`30440708978`部署为`index-Clq8Eo2f.js`。正式隔离浏览器
  已从训练页词汇卡直接进入额外词汇，随后验证三模块退出/刷新恢复、完成、再次训练、离线
  入口和3/3保持不变。
