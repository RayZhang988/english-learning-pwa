import type {
  AttemptFailureCategory,
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskStartedEvent,
  LearningTaskSkippedEvent,
} from '../../learning-engine/index.ts'
import { getVocabularySessionResult } from './session.ts'
import type { VocabularySession } from './types.ts'

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
    domain: 'vocabulary' as const,
    targetModuleId: 'vocabulary' as const,
    localDate,
  }
}

export function createVocabularyTaskStartedEvent(
  task: LearningTask,
  identity: EventIdentity,
): LearningTaskStartedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.started.v1',
    sourceModuleId: 'vocabulary',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      mode: task.mode,
    },
  }
}

export function createVocabularyTaskPausedEvent(
  task: LearningTask,
  reason: TaskPauseReason,
  durationSeconds: number,
  identity: EventIdentity,
): LearningTaskPausedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.paused.v1',
    sourceModuleId: 'vocabulary',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
    },
  }
}

export function createVocabularyTaskSkippedEvent(
  task: LearningTask,
  reason: TaskSkipReason,
  identity: EventIdentity,
): LearningTaskSkippedEvent {
  return {
    id: identity.eventId,
    type: 'learning.task.skipped.v1',
    sourceModuleId: 'vocabulary',
    occurredAt: identity.occurredAt,
    schemaVersion: 1,
    payload: {
      ...basePayload(task, identity.localDate),
      reason,
    },
  }
}

export function createVocabularyCompletedEvent(
  session: VocabularySession,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  const result = getVocabularySessionResult(session)
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'vocabulary',
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
      assistanceLevel: 0,
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      taskCompleted: true,
      errorTags: result.errorTags,
      contentTags: session.task.tags,
      failureCategory: null,
    },
  }
}

export function createVocabularyUnscorableEvent(
  task: LearningTask,
  failureCategory: AttemptFailureCategory,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'vocabulary',
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
