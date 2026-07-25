import type {
  AbilityDomain,
  AbilityProfile,
  AttemptEvidence,
  CommonErrorMetric,
  DailyActivity,
  DomainProgressMetric,
  DomainProgressState,
  ProgressSnapshot,
  ProgressState,
  ProgressTrend,
  ReassessmentRecommendation,
  ReviewItemState,
  StandardErrorTag,
  StreakMetric,
} from './contracts.ts'
import {
  ABILITY_DOMAINS,
  assertLocalDate,
  clamp,
  elapsedDays,
  localDateOrdinal,
  mean,
  parseTimestamp,
  round,
} from './utils.ts'

const SAFE_UNAVAILABLE_LEVEL = 2.5
const MAX_ATTEMPT_HISTORY = 120
const MAX_DAILY_HISTORY = 90
const ERROR_HALF_LIFE_DAYS = 14

function startingDomainProgress(
  profile: AbilityProfile,
  domain: AbilityDomain,
): DomainProgressState {
  const estimate = profile.abilities[domain]
  const baselineLevel =
    estimate.status === 'unavailable' || estimate.internalLevel === null
      ? SAFE_UNAVAILABLE_LEVEL
      : estimate.internalLevel

  return {
    domain,
    assessmentStatus: estimate.status,
    assessmentBoundary: estimate.boundary,
    baselineLevel,
    currentLevel: baselineLevel,
    confidence:
      estimate.status === 'unavailable' ? 0 : clamp(estimate.confidence, 0, 1),
    recentPerformance: 0.65,
    retentionScore: 0.5,
    masteryScore: 0.5,
    evidenceCount: 0,
    reliableEvidenceCount: 0,
  }
}

export function createInitialProgressState(
  profile: AbilityProfile,
  initializedAt: string,
): ProgressState {
  if (profile.schemaVersion !== 1) {
    throw new TypeError('Unsupported AbilityProfile schemaVersion')
  }
  parseTimestamp(profile.completedAt, 'profile.completedAt')
  parseTimestamp(initializedAt, 'initializedAt')

  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    assessmentCompletedAt: profile.completedAt,
    initializedAt,
    updatedAt: initializedAt,
    domains: {
      vocabulary: startingDomainProgress(profile, 'vocabulary'),
      listening: startingDomainProgress(profile, 'listening'),
      speaking: startingDomainProgress(profile, 'speaking'),
    },
    attempts: [],
    dailyActivity: [],
    lastReassessmentAt: null,
  }
}

function domainMastery(
  reviewItems: Readonly<Record<string, ReviewItemState>>,
  domain: AbilityDomain,
  fallback: number,
): number {
  const values = Object.values(reviewItems)
    .filter((item) => item.domain === domain)
    .map((item) => item.mastery)
  return values.length === 0 ? fallback : mean(values, fallback)
}

export function appendAttemptEvidence(
  progress: ProgressState,
  evidence: AttemptEvidence,
  reviewItems: Readonly<Record<string, ReviewItemState>>,
): ProgressState {
  const current = progress.domains[evidence.domain]
  const quality = evidence.evidenceQuality
  const earlyCalibrationBoost =
    current.reliableEvidenceCount < 8 &&
    current.assessmentStatus !== 'estimated'
      ? 0.08
      : 0
  const levelLearningRate = clamp(
    0.08 + 0.17 * quality + earlyCalibrationBoost,
    0.08,
    0.33,
  )
  const observedLevel = clamp(
    evidence.difficultyLevel +
      (evidence.effectivePerformance - 0.65) * 2.5,
    0,
    12,
  )
  const currentLevel =
    current.currentLevel +
    (observedLevel - current.currentLevel) * levelLearningRate
  const performanceLearningRate = 0.08 + 0.2 * quality
  const recentPerformance =
    current.recentPerformance +
    (evidence.effectivePerformance - current.recentPerformance) *
      performanceLearningRate
  const retentionScore =
    evidence.mode === 'review' || evidence.mode === 'retry'
      ? current.retentionScore +
        (evidence.effectivePerformance - current.retentionScore) *
          performanceLearningRate
      : current.retentionScore
  const reliableEvidenceCount =
    current.reliableEvidenceCount + (quality >= 0.6 ? 1 : 0)
  const confidence = clamp(
    current.confidence + (1 - current.confidence) * 0.06 * quality,
    0,
    1,
  )
  const nextDomain: DomainProgressState = {
    ...current,
    currentLevel: round(currentLevel),
    confidence: round(confidence),
    recentPerformance: round(recentPerformance),
    retentionScore: round(retentionScore),
    masteryScore: round(
      domainMastery(reviewItems, evidence.domain, current.masteryScore),
    ),
    evidenceCount: current.evidenceCount + 1,
    reliableEvidenceCount,
  }

  return {
    ...progress,
    updatedAt: evidence.occurredAt,
    domains: {
      ...progress.domains,
      [evidence.domain]: nextDomain,
    },
    attempts: [...progress.attempts, evidence].slice(-MAX_ATTEMPT_HISTORY),
  }
}

export function streakThresholdSeconds(plannedSeconds: number): number {
  return Math.min(600, Math.max(300, plannedSeconds * 0.5))
}

export function recordDailyActivity(
  progress: ProgressState,
  input: {
    readonly localDate: string
    readonly plannedSeconds: number
    readonly effectiveSeconds: number
    readonly completedTaskCount: number
    readonly planCompleted: boolean
    readonly recordedAt: string
  },
): ProgressState {
  assertLocalDate(input.localDate)
  parseTimestamp(input.recordedAt, 'recordedAt')
  const qualifiesForStreak =
    input.completedTaskCount > 0 &&
    input.effectiveSeconds >= streakThresholdSeconds(input.plannedSeconds)
  const activity: DailyActivity = {
    localDate: input.localDate,
    plannedSeconds: Math.max(0, Math.round(input.plannedSeconds)),
    effectiveSeconds: Math.max(0, Math.round(input.effectiveSeconds)),
    completedTaskCount: Math.max(0, Math.floor(input.completedTaskCount)),
    planCompleted: input.planCompleted,
    qualifiesForStreak,
  }
  const dailyActivity = [
    ...progress.dailyActivity.filter(
      (existing) => existing.localDate !== activity.localDate,
    ),
    activity,
  ]
    .sort(
      (left, right) =>
        localDateOrdinal(left.localDate) - localDateOrdinal(right.localDate),
    )
    .slice(-MAX_DAILY_HISTORY)

  return {
    ...progress,
    updatedAt: input.recordedAt,
    dailyActivity,
  }
}

function calculateTrend(
  attempts: readonly AttemptEvidence[],
): ProgressTrend {
  const reliable = attempts
    .filter((attempt) => attempt.evidenceQuality >= 0.5)
    .slice(-14)
  if (reliable.length < 6) {
    return 'insufficient-evidence'
  }
  const splitIndex = Math.floor(reliable.length / 2)
  const earlier = mean(
    reliable.slice(0, splitIndex).map((attempt) => attempt.effectivePerformance),
  )
  const later = mean(
    reliable.slice(splitIndex).map((attempt) => attempt.effectivePerformance),
  )
  const difference = later - earlier
  if (difference >= 0.05) {
    return 'improving'
  }
  if (difference <= -0.05) {
    return 'declining'
  }
  return 'stable'
}

function commonErrors(
  attempts: readonly AttemptEvidence[],
  asOf: string,
): readonly CommonErrorMetric[] {
  const totals = new Map<
    StandardErrorTag,
    {
      count: number
      weightedCount: number
      weightedAttemptTotal: number
      qualityTotal: number
    }
  >()
  let allAttemptWeight = 0

  for (const attempt of attempts) {
    const ageDays = elapsedDays(attempt.occurredAt, asOf)
    const recencyWeight = 0.5 ** (ageDays / ERROR_HALF_LIFE_DAYS)
    allAttemptWeight += recencyWeight
    for (const tag of new Set(attempt.errorTags)) {
      const current = totals.get(tag) ?? {
        count: 0,
        weightedCount: 0,
        weightedAttemptTotal: 0,
        qualityTotal: 0,
      }
      current.count += 1
      current.weightedCount += recencyWeight
      current.weightedAttemptTotal += recencyWeight
      current.qualityTotal += attempt.evidenceQuality
      totals.set(tag, current)
    }
  }

  return [...totals.entries()]
    .filter(([, value]) => value.count >= 2)
    .map(([tag, value]) => {
      const errorRate =
        allAttemptWeight === 0 ? 0 : value.weightedCount / allAttemptWeight
      const averageQuality = value.qualityTotal / value.count
      return {
        tag,
        recentCount: value.count,
        weightedCount: round(value.weightedCount),
        errorRate: round(errorRate),
        score: round(value.weightedCount * errorRate * averageQuality),
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
}

function buildStreak(
  activities: readonly DailyActivity[],
  currentLocalDate: string,
): StreakMetric {
  assertLocalDate(currentLocalDate, 'currentLocalDate')
  const qualifyingOrdinals = [
    ...new Set(
      activities
        .filter((activity) => activity.qualifiesForStreak)
        .map((activity) => localDateOrdinal(activity.localDate)),
    ),
  ].sort((left, right) => left - right)
  if (qualifyingOrdinals.length === 0) {
    return {
      currentDays: 0,
      longestDays: 0,
      lastQualifyingDate: null,
    }
  }

  let longestDays = 1
  let runningDays = 1
  for (let index = 1; index < qualifyingOrdinals.length; index += 1) {
    if (qualifyingOrdinals[index] === qualifyingOrdinals[index - 1] + 1) {
      runningDays += 1
      longestDays = Math.max(longestDays, runningDays)
    } else {
      runningDays = 1
    }
  }

  const lastOrdinal = qualifyingOrdinals.at(-1) as number
  const todayOrdinal = localDateOrdinal(currentLocalDate)
  const currentDays =
    todayOrdinal - lastOrdinal <= 1 ? runningDays : 0
  return {
    currentDays,
    longestDays,
    lastQualifyingDate: new Date(
      lastOrdinal * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10),
  }
}

function domainMetric(
  progress: ProgressState,
  domain: AbilityDomain,
  asOf: string,
): DomainProgressMetric {
  const state = progress.domains[domain]
  const attempts = progress.attempts.filter(
    (attempt) => attempt.domain === domain,
  )
  const progressScore = clamp(
    0.45 * state.masteryScore +
      0.35 * state.recentPerformance +
      0.2 * state.retentionScore,
    0,
    1,
  )

  return {
    domain,
    currentLevel: round(state.currentLevel, 2),
    levelChange: round(state.currentLevel - state.baselineLevel, 2),
    progressScore: round(progressScore),
    recentPerformance: round(state.recentPerformance),
    retentionScore: round(state.retentionScore),
    masteryScore: round(state.masteryScore),
    confidence: round(state.confidence),
    trend: calculateTrend(attempts),
    commonErrors: commonErrors(attempts, asOf),
  }
}

export function buildProgressSnapshot(
  progress: ProgressState,
  asOf: string,
  currentLocalDate: string,
): ProgressSnapshot {
  parseTimestamp(asOf, 'asOf')
  return {
    schemaVersion: 1,
    asOf,
    domains: {
      vocabulary: domainMetric(progress, 'vocabulary', asOf),
      listening: domainMetric(progress, 'listening', asOf),
      speaking: domainMetric(progress, 'speaking', asOf),
    },
    streak: buildStreak(progress.dailyActivity, currentLocalDate),
  }
}

export function getReassessmentRecommendation(
  progress: ProgressState,
): ReassessmentRecommendation {
  const cutoff = progress.lastReassessmentAt
  const qualifyingDays = progress.dailyActivity.filter((activity) => {
    if (!activity.qualifiesForStreak) {
      return false
    }
    if (cutoff === null) {
      return true
    }
    return activity.localDate > cutoff.slice(0, 10)
  }).length
  if (qualifyingDays >= 14) {
    return {
      schemaVersion: 1,
      due: true,
      domains: ABILITY_DOMAINS,
      reason: 'fourteen-learning-days',
      qualifyingDaysSinceLastAssessment: qualifyingDays,
    }
  }

  const calibrationDomains = ABILITY_DOMAINS.filter((domain) => {
    const state = progress.domains[domain]
    return (
      state.assessmentStatus !== 'estimated' &&
      state.reliableEvidenceCount >= 8
    )
  })
  if (calibrationDomains.length > 0) {
    return {
      schemaVersion: 1,
      due: true,
      domains: calibrationDomains,
      reason: 'low-confidence-calibration',
      qualifyingDaysSinceLastAssessment: qualifyingDays,
    }
  }

  return {
    schemaVersion: 1,
    due: false,
    domains: [],
    reason: 'not-due',
    qualifyingDaysSinceLastAssessment: qualifyingDays,
  }
}

export function markReassessmentCompleted(
  progress: ProgressState,
  completedAt: string,
): ProgressState {
  parseTimestamp(completedAt, 'completedAt')
  return {
    ...progress,
    updatedAt: completedAt,
    lastReassessmentAt: completedAt,
  }
}
