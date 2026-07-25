import type {
  AttemptFailureCategory,
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskStartedEvent,
  LearningTaskSkippedEvent,
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
  task: LearningTask,
  failureCategory: AttemptFailureCategory,
  durationSeconds: number,
  identity: EventIdentity,
): LearningAttemptCompletedEvent {
  return {
    id: identity.eventId,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'speaking',
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
