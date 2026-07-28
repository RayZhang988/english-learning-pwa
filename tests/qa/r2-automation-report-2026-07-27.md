# 09｜R2 每日训练自由选择自动化报告（2026-07-27）

## 结论

**R2 已由桌面、正式站和用户手机实际入口确认关闭。**

这不是第一版通过结论。用户确认后只解锁了 R3“训练时长真实性”；继续训练、听力
双语选项、关键词听写、口语匹配和单元得分仍不得提前实施。

## 验收版本

- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- 04 契约：`32b952a`
- 02 展示契约：`13094f7`
- 01 应用集成：`463bee4`
- 状态提交：`c5fd00d`
- GitHub Pages run：`30254660989`，`completed / success`
- run head SHA：`6dfce67ea356f2960e89e6ede487545bfa6ecdc7`
- 正式资产：`assets/index-CgCA6fnf.js`
- 首页、Manifest、Service Worker、正式资产：HTTP 200

## 新增 09 自动化

### 外部契约

```text
pnpm exec vitest run tests/qa/r2-free-choice.acceptance.test.ts
结果：1 个文件、10 项测试通过
```

覆盖：

- “今天”和“训练”使用相同三个真实 taskId；
- 三个未完成任务同时可启动，推荐仅为一个展示标记；
- 六种完成顺序均得到相同 3/3 终态；
- 暂停项成为推荐，但其他任务仍可启动；
- 旧 schema 1 计划恢复时动态派生推荐，不把推荐写回计划；
- 缺失、完成和 identity 损坏 taskId 分别返回诚实原因。

### R2 相关集成与完整门禁

```text
pnpm exec vitest run \
  src/learning-engine/task-access.test.ts \
  src/ui/learning-app-prototype.test.tsx \
  src/app/learning/learning-app-coordinator.test.ts \
  src/app/learning/view-model.test.ts \
  tests/qa/r2-free-choice.acceptance.test.ts
结果：5 个文件、54 项测试通过
```

```text
pnpm check
结果：通过
Vitest：97 个文件、454 项测试通过
lint：通过
TypeScript：通过
生产构建：通过
课程资源：8 个发布、8 个进入 PWA 预缓存、0 个 JSON 内联
PWA：20 项预缓存生成通过
```

### 正式站隔离浏览器

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/r2-browser-acceptance.mjs
结果：exit 0，status=passed
```

脚本为每个场景启动独立临时 Chrome profile，不读取、不清除日常浏览器数据。它先在
正式 R1 页面生成 schema 3 `AbilityProfile` 和 schema 1 active plan，再复制这三条
必要生产记录到其他隔离 profile；没有使用 `demoPlan`、UI fixture 或测试 taskId。

正式 active plan 为 2,700 秒，恰有三个不同 taskId，分别属于 vocabulary、listening、
speaking。持久化计划不包含 `recommendedTaskId`，权限与推荐均由正式运行时派生。

## 正式站关键证据

### 两个公开入口

- “今天”：三项均 `availability=startable`、均可点击；词汇显示“建议先做”，听力和
  口语保持可点；页面没有“尚未轮到”。
- “训练”：使用与“今天”完全相同的三个 taskId 和权限。
- 从“训练”分别以词汇、听力、口语为首项进入对应 06/07/08 路由。
- 从“今天”也分别以词汇、听力、口语为首项进入对应生产路由。
- URL 查询参数逐次等于 active-plan 中该模块的真实 taskId；没有串模块、demo 或占位。

### 六种顺序与刷新

下列六种顺序均完整跑完：

1. vocabulary → listening → speaking
2. vocabulary → speaking → listening
3. listening → vocabulary → speaking
4. listening → speaking → vocabulary
5. speaking → vocabulary → listening
6. speaking → listening → vocabulary

每完成一项都返回首页并真实 reload，共 18 个逐步检查点：

- 1/3：完成项显示完成且禁用，另外两项仍同时可点；
- 2/3：最后一项仍可点；
- 3/3：三个执行状态均为 `completed`，active plan 为 `completed`；
- 每个模块的正式 session 均保持 `phase=completed`，taskId、题序和 answers 刷新后
  不变，没有因顺序变化丢失结果。

### 幂等、推荐与错误状态

- 每种顺序的首项卡执行快速双击，没有跳入两个模块或完成两项。
- 首个顺序的首项完成按钮快速双击，完成数只增加一次；processed event IDs 无重复。
- 听力中断后 active plan 为 `paused`，推荐切到听力；非推荐词汇仍可从“训练”启动。
- 损坏词汇 task identity 后，“今天”和“训练”均显示“任务异常”、禁用入口；听力与
  口语仍可用。
- 缺失 taskId 直达路由显示“无法打开训练任务 / taskId is not part of the active
  daily plan.”，没有误进词汇题。
- 已完成 taskId 在每个 1/3、2/3、3/3 检查点均保持禁用，不能作为未完成任务重启。

### 窄屏

- 320 px：“今天”和“训练”均 `documentWidth=viewportWidth=320`。
- 390 px：“今天”和“训练”均 `documentWidth=viewportWidth=390`。
- 三任务状态、推荐徽标与操作文字均在页面可读文本中。

## 仍待真实 iPhone

桌面 Chrome 的移动视口和触控模拟不能替代以下事实：

- Safari 与主屏幕 Web App 中三个真实入口的触摸命中和单手可用性；
- 从词汇、听力、口语任一项开始后，返回/刷新仍可自由选剩余任务；
- iOS 后台、锁屏、安装态存储与 VoiceOver 行为。

2026-07-27，用户已在手机实际入口确认 R2 修复，00 据此关闭 R2 并激活 R3。该确认只
覆盖 R2 的自由选择入口，不代表完整 iPhone 安装、离线、后台、权限、VoiceOver、
缓存更新或第一版验收通过。
