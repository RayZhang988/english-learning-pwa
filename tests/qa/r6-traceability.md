# 09｜R6 完成每日计划后继续训练追踪表

验收版本：本地候选 `7193aa0`。  
当前结论：**外部契约 10/10、本地生产浏览器与完整工程门禁通过；等待正式站。**

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
| R6-011 | 正式站版本、缓存更新及真实 iPhone Safari/主屏幕 App 的触摸、后台、锁屏、音频/录音行为必须单独验收 | 本地候选只能批准部署；部署后传 `QA_BASE_URL`、资产和 Pages run 重跑；真机按 `iphone-checklist.md` 执行 | 01/09/用户 | 待正式站 / 待真机 |

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

因此，本地全部通过时也只能给出“R6 可部署候选”，不能关闭 R6，更不能开始 14 天计时。
