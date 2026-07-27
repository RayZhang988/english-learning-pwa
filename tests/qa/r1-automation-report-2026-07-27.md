# R1｜09 自动化与正式站验收报告（2026-07-27）

## 结论

**09 桌面与正式站子步骤通过；R1 仍待用户真实 iPhone 验收。**

本报告只覆盖当前活动需求 R1。训练顺序、真实时长、继续训练、听力双语选项、
关键词听写、口语匹配和单元得分均未验收，也未被解锁。

## 验收版本

- 03 词库、抽样、估算、档案：`ac94d6d`
- 04 首日保守起点兼容：`d94e82b`
- 02 分阶段页面：`edc46dc`
- 01 正式入口、存储迁移和计划集成：`405f120`
- GitHub Pages run：`30240359686`
- 正式资产：`index-CT4ajse6.js`
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

结果：27 个测试文件、145 项测试通过
```

### 项目门禁

```text
pnpm check

结果：通过
Vitest：94 个测试文件、391 项测试通过
lint：通过
TypeScript：通过
生产构建：通过
课程发布校验：通过
PWA 生成与预缓存校验：通过
构建资产：index-CT4ajse6.js
```

### 正式站 R1 黑盒

```text
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
  node tests/e2e/r1-browser-acceptance.mjs

结果：exit 0，status=passed
```

正式黑盒使用隔离的临时浏览器数据目录，不读取或清除使用者现有网站数据。检查点：

1. 首页、Manifest、Service Worker 和 `index-CT4ajse6.js` 均 HTTP 200。
2. 全新状态进入 `#/assessment` 的 R1 介绍页；范围仅为旅游英语单词，明确
   5 阶段、每阶段 30 题和“不设规定时长”，没有 v1/v2 或占位入口。
3. 正式运行快照包含 5×30 题、150 个唯一单词；四个正确选项位置均实际出现。
4. 改选、不认识/不确定、清除、1–30 导航、未答禁用提交和提交后锁定通过。
5. 暂停、刷新、断网刷新和 Service Worker 更新前后，样本、选项、草稿、阶段与题号
   保持；暂停期间增加的 60 秒未计入有效时间；双击提交未二次推进。
6. v1/v2 源记录摘要保持不变，只生成独立 R1 新样本；损坏 R1 先保存到
   `corrupt-*` 备份，再重新抽样。重新抽样与最近 150 题重叠 0。
7. 完整 150 题使用阶段正确数 `0、6、15、30、0`，分别得到掌握率
   `0%、20%、50%、100%、0%`；低分和零分均继续到下一阶段。
8. 最终结果为估算 1,230 词、合理区间 800–1,490、内部标签“初中一年级”，显示
   5 阶段明细、150 总题数、178 秒受控有效时间和非学历/非 CET 声明。
9. 持久化档案为 schema 3，词汇为估算结果，听力/口语均为
   `pending-calibration`；首日计划为 2,700 秒、3 个正常训练任务，保守起点与
   04 公开映射一致，没有强制校准任务。
10. 页面由正式 Service Worker 控制，R1 资产已缓存；离线刷新和 SW 更新未覆盖新状态。

15 个结果标签的全部阈值边界、五个候选池各至少 150 个有效词、随机性统计和 option
洗牌由 03 单元/契约测试覆盖；正式黑盒实际跑通一个混合成绩和两次不同样本，不把
单次正式结果冒充全部边界样本。

## 未由桌面证明的项目

以下必须保持未通过，直到用户在真实 iPhone 留下证据：

- Safari 与主屏幕 Web App 的安装和首次 R1 入口；
- 真实触摸下完成 150 题、1–30 导航、提交检查及结果页的可用性；
- 切后台、锁屏、系统回收、关闭再开后的固定样本、草稿、阶段和有效时间；
- 安装态离线启动、离线继续与恢复联网后的数据保留；
- 320–430 px 真机窄屏、大号文字和 VoiceOver；
- 跨正式版本的安装态缓存更新与 R1 数据保留。

桌面自动化没有发现需要登记的新生产缺陷。R1-QA-11 未通过前，R1 仍是部分完成，
不得开始下一条排队需求，也不得开始连续 14 天正式记录。
