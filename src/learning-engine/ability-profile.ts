import type {
  AbilityDomain,
  TravelVocabularyResultLevelId,
} from '../features/assessment/index.ts'
import type {
  DomainProgressState,
  R1VocabularyStartPlacement,
} from './contracts.ts'
import { clamp } from './utils.ts'

export const R1_FIRST_DAY_START_MAPPING_VERSION =
  'learning-r1-first-day-start-v1'

export const R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS = 3_200
export const R1_ENGINE_DIFFICULTY_MAX = 12
export const SAFE_PENDING_CALIBRATION_LEVEL = 2.5

export interface R1StartRule {
  readonly id: TravelVocabularyResultLevelId
  readonly ordinal: number
  readonly minimumEstimatedWords: number
}

/**
 * These are internal learning labels from 03, not school placement or
 * evidence of an official CET result.
 */
export const R1_FIRST_DAY_START_RULES: readonly R1StartRule[] = [
  { id: 'kindergarten', ordinal: 0, minimumEstimatedWords: 0 },
  { id: 'primary-1', ordinal: 1, minimumEstimatedWords: 150 },
  { id: 'primary-2', ordinal: 2, minimumEstimatedWords: 300 },
  { id: 'primary-3', ordinal: 3, minimumEstimatedWords: 450 },
  { id: 'primary-4', ordinal: 4, minimumEstimatedWords: 600 },
  { id: 'primary-5', ordinal: 5, minimumEstimatedWords: 750 },
  { id: 'primary-6', ordinal: 6, minimumEstimatedWords: 900 },
  { id: 'junior-1', ordinal: 7, minimumEstimatedWords: 1_100 },
  { id: 'junior-2', ordinal: 8, minimumEstimatedWords: 1_300 },
  { id: 'junior-3', ordinal: 9, minimumEstimatedWords: 1_500 },
  { id: 'senior-1', ordinal: 10, minimumEstimatedWords: 1_750 },
  { id: 'senior-2', ordinal: 11, minimumEstimatedWords: 2_000 },
  { id: 'senior-3', ordinal: 12, minimumEstimatedWords: 2_250 },
  { id: 'cet-4-reference', ordinal: 13, minimumEstimatedWords: 2_500 },
  { id: 'cet-6-reference', ordinal: 14, minimumEstimatedWords: 2_850 },
]

interface NormalizedLearningProfile {
  readonly profileId: string
  readonly completedAt: string
  readonly domains: Readonly<Record<AbilityDomain, DomainProgressState>>
  readonly r1VocabularyStartPlacement?: R1VocabularyStartPlacement
}

type AssessmentStatus = DomainProgressState['assessmentStatus']
type AssessmentBoundary = DomainProgressState['assessmentBoundary']

const ASSESSMENT_STATUSES: readonly AssessmentStatus[] = [
  'estimated',
  'low-confidence',
  'unavailable',
]
const ASSESSMENT_BOUNDARIES: readonly AssessmentBoundary[] = [
  'within-range',
  'lower-censored',
  'upper-censored',
  'unknown',
]
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

function finiteNumber(
  value: unknown,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`)
  }
  return value
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = finiteNumber(value, field)
  if (parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `${field} must be between ${minimum} and ${maximum}`,
    )
  }
  return parsed
}

function requiredTimestamp(
  value: unknown,
  field: string,
): string {
  const parsed = requiredString(value, field)
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return parsed
}

function assessmentStatus(
  value: unknown,
  field: string,
): AssessmentStatus {
  for (const candidate of ASSESSMENT_STATUSES) {
    if (value === candidate) {
      return candidate
    }
  }
  throw new TypeError(`${field} is invalid`)
}

function assessmentBoundary(
  value: unknown,
  field: string,
): AssessmentBoundary {
  for (const candidate of ASSESSMENT_BOUNDARIES) {
    if (value === candidate) {
      return candidate
    }
  }
  throw new TypeError(`${field} is invalid`)
}

function normalizeDomain(
  value: unknown,
  domain: AbilityDomain,
  options: {
    readonly normalTrainingWhenPending: boolean
    readonly requirePending?: boolean
    readonly requireEstimatedCalibration?: boolean
    readonly requireKnownCalibrationState?: boolean
    readonly maximumInternalLevel?: number
  },
): DomainProgressState {
  if (!isRecord(value) || value.domain !== domain) {
    throw new TypeError(`abilities.${domain} is invalid`)
  }
  const status = assessmentStatus(
    value.status,
    `abilities.${domain}.status`,
  )
  const boundary = assessmentBoundary(
    value.boundary,
    `abilities.${domain}.boundary`,
  )
  const confidence = boundedNumber(
    value.confidence,
    `abilities.${domain}.confidence`,
    0,
    1,
  )
  const internalLevel =
    value.internalLevel === null
      ? null
      : boundedNumber(
          value.internalLevel,
          `abilities.${domain}.internalLevel`,
          0,
          options.maximumInternalLevel ??
            R1_ENGINE_DIFFICULTY_MAX,
        )
  const calibrationState =
    typeof value.calibrationState === 'string'
      ? value.calibrationState
      : null
  if (
    options.requireKnownCalibrationState &&
    calibrationState !== 'estimated' &&
    calibrationState !== 'insufficient-evidence' &&
    calibrationState !== 'pending-calibration'
  ) {
    throw new TypeError(
      `abilities.${domain}.calibrationState is invalid`,
    )
  }

  if (
    options.requirePending &&
    (
      calibrationState !== 'pending-calibration' ||
      status !== 'unavailable' ||
      internalLevel !== null ||
      confidence !== 0 ||
      boundary !== 'unknown'
    )
  ) {
    throw new TypeError(
      `abilities.${domain} must remain pending calibration`,
    )
  }
  if (
    options.requireEstimatedCalibration &&
    calibrationState !== 'estimated'
  ) {
    throw new TypeError(
      `abilities.${domain} must contain an estimated calibration`,
    )
  }
  if (status === 'unavailable' && internalLevel !== null) {
    throw new TypeError(
      `abilities.${domain}.internalLevel must be null when unavailable`,
    )
  }
  if (status !== 'unavailable' && internalLevel === null) {
    throw new TypeError(
      `abilities.${domain}.internalLevel is required`,
    )
  }

  const baselineLevel =
    internalLevel ?? SAFE_PENDING_CALIBRATION_LEVEL
  const normalTrainingPending =
    options.normalTrainingWhenPending &&
    calibrationState === 'pending-calibration'

  const progress: DomainProgressState = {
    domain,
    assessmentStatus: status,
    assessmentBoundary: boundary,
    baselineLevel,
    currentLevel: baselineLevel,
    confidence: status === 'unavailable' ? 0 : confidence,
    recentPerformance: 0.65,
    retentionScore: 0.5,
    masteryScore: 0.5,
    evidenceCount: 0,
    reliableEvidenceCount: 0,
  }
  return normalTrainingPending
    ? {
        ...progress,
        pendingCalibrationPolicy: 'normal-training',
      }
    : progress
}

function mapWordsToInternalLevel(words: number): number {
  const raw =
    (words / R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS) *
    R1_ENGINE_DIFFICULTY_MAX
  return clamp(Math.floor(raw * 2) / 2, 0, R1_ENGINE_DIFFICULTY_MAX)
}

function matchingResultRule(
  value: Record<string, unknown>,
  estimatedWords: number,
): R1StartRule {
  const id = value.id
  const ordinal = finiteNumber(
    value.ordinal,
    'resultLevel.ordinal',
  )
  const minimumEstimatedWords = finiteNumber(
    value.minimumEstimatedWords,
    'resultLevel.minimumEstimatedWords',
  )
  const rule = R1_FIRST_DAY_START_RULES.find(
    (candidate) => candidate.id === id,
  )
  if (
    rule === undefined ||
    rule.ordinal !== ordinal ||
    rule.minimumEstimatedWords !== minimumEstimatedWords
  ) {
    throw new TypeError('resultLevel is incompatible with R1 mapping')
  }
  const expected = R1_FIRST_DAY_START_RULES.reduce(
    (selected, candidate) =>
      estimatedWords >= candidate.minimumEstimatedWords
        ? candidate
        : selected,
    R1_FIRST_DAY_START_RULES[0],
  )
  if (expected.id !== rule.id) {
    throw new TypeError(
      'resultLevel does not match travelVocabulary.estimatedWords',
    )
  }
  return rule
}

function normalizeR1(
  value: Record<string, unknown>,
): NormalizedLearningProfile {
  if (
    value.assessmentKind !== 'staged-travel-vocabulary' ||
    value.bankDataVersion !== 'travel-vocabulary-pools-r1-v1' ||
    value.estimationModelVersion !==
      'travel-vocabulary-estimation-r1-v1' ||
    value.resultMappingVersion !==
      'travel-vocabulary-level-map-r1-v1'
  ) {
    throw new TypeError('AbilityProfileR1 contract is incompatible')
  }
  if (
    !isRecord(value.travelVocabulary) ||
    !isRecord(value.resultLevel) ||
    !isRecord(value.abilities)
  ) {
    throw new TypeError('AbilityProfileR1 structure is invalid')
  }
  const estimate = value.travelVocabulary
  if (!isRecord(estimate.reasonableInterval)) {
    throw new TypeError('AbilityProfileR1 interval is invalid')
  }
  const interval = estimate.reasonableInterval
  const estimatedWords = boundedNumber(
    estimate.estimatedWords,
    'travelVocabulary.estimatedWords',
    0,
    R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS,
  )
  const representativeWordCount = finiteNumber(
    estimate.representativeWordCount,
    'travelVocabulary.representativeWordCount',
  )
  if (
    representativeWordCount !==
    R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS
  ) {
    throw new TypeError(
      'travelVocabulary.representativeWordCount is incompatible',
    )
  }
  const intervalLower = boundedNumber(
    interval.lower,
    'travelVocabulary.reasonableInterval.lower',
    0,
    R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS,
  )
  const intervalUpper = boundedNumber(
    interval.upper,
    'travelVocabulary.reasonableInterval.upper',
    0,
    R1_TRAVEL_VOCABULARY_REPRESENTATIVE_WORDS,
  )
  if (
    intervalLower > estimatedWords ||
    estimatedWords > intervalUpper
  ) {
    throw new TypeError(
      'travelVocabulary reasonable interval must contain estimatedWords',
    )
  }
  const resultRule = matchingResultRule(
    value.resultLevel,
    estimatedWords,
  )
  const intervalLowerLevel = mapWordsToInternalLevel(intervalLower)
  const pointEstimateLevel = mapWordsToInternalLevel(estimatedWords)
  const resultLevelFloor = mapWordsToInternalLevel(
    resultRule.minimumEstimatedWords,
  )
  const selectedStartLevel = Math.min(
    intervalLowerLevel,
    pointEstimateLevel,
    resultLevelFloor,
  )

  const vocabulary = normalizeDomain(
    value.abilities.vocabulary,
    'vocabulary',
    {
      normalTrainingWhenPending: false,
      requireEstimatedCalibration: true,
      maximumInternalLevel: 14,
    },
  )
  if (
    !isRecord(value.abilities.vocabulary) ||
    value.abilities.vocabulary.internalLevel !== resultRule.ordinal
  ) {
    throw new TypeError(
      'abilities.vocabulary.internalLevel must match resultLevel.ordinal',
    )
  }
  const placement: R1VocabularyStartPlacement = {
    kind: 'r1-conservative-travel-vocabulary',
    mappingVersion: R1_FIRST_DAY_START_MAPPING_VERSION,
    resultLevelId: resultRule.id,
    resultLevelOrdinal: resultRule.ordinal,
    resultLevelMinimumEstimatedWords:
      resultRule.minimumEstimatedWords,
    estimatedWords,
    reasonableInterval: {
      lower: intervalLower,
      upper: intervalUpper,
    },
    intervalLowerLevel,
    pointEstimateLevel,
    resultLevelFloor,
    selectedStartLevel,
  }

  return {
    profileId: requiredString(value.profileId, 'profileId'),
    completedAt: requiredTimestamp(value.completedAt, 'completedAt'),
    domains: {
      vocabulary: {
        ...vocabulary,
        baselineLevel: selectedStartLevel,
        currentLevel: selectedStartLevel,
      },
      listening: normalizeDomain(
        value.abilities.listening,
        'listening',
        {
          normalTrainingWhenPending: true,
          requirePending: true,
        },
      ),
      speaking: normalizeDomain(
        value.abilities.speaking,
        'speaking',
        {
          normalTrainingWhenPending: true,
          requirePending: true,
        },
      ),
    },
    r1VocabularyStartPlacement: placement,
  }
}

function normalizeV1OrV2(
  value: Record<string, unknown>,
  schemaVersion: 1 | 2,
): NormalizedLearningProfile {
  if (!isRecord(value.abilities)) {
    throw new TypeError('AbilityProfile abilities are invalid')
  }
  if (
    schemaVersion === 2 &&
    value.assessmentKind !== 'adaptive-vocabulary'
  ) {
    throw new TypeError('AbilityProfileV2 contract is incompatible')
  }
  const domains: Readonly<Record<AbilityDomain, DomainProgressState>> = {
    vocabulary: normalizeDomain(
      value.abilities.vocabulary,
      'vocabulary',
      {
        normalTrainingWhenPending: schemaVersion === 2,
        requireKnownCalibrationState: schemaVersion === 2,
      },
    ),
    listening: normalizeDomain(
      value.abilities.listening,
      'listening',
      {
        normalTrainingWhenPending: schemaVersion === 2,
        requireKnownCalibrationState: schemaVersion === 2,
      },
    ),
    speaking: normalizeDomain(
      value.abilities.speaking,
      'speaking',
      {
        normalTrainingWhenPending: schemaVersion === 2,
        requireKnownCalibrationState: schemaVersion === 2,
      },
    ),
  }

  return {
    profileId: requiredString(value.profileId, 'profileId'),
    completedAt: requiredTimestamp(value.completedAt, 'completedAt'),
    domains,
  }
}

export function normalizeLearningAbilityProfile(
  value: unknown,
): NormalizedLearningProfile {
  if (!isRecord(value)) {
    throw new TypeError('AbilityProfile must be an object')
  }
  if (value.schemaVersion === 1) {
    return normalizeV1OrV2(value, 1)
  }
  if (value.schemaVersion === 2) {
    return normalizeV1OrV2(value, 2)
  }
  if (value.schemaVersion === 3) {
    return normalizeR1(value)
  }
  throw new TypeError('Unsupported AbilityProfile schemaVersion')
}
