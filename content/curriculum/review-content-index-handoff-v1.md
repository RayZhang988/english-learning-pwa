# R13-D 统一错题内容身份索引（v1）

唯一入口是 `review-content-index.v1.json`；生成与严格漂移校验器是
`generate-review-content-index.v1.mjs`。索引覆盖当前发布的日常供应 `itemId` 和 612 个场景
词汇 `bankId@contentVersion/questionId`。消费者不得根据展示文字、`variantFamilyId` 或
`playbackContentId` 临时猜测身份。

每个 alias 返回 04 所需的非空 `reviewContentId`、`originalQuestionType`、domain 和原题
定位。日常定位保留正式 `itemId`、source type/id、variant 和 contentRef；场景定位保留
bank/version/questionId/category/scene。06/07/08 以这些定位回到各自已发布 resolver，恢复原
题格式；05 不评分、不保存错题状态。

规范化是“原题型 + 完整可评分内容”的排序键 JSON 再做 FNV-1a-32 指纹。定位 ID、供应
item ID、播放 ID 与变式族不进入指纹，因此真正相同的评分内容可跨来源合并；题型、题干、
选项/可接受答案、必要音频来源字段不同就不会合并。听力的题目内容是主键，
`playbackContentId` 绝不能单独作为身份。口语保留原 `modelAnswer`/`acceptedAnswers`，不创
造任何发音评分或改变现有 match/close/partial/different 语义。

旧记录只能在其持有本索引的完整 alias 和一条可验证的正式 incorrect 证据时迁移。旧
`reviewItems`、R7 汇总、分数或只有目标词的记录无法证明原题，必须拒绝迁移，不能伪造历史。

运行：

```sh
node content/curriculum/generate-review-content-index.v1.mjs
```

内容改动后明确运行 `--write`，并将生成索引与变更一起审查。01 需把此索引加入课程资源加载、
构建发布和 PWA 预缓存；这是 01 的边界，不在本交付中代做。
