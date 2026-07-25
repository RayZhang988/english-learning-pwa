# 09｜自动化验收报告（2026-07-25）

## 阶段性结论

**自动化与桌面真实浏览器门槛通过；第一版最终验收仍待真实 iPhone 和连续 14 天。**

`QA-001`、`QA-002` 两个 S1 均已在修复后的正式站回归关闭。目前没有未关闭 S0/S1
或影响 MUST 门槛的 S2。自动化通过仍不等于第一版通过：Safari/PWA 系统能力和连续
14 天个人使用尚无真实证据。

## 版本与范围

- 当前验收提交：`20c373d`（`main`、`origin/main`）
- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- `QA-001` 原始失败验收版本：`e98e522`
- `QA-001` 修复版本：`3ae5c9f`
- `3ae5c9f` GitHub Pages 部署：run `30139578460`，成功
- `QA-002` 原始失败版本：`3ae5c9f`
- `QA-002` 修复版本：`20c373d`
- `20c373d` GitHub Pages 部署：run `30141142971`，成功
- 09 只修改 `tests/e2e/**`、`tests/qa/**`，未修改生产代码。

## 可复现命令与结果

### 项目门禁

```text
pnpm check
结果：通过
lint：通过
TypeScript：通过
Vitest：75 个测试文件、258 项测试通过
生产构建：通过
PWA：20 项、1026.57 KiB 进入预缓存
课程构建校验：8 个课程资产输出、8 个进入预缓存、0 个课程 JSON 内联
```

### 构建产物与正式站

```text
node tests/e2e/release-smoke.mjs
结果：通过
Manifest：通过
Service Worker：通过
预缓存课程 JSON：6 个
```

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/release-smoke.mjs
结果：通过
首页 / Manifest / Service Worker：HTTP 200
安装图标：4 个
```

### 评估、档案、计划与恢复

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/assessment-recovery-smoke.mjs
结果：通过
```

正式站证据：

- 评估作答后暂停，刷新恢复的 IndexedDB 记录完全一致。
- 保存部分结果后生成真实 v1 `AbilityProfile`，没有课程加载错误。
- 可进入 45 分钟、3 项任务的真实首日计划。
- GitHub Pages run `30139578460` 已成功部署 `3ae5c9f`。
- `QA-001` 已回归关闭。

完整浏览器评估使用受控时钟累计 1047–1048 秒（约 17 分 28 秒），完成 19 道正式题，
产生词汇、听力、口语三个独立能力字段，并生成 2700 秒计划。真实人的 15–20 分钟
体验仍须 iPhone 计时，受控时钟不能替代真机证据。

### 浏览器、离线、权限与降级

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/platform-offline-accessibility.mjs
结果：通过
```

- 320 / 375 / 390 px 无横向溢出。
- Tab 焦点可到达“开始水平测试”。
- Service Worker 已控制页面。
- Workbox 缓存包含应用壳和 6 个课程 JSON。
- 断网刷新后应用壳仍能启动。
- 未发现非预期跨域请求。

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/assessment-permission-denial.mjs
结果：通过
```

- 浏览器真实拒绝麦克风权限后没有卡死。
- 显示设备失败说明，允许提交失败记录或跳题。
- 没有把权限失败宣称为答错。

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/assessment-recording-fallback.mjs
结果：通过
```

- 可录音、停止并播放本地录音。
- 识别失败时显示“录音仍可回放”。
- 没有伪造识别文本或按答错处理。

### 三个真实训练模块与计划进度

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
结果：通过（exit 0）
```

`20c373d` 正式站黑盒证据：

1. 全新浏览器数据进入正式评估，没有 `demoPlan` 或测试任务。
2. 生成真实计划后，用计划内真实 `taskId` 打开口语任务。
3. 口语完成 3/3 录音；识别失败时可回放，并以不可评分练习终态推进计划。
4. 不可评分口语没有产生虚假掌握度证据。
5. 听力 7/7 和词汇 6/6 正常完成，均由真实计划路由进入。
6. 最终 `completedTaskCount: 3`、`planCompleted: true`。
7. 刷新后仍保留同一 `planId`、3/3 完成和完整计划终态。
8. `QA-002` 在相同 fallback 强制条件下正式回归关闭。

## 缺陷结果

| ID | 严重度 | 状态 | 结论 |
| --- | --- | --- | --- |
| QA-001 | S1 | 已关闭 | 课程索引未随生产构建发布；`3ae5c9f` 本地与正式站回归通过 |
| QA-002 | S1 | 已关闭 | `20c373d` 正式站强制 fallback 完整回归 exit 0 |

09 只记录缺陷与回归证据，没有修改生产代码。

## QA-002 关闭证据

- 生产修复：`20c373d`，已推送至 `main`。
- 部署证据：GitHub Pages run `30141142971` 成功。
- 回归环境：正式 HTTPS 站。
- 回归条件：`QA_SPEAKING_FALLBACK_ONLY=1`。
- 结果：exit 0、三任务完成、计划完成、刷新恢复，不可评分口语不制造掌握度证据。

## G0–G8 状态

| 门槛 | 状态 | 证据或缺口 |
| --- | --- | --- |
| G0 可构建 | 通过 | `pnpm check`、课程构建校验、生产构建和 PWA 通过 |
| G1 首次使用 | 自动化通过 | 正式评估、1047–1048 秒、三能力字段、真实档案和 2700 秒计划通过；真机实际体验待测 |
| G2 训练衔接 | 自动化通过 | 正式站真实 taskId 完成口语 fallback、听力、词汇，计划 3/3 completed |
| G3 数据韧性 | 自动化通过 | 评估恢复、完整计划恢复、3/3 结果刷新保留、损坏/未来版本和幂等测试通过 |
| G4 PWA/离线 | 待真机 | HTTPS、Manifest、SW、缓存和离线应用壳通过；iPhone 安装态及真实离线训练待测 |
| G5 设备降级 | 待真机 | Chrome 权限拒绝、录音回放、识别失败、不记错和计划推进通过；Safari 系统能力待测 |
| G6 兼容与无障碍 | 待真机 | Chrome 窄屏和键盘通过；Safari、大号文字和 VoiceOver 待测 |
| G7 内容完整 | 通过 | 4 周、28 天、84 单元、答案、前置链和生产 catalog 通过 |
| G8 真机稳定 | 待实测 | iPhone 清单未执行；连续 14 天未开始 |

## 当前门禁

阶段性结论：**自动化与桌面真实浏览器通过；第一版最终验收待真机和 14 天实测。**

最终通过仍需：

1. 按 `iphone-checklist.md` 完成真实 iPhone Safari/PWA 的安装、麦克风、录音、系统
   语音、VoiceOver、后台中断、离线、恢复和缓存更新。
2. 真机基础清单通过后，按 `14-day-usage-log.md` 连续记录 14 天个人使用。
