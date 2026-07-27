import type {
  AbilityDomain,
  AbilityEstimate,
  AbilityEstimateV2,
  AbilityProfile,
  AbilityProfileR1,
  AbilityProfileV2,
  TravelVocabularyResultLevelId,
  TravelVocabularyStageId,
  TravelVocabularyStageResultR1,
} from '../features/assessment/index.ts'
import type {
  LearningAttemptCompletedEvent,
  LearningAttemptCompletedPayload,
  LearningCandidate,
} from './contracts.ts'

export function abilityEstimate(
  domain: AbilityDomain,
  input: {
    readonly status?: AbilityEstimate['status']
    readonly level?: number
    readonly confidence?: number
    readonly boundary?: AbilityEstimate['boundary']
  } = {},
): AbilityEstimate {
  const status = input.status ?? 'estimated'
  const level = status === 'unavailable' ? null : (input.level ?? 5)
  return {
    domain,
    status,
    internalLevel: level,
    internalRange:
      level === null
        ? null
        : {
            lower: Math.max(0, level - 1),
            upper: Math.min(12, level + 1),
          },
    score100: level === null ? null : Math.round((level / 12) * 100),
    cefrEstimate: level === null ? 'unknown' : 'B1',
    cefrRange:
      level === null ? null : { lower: 'A2', upper: 'B2' },
    confidence:
      status === 'unavailable' ? 0 : (input.confidence ?? 0.8),
    confidenceBand:
      status === 'unavailable'
        ? 'insufficient'
        : (input.confidence ?? 0.8) >= 0.75
          ? 'high'
          : 'low',
    standardError: level === null ? null : 0.8,
    evidenceCount: level === null ? 0 : 6,
    attemptedCount: level === null ? 2 : 6,
    reliability: level === null ? 0 : 0.9,
    boundary: input.boundary ?? (level === null ? 'unknown' : 'within-range'),
    message: 'fixture',
    warnings: [],
  }
}

export function abilityProfile(
  overrides: Partial<
    Readonly<Record<AbilityDomain, AbilityEstimate>>
  > = {},
): AbilityProfile {
  return {
    schemaVersion: 1,
    profileId: 'profile-1',
    assessmentId: 'assessment-1',
    bankId: 'bank-1',
    completedAt: '2026-07-01T00:00:00.000Z',
    durationSeconds: 900,
    outcome: 'completed',
    disclaimer: 'fixture',
    abilities: {
      vocabulary:
        overrides.vocabulary ?? abilityEstimate('vocabulary'),
      listening:
        overrides.listening ?? abilityEstimate('listening'),
      speaking: overrides.speaking ?? abilityEstimate('speaking'),
    },
  }
}

function pendingEstimateV2(
  domain: Exclude<AbilityDomain, 'vocabulary'>,
): AbilityEstimateV2 {
  return {
    ...abilityEstimate(domain, { status: 'unavailable' }),
    calibrationState: 'pending-calibration',
  }
}

export function abilityProfileV2(
  vocabularyLevel = 6,
): AbilityProfileV2 {
  return {
    schemaVersion: 2,
    assessmentKind: 'adaptive-vocabulary',
    profileId: 'profile-v2',
    assessmentId: 'assessment-v2',
    bankId: 'bank-v2',
    completedAt: '2026-07-01T00:00:00.000Z',
    durationSeconds: 900,
    outcome: 'completed',
    disclaimer: 'fixture',
    vocabularySize: {
      status: 'estimated-internal-band',
      unit: 'internal-lexical-level',
      internalRange: {
        lower: Math.max(0, vocabularyLevel - 1),
        upper: Math.min(12, vocabularyLevel + 1),
      },
      wordCountRange: null,
      wordCountCalibration: 'unavailable',
      label: 'fixture',
      message: 'fixture',
    },
    abilities: {
      vocabulary: {
        ...abilityEstimate('vocabulary', { level: vocabularyLevel }),
        calibrationState: 'estimated',
      },
      listening: pendingEstimateV2('listening'),
      speaking: pendingEstimateV2('speaking'),
    },
  }
}

const R1_STAGE_SPECS: readonly [
  TravelVocabularyStageId,
  1 | 2 | 3 | 4 | 5,
][] = [
  ['stage-1-foundation', 1],
  ['stage-2-essential', 2],
  ['stage-3-independent', 3],
  ['stage-4-advanced', 4],
  ['stage-5-specialized', 5],
]

function r1StageResult(
  stageId: TravelVocabularyStageId,
  stageOrder: 1 | 2 | 3 | 4 | 5,
): TravelVocabularyStageResultR1 {
  return {
    stageId,
    stageOrder,
    stageLabel: `stage ${stageOrder}`,
    representativeWordCount: [300, 500, 650, 800, 950][
      stageOrder - 1
    ],
    correctCount: 15,
    incorrectCount: 15,
    uncertainCount: 0,
    validQuestionCount: 30,
    masteryRate: 0.5,
    estimatedWords: 150,
    reasonableInterval: { lower: 50, upper: 250 },
    submittedAt: '2026-07-01T00:00:00.000Z',
    responses: [],
  }
}

const R1_STAGE_RESULTS: readonly TravelVocabularyStageResultR1[] =
  R1_STAGE_SPECS.map(([stageId, stageOrder]) =>
    r1StageResult(stageId, stageOrder),
  )

const R1_LEVEL_MINIMUMS: Readonly<
  Record<TravelVocabularyResultLevelId, number>
> = {
  kindergarten: 0,
  'primary-1': 150,
  'primary-2': 300,
  'primary-3': 450,
  'primary-4': 600,
  'primary-5': 750,
  'primary-6': 900,
  'junior-1': 1_100,
  'junior-2': 1_300,
  'junior-3': 1_500,
  'senior-1': 1_750,
  'senior-2': 2_000,
  'senior-3': 2_250,
  'cet-4-reference': 2_500,
  'cet-6-reference': 2_850,
}

function r1PendingEstimate(
  domain: Exclude<AbilityDomain, 'vocabulary'>,
): AbilityProfileR1['abilities'][typeof domain] {
  return {
    ...abilityEstimate(domain, { status: 'unavailable' }),
    calibrationState: 'pending-calibration',
  }
}

export function abilityProfileR1(input: {
  readonly id?: TravelVocabularyResultLevelId
  readonly ordinal?: number
  readonly estimatedWords?: number
  readonly lower?: number
  readonly upper?: number
  readonly minimumEstimatedWords?: number
} = {}): AbilityProfileR1 {
  const id = input.id ?? 'junior-3'
  const ordinal = input.ordinal ?? 9
  const estimatedWords = input.estimatedWords ?? 1_600
  const lower = input.lower ?? 1_300
  const upper = input.upper ?? 1_800
  const minimumEstimatedWords =
    input.minimumEstimatedWords ?? R1_LEVEL_MINIMUMS[id]
  return {
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    profileId: 'profile-r1',
    assessmentId: 'assessment-r1',
    bankId: 'travel-vocabulary-zh-cn-r1-v1',
    bankDataVersion: 'travel-vocabulary-pools-r1-v1',
    estimationModelVersion: 'travel-vocabulary-estimation-r1-v1',
    resultMappingVersion: 'travel-vocabulary-level-map-r1-v1',
    completedAt: '2026-07-01T00:00:00.000Z',
    durationSeconds: 1_800,
    outcome: 'completed',
    disclaimer: 'internal learning label only',
    sampledWordIds: Array.from(
      { length: 150 },
      (_, index) => `word-${index + 1}`,
    ),
    travelVocabulary: {
      estimatedWords,
      reasonableInterval: { lower, upper },
      representativeWordCount: 3_200,
      correctCount: 75,
      validQuestionCount: 150,
      uncertainCount: 0,
      confidence: 0.8,
      confidenceBand: 'high',
      samplingConfidence: 'approximate-90-percent',
      chanceModel: 'four-choice-with-uncertain-option',
      rounding: 'nearest-10-after-each-stage',
      stageResults: R1_STAGE_RESULTS,
    },
    resultLevel: {
      id,
      ordinal,
      label: id,
      minimumEstimatedWords,
      disclaimer: 'internal learning label only',
    },
    abilities: {
      vocabulary: {
        ...abilityEstimate('vocabulary', {
          level: Math.min(12, ordinal),
        }),
        internalLevel: ordinal,
        internalRange: {
          lower: Math.max(0, ordinal - 1),
          upper: Math.min(14, ordinal + 1),
        },
        calibrationState: 'estimated',
      },
      listening: r1PendingEstimate('listening'),
      speaking: r1PendingEstimate('speaking'),
    },
  }
}

export function learningCandidate(
  domain: AbilityDomain,
  index: number,
  input: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    schemaVersion: 1,
    learningUnitId: `${domain}-${index}`,
    contentRef: `lesson://${domain}/${index}`,
    domain,
    difficultyLevel: 5,
    estimatedSeconds: 180,
    tags: ['fixture'],
    prerequisitesMet: true,
    ...input,
  }
}

export function attemptEvent(
  input: Partial<LearningAttemptCompletedPayload> & {
    readonly id?: string
    readonly occurredAt?: string
  } = {},
): LearningAttemptCompletedEvent {
  const domain = input.domain ?? 'vocabulary'
  const payload: LearningAttemptCompletedPayload = {
    planId: 'plan-1',
    taskId: 'task-1',
    learningUnitId: 'vocabulary-1',
    contentRef: 'lesson://vocabulary/1',
    domain,
    targetModuleId: domain,
    localDate: '2026-07-02',
    mode: 'learn',
    difficultyLevel: 5,
    estimatedSeconds: 180,
    result: 'scored',
    performanceScore: 0.8,
    evidenceQuality: 1,
    assistanceLevel: 0,
    durationSeconds: 120,
    taskCompleted: true,
    errorTags: [],
    contentTags: ['fixture'],
    failureCategory: null,
    ...input,
  }
  return {
    id: input.id ?? 'event-1',
    type: 'learning.attempt.completed.v1',
    sourceModuleId: payload.targetModuleId,
    occurredAt: input.occurredAt ?? '2026-07-02T00:00:00.000Z',
    schemaVersion: 1,
    payload,
  }
}
