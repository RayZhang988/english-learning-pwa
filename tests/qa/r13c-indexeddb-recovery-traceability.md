# R13-C｜正式 IndexedDB 恢复验收

正式命令：

```bash
QA_BASE_URL=https://rayzhang988.github.io/english-learning-pwa/ \
QA_EXPECTED_ASSET=index-pFiN7mRr.js \
QA_PAGES_RUN=30529368908 \
  node tests/e2e/r13c-formal-browser-acceptance.mjs
```

| 门禁 | 正式浏览器断言 | 证据脚本 |
| --- | --- | --- |
| Profile A | 合法旧 schema-1 选择态迁移到 schema-2；已答、答对、当前题、选择保留；答至第 7 题后刷新稳定 | `r13c-indexeddb-recovery-browser-acceptance.mjs` |
| Profile A 反馈态 | 独立场景的旧 schema-1 feedback 态仍显示真实正确反馈 | 同上 |
| Profile B 结构损坏 | JSON 可读但不完整的快照显示专用恢复界面；取消不删除，确认后只重建当前场景 | 同上 |
| Profile B 顺序漂移 | 未发布 question ID/顺序漂移同样拒绝并经过 UI 二次确认恢复 | 同上 |
| 隔离 | 其他场景、预置 daily-plan 与 R6.1 extra-training 原始 `records` 条目逐字节不变 | 同上 |
