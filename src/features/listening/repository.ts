import {
  parseLearningEvent,
  type LearningEvent,
  type LearningTask,
} from '../../learning-engine/index.ts'
import {
  localStorageService,
  type NamespaceStore,
} from '../../storage/index.ts'
import { ListeningError } from './errors.ts'
import {
  LISTENING_SESSION_SCHEMA_VERSION,
  type ListeningQuestion,
  type ListeningSession,
} from './types.ts'

export const LISTENING_STORAGE_NAMESPACE = 'feature.listening'
export const LISTENING_STORAGE_SCHEMA_VERSION = 1 as const

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

function validQuestion(value: unknown): value is ListeningQuestion {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.promptZh !== 'string' ||
    typeof value.primarySegmentId !== 'string' ||
    !Array.isArray(value.segments) ||
    !isRecord(value.playbackPolicy)
  ) {
    return false
  }
  const types = [
    'word-discrimination',
    'short-sentence-choice',
    'keyword-dictation',
    'core-information',
    'scene-comprehension',
  ]
  if (!types.includes(value.type)) {
    return false
  }
  const segmentIds = new Set<string>()
  for (const segment of value.segments) {
    if (
      !isRecord(segment) ||
      typeof segment.id !== 'string' ||
      typeof segment.text !== 'string' ||
      segment.locale !== 'en-US' ||
      segmentIds.has(segment.id)
    ) {
      return false
    }
    segmentIds.add(segment.id)
  }
  if (!segmentIds.has(value.primarySegmentId)) {
    return false
  }
  const sequenceMode = value.playbackPolicy.sequenceMode
  if (
    sequenceMode !== undefined &&
    sequenceMode !== 'current-segment' &&
    sequenceMode !== 'all-segments'
  ) {
    return false
  }
  if (value.type === 'keyword-dictation') {
    return (
      typeof value.standardAnswer === 'string' &&
      Array.isArray(value.acceptedAnswers) &&
      value.acceptedAnswers.includes(value.standardAnswer)
    )
  }
  return (
    Array.isArray(value.options) &&
    typeof value.correctOptionId === 'string' &&
    value.options.some(
      (option) =>
        isRecord(option) && option.id === value.correctOptionId,
    )
  )
}

function upgradeLegacyPassageSession(
  session: ListeningSession,
): ListeningSession {
  const legacySegmentId = `${session.task.learningUnitId}:passage`
  let upgradedLegacyPassage = false
  const questions = session.questions.map((question) => {
    const normalizedPolicy = {
      ...question.playbackPolicy,
      sequenceMode:
        question.playbackPolicy.sequenceMode ?? 'current-segment',
    }
    if (
      question.type !== 'core-information' ||
      question.primarySegmentId !== legacySegmentId ||
      question.segments.length !== 1 ||
      session.transcript.length === 0
    ) {
      return {
        ...question,
        playbackPolicy: normalizedPolicy,
      } as ListeningQuestion
    }
    upgradedLegacyPassage = true
    const segments = session.transcript.map((line, index) => ({
      id: `${session.task.learningUnitId}:passage:${index}`,
      locale: 'en-US' as const,
      text: line.text,
      label: line.speaker
        ? `${line.speaker} 的句子`
        : `第 ${index + 1} 句`,
      speaker: line.speaker,
    }))
    return {
      ...question,
      primarySegmentId: segments[0].id,
      segments,
      playbackPolicy: {
        ...normalizedPolicy,
        allowSegmentSelection: true,
        sequenceMode: 'all-segments',
      },
    } as ListeningQuestion
  })
  if (
    !upgradedLegacyPassage ||
    session.playback.currentSegmentId !== legacySegmentId
  ) {
    return {
      ...session,
      questions,
    }
  }
  const firstSegmentId = `${session.task.learningUnitId}:passage:0`
  const legacyPlayCount =
    session.playback.playCounts[legacySegmentId] ?? 0
  return {
    ...session,
    questions,
    playback: {
      ...session.playback,
      currentSegmentId: firstSegmentId,
      playCounts: {
        ...session.playback.playCounts,
        [firstSegmentId]: legacyPlayCount,
      },
    },
  }
}

function restoreSession(
  value: unknown,
  expectedTask: LearningTask,
): ListeningSession {
  if (!isRecord(value)) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session is not an object.',
    )
  }
  if (value.schemaVersion !== LISTENING_SESSION_SCHEMA_VERSION) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session uses an unsupported version.',
    )
  }
  if (
    !isRecord(value.task) ||
    !sameTaskIdentity(value.task as unknown as LearningTask, expectedTask)
  ) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session belongs to a different learning task.',
    )
  }
  if (
    !Array.isArray(value.questions) ||
    !value.questions.every(validQuestion) ||
    !Array.isArray(value.transcript) ||
    !Array.isArray(value.answers) ||
    !Array.isArray(value.pendingEvents) ||
    !isRecord(value.playback)
  ) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session has invalid content or playback data.',
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
    typeof value.selectedOptionId !== 'string' &&
      value.selectedOptionId !== null ||
    typeof value.dictationInput !== 'string' ||
    typeof value.activeDurationSeconds !== 'number' ||
    typeof value.reportedDurationSeconds !== 'number' ||
    typeof value.startedAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session has invalid state metadata.',
    )
  }
  const questions = value.questions as unknown as readonly ListeningQuestion[]
  const questionIndex = value.questionIndex as number
  if (
    (questions.length === 0 && value.phase !== 'error') ||
    (questions.length > 0 &&
      (questionIndex < 0 || questionIndex >= questions.length))
  ) {
    throw new ListeningError(
      'session-recovery-invalid',
      'Stored listening session points to an invalid question.',
    )
  }
  const questionIds = new Set(questions.map((question) => question.id))
  for (const answer of value.answers) {
    if (
      !isRecord(answer) ||
      typeof answer.questionId !== 'string' ||
      !questionIds.has(answer.questionId) ||
      typeof answer.response !== 'string' ||
      typeof answer.correct !== 'boolean' ||
      typeof answer.submittedAt !== 'string'
    ) {
      throw new ListeningError(
        'session-recovery-invalid',
        'Stored listening answer is invalid.',
      )
    }
  }

  const pendingEvents: LearningEvent[] = []
  for (const pending of value.pendingEvents) {
    try {
      const event = parseLearningEvent(
        pending as Parameters<typeof parseLearningEvent>[0],
      )
      if (
        event.sourceModuleId !== 'listening' ||
        event.payload.taskId !== expectedTask.taskId
      ) {
        throw new TypeError('Event belongs to a different task')
      }
      pendingEvents.push(event)
    } catch (error) {
      throw new ListeningError(
        'session-recovery-invalid',
        'Stored listening event outbox is invalid.',
        { cause: error },
      )
    }
  }
  return upgradeLegacyPassageSession({
    ...(value as unknown as ListeningSession),
    pendingEvents,
  })
}

export class ListeningSessionRepository {
  private readonly store: NamespaceStore

  constructor(
    store: NamespaceStore = localStorageService.namespace(
      LISTENING_STORAGE_NAMESPACE,
    ),
  ) {
    this.store = store
  }

  private key(taskId: string): string {
    return `session:${taskId}`
  }

  async load(task: LearningTask): Promise<ListeningSession | undefined> {
    const stored = await this.store.get<unknown>(this.key(task.taskId))
    if (!stored) {
      return undefined
    }
    if (stored.schemaVersion !== LISTENING_STORAGE_SCHEMA_VERSION) {
      throw new ListeningError(
        'session-recovery-invalid',
        'Stored listening record uses an unsupported schema version.',
      )
    }
    return restoreSession(stored.value, task)
  }

  save(session: ListeningSession): Promise<void> {
    return this.store.put(
      this.key(session.task.taskId),
      session,
      LISTENING_STORAGE_SCHEMA_VERSION,
    )
  }

  delete(taskId: string): Promise<void> {
    return this.store.delete(this.key(taskId))
  }
}
