# R1｜09 自动化与正式站验收报告（2026-07-27）

## 结论

**09 桌面与正式站子步骤通过；R1 仍待用户真实 iPhone 验收。**

本报告只覆盖当前活动需求 R1。训练顺序、真实时长、继续训练、听力双语选项、
关键词听写、口语匹配和单元得分均未验收，也未被解锁。

## 验收版本

- 03 词库、抽样、估算、档案基线：`ac94d6d`
- 03 快速作答运行时：`92b7b16`
- 04 首日保守起点兼容：`d94e82b`
- 02 分阶段页面基线：`edc46dc`
- 02 快速作答页面：`4a851b2`
- 01 正式入口、存储和计划基线：`405f120`
- 01 快速作答集成：`1f3d84f`
- QA 放行状态：`9694563`
- GitHub Pages run：`30246015269`
- 正式资产：`index-DGYLY5lm.js`
- 正式地址：`https://rayzhang988.github.io/english-learning-pwa/`

## 可复现结果

### R1 专项

```text
pnpm exec vitest run \
  src/features/assessment \
  src/learning-engine/ability-profile.test.ts \
  src/ui/travel-vocabulary-r1-screens.test.tsx \
  src/app/assessment/TravelVocabularyR1RouteHost.test.tsx \
  src/app/assessment/travel-vocabulary-r1-flow.integration.test.ts \
  src/app/assessment/travel-vocabulary-r1-snapshot-repository.test.ts \
  src/app/assessment/travel-vocabulary-r1-view-model.test.ts \
  src/app/learning/learning-app-coordinator.test.ts \
  src/app/module-registry.test.ts

结果：27 个测试文件、170 项测试通过
```

09 外部验收：

```text
pnpm exec vitest run tests/qa

结果：6 个测试文件、33 项测试通过
其中 R1 快速作答外部验收：1 个文件、4 项测试通过
```

### 项目门禁

```text
pnpm check

结果：通过
Vitest：95 个测试文件、420 项测试通过
lint：通过
TypeScript：通过
生产构建：通过
课程发布校验：通过
PWA 生成与预缓存校验：通过
构建资产：index-DGYLY5lm.js
```

### 正式站 R1 黑盒

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/r1-browser-acceptance.mjs

结果：exit 0，status=passed
```

正式黑盒使用隔离的临时浏览器数据目录，不读取或清除使用者现有网站数据。检查点：

1. 首页、Manifest、Service Worker 和 `index-DGYLY5lm.js` 均 HTTP 200。
2. 全新状态进入 `#/assessment` 的 R1 介绍页；范围仅为旅游英语单词，明确
   5 阶段、每阶段 30 题和“不设规定时长”，没有 v1/v2 或占位入口。
3. 正式运行快照包含 5×30 题、150 个唯一单词；四个正确选项位置均实际出现。
4. 改选、不认识/不确定、清除、1–30 导航和提交后锁定继续通过；检查页明确说明
   未答将按不会记录，未答不再错误禁用提交。
5. 暂停、刷新、断网刷新和 Service Worker 更新前后，样本、选项、草稿、阶段与题号
   保持；暂停期间增加的 60 秒未计入有效时间；双击提交未二次推进。
6. v1/v2 源记录摘要保持不变，只生成独立 R1 新样本；损坏 R1 先保存到
   `corrupt-*` 备份，再重新抽样。重新抽样与最近 150 题重叠 0。
7. 完整 150 题使用阶段正确数 `0、6、15、30、0`，分别得到掌握率
   `0%、20%、50%、100%、0%`；低分和零分均继续到下一阶段。
8. 最终结果为估算 1,230 词、合理区间 800–1,490、内部标签“初中一年级”，显示
   5 阶段明细、150 总题数、179 秒受控有效时间和非学历/非 CET 声明。
9. 持久化档案为 schema 3，词汇为估算结果，听力/口语均为
   `pending-calibration`；首日计划为 2,700 秒、3 个正常训练任务，保守起点与
   04 公开映射一致，没有强制校准任务。
10. 页面由正式 Service Worker 控制，R1 资产已缓存；离线刷新和 SW 更新未覆盖新状态。

快速作答新增检查点：

1. 第 1 题未答时页面显示“未作答将按不会记录，返回后仍可修改”；双击“下一题”只
   到第 2 题，IndexedDB 中第 1 题为 `uncertain`。返回和刷新恢复后状态不变。
2. 第 1 阶段只答对 1 题，其余 29 题留空；检查页提交按钮可用，提交后
   `validQuestionCount=30`、`correctCount=1`、`uncertainCount=29`。双击提交只生成
   一个阶段结果。
3. 第 2 阶段答对 1 题后请求提前结束，确认页显示剩余 119 题；首次请求没有生成结果。
   取消前后 R1 快照摘要一致，已有正确答案仍选中。
4. 再次请求并双击确认后生成五阶段完整结果：有效 150、正确 2、不确定 148，
   `completionReason=remaining-marked-unknown`；只存在一个最新档案。
5. 刷新后结果、schema 3 档案和首日计划摘要不变。
6. 缺少 `completionReason` 的修补前 schema 3 进行中快照可恢复；加载时源记录不被
   重写，恢复保存后内存/新快照原因规范化为 `null`，原第 1 题不确定证据保留。

15 个结果标签的全部阈值边界、五个候选池各至少 150 个有效词、随机性统计和 option
洗牌由 03 单元/契约测试覆盖；正式黑盒实际跑通一个混合成绩和两次不同样本，不把
单次正式结果冒充全部边界样本。

## 未由桌面证明的项目

以下必须保持未通过，直到用户在真实 iPhone 留下证据：

- Safari 与主屏幕 Web App 的安装和首次 R1 入口；
- 真实触摸下的未答下一题、部分提交、提前结束二次确认、1–30 导航及结果页可用性；
- 切后台、锁屏、系统回收、关闭再开后的固定样本、草稿、阶段和有效时间；
- 安装态离线启动、离线继续与恢复联网后的数据保留；
- 320–430 px 真机窄屏、大号文字和 VoiceOver；
- 跨正式版本的安装态缓存更新与 R1 数据保留。

桌面和正式站没有发现需要登记的新生产缺陷。R1-QA-11 未通过前，R1 仍是部分完成，
不得开始下一条排队需求，也不得开始连续 14 天正式记录。
