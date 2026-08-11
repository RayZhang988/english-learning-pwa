import type {
  ApplyAttemptResult,
  ExtraTrainingAttemptCompletedEvent,
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
    recentTrainingItemIds: {},
  }
}

export function trainingRecentBucket(
  domain: string,
  mode: string,
  difficultyLevel: number,
): string {
  return `${domain}:${mode}:${difficultyLevel}`
}

export function recordRecentTrainingItem(
  state: LearningEngineState,
  bucket: string,
  itemId: string,
): LearningEngineState {
  if (bucket.trim().length === 0 || itemId.trim().length === 0) {
    throw new TypeError('Recent training bucket and itemId must be non-empty')
  }
  const current = state.recentTrainingItemIds?.[bucket] ?? []
  const next = [...current.filter((value) => value !== itemId), itemId].slice(-12)
  return { ...state, recentTrainingItemIds: { ...(state.recentTrainingItemIds ?? {}), [bucket]: next } }
}

const MAX_SCENE_TRAINING_ACKNOWLEDGEMENTS = 500

/**
 * A scene callback is removed from its source snapshot only after this state
 * is saved. Persist its acknowledgement ID beside the recent-12 update so a
 * refresh between those two writes cannot reorder the cooldown again.
 */
export function acknowledgeSceneTrainingItem(
  state: LearningEngineState,
  acknowledgementId: string,
  bucket: string,
  itemId: string,
): LearningEngineState {
  if (acknowledgementId.trim().length === 0) {
    throw new TypeError('Scene training acknowledgementId must be non-empty')
  }
  const processed = state.sceneTrainingAcknowledgementIds ?? []
  if (processed.includes(acknowledgementId)) {
    return state
  }
  const next = recordRecentTrainingItem(state, bucket, itemId)
  return {
    ...next,
    sceneTrainingAcknowledgementIds: [
      ...processed,
      acknowledgementId,
    ].slice(-MAX_SCENE_TRAINING_ACKNOWLEDGEMENTS),
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

/**
 * Scored optional practice uses the same review algorithm, while carrying a
 * reserved non-plan evidence identity. It never enters applyPlanEvent(), so
 * it cannot alter a completed daily plan or manufacture a fourth daily task.
 */
export function applyExtraTrainingAttempt(
  state: LearningEngineState,
  event: ExtraTrainingAttemptCompletedEvent,
): ApplyAttemptResult {
  const payload = event.payload
  return applyLearningAttempt(state, {
    id: event.id,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: event.sourceModuleId,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    payload: {
      planId: `extra-training:${payload.localDate}`,
      taskId: payload.sessionId,
      learningUnitId: payload.learningUnitId,
      contentRef: payload.contentRef,
      domain: payload.domain,
      targetModuleId: payload.targetModuleId,
      localDate: payload.localDate,
      mode: payload.mode,
      difficultyLevel: payload.difficultyLevel,
      estimatedSeconds: payload.estimatedSeconds,
      result: payload.result,
      performanceScore: payload.performanceScore,
      evidenceQuality: payload.evidenceQuality,
      assistanceLevel: payload.assistanceLevel,
      durationSeconds: payload.durationSeconds,
      taskCompleted: false,
      errorTags: payload.errorTags,
      contentTags: payload.contentTags,
      failureCategory: payload.failureCategory,
    },
  })
}
