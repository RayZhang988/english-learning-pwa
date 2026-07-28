import type {
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskStartedEvent,
  LearningTaskSkippedEvent,
  LearningTaskSupplyItem,
  LearningTrainingBudgetCompletedEvent,
  LearningTrainingContentExhaustedEvent,
  LearningTrainingItemCompletedEvent,
} from '../../learning-engine/index.ts'
import { SpeakingError } from './errors.ts'
import { getSpeakingSessionResult } from './session.ts'
import type { SpeakingSession } from './types.ts'

type TaskPauseReason = LearningTaskPausedEvent['payload']['reason']
type TaskSkipReason = LearningTaskSkippedEvent['payload']['reason']

interface EventIdentity {
  readonly eventId: string
  readonly occurredAt: string
  readonly localDate: string
}

function basePayload(task: LearningTask, localDate: string) {
  return {
    planId: task.planId,
    taskId: task.taskId,
    learningUnitId: task.learningUnitId,
    contentRef: task.contentRef,
    domain: 'speaking' as const,
    targetModuleId: 'speaking' as const,
    localDate,
  }
}

export function createSpeakingTaskStartedEvent(
  task: LearningTask,
  identity: EventIdentity,
): LearningTaskStartedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.started.v1',
    sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      mode: task.mode,
    },
  }
}

export function createSpeakingTaskPausedEvent(
  task: LearningTask,
  reason: TaskPauseReason,
  durationSeconds: number,
  identity: EventIdentity,
): LearningTaskPausedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.paused.v1',
    sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
    },
  }
}

export function createSpeakingTaskSkippedEvent(
  task: LearningTask,
  reason: TaskSkipReason,
  identity: EventIdentity,
): LearningTaskSkippedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.skipped.v1',
    sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
    },
  }
}

export function createSpeakingCompletedEvent(
  session: SpeakingSession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  if (session.phase !== 'completed') {
    throw new SpeakingError(
      'session-transition-invalid',
      'A speaking completion event requires a completed session.',
    )
  }
  const result = getSpeakingSessionResult(session)
  if (result.performanceScore === null) {
    throw new SpeakingError(
      'session-transition-invalid',
      'A scored speaking event requires recognized text evidence.',
    )
  }
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(session.task, identity.localDate),
      mode: session.task.mode,
      difficultyLevel: session.task.difficultyLevel,
      estimatedSeconds: session.task.estimatedSeconds,
      result: 'scored',
      performanceScore: result.performanceScore,
      evidenceQuality: result.evidenceQuality,
      assistanceLevel: result.assistanceLevel,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: true,
      errorTags: result.errorTags,
      contentTags: session.task.tags,
      failureCategory: null,
    },
  }
}

export function createSpeakingUnscorableEvent(
  session: SpeakingSession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  if (session.phase !== 'completed') {
    throw new SpeakingError(
      'session-transition-invalid',
      'An unscorable speaking event requires a completed session.',
    )
  }
  const result = getSpeakingSessionResult(session)
  if (result.performanceScore !== null) {
    throw new SpeakingError(
      'session-transition-invalid',
      'An unscorable speaking event cannot contain recognized text evidence.',
    )
  }
  const failureCategory = result.failureCategory
  if (
    failureCategory !== 'device' &&
    failureCategory !== 'permission' &&
    failureCategory !== 'network'
  ) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Completed unscorable speaking practice requires a terminal-compatible failure category.',
    )
  }
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(session.task, identity.localDate),
      mode: session.task.mode,
      difficultyLevel: session.task.difficultyLevel,
      estimatedSeconds: session.task.estimatedSeconds,
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      assistanceLevel: 0,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: false,
      errorTags: [],
      contentTags: session.task.tags,
      failureCategory,
    },
  }
}

export function createSpeakingStreamAttemptEvent(
  session: SpeakingSession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  const result = getSpeakingSessionResult(session)
  const unscorable = result.performanceScore === null
  if (unscorable && result.failureCategory === null) {
    throw new SpeakingError('session-transition-invalid', 'Unscorable speaking stream item needs an honest failure category.')
  }
  return {
    id: identity.eventId, type: 'learning.attempt.completed.v1', sourceModuleId: 'speaking',
    occurredAt: identity.occurredAt, schemaVersion: 1,
    payload: {
      ...basePayload(session.task, identity.localDate), mode: session.task.mode,
      difficultyLevel: session.task.difficultyLevel, estimatedSeconds: session.task.estimatedSeconds,
      result: unscorable ? 'unscorable' : 'scored',
      performanceScore: result.performanceScore,
      evidenceQuality: unscorable ? 0 : result.evidenceQuality,
      assistanceLevel: unscorable ? 0 : result.assistanceLevel,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)), taskCompleted: false,
      errorTags: unscorable ? [] : result.errorTags, contentTags: session.task.tags,
      failureCategory: unscorable ? result.failureCategory : null,
    },
  }
}

export function createSpeakingTrainingItemCompletedEvent(
  task: LearningTask, item: LearningTaskSupplyItem, requestId: string,
  nextSupplyCursor: string | null,
  outcome: 'scored' | 'unscorable-practice', identity: EventIdentity,
): LearningTrainingItemCompletedEvent {
  return { id: identity.eventId, type: 'learning.training.item.completed.v1', sourceModuleId: 'speaking', occurredAt: identity.occurredAt, schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, item, requestId, nextSupplyCursor, outcome } }
}

export function createSpeakingTrainingContentExhaustedEvent(
  task: LearningTask, requestId: string, cursor: string | null,
  reason: LearningTrainingContentExhaustedEvent['payload']['reason'], identity: EventIdentity,
): LearningTrainingContentExhaustedEvent {
  return { id: identity.eventId, type: 'learning.training.content.exhausted.v1', sourceModuleId: 'speaking', occurredAt: identity.occurredAt, schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, requestId, cursor, reason } }
}

export function createSpeakingTrainingBudgetCompletedEvent(
  task: LearningTask, lastCompletedItemId: string, completedItemCount: number, identity: EventIdentity,
): LearningTrainingBudgetCompletedEvent {
  return { id: identity.eventId, type: 'learning.training.budget.completed.v1', sourceModuleId: 'speaking', occurredAt: identity.occurredAt, schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, lastCompletedItemId, completedItemCount } }
}
