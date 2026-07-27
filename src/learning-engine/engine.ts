import type {
  ApplyAttemptResult,
  LearningAttemptCompletedEvent,
  LearningEngineState,
  ReviewItemState,
} from './contracts.ts'
import { appendAttemptEvidence, createInitialProgressState } from './progress.ts'
import { updateReviewItem } from './review.ts'
import {
  assertLocalDate,
  clamp,
  round,
  uniqueStrings,
} from './utils.ts'
import type { LearningAbilityProfile } from './contracts.ts'

export function createLearningEngineState(
  profile: LearningAbilityProfile,
  initializedAt: string,
): LearningEngineState {
  return {
    schemaVersion: 1,
    progress: createInitialProgressState(profile, initializedAt),
    reviewItems: {},
  }
}

function reviewMapWith(
  reviewItems: Readonly<Record<string, ReviewItemState>>,
  item: ReviewItemState,
): Readonly<Record<string, ReviewItemState>> {
  return {
    ...reviewItems,
    [item.learningUnitId]: item,
  }
}

export function applyLearningAttempt(
  state: LearningEngineState,
  event: LearningAttemptCompletedEvent,
): ApplyAttemptResult {
  assertLocalDate(event.payload.localDate)
  const previous = state.reviewItems[event.payload.learningUnitId]
  if (
    state.progress.attempts.some(
      (attempt) => attempt.eventId === event.id,
    )
  ) {
    return {
      state,
      reviewItem: previous ?? null,
      evidenceAccepted: false,
      reason: 'duplicate',
    }
  }
  if (
    event.payload.result === 'unscorable' ||
    event.payload.performanceScore === null
  ) {
    return {
      state,
      reviewItem: previous ?? null,
      evidenceAccepted: false,
      reason: 'unscorable',
    }
  }

  const reviewItem = updateReviewItem(previous, event)
  const reviewItems = reviewMapWith(state.reviewItems, reviewItem)
  const effectivePerformance = clamp(
    event.payload.performanceScore *
      (1 - 0.3 * event.payload.assistanceLevel),
    0,
    1,
  )
  const progress = appendAttemptEvidence(
    state.progress,
    {
      eventId: event.id,
      planId: event.payload.planId,
      taskId: event.payload.taskId,
      learningUnitId: event.payload.learningUnitId,
      domain: event.payload.domain,
      mode: event.payload.mode,
      difficultyLevel: event.payload.difficultyLevel,
      performanceScore: event.payload.performanceScore,
      effectivePerformance: round(effectivePerformance),
      evidenceQuality: event.payload.evidenceQuality,
      durationSeconds: event.payload.durationSeconds,
      errorTags: uniqueStrings(event.payload.errorTags),
      occurredAt: event.occurredAt,
      localDate: event.payload.localDate,
    },
    reviewItems,
  )
  return {
    state: {
      ...state,
      progress,
      reviewItems,
    },
    reviewItem,
    evidenceAccepted: true,
    reason: 'scored',
  }
}
