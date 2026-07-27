import {
  estimateTravelVocabularyTotalR1,
  mapTravelVocabularyLevelR1,
  TRAVEL_VOCABULARY_ASSESSMENT_DISCLAIMER_R1,
} from './travel-vocabulary-model.ts'
import { sampledTravelVocabularyWordIdsR1 } from './travel-vocabulary-engine.ts'
import type { AbilityDomain } from './types.ts'
import type {
  AbilityProfileR1,
  TravelVocabularyAbilityEstimateR1,
  TravelVocabularyAssessmentSessionR1,
  TravelVocabularyBankR1,
} from './travel-vocabulary-types.ts'

export const TRAVEL_PENDING_CALIBRATION_MESSAGE_R1 =
  'R1 首次测试没有测量此能力，将在后续正常训练中逐步校准。'

function parseTimestamp(value: string, field: string): number {
  const result = Date.parse(value)
  if (!Number.isFinite(result)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return result
}

function pendingAbility(
  domain: Exclude<AbilityDomain, 'vocabulary'>,
): TravelVocabularyAbilityEstimateR1 {
  return {
    domain,
    status: 'unavailable',
    calibrationState: 'pending-calibration',
    internalLevel: null,
    internalRange: null,
    score100: null,
    cefrEstimate: 'unknown',
    cefrRange: null,
    confidence: 0,
    confidenceBand: 'insufficient',
    standardError: null,
    evidenceCount: 0,
    attemptedCount: 0,
    reliability: 0,
    boundary: 'unknown',
    message: TRAVEL_PENDING_CALIBRATION_MESSAGE_R1,
    warnings: ['旅游英语单词测试没有收集此专项证据。'],
  }
}

export function buildTravelVocabularyAbilityProfileR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly bank: TravelVocabularyBankR1
  readonly completedAt: string
  readonly durationSeconds: number
}): AbilityProfileR1 {
  if (
    input.session.status !== 'completed' ||
    input.session.completedStages.length !== 5
  ) {
    throw new TypeError(
      'Cannot build an R1 profile before all five stages complete',
    )
  }
  if (input.session.bankId !== input.bank.id) {
    throw new TypeError('R1 profile bank is incompatible')
  }
  const startedAt = parseTimestamp(
    input.session.startedAt,
    'startedAt',
  )
  const completedAt = parseTimestamp(
    input.completedAt,
    'completedAt',
  )
  if (completedAt < startedAt) {
    throw new RangeError('completedAt cannot be earlier than startedAt')
  }
  if (
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds < 0
  ) {
    throw new TypeError('durationSeconds must be non-negative')
  }
  const estimate = estimateTravelVocabularyTotalR1(
    input.session.completedStages,
  )
  const resultLevel = mapTravelVocabularyLevelR1(
    estimate.estimatedWords,
  )
  const lowerLevel = mapTravelVocabularyLevelR1(
    estimate.reasonableInterval.lower,
  )
  const upperLevel = mapTravelVocabularyLevelR1(
    estimate.reasonableInterval.upper,
  )
  const representativeTotal = estimate.representativeWordCount
  const vocabulary: TravelVocabularyAbilityEstimateR1 = {
    domain: 'vocabulary',
    status:
      estimate.confidenceBand === 'insufficient'
        ? 'low-confidence'
        : 'estimated',
    calibrationState: 'estimated',
    internalLevel: resultLevel.ordinal,
    internalRange: {
      lower: lowerLevel.ordinal,
      upper: upperLevel.ordinal,
    },
    score100: Math.round(
      (estimate.estimatedWords / representativeTotal) * 100,
    ),
    cefrEstimate: 'unknown',
    cefrRange: null,
    confidence: estimate.confidence,
    confidenceBand: estimate.confidenceBand,
    standardError: null,
    evidenceCount: estimate.validQuestionCount,
    attemptedCount: estimate.validQuestionCount,
    reliability: estimate.confidence,
    boundary:
      resultLevel.ordinal === 0
        ? 'lower-censored'
        : resultLevel.ordinal === 14
          ? 'upper-censored'
          : 'within-range',
    message: `估算旅游英语词汇量 ${estimate.estimatedWords}，内部标签“${resultLevel.label}”。`,
    warnings: [
      '四选一存在猜中概率，合理区间已对猜测风险采用保守下界。',
      resultLevel.disclaimer,
    ],
  }

  return {
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    profileId: `${input.session.id}:profile:r1`,
    assessmentId: input.session.id,
    bankId: input.bank.id,
    bankDataVersion: input.bank.dataVersion,
    estimationModelVersion: input.bank.estimationModelVersion,
    resultMappingVersion: input.bank.resultMappingVersion,
    completedAt: input.completedAt,
    durationSeconds: Math.round(input.durationSeconds),
    outcome: 'completed',
    disclaimer: TRAVEL_VOCABULARY_ASSESSMENT_DISCLAIMER_R1,
    sampledWordIds: sampledTravelVocabularyWordIdsR1(input.session),
    travelVocabulary: estimate,
    resultLevel,
    abilities: {
      vocabulary,
      listening: pendingAbility('listening'),
      speaking: pendingAbility('speaking'),
    },
  }
}
