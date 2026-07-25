import {
  parseLearningEvent,
  type LearningEvent,
  type LearningTask,
} from '../../learning-engine/index.ts'
import {
  localStorageService,
  type NamespaceStore,
} from '../../storage/index.ts'
import { VocabularyError } from './errors.ts'
import {
  VOCABULARY_SESSION_SCHEMA_VERSION,
  type VocabularyQuestion,
  type VocabularySession,
} from './types.ts'

export const VOCABULARY_STORAGE_NAMESPACE = 'feature.vocabulary'
export const VOCABULARY_STORAGE_SCHEMA_VERSION = 1 as const

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function validateQuestion(value: unknown): value is VocabularyQuestion {
  if (!isRecord(value) || !Array.isArray(value.options)) {
    return false
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.prompt !== 'string' ||
    typeof value.instructionZh !== 'string' ||
    typeof value.correctOptionId !== 'string' ||
    ![
      'term-to-meaning',
      'meaning-to-term',
      'example-comprehension',
      'scene-word-choice',
    ].includes(String(value.type))
  ) {
    return false
  }
  const optionIds = new Set<string>()
  for (const option of value.options) {
    if (
      !isRecord(option) ||
      typeof option.id !== 'string' ||
      typeof option.label !== 'string' ||
      optionIds.has(option.id)
    ) {
      return false
    }
    optionIds.add(option.id)
  }
  return optionIds.has(value.correctOptionId)
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
): VocabularySession {
  if (!isRecord(value)) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session is not an object.',
    )
  }
  if (value.schemaVersion !== VOCABULARY_SESSION_SCHEMA_VERSION) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session uses an unsupported version.',
    )
  }
  if (
    !isRecord(value.task) ||
    !sameTaskIdentity(value.task as unknown as LearningTask, expectedTask)
  ) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session belongs to a different learning task.',
    )
  }
  if (
    !Array.isArray(value.questions) ||
    !value.questions.every(validateQuestion) ||
    !Array.isArray(value.answers) ||
    !Array.isArray(value.pendingEvents)
  ) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session has invalid question or event data.',
    )
  }
  const phases = [
    'answering',
    'feedback',
    'paused',
    'completed',
    'error',
  ]
  if (
    !phases.includes(String(value.phase)) ||
    !Number.isInteger(value.questionIndex) ||
    typeof value.activeDurationSeconds !== 'number' ||
    typeof value.reportedDurationSeconds !== 'number' ||
    typeof value.startedAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isStringOrNull(value.lastActiveAt) ||
    !isStringOrNull(value.selectedOptionId)
  ) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session has invalid state metadata.',
    )
  }
  const questions = value.questions as unknown as readonly VocabularyQuestion[]
  const questionIndex = value.questionIndex as number
  if (
    (questions.length === 0 && value.phase !== 'error') ||
    (questions.length > 0 &&
      (questionIndex < 0 || questionIndex >= questions.length))
  ) {
    throw new VocabularyError(
      'session-recovery-invalid',
      'Stored vocabulary session points to an invalid question.',
    )
  }
  const questionMap = new Map(
    questions.map((question) => [question.id, question]),
  )
  for (const answer of value.answers) {
    if (
      !isRecord(answer) ||
      typeof answer.questionId !== 'string' ||
      typeof answer.selectedOptionId !== 'string' ||
      typeof answer.correct !== 'boolean' ||
      typeof answer.submittedAt !== 'string'
    ) {
      throw new VocabularyError(
        'session-recovery-invalid',
        'Stored vocabulary answer is invalid.',
      )
    }
    const question = questionMap.get(answer.questionId)
    if (
      !question ||
      !question.options.some(
        (option) => option.id === answer.selectedOptionId,
      )
    ) {
      throw new VocabularyError(
        'session-recovery-invalid',
        'Stored vocabulary answer does not match its question.',
      )
    }
  }

  const pendingEvents: LearningEvent[] = []
  for (const pendingEvent of value.pendingEvents) {
    try {
      const event = parseLearningEvent(
        pendingEvent as Parameters<typeof parseLearningEvent>[0],
      )
      if (
        event.sourceModuleId !== 'vocabulary' ||
        event.payload.taskId !== expectedTask.taskId
      ) {
        throw new TypeError('Event belongs to a different task')
      }
      pendingEvents.push(event)
    } catch (error) {
      throw new VocabularyError(
        'session-recovery-invalid',
        'Stored vocabulary event outbox is invalid.',
        { cause: error },
      )
    }
  }

  return {
    ...(value as unknown as VocabularySession),
    pendingEvents,
  }
}

export class VocabularySessionRepository {
  private readonly store: NamespaceStore

  constructor(
    store: NamespaceStore = localStorageService.namespace(
      VOCABULARY_STORAGE_NAMESPACE,
    ),
  ) {
    this.store = store
  }

  private key(taskId: string): string {
    return `session:${taskId}`
  }

  async load(task: LearningTask): Promise<VocabularySession | undefined> {
    const record = await this.store.get<unknown>(this.key(task.taskId))
    if (!record) {
      return undefined
    }
    if (record.schemaVersion !== VOCABULARY_STORAGE_SCHEMA_VERSION) {
      throw new VocabularyError(
        'session-recovery-invalid',
        'Stored vocabulary record uses an unsupported schema version.',
      )
    }
    return restoreSession(record.value, task)
  }

  save(session: VocabularySession): Promise<void> {
    return this.store.put(
      this.key(session.task.taskId),
      session,
      VOCABULARY_STORAGE_SCHEMA_VERSION,
    )
  }

  delete(taskId: string): Promise<void> {
    return this.store.delete(this.key(taskId))
  }
}
