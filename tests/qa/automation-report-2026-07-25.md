# 09｜自动化验收报告（2026-07-25）

> 这是 R1 之前的历史基线。当前活动需求 R1 的版本、门禁数字和正式站结果见
> `r1-automation-report-2026-07-27.md`；不得继续用本报告的旧 v1 评估与 78/299
> 数字代表当前版本。

## 阶段性结论

**QA-008 正式回归通过；自动化与桌面浏览器门槛通过，第一版仍待完整真机和 14 天。**

`QA-006` 听写竞态仍为已关闭。旧 one/two voice 自动化虽然全部通过，但用户真实
听感明确否决其多 voice、变调变速和逐句 utterance 方案，现登记 `QA-007`。自然度
优先候选已撤除这些机制并通过正式自动化；用户随后明确反馈候选“已经解决”，
QA-007 已关闭。该反馈只关闭听力自然度缺陷，不代表完整 iPhone 清单通过。
随后正式站黑盒复现 `QA-008`：完成真实评估和首日计划后，从底部“训练”进入水平
测试、词汇、听力、口语，四项全部显示“暂无可用训练”，没有进入真实路由。
`1b504c9` 与 `a326f97` 修复部署后，同一正式黑盒完成结果路由、三类真实 taskId、
未轮到/完成禁用状态和占位 0/4 回归，QA-008 已关闭。

## 版本与范围

- 当前正式功能版本：训练页路由修复 `a326f97`
- 当前已提交 09 验收同步版本：`98ffb1b`；本报告包含尚未提交的 QA-008 外部验收扩展
- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`
- QA-008 修复链：`1b504c9`（02 公开入口契约）、`c2f56a8`（QA 登记）、
  `a326f97`（01 生产任务/结果路由）
- GitHub Pages run `30149442712` 成功；正式资产 `index-BAJtI4Qx.js`；
  首页、Manifest、Service Worker 均 HTTP 200
- `724565b` 首次 GitHub Pages run `30147956114` 失败：当次只提交 07，CI 仍读取
  旧 09 多音色断言；这是候选与验收未同步，不是新播放链路的运行时失败
- `98ffb1b` 同步新验收后，GitHub Pages run `30147986654` 成功；正式资产
  `index-DQn2F3sQ.js`，HTTP 200
- `64d884c` GitHub Pages 部署：run `30146382499`，正式资产
  `index-igXDg-nF.js`；该版本触发 QA-006
- `QA-006` 修复版本：`56ca8f1`
- `56ca8f1` GitHub Pages 部署：run `30146889205`，成功；正式资产
  `index-DARWx41s.js`
- `QA-001` 原始失败验收版本：`e98e522`
- `QA-001` 修复版本：`3ae5c9f`
- `3ae5c9f` GitHub Pages 部署：run `30139578460`，成功
- `QA-002` 原始失败版本：`3ae5c9f`
- `QA-002` 修复版本：`20c373d`
- `20c373d` GitHub Pages 部署：run `30141142971`，成功
- `QA-003` 修复版本：`d1e9379`
- `d1e9379` GitHub Pages 部署：run `30141749051`，成功
- `QA-004` 修复版本：`45e97e1`
- `45e97e1` GitHub Pages 部署：run `30143745055`，成功；正式资产
  `index-BO_FD2n1.js`
- `QA-005` 修复版本：`4a15e1e`
- `4a15e1e` GitHub Pages 部署：run `30144364133`，成功；正式资产
  `index-R31Brx_E.js`
- 09 只修改 `tests/e2e/**`、`tests/qa/**`，未修改生产代码。

## 可复现命令与结果

### 项目门禁

```text
pnpm check
结果：通过
lint：通过
TypeScript：通过
Vitest：78 个测试文件、299 项测试通过
生产构建：通过
PWA：生成、自动更新策略和过期预缓存清理校验通过
课程构建校验：8 个课程资产输出、8 个进入预缓存、0 个课程 JSON 内联
```

07 候选专项为 11 个文件、44 项测试通过；新外部验收 1 个文件、8 项测试通过；
当前全量为 78 个文件、299 项测试通过。QA-008 正式回归资产为
`index-BAJtI4Qx.js`。

### 听力对话自动化与真实听感回归

```text
pnpm exec vitest run tests/qa/listening-dialogue-voice.acceptance.test.ts
结果：1 个文件、8 项测试通过
```

旧方案的历史证据：

- 正式 one/two voice 完整 E2E 曾验证 voiceId、pitch、rate、A/B/A 稳定并完成计划
  3/3。
- 这些结果只证明程序按旧设计传参。用户实际听音认为声音和逐句衔接明显不自然，因此
  旧参数证据不得再作为自然度通过依据。

当前正式候选的自动化证据：

- 发布内容的 21 个听力对话、143 条台词继续保持 speaker 与正文分离。
- 完整对话按 transcript 顺序拼成一个连续正文 request，不包含 `Maya:`、`Leo:`、
  `Staff:` 等标签。
- 请求不再携带 `voiceId` 或 `pitch`；生产适配器候选使用系统默认 `voice=null` 和
  `pitch=1`。
- rate 精确等于用户选择的 `0.75`、`1` 或 `1.25`，不存在 speaker 隐藏倍率。
- 用户选择单句时只朗读该句；重复当前、循环全部、暂停、恢复、取消和调速通过。
- 生产 E2E 探针已改为 `QA_TTS_NEUTRAL_PROBE=1`，不再保留废弃 one/two 模式。

以上自动化只能证明导致旧机械听感的代码机制已撤除。候选部署并通过正式自动化后，
用户真实听感明确确认自然单 voice 候选“已经解决”，补齐了自然度、连续性和可用性
证据，QA-007 已关闭。此次反馈没有覆盖整份 iPhone 清单。

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

`45e97e1` 正式站的 QA-004 专项检查点随后通过：

- `pausedValue=abc`
- `restoredValue=abc`
- `submittedValue=abcdef`
- `persistedPhase=feedback`
- 听力任务完成并成功上报

同次完整脚本继续到真实词汇任务后，在第 3 题进入“词汇训练暂时无法继续”，因此
`45e97e1` 不能据旧版 3/3 证据宣称当时完整桌面链路通过。`4a15e1e` 增加了运行时操作
串行化、订阅驱动的单调状态，以及 Route `operationPending` 同步防重入和全交互禁用
三层门禁。06 专项 7 个文件、23 项测试通过；项目全量 76 个文件、272 项测试通过。

GitHub Pages run `30144364133` 成功部署正式资产 `index-R31Brx_E.js`。部署后在正式站
重跑同一 `browser-acceptance.mjs`，exit 0、`status=passed`：QA-004 检查点继续通过，
听力 7/7、词汇 6/6、整日计划 3/3 和刷新恢复全部通过，没有再出现 QA-005。

自然单 voice 候选 `724565b` 与验收同步 `98ffb1b` 部署后，在正式站运行：

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
结果：通过（exit 0，status=passed）
```

- 正式资产：`assets/index-DQn2F3sQ.js`，HTTP 200。
- QA-006 继续通过：`pausedValue=abc`、`restoredValue=abc`、
  `submittedValue=abcdef`、`persistedPhase=feedback`。
- 完整计划 3/3、`planCompleted=true`，刷新恢复通过。
- 此结果证明正式候选的功能与持久化链路通过，不代表真实设备听感通过。

### QA-008 正式训练页黑盒回归

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_TTS_NEUTRAL_PROBE=1 \
QA_SPEAKING_FALLBACK_ONLY=1 \
  node tests/e2e/browser-acceptance.mjs
结果：通过（exit 0，status=passed）
```

- 正式资产为 `index-BAJtI4Qx.js`；从空数据完成 19 道正式评估，生成真实
  AbilityProfile、2700 秒 active-plan 和三个生产 taskId。
- “训练 → 水平测试”精确进入 `#/assessment?mode=results`，并显示词汇、听力、
  口语三项已保存结果。
- “今天”当前任务与“训练”当前专项均携带 active-plan 中的真实 taskId；口语、
  听力、词汇依次完成，最终计划 3/3、`planCompleted=true`，刷新恢复通过。
- 未轮到与已完成卡片在点击前禁用并显示准确原因；所有训练页均拒绝
  “暂无可用训练 / 训练内容接入后会显示在这里”，占位命中从 4/4 降到 0/4。
- 正常生产计划无法自然制造“已跳过”和“任务缺失”状态；这两种状态由现有公开
  契约测试补证，不伪装为正式黑盒：4 个文件、19 项测试通过。
- QA-006 保持通过：`pausedValue=abc`、`restoredValue=abc`、
  `submittedValue=abcdef`、`persistedPhase=feedback`。
- QA-007 的中性连续正文自动化探针通过；真实用户听感关闭证据不变。本次桌面
  正式回归不冒充新的 iPhone 主观听感证据。

## 缺陷结果

| ID | 严重度 | 状态 | 结论 |
| --- | --- | --- | --- |
| QA-001 | S1 | 已关闭 | 课程索引未随生产构建发布；`3ae5c9f` 本地与正式站回归通过 |
| QA-002 | S1 | 已关闭 | `20c373d` 正式站强制 fallback 完整回归 exit 0 |
| QA-003 | S1 | 已关闭 | `d1e9379` 正式 Chrome 从旧缓存切换到新资产且数据保留 |
| QA-004 | S2 | 已关闭 | `45e97e1` / run `30143745055` 正式生产检查点通过 |
| QA-005 | S2 | 已关闭 | `4a15e1e` / run `30144364133` 正式完整 E2E 通过，词汇 6/6、计划 3/3 |
| QA-006 | S2 | 已关闭 | 失败 `64d884c`；`56ca8f1` / run `30146889205` / `index-DARWx41s.js` 正式 one/two voice 完整 E2E 均 exit 0 |
| QA-007 | S2 | 已关闭 | `724565b` / `98ffb1b` / run `30147986654` 正式自动化通过；用户真实听感确认自然度、连续性和可用性问题已经解决 |
| QA-008 | S2 | 已关闭 | `1b504c9` / `a326f97`、run `30149442712`、资产 `index-BAJtI4Qx.js`；正式完整 E2E exit 0，占位命中 0/4 |

09 只记录缺陷与回归证据，没有修改生产代码。

## QA-002 关闭证据

- 生产修复：`20c373d`，已推送至 `main`。
- 部署证据：GitHub Pages run `30141142971` 成功。
- 回归环境：正式 HTTPS 站。
- 回归条件：`QA_SPEAKING_FALLBACK_ONLY=1`。
- 结果：exit 0、三任务完成、计划完成、刷新恢复，不可评分口语不制造掌握度证据。

## QA-003 桌面缓存更新关闭证据

旧版本真实 Chrome 加载 `index-CGAg-Eo9.js` / `index-DaT6cIjA.css`，只显示“技术底座
已运行，尚未接入训练模块”。服务器已有新版本，普通 reload 仍旧，因为旧
`registerType: 'prompt'`、`skipWaiting: false` 与缺失更新入口共同导致新 Service
Worker 永久 waiting。

`d1e9379` 修复并经 GitHub Pages run `30141749051` 发布：

- 使用 `autoUpdate`、`skipWaiting`、`clientsClaim` 和过期预缓存清理。
- 使用单次 reload guard，避免 controller 切换造成重复刷新。
- 用户保持同一标签页和学习数据；第一次 reload 仍旧，等待 3 秒后第二次 reload
  成功切到 `index-WPTS1Fa6.js`。
- 页面显示“需要先完成水平测试 / 开始水平测试”，学习数据未清除。

这证明桌面真实 Chrome 的更新接管与数据保留通过，不证明 iPhone 主屏幕安装态通过。

## G0–G8 状态

| 门槛 | 状态 | 证据或缺口 |
| --- | --- | --- |
| G0 可构建 | 通过 | `pnpm check`、课程构建校验、生产构建和 PWA 通过 |
| G1 首次使用 | 自动化通过 | 正式评估、1047–1048 秒、三能力字段、真实档案和 2700 秒计划通过；真机实际体验待测 |
| G2 训练衔接 | 自动化通过 | “今天”与“训练”两条入口均使用真实 taskId；水平测试结果路由、未轮到/完成禁用、计划 3/3 和刷新恢复通过，QA-008 关闭 |
| G3 数据韧性 | 自动化通过 | 自然单 voice 正式候选通过 `abc` 暂停/恢复、追加为 `abcdef` 立即提交、feedback 持久化与计划刷新恢复 |
| G4 PWA/离线 | 待真机 | Chrome 旧缓存自动更新、数据保留、HTTPS、Manifest、SW、缓存和离线应用壳通过；iPhone 安装态更新及真实离线训练待测 |
| G5 设备与语音 | 待真机 | QA-007 的真实用户听感已通过；麦克风、录音、权限、后台与完整系统语音真机项尚未全部验证 |
| G6 兼容与无障碍 | 待真机 | Chrome 窄屏和键盘通过；Safari、大号文字和 VoiceOver 待测 |
| G7 内容完整 | 通过 | 4 周、28 天、84 单元、答案、前置链和生产 catalog 通过 |
| G8 真机稳定 | 待实测 | iPhone 清单未执行；连续 14 天未开始 |

## 当前门禁

阶段性结论：**QA-008 已关闭；自动化与桌面浏览器门槛通过，第一版尚未完成验收。**

下一步顺序：

1. 完成其余 iPhone 安装、离线、权限、后台、恢复和无障碍清单。
2. 真机门槛全部通过后，再开始连续 14 天记录。
