# 09｜R2 每日训练自由选择追踪表

验收版本：

- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- 04：`32b952a`
- 02：`13094f7`
- 01：`463bee4`
- 状态：`c5fd00d`
- GitHub Pages run：`30254660989`，`success`
- 正式资产：`assets/index-CgCA6fnf.js`

状态只使用：`通过`、`正式站通过`、`待用户真机`、`不通过`。

| ID | R2 要求 | 自动化与黑盒证据 | 通过门槛 | 状态 |
| --- | --- | --- | --- | --- |
| R2-01 | 04 公开全部可启动 taskId；推荐不构成权限 | `r2-free-choice.acceptance.test.ts` 直接检查 `getPlanTaskAccess()`、`evaluatePlanTaskStart()` 与 01 训练页 ViewModel | 3 个不同真实 taskId 同时 `startable`；仅 1 个推荐；无顺序锁 | 通过 |
| R2-02 | 正式部署必须是指定 run/asset | `r2-browser-acceptance.mjs` 读取 Actions API、首页、Manifest、SW 和资产 | run `30254660989` 为 `completed/success`；首页引用 `index-CgCA6fnf.js`；三项资源 HTTP 200 | 正式站通过 |
| R2-03 | 使用真实档案和 active plan，不得用 demo/占位 | 正式隔离浏览器从 R1 完成页生成 schema 3 profile 与 schema 1 active plan | 计划为 2,700 秒、恰有 V/L/S 三任务、taskId 各不相同；记录中无 `recommendedTaskId` | 正式站通过 |
| R2-04 | “今天”同时显示三项，推荐不锁定 | 正式站 `button.task-row` 的 `data-task-id/availability/recommended` 与可点击态 | V/L/S 全部可点；一项“建议先做”；其余无“尚未轮到” | 正式站通过 |
| R2-05 | “训练”使用同一三个 taskId；三类均能作为首项进入真实模块 | V→L→S、L→V→S、S→V→L 从“训练”分别以 V/L/S 为首项 | 路由分别为 `#/vocabulary`、`#/listening`、`#/speaking`，查询参数等于 active-plan taskId；无 demo/占位/串模块 | 正式站通过 |
| R2-06 | “今天”三类也能作为首项 | V→S→L、L→S→V、S→L→V 从“今天”分别以 V/L/S 为首项 | 三个首项均进入正确生产模块和对应 taskId | 正式站通过 |
| R2-07 | 六种完成顺序最终一致 | 隔离临时 Chrome 依次跑完 VLS、VSL、LVS、LSV、SVL、SLV | 每种顺序均逐项达到 1/3、2/3、3/3；最终 `planCompleted=true` | 正式站通过 |
| R2-08 | 完成一项后只禁用该项，其余仍可点；结果刷新保留 | 18 个逐步完成检查点均在返回首页后刷新，再检查“今天”“训练”、active plan 和模块 session | 已完成项显示完成且禁用；未完成项仍 `startable`；三模块 `phase=completed` 与 answers 稳定保留 | 正式站通过 |
| R2-09 | 快速重复操作与重复完成幂等 | 每种顺序首项卡快速双击；首个顺序的首项完成按钮快速双击；检查完成数与事件 ID | 不串路由、不跳两项、不重复完成；完成数只增加 1；processed event IDs 无重复 | 正式站通过 |
| R2-10 | active/paused 只改变推荐，不锁定其他任务 | 正式站启动并退出听力形成 `paused`，刷新后听力变为推荐，再从“训练”启动非推荐词汇 | 暂停项推荐；另两项仍可点；非推荐词汇进入正确路由 | 正式站通过 |
| R2-11 | 旧 schema 1 active plan 刷新恢复 | 正式生成的 schema 1 计划复制到全新隔离 profile 后刷新派生权限 | 不在持久化计划写入推荐字段；刷新后仍有相同三个 taskId 和权限 | 正式站通过 |
| R2-12 | 缺失、损坏或已完成 taskId 诚实拒绝 | 损坏词汇 identity 后“今天/训练”卡均禁用；缺失 taskId 直达路由显示错误；六顺序逐项覆盖完成态 | 不误路由、不隐藏错误；损坏显示“任务异常”；缺失显示“无法打开训练任务”；完成项不能重启 | 正式站通过 |
| R2-13 | 320/390 px 无横向阻断 | 六顺序交替使用 320/390 视口检查“今天”和“训练” | `documentWidth === viewportWidth`；三卡状态、推荐和动作文字可读 | 正式站通过 |
| R2-14 | 用户在真实 iPhone 入口确认可自由选择 | `iphone-checklist.md` 的 R2 小节 | 用户亲自在 Safari/主屏幕 Web App 从 V/L/S 任一项启动并刷新确认；自动化不得代替触摸验收 | 待用户真机 |

## 当前门禁

R2 的外部契约、正式部署、桌面真实浏览器、六种顺序、刷新、幂等、错误拒绝和窄屏
门槛均通过。R2 产品需求仍未关闭：缺少用户在真实 iPhone Safari 或主屏幕 Web App
对三个实际入口自由选择的确认。在该项完成前，不得启动真实时长或其他排队需求。
