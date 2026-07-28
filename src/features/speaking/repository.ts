import {
  parseLearningEvent,
  type LearningEvent,
  type LearningTask,
} from '../../learning-engine/index.ts'
import {
  localStorageService,
  type NamespaceStore,
} from '../../storage/index.ts'
import { SpeakingError } from './errors.ts'
import {
  SPEAKING_SESSION_SCHEMA_VERSION,
  type SpeakingSession,
} from './types.ts'

export const SPEAKING_STORAGE_NAMESPACE = 'feature.speaking'
export const SPEAKING_STORAGE_SCHEMA_VERSION = 1 as const

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function sameTaskIdentity(left: LearningTask, right: LearningTask): boolean {
  return (
    left.taskId === right.taskId &&
    left.planId === right.planId &&
    left.learningUnitId === right.learningUnitId &&
    left.contentRef === right.contentRef &&
    left.domain === right.domain &&
    left.targetModuleId === right.targetModuleId &&
    left.mode === right.mode
  )
}

function restoreSession(
  value: unknown,
  expectedTask: LearningTask,
): SpeakingSession {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SPEAKING_SESSION_SCHEMA_VERSION ||
    !isRecord(value.task) ||
    !sameTaskIdentity(
      value.task as unknown as LearningTask,
      expectedTask,
    )
  ) {
    throw new SpeakingError(
      'session-recovery-invalid',
      'Stored speaking session has an invalid identity or version.',
    )
  }
  if (
    !Array.isArray(value.answers) ||
    !Array.isArray(value.pendingEvents) ||
    !isRecord(value.recorder) ||
    !isRecord(value.recognition) ||
    typeof value.phase !== 'string' ||
    ![
      'practicing',
      'feedback',
      'paused',
      'completed',
      'error',
    ].includes(value.phase) ||
    !Number.isInteger(value.promptIndex) ||
    typeof value.activeDurationSeconds !== 'number' ||
    typeof value.reportedDurationSeconds !== 'number' ||
    typeof value.startedAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new SpeakingError(
      'session-recovery-invalid',
      'Stored speaking session has invalid state data.',
    )
  }
  const pendingEvents: LearningEvent[] = []
  for (const pending of value.pendingEvents) {
    try {
      const event = parseLearningEvent(
        pending as Parameters<typeof parseLearningEvent>[0],
      )
      if (
        event.sourceModuleId !== 'speaking' ||
        event.payload.taskId !== expectedTask.taskId
      ) {
        throw new TypeError('Event belongs to a different task')
      }
      pendingEvents.push(event)
    } catch (error) {
      throw new SpeakingError(
        'session-recovery-invalid',
        'Stored speaking event outbox is invalid.',
        { cause: error },
      )
    }
  }
  const legacyStream = (value as unknown as {
    stream?: SpeakingSession['stream']
  }).stream
  return {
    ...(value as unknown as SpeakingSession),
    stream: legacyStream === null || legacyStream === undefined
      ? null
      : {
          ...legacyStream,
          exhaustionRequestId: legacyStream.exhaustionRequestId ?? null,
          recoveryEventId: legacyStream.recoveryEventId ?? null,
        },
    pendingEvents,
    recorder: {
      ...(value.recorder as unknown as SpeakingSession['recorder']),
      playbackAvailable: false,
    },
  }
}

export class SpeakingSessionRepository {
  private readonly store: NamespaceStore

  constructor(
    store: NamespaceStore = localStorageService.namespace(
      SPEAKING_STORAGE_NAMESPACE,
    ),
  ) {
    this.store = store
  }

  private key(taskId: string): string {
    return `session:${taskId}`
  }

  async load(task: LearningTask): Promise<SpeakingSession | undefined> {
    const stored = await this.store.get<unknown>(this.key(task.taskId))
    if (!stored) {
      return undefined
    }
    if (stored.schemaVersion !== SPEAKING_STORAGE_SCHEMA_VERSION) {
      throw new SpeakingError(
        'session-recovery-invalid',
        'Stored speaking record uses an unsupported schema version.',
      )
    }
    return restoreSession(stored.value, task)
  }

  async save(session: SpeakingSession): Promise<void> {
    await this.store.put(
      this.key(session.task.taskId),
      session,
      SPEAKING_STORAGE_SCHEMA_VERSION,
    )
  }

  async remove(taskId: string): Promise<void> {
    await this.store.delete(this.key(taskId))
  }
}
