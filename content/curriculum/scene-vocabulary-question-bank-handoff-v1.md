# R13-B 场景词汇题库交接（v1）

## 交付范围

唯一入口是 `content/curriculum/scene-vocabulary-question-bank-index.v1.json`。它明确列出题库、schema、审计器和本说明的路径；消费者不得扫描目录或根据文件名猜测版本。

本交付是 R13-B 的第一步：仅提供场景训练的词汇题库。它不接入 `src/**`，不创建每日计划、额外训练、成绩、时长或任何听力/口语题。后续 02、06、01、09 必须在各自职责内显式消费、集成和验收，不能把本文件存在误报为场景训练已上线。

## 冻结的题型契约

每一道题包含：

- 一句场景相关的 `sentenceEn`；
- 一个唯一的 `targetText`，由 `targetOccurrence: 1` 固定其在句中的高亮目标；
- 仅问“这个词是什么意思？”的中文词义选择：`correctMeaningZh` 与三个 `distractorMeaningsZh`；
- `targetPlayback: tap-highlighted-target-only`：点击高亮目标时只能播放该目标词，固定 `en-US`，不得朗读整句；
- 没有整句翻译字段，`sentenceTranslationAllowed` 恒为 `false`。

目标词、句子和选项均是离线 JSON 内的受控文本。题库不含 URL、远程音频或运行时机器翻译依赖。

## 覆盖清单

| 一级分类 | 子场景 | 题数 |
| --- | --- | ---: |
| 机场与飞行 | 机场、飞机上、入境海关、行李提取、海关行李检查、货币兑换、机场交通 | 42 |
| 城市交通 | 出租车、公共交通、自驾租车 | 18 |
| 住宿与餐饮 | 酒店、餐厅 | 12 |
| 购物与观光 | 购物、景点观光 | 12 |
| 日常求助与通信 | 向路人求助、卫生间、网络与通信 | 18 |
| 医疗与药店 | 医疗与药店 | 6 |

合计为 18 个既有 `sceneId`、108 题、每个子场景 6 题。场景 ID 和分类 ID 必须严格匹配 R13-A 已发布入口；医疗与药店是一个 `medical-pharmacy` 子场景，不得拆分或新增第 19 项。

## 可追溯性与版本规则

每题有全局稳定 `questionId` 和一对一的 `source.sourceId`。`source.kind` 固定为 `project-authored-controlled-text`，`rights` 固定为 `original-project-content`：文本由本项目创作，不摘录教材、影视、考试、旅游网站或商标话术。

`questionId`、`sourceId`、目标词、正确词义或答案语义的改变是破坏性修改：须建立新内容版本并提供旧学习记录的显式迁移。仅修正不影响词义的标点可作为补丁版本，但仍要重新运行审计器。

## 审计

运行：

```sh
node content/curriculum/validate-scene-vocabulary-question-bank.v1.mjs
```

审计会核对入口版本、18 个场景及顺序、每场景 6 题、108 个唯一题目/来源 ID、句中唯一目标词、三项不同干扰项、正确答案不进入干扰项，以及固定的无整句翻译/目标词单独播放契约。

本审计不替代 JSON Schema 验证器；后续集成方还必须在构建时按 `scene-vocabulary-question-bank.schema.v1.json` 验证形状，并在 UI、运行时和正式站分别验证高亮、单词播放、离线读取及计分。

## 限制

108 题是每个场景的正式首批词汇题，不是 15 分钟无限供应承诺，也不授权 06 自行循环题目。题库只承诺词义选择与单词播放的内容事实；抽题、选项顺序、恢复、得分、时长、错误复习和显示状态均由后续模块的公开契约决定。
