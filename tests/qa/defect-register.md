# 09｜缺陷登记

只登记已经复现的缺陷。推测、未执行项和真机待验证项分别留在追踪表，不伪装成缺陷。

| 缺陷 ID | 状态 | 严重度 | 标题 | 环境/版本 | 责任任务 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| QA-001 | 已关闭 | S1 | 完成评估后课程索引无法读取，不能生成首日计划 | 正式站验收版本 `e98e522`；修复 `3ae5c9f` | 01 | Pages run `30139578460` 成功；`assessment-recovery-smoke.mjs` 正式站通过 |
| QA-002 | 已关闭 | S1 | 口语识别失败降级完成后不推进计划，后续任务锁定 | 失败 `3ae5c9f`；修复 `20c373d` | 01 主责，04/08 契约协同 | Pages run `30141142971`；正式站强制 fallback 回归 exit 0 |

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
