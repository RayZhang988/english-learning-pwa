import type {
  LearningAttemptCompletedEvent,
  ReviewItemState,
} from './contracts.ts'
import {
  addMilliseconds,
  clamp,
  elapsedDays,
  parseTimestamp,
  round,
} from './utils.ts'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
const MIN_STABILITY_DAYS = 0.25
const MAX_STABILITY_DAYS = 60
const SUCCESS_THRESHOLD = 0.6

export function calculateRetrievability(
  reviewItem: ReviewItemState,
  asOf: string,
): number {
  if (reviewItem.lastAttemptAt === null) {
    return 0
  }
  const days = elapsedDays(reviewItem.lastAttemptAt, asOf)
  return round(Math.exp(-days / Math.max(MIN_STABILITY_DAYS, reviewItem.stabilityDays)))
}

function createInitialReviewItem(
  event: LearningAttemptCompletedEvent,
): ReviewItemState {
  const payload = event.payload
  return {
    schemaVersion: 1,
    learningUnitId: payload.learningUnitId,
    contentRef: payload.contentRef,
    domain: payload.domain,
    difficultyLevel: payload.difficultyLevel,
    estimatedSeconds: payload.estimatedSeconds,
    memoryDifficulty: 0.5,
    mastery: 0.2,
    stabilityDays: MIN_STABILITY_DAYS,
    successfulReviews: 0,
    lapseCount: 0,
    attemptCount: 0,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    nextReviewAt: event.occurredAt,
    retryAt: null,
    status: 'learning',
    tags: payload.contentTags,
  }
}

export function updateReviewItem(
  previous: ReviewItemState | undefined,
  event: LearningAttemptCompletedEvent,
): ReviewItemState {
  const payload = event.payload
  if (payload.result !== 'scored' || payload.performanceScore === null) {
    throw new TypeError('Only scored attempts can update review state')
  }
  parseTimestamp(event.occurredAt, 'occurredAt')

  const current = previous ?? createInitialReviewItem(event)
  if (
    current.learningUnitId !== payload.learningUnitId ||
    current.domain !== payload.domain ||
    current.contentRef !== payload.contentRef
  ) {
    throw new TypeError('Attempt identity does not match review item')
  }
  if (
    current.lastAttemptAt !== null &&
    parseTimestamp(event.occurredAt, 'occurredAt') <
      parseTimestamp(current.lastAttemptAt, 'lastAttemptAt')
  ) {
    throw new RangeError('Attempt cannot predate the latest review state')
  }

  const effectivePerformance = clamp(
    payload.performanceScore * (1 - 0.3 * payload.assistanceLevel),
    0,
    1,
  )
  const evidenceWeight = 0.12 + 0.38 * payload.evidenceQuality
  const mastery = clamp(
    current.mastery +
      evidenceWeight * (effectivePerformance - current.mastery),
    0,
    1,
  )
  const succeeded = effectivePerformance >= SUCCESS_THRESHOLD
  const memoryDifficulty = clamp(
    current.memoryDifficulty +
      (succeeded
        ? -0.08 * effectivePerformance
        : 0.16 * (1 - effectivePerformance)),
    0.05,
    0.95,
  )

  if (!succeeded) {
    const lapseCount = current.lapseCount + 1
    const retryMinutes = Math.min(30, 10 + (lapseCount - 1) * 5)
    return {
      ...current,
      difficultyLevel: payload.difficultyLevel,
      estimatedSeconds: payload.estimatedSeconds,
      memoryDifficulty: round(memoryDifficulty),
      mastery: round(mastery * 0.7),
      stabilityDays: round(
        Math.max(MIN_STABILITY_DAYS, current.stabilityDays * 0.35),
      ),
      lapseCount,
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: event.occurredAt,
      nextReviewAt: addMilliseconds(event.occurredAt, DAY_MS),
      retryAt: addMilliseconds(event.occurredAt, retryMinutes * MINUTE_MS),
      status: 'learning',
      tags: payload.contentTags,
    }
  }

  const wasRetry = current.retryAt !== null
  const baseStability =
    current.successfulReviews === 0
      ? 0.75 + 1.75 * effectivePerformance
      : current.stabilityDays *
        (1.2 + 1.3 * effectivePerformance) *
        (1 - 0.25 * memoryDifficulty)
  const stabilityDays = clamp(
    wasRetry ? Math.min(1, baseStability) : baseStability,
    MIN_STABILITY_DAYS,
    MAX_STABILITY_DAYS,
  )
  const intervalDays = wasRetry
    ? 1
    : clamp(
        stabilityDays * (0.75 + 0.5 * mastery),
        MIN_STABILITY_DAYS,
        MAX_STABILITY_DAYS,
      )
  const successfulReviews = current.successfulReviews + 1
  const status =
    mastery >= 0.9 && stabilityDays >= 21
      ? 'mastered'
      : successfulReviews >= 2
        ? 'reviewing'
        : 'learning'

  return {
    ...current,
    difficultyLevel: payload.difficultyLevel,
    estimatedSeconds: payload.estimatedSeconds,
    memoryDifficulty: round(memoryDifficulty),
    mastery: round(mastery),
    stabilityDays: round(stabilityDays),
    successfulReviews,
    attemptCount: current.attemptCount + 1,
    lastAttemptAt: event.occurredAt,
    lastSuccessfulAt: event.occurredAt,
    nextReviewAt: addMilliseconds(event.occurredAt, intervalDays * DAY_MS),
    retryAt: null,
    status,
    tags: payload.contentTags,
  }
}

export function isReviewDue(
  reviewItem: ReviewItemState,
  asOf: string,
): boolean {
  const now = parseTimestamp(asOf, 'asOf')
  return Date.parse(reviewItem.nextReviewAt) <= now
}

export function isRetryDue(
  reviewItem: ReviewItemState,
  asOf: string,
): boolean {
  if (reviewItem.retryAt === null) {
    return false
  }
  const now = parseTimestamp(asOf, 'asOf')
  return Date.parse(reviewItem.retryAt) <= now
}
