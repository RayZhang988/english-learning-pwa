# AbilityProfile v2 交接契约

> **已废止为新用户输出。** schema 2 只保留给旧档案读取；R1 新档案使用 schema 3，
> 见 `travel-vocabulary-r1-contract.md`。

## 适用范围

`AbilityProfileV2` 是新用户完成自适应词汇测试后的正式输出。它不是 v1 三能力测试档案的
原地改写。v1 仍由 `AbilityProfileV1` 表示并可继续读取；使用方必须按
`schemaVersion` 分支，不能把 v1 当 v2，也不能用词汇结果补造听力或口语等级。

公开类型从 `src/features/assessment/index.ts` 导出：

```ts
type AnyAbilityProfile = AbilityProfileV1 | AbilityProfileV2
```

## v2 必备语义

```ts
interface AbilityProfileV2 {
  schemaVersion: 2
  assessmentKind: 'adaptive-vocabulary'
  profileId: string
  assessmentId: string
  bankId: string
  completedAt: string
  durationSeconds: number
  outcome: 'completed' | 'partial'
  disclaimer: string
  vocabularySize: {
    status: 'estimated-internal-band' | 'insufficient-evidence'
    unit: 'internal-lexical-level'
    internalRange: { lower: number; upper: number } | null
    wordCountRange: null
    wordCountCalibration: 'unavailable'
    label: string
    message: string
  }
  abilities: {
    vocabulary: AbilityEstimateV2
    listening: AbilityEstimateV2
    speaking: AbilityEstimateV2
  }
}
```

词汇能力的可用结果满足：

- `calibrationState: "estimated"`；
- `internalLevel` 与 `internalRange` 是 0–12 的内部词汇难度标尺；
- `cefrEstimate` 只是约略、非官方的词汇参考，不是综合英语等级；
- `confidence`、`boundary`、`warnings` 必须与结果一起保留；
- `vocabularySize.wordCountRange` 必须保持 `null`。当前没有总词数或词族数的实证标定，
  下游不得用正确率、等级或 CEFR 乘常数生成词数。

词汇可靠证据不足时：

```ts
{
  status: 'unavailable',
  calibrationState: 'insufficient-evidence',
  internalLevel: null,
  cefrEstimate: 'unknown'
}
```

听力和口语在首次测试完成时必须严格满足：

```ts
{
  status: 'unavailable',
  calibrationState: 'pending-calibration',
  internalLevel: null,
  internalRange: null,
  score100: null,
  cefrEstimate: 'unknown',
  cefrRange: null,
  confidence: 0,
  confidenceBand: 'insufficient',
  evidenceCount: 0,
  attemptedCount: 0,
  reliability: 0,
  boundary: 'unknown'
}
```

## 给 04 的输入规则

04 应以 `AbilityProfileV2` 作为新用户计划输入，并遵守：

1. 只使用 `abilities.vocabulary.internalLevel` 和区间安排词汇起点；若其为 `null`，使用
   最保守基础词汇起点。
2. 看到 `pending-calibration` 时，为听力、口语选择保守起点，并在后续正常训练事件中
   逐步校准。
3. 不得插入强制听力或口语入门考试，不得从词汇等级派生两个待校准维度。
4. `outcome: "partial"` 只表示词汇证据不足或用户/时间提前停止，不得改变
   `pending-calibration` 的含义。
5. v1 档案仍按旧逻辑读取；04 的新版消费者必须显式支持
   `AnyAbilityProfile`，不能静默覆盖旧档案。

统一免责声明由 `VOCABULARY_ASSESSMENT_DISCLAIMER_V2` 导出，结果页和下游摘要不得删成
“综合英语水平”或“官方 CEFR”。
