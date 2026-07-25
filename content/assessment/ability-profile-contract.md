# 03 → 04｜初始能力档案契约（v1）

## 交付入口

04 只能从 03 的公开入口导入：

```ts
import type { AbilityProfile } from '../features/assessment/index.ts'
```

运行时由 `buildAbilityProfile()` 生成档案。需要读取本机最近一次结果时，由集成层创建
`AssessmentProfileRepository` 并注入 01 提供的 `NamespaceStore`。04 不应导入 03
内部文件，也不应直接读取 `feature.assessment` 命名空间。

## 顶层结构

```ts
interface AbilityProfile {
  schemaVersion: 1
  profileId: string
  assessmentId: string
  bankId: string
  completedAt: string             // ISO 8601 UTC
  durationSeconds: number
  outcome: 'completed' | 'partial'
  disclaimer: string
  abilities: {
    vocabulary: AbilityEstimate
    listening: AbilityEstimate
    speaking: AbilityEstimate
  }
}
```

三个 `abilities` 必须分别消费，不能把其中一项复制成其他项，也不能先求一个总分再反推
专项水平。第一版档案故意不输出“每日任务”“复习间隔”或“推荐训练分钟”，这些属于 04。

## 专项结构

```ts
interface AbilityEstimate {
  domain: 'vocabulary' | 'listening' | 'speaking'
  status: 'estimated' | 'low-confidence' | 'unavailable'
  internalLevel: number | null       // 0–12，0.5 级粒度
  internalRange: { lower: number; upper: number } | null
  score100: number | null            // 仅为内部等级的线性展示值
  cefrEstimate: 'pre-A1' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'unknown'
  cefrRange: { lower: CefrBand; upper: CefrBand } | null
  confidence: number                 // 0–1，本次证据质量
  confidenceBand: 'high' | 'moderate' | 'low' | 'insufficient'
  standardError: number | null
  evidenceCount: number
  attemptedCount: number
  reliability: number               // 0–1，证据平均可靠性
  boundary: 'within-range' | 'lower-censored' | 'upper-censored' | 'unknown'
  message: string
  warnings: readonly string[]
}
```

## 04 的消费规则

1. `status === 'unavailable'` 时，`internalLevel`、区间和 CEFR 必须视为缺失。04 应采用
   新用户安全默认起点或安排后续收集证据，不得当作 0 级。
2. `status === 'low-confidence'` 时可暂用 `internalLevel`，但任务难度应允许更快校正；
   具体校正规则由 04 定义。
3. `boundary === 'upper-censored'` 表示短测触顶，不等于已认证 C2；不得因此直接跳过
   全部基础证据收集。
4. `boundary === 'lower-censored'` 表示真实水平可能低于题库下限；初始任务必须允许
   更简单内容和快速回退。
5. `score100` 不是考试百分制，也不是正确率。计划算法优先使用 `internalLevel`、区间、
   置信度和状态。
6. `outcome === 'partial'` 不代表整个档案无效。逐项检查，保留已可靠估算的专项。
7. `schemaVersion` 未识别时必须停止消费并报告版本错误，不能按 v1 猜字段含义。

## 等级映射

| 内部等级 | 界面大致范围 |
| ---: | --- |
| 0–0.5 | pre-A1 |
| 1–2.5 | A1 |
| 3–4.5 | A2 |
| 5–6.5 | B1 |
| 7–8.5 | B2 |
| 9–10.5 | C1 |
| 11–12 | C2 |

界面必须同时展示档案中的 `disclaimer`：

> 这是基于本次 15–20 分钟样本的起点估算，大致参考 CEFR 范围，不是官方认证。

## 典型部分结果

```json
{
  "schemaVersion": 1,
  "outcome": "partial",
  "abilities": {
    "vocabulary": {
      "status": "estimated",
      "internalLevel": 6.5,
      "cefrEstimate": "B1"
    },
    "listening": {
      "status": "low-confidence",
      "internalLevel": 5,
      "cefrEstimate": "B1"
    },
    "speaking": {
      "status": "unavailable",
      "internalLevel": null,
      "cefrEstimate": "unknown"
    }
  }
}
```

示例省略了非关键字段，不能作为完整存储对象。正式对象必须符合 TypeScript
`AbilityProfile`。

## 所有权与后续集成

- 03 保留档案字段、等级映射、评分和测试会话语义的所有权。
- 04 保留如何把档案转换为每日计划、复习和进度状态的所有权。
- 02 只决定档案如何展示；不得改变 `unknown`、置信度或非官方免责声明的语义。
- 01 负责把 02 提供的测试页面注入 `createAssessmentFeatureModule()` 并注册路由。
