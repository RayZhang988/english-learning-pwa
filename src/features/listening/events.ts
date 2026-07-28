import type {
  AttemptFailureCategory,
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskStartedEvent,
  LearningTaskSupplyItem,
  LearningTrainingBudgetCompletedEvent,
  LearningTrainingContentExhaustedEvent,
  LearningTrainingContentRecoveredEvent,
  LearningTrainingItemCompletedEvent,
  LearningTaskSkippedEvent,
} from '../../learning-engine/index.ts'
import { ListeningError } from './errors.ts'
import { getListeningSessionResult } from './session.ts'
import type { ListeningSession } from './types.ts'

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
    domain: 'listening' as const,
    targetModuleId: 'listening' as const,
    localDate,
  }
}

export function createListeningTaskStartedEvent(
  task: LearningTask,
  identity: EventIdentity,
): LearningTaskStartedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.started.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      mode: task.mode,
    },
  }
}

export function createListeningTaskPausedEvent(
  task: LearningTask,
  reason: TaskPauseReason,
  durationSeconds: number,
  identity: EventIdentity,
): LearningTaskPausedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.paused.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
    },
  }
}

export function createListeningTaskSkippedEvent(
  task: LearningTask,
  reason: TaskSkipReason,
  identity: EventIdentity,
): LearningTaskSkippedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.skipped.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
    },
  }
}

export function createListeningCompletedEvent(
  session: ListeningSession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  if (session.phase !== 'completed') {
    throw new ListeningError(
      'session-transition-invalid',
      'A scored listening event requires a completed session.',
    )
  }
  const result = getListeningSessionResult(session)
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(session.task, identity.localDate),
      mode: session.task.mode,
      difficultyLevel: session.task.difficultyLevel,
      estimatedSeconds: session.task.estimatedSeconds,
      result: 'scored',
      performanceScore: result.performanceScore,
      evidenceQuality: 1,
      assistanceLevel: result.assistanceLevel,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: true,
      errorTags: result.errorTags,
      contentTags: session.task.tags,
      failureCategory: null,
    },
  }
}

export function createListeningUnscorableEvent(
  task: LearningTask,
  failureCategory: AttemptFailureCategory,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      assistanceLevel: 0,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: false,
      errorTags: [],
      contentTags: task.tags,
      failureCategory,
    },
  }
}

export function createListeningStreamAttemptEvent(
  session: ListeningSession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  const result = getListeningSessionResult(session)
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(session.task, identity.localDate),
      mode: session.task.mode,
      difficultyLevel: session.task.difficultyLevel,
      estimatedSeconds: session.task.estimatedSeconds,
      result: 'scored',
      performanceScore: result.performanceScore,
      evidenceQuality: 1,
      assistanceLevel: result.assistanceLevel,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: false,
      errorTags: result.errorTags,
      contentTags: session.task.tags,
      failureCategory: null,
    },
  }
}

export function createListeningTrainingItemCompletedEvent(
  task: LearningTask,
  item: LearningTaskSupplyItem,
  requestId: string,
  nextSupplyCursor: string | null,
  identity: EventIdentity,
): LearningTrainingItemCompletedEvent {
  return {
    id: identity.eventId,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, item, requestId, nextSupplyCursor, outcome: 'scored' },
  }
}

export function createListeningTrainingContentExhaustedEvent(
  task: LearningTask,
  requestId: string,
  cursor: string | null,
  reason: LearningTrainingContentExhaustedEvent['payload']['reason'],
  identity: EventIdentity,
): LearningTrainingContentExhaustedEvent {
  return {
    id: identity.eventId,
    type: 'learning.training.content.exhausted.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, requestId, cursor, reason },
  }
}

export function createListeningTrainingContentRecoveredEvent(
  task: LearningTask,
  exhaustionRequestId: string,
  identity: EventIdentity,
): LearningTrainingContentRecoveredEvent {
  return {
    id: identity.eventId,
    type: 'learning.training.content.recovered.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, exhaustionRequestId },
  }
}

export function createListeningTrainingBudgetCompletedEvent(
  task: LearningTask,
  lastCompletedItemId: string,
  completedItemCount: number,
  identity: EventIdentity,
): LearningTrainingBudgetCompletedEvent {
  return {
    id: identity.eventId,
    type: 'learning.training.budget.completed.v1',
    sourceModuleId: 'listening',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: { ...basePayload(task, identity.localDate), mode: task.mode, lastCompletedItemId, completedItemCount },
  }
}
