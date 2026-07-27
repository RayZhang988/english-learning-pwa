import { confidenceBand } from './confidence.ts'
import type {
  TravelVocabularyEstimateIntervalR1,
  TravelVocabularyResultLevelR1,
  TravelVocabularyStageId,
  TravelVocabularyStageResultR1,
  TravelVocabularyTotalEstimateR1,
} from './travel-vocabulary-types.ts'

export const TRAVEL_VOCABULARY_ESTIMATION_MODEL_VERSION_R1 =
  'travel-vocabulary-estimation-r1-v1' as const

export const TRAVEL_VOCABULARY_RESULT_MAPPING_VERSION_R1 =
  'travel-vocabulary-level-map-r1-v1' as const

export const TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1 = 30 as const
export const TRAVEL_VOCABULARY_TOTAL_STAGES_R1 = 5 as const
export const TRAVEL_VOCABULARY_TOTAL_QUESTIONS_R1 = 150 as const

export const TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1 = [
  {
    id: 'stage-1-foundation',
    order: 1,
    label: '基础出行词汇',
    description: '最常见的方向、人物、数字、交通和日常需求单词。',
    representativeWordCount: 300,
  },
  {
    id: 'stage-2-essential',
    order: 2,
    label: '核心旅行词汇',
    description: '机场、酒店、餐饮、购物和城市出行的核心单词。',
    representativeWordCount: 500,
  },
  {
    id: 'stage-3-independent',
    order: 3,
    label: '独立旅行词汇',
    description: '能够独立处理预订、变更、服务沟通和常见问题的单词。',
    representativeWordCount: 650,
  },
  {
    id: 'stage-4-advanced',
    order: 4,
    label: '进阶旅行词汇',
    description: '复杂行程、文化体验、医疗、安全和正式服务场景单词。',
    representativeWordCount: 800,
  },
  {
    id: 'stage-5-specialized',
    order: 5,
    label: '高阶旅行词汇',
    description: '专业旅游、规则、风险、地理和高阶服务沟通单词。',
    representativeWordCount: 950,
  },
] as const satisfies readonly {
  readonly id: TravelVocabularyStageId
  readonly order: 1 | 2 | 3 | 4 | 5
  readonly label: string
  readonly description: string
  readonly representativeWordCount: number
}[]

const INTERNAL_LEVEL_DISCLAIMER =
  '这是本软件的旅游英语学习标签，不是学校学历、官方年级或考试证书。'

const CET_DISCLAIMER =
  '“大学英语四级 / 六级”仅表示旅游英语词汇难度参照，不代表通过官方 CET-4 / CET-6 考试。'

const TRAVEL_VOCABULARY_RESULT_LEVEL_ROWS_R1 = [
  ['kindergarten', 0, '幼儿园', 0],
  ['primary-1', 1, '小学一年级', 150],
  ['primary-2', 2, '小学二年级', 300],
  ['primary-3', 3, '小学三年级', 450],
  ['primary-4', 4, '小学四年级', 600],
  ['primary-5', 5, '小学五年级', 750],
  ['primary-6', 6, '小学六年级', 900],
  ['junior-1', 7, '初中一年级', 1_100],
  ['junior-2', 8, '初中二年级', 1_300],
  ['junior-3', 9, '初中三年级', 1_500],
  ['senior-1', 10, '高中一年级', 1_750],
  ['senior-2', 11, '高中二年级', 2_000],
  ['senior-3', 12, '高中三年级', 2_250],
  ['cet-4-reference', 13, '大学英语四级', 2_500],
  ['cet-6-reference', 14, '大学英语六级', 2_850],
] as const

export const TRAVEL_VOCABULARY_RESULT_LEVELS_R1 =
  TRAVEL_VOCABULARY_RESULT_LEVEL_ROWS_R1.map(
    ([id, ordinal, label, minimumEstimatedWords]) => ({
  id,
  ordinal,
  label,
  minimumEstimatedWords,
  disclaimer:
    ordinal >= 13 ? CET_DISCLAIMER : INTERNAL_LEVEL_DISCLAIMER,
    }),
  ) as readonly TravelVocabularyResultLevelR1[]

export const TRAVEL_VOCABULARY_ASSESSMENT_DISCLAIMER_R1 =
  '结果来自五个旅游英语词库的分层随机抽样，只是估算，不是精确词数、学校学历、官方年级或 CET-4 / CET-6 证书。四选一可能被猜中；“不认识 / 不确定”可降低被迫猜测造成的偏差。'

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function roundTravelVocabularyWordsR1(value: number): number {
  return Math.max(0, Math.round(value / 10) * 10)
}

function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.644_854,
): { readonly lower: number; readonly upper: number } {
  if (trials <= 0) {
    return { lower: 0, upper: 1 }
  }
  const proportion = successes / trials
  const zSquared = z * z
  const denominator = 1 + zSquared / trials
  const center =
    (proportion + zSquared / (2 * trials)) / denominator
  const margin =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion) +
          zSquared / (4 * trials)) /
          trials,
      )) /
    denominator
  return {
    lower: clampUnit(center - margin),
    upper: clampUnit(center + margin),
  }
}

function chanceConservativeLower(observedLower: number): number {
  const fourChoiceChance = 0.25
  return clampUnit(
    (observedLower - fourChoiceChance) /
      (1 - fourChoiceChance),
  )
}

export function estimateTravelVocabularyStageR1(input: {
  readonly stageId: TravelVocabularyStageId
  readonly stageOrder: 1 | 2 | 3 | 4 | 5
  readonly stageLabel: string
  readonly representativeWordCount: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly uncertainCount: number
  readonly submittedAt: string
  readonly responses: TravelVocabularyStageResultR1['responses']
}): TravelVocabularyStageResultR1 {
  const validQuestionCount =
    input.correctCount +
    input.incorrectCount +
    input.uncertainCount
  if (validQuestionCount !== TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1) {
    throw new TypeError('A travel vocabulary stage requires 30 valid answers')
  }
  if (
    !Number.isInteger(input.correctCount) ||
    !Number.isInteger(input.incorrectCount) ||
    !Number.isInteger(input.uncertainCount) ||
    Math.min(
      input.correctCount,
      input.incorrectCount,
      input.uncertainCount,
    ) < 0
  ) {
    throw new TypeError('Travel vocabulary stage counts are invalid')
  }
  if (
    input.responses.length !== validQuestionCount ||
    input.responses.filter(
      (response) => response.answer === 'correct',
    ).length !== input.correctCount ||
    input.responses.filter(
      (response) => response.answer === 'incorrect',
    ).length !== input.incorrectCount ||
    input.responses.filter(
      (response) => response.answer === 'uncertain',
    ).length !== input.uncertainCount
  ) {
    throw new TypeError(
      'Travel vocabulary stage responses do not match counts',
    )
  }
  const masteryRate = input.correctCount / validQuestionCount
  const sampling = wilsonInterval(
    input.correctCount,
    validQuestionCount,
  )
  const interval: TravelVocabularyEstimateIntervalR1 = {
    lower: roundTravelVocabularyWordsR1(
      chanceConservativeLower(sampling.lower) *
        input.representativeWordCount,
    ),
    upper: roundTravelVocabularyWordsR1(
      sampling.upper * input.representativeWordCount,
    ),
  }
  const estimatedWords = roundTravelVocabularyWordsR1(
    masteryRate * input.representativeWordCount,
  )

  return {
    stageId: input.stageId,
    stageOrder: input.stageOrder,
    stageLabel: input.stageLabel,
    representativeWordCount: input.representativeWordCount,
    correctCount: input.correctCount,
    incorrectCount: input.incorrectCount,
    uncertainCount: input.uncertainCount,
    validQuestionCount,
    masteryRate: roundRate(masteryRate),
    estimatedWords,
    reasonableInterval: {
      lower: Math.min(interval.lower, estimatedWords),
      upper: Math.max(interval.upper, estimatedWords),
    },
    submittedAt: input.submittedAt,
    responses: input.responses,
  }
}

export function estimateTravelVocabularyTotalR1(
  stageResults: readonly TravelVocabularyStageResultR1[],
): TravelVocabularyTotalEstimateR1 {
  if (stageResults.length !== TRAVEL_VOCABULARY_TOTAL_STAGES_R1) {
    throw new TypeError('All five travel vocabulary stages are required')
  }
  const ordered = [...stageResults].sort(
    (left, right) => left.stageOrder - right.stageOrder,
  )
  const expectedIds = TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1.map(
    (stage) => stage.id,
  )
  if (
    ordered.some(
      (stage, index) => stage.stageId !== expectedIds[index],
    )
  ) {
    throw new TypeError('Travel vocabulary stage results are incomplete')
  }
  const estimatedWords = ordered.reduce(
    (total, stage) => total + stage.estimatedWords,
    0,
  )
  const lower = ordered.reduce(
    (total, stage) => total + stage.reasonableInterval.lower,
    0,
  )
  const upper = ordered.reduce(
    (total, stage) => total + stage.reasonableInterval.upper,
    0,
  )
  const representativeWordCount = ordered.reduce(
    (total, stage) => total + stage.representativeWordCount,
    0,
  )
  const correctCount = ordered.reduce(
    (total, stage) => total + stage.correctCount,
    0,
  )
  const validQuestionCount = ordered.reduce(
    (total, stage) => total + stage.validQuestionCount,
    0,
  )
  const uncertainCount = ordered.reduce(
    (total, stage) => total + stage.uncertainCount,
    0,
  )
  const intervalWidth = upper - lower
  const confidence = Math.round(
    clampUnit(1 - intervalWidth / representativeWordCount) * 100,
  ) / 100

  return {
    estimatedWords,
    reasonableInterval: {
      lower: Math.min(lower, estimatedWords),
      upper: Math.max(upper, estimatedWords),
    },
    representativeWordCount,
    correctCount,
    validQuestionCount,
    uncertainCount,
    confidence,
    confidenceBand: confidenceBand(confidence),
    samplingConfidence: 'approximate-90-percent',
    chanceModel: 'four-choice-with-uncertain-option',
    rounding: 'nearest-10-after-each-stage',
    stageResults: ordered,
  }
}

export function mapTravelVocabularyLevelR1(
  estimatedWords: number,
): TravelVocabularyResultLevelR1 {
  if (!Number.isFinite(estimatedWords) || estimatedWords < 0) {
    throw new TypeError('estimatedWords must be a non-negative number')
  }
  const result = [...TRAVEL_VOCABULARY_RESULT_LEVELS_R1]
    .reverse()
    .find(
      (level) => estimatedWords >= level.minimumEstimatedWords,
    )
  if (!result) {
    throw new TypeError('Travel vocabulary result mapping is empty')
  }
  return result
}
