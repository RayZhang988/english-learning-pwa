import { confidenceBand } from './confidence.ts'
import {
  describeInternalLevel,
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
  mapInternalLevelToCefr,
  roundInternalLevel,
} from './levels.ts'
import type {
  AbilityDomain,
} from './types.ts'
import type {
  AbilityEstimateV2,
  AbilityProfileV2,
  VocabularyAssessmentSessionV2,
} from './vocabulary-types.ts'

export const VOCABULARY_ASSESSMENT_DISCLAIMER_V2 =
  '这是基于 8–15 分钟自适应词汇样本的起点估算，只反映词汇能力；不是综合英语水平、官方 CEFR 认证或经标定的总词汇量测验。'

export const PENDING_CALIBRATION_MESSAGE_V2 =
  '首次测试未测量此能力，将在后续正常训练中逐步校准。'

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return parsed
}

function pendingEstimate(domain: Exclude<AbilityDomain, 'vocabulary'>): AbilityEstimateV2 {
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
    message: PENDING_CALIBRATION_MESSAGE_V2,
    warnings: ['首次词汇测试没有收集此专项证据。'],
  }
}

function vocabularyEstimate(
  session: VocabularyAssessmentSessionV2,
): AbilityEstimateV2 {
  const estimate = session.estimate
  const publishable =
    estimate.reliableEvidenceCount >= 4 &&
    estimate.confidence >= 0.35
  if (!publishable) {
    return {
      domain: 'vocabulary',
      status: 'unavailable',
      calibrationState: 'insufficient-evidence',
      internalLevel: null,
      internalRange: null,
      score100: null,
      cefrEstimate: 'unknown',
      cefrRange: null,
      confidence: estimate.confidence,
      confidenceBand: confidenceBand(estimate.confidence),
      standardError:
        estimate.attemptedCount === 0 ? null : estimate.standardError,
      evidenceCount: estimate.reliableEvidenceCount,
      attemptedCount: estimate.attemptedCount,
      reliability:
        estimate.reliableEvidenceCount === 0
          ? 0
          : Math.round(
              (estimate.reliabilityTotal /
                estimate.reliableEvidenceCount) *
                100,
            ) / 100,
      boundary: 'unknown',
      message: '可靠词汇证据不足，暂不估算起点等级。',
      warnings: ['可在稳定作答环境下重新完成词汇测试。'],
    }
  }

  const internalLevel = roundInternalLevel(estimate.level)
  const margin = Math.max(0.5, estimate.standardError * 1.1)
  const lower = roundInternalLevel(
    Math.max(INTERNAL_LEVEL_MIN, estimate.level - margin),
  )
  const upper = roundInternalLevel(
    Math.min(INTERNAL_LEVEL_MAX, estimate.level + margin),
  )
  const boundary: AbilityEstimateV2['boundary'] =
    estimate.stopReason === 'lower-boundary' ||
    internalLevel <= INTERNAL_LEVEL_MIN + 0.5
      ? 'lower-censored'
      : estimate.stopReason === 'upper-boundary' ||
          internalLevel >= INTERNAL_LEVEL_MAX - 0.5
        ? 'upper-censored'
        : 'within-range'
  const warnings: string[] = []
  if (estimate.confidence < 0.6) {
    warnings.push('词汇证据的收敛度有限，起点会在后续训练中继续校准。')
  }
  if (boundary === 'lower-censored') {
    warnings.push('结果触及题库下界，真实词汇起点可能更低。')
  } else if (boundary === 'upper-censored') {
    warnings.push('结果触及题库上界，不能据此证明达到官方 C2。')
  }
  if (estimate.rapidGuessCount > 0 || estimate.uncertainCount > 0) {
    warnings.push('部分作答被标记为快速猜测或不确定，已降低证据权重。')
  }

  return {
    domain: 'vocabulary',
    status: estimate.confidence >= 0.6 ? 'estimated' : 'low-confidence',
    calibrationState: 'estimated',
    internalLevel,
    internalRange: { lower, upper },
    score100: Math.round((internalLevel / INTERNAL_LEVEL_MAX) * 100),
    cefrEstimate: mapInternalLevelToCefr(internalLevel),
    cefrRange: {
      lower: mapInternalLevelToCefr(lower),
      upper: mapInternalLevelToCefr(upper),
    },
    confidence: estimate.confidence,
    confidenceBand: confidenceBand(estimate.confidence),
    standardError: estimate.standardError,
    evidenceCount: estimate.reliableEvidenceCount,
    attemptedCount: estimate.attemptedCount,
    reliability:
      Math.round(
        (estimate.reliabilityTotal /
          Math.max(1, estimate.reliableEvidenceCount)) *
          100,
      ) / 100,
    boundary,
    message: `${describeInternalLevel(internalLevel)}；仅代表词汇起点。`,
    warnings,
  }
}

export function buildVocabularyAbilityProfileV2(input: {
  readonly session: VocabularyAssessmentSessionV2
  readonly completedAt: string
  readonly durationSeconds?: number
}): AbilityProfileV2 {
  if (input.session.status === 'in-progress') {
    throw new TypeError('Cannot build a profile from an in-progress session')
  }
  const startedAt = parseTimestamp(input.session.startedAt, 'startedAt')
  const completedAt = parseTimestamp(input.completedAt, 'completedAt')
  if (completedAt < startedAt) {
    throw new RangeError('completedAt cannot be earlier than startedAt')
  }
  if (
    input.durationSeconds !== undefined &&
    (!Number.isFinite(input.durationSeconds) ||
      input.durationSeconds < 0)
  ) {
    throw new TypeError('durationSeconds must be a non-negative number')
  }

  const vocabulary = vocabularyEstimate(input.session)
  const range = vocabulary.internalRange
  return {
    schemaVersion: 2,
    assessmentKind: 'adaptive-vocabulary',
    profileId: `${input.session.id}:profile:v2`,
    assessmentId: input.session.id,
    bankId: input.session.bankId,
    completedAt: input.completedAt,
    durationSeconds:
      input.durationSeconds === undefined
        ? Math.round((completedAt - startedAt) / 1000)
        : Math.round(input.durationSeconds),
    outcome:
      input.session.status === 'partial' ||
      vocabulary.status === 'unavailable'
        ? 'partial'
        : 'completed',
    disclaimer: VOCABULARY_ASSESSMENT_DISCLAIMER_V2,
    vocabularySize: {
      status:
        range === null
          ? 'insufficient-evidence'
          : 'estimated-internal-band',
      unit: 'internal-lexical-level',
      internalRange: range,
      wordCountRange: null,
      wordCountCalibration: 'unavailable',
      label:
        range === null
          ? '暂不能估算词汇难度区间'
          : `内部词汇等级 ${range.lower}–${range.upper}`,
      message:
        '题库尚未建立外部语料到总词数的实证标定，因此不输出伪精确词数。',
    },
    abilities: {
      vocabulary,
      listening: pendingEstimate('listening'),
      speaking: pendingEstimate('speaking'),
    },
  }
}
