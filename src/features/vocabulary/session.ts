import type { LearningTask, StandardErrorTag } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import { judgeVocabularyAnswer } from './questions.ts'
import {
  VOCABULARY_SESSION_SCHEMA_VERSION,
  type VocabularyAnswerFeedback,
  type VocabularyQuestion,
  type VocabularySession,
  type VocabularySessionFailure,
  type VocabularySessionResult,
  type VocabularyStreamState,
} from './types.ts'

function assertTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new VocabularyError(
      'session-transition-invalid',
      `Invalid session timestamp: ${value}`,
    )
  }
  return timestamp
}

function activeSecondsBetween(start: string, end: string): number {
  return Math.max(
    0,
    Math.floor((assertTimestamp(end) - assertTimestamp(start)) / 1_000),
  )
}

function touchActiveSession(
  session: VocabularySession,
  now: string,
): Pick<VocabularySession, 'activeDurationSeconds' | 'lastActiveAt'> {
  if (
    session.lastActiveAt === null ||
    (session.phase !== 'answering' && session.phase !== 'feedback')
  ) {
    return {
      activeDurationSeconds: session.activeDurationSeconds,
      lastActiveAt: session.lastActiveAt,
    }
  }

  return {
    activeDurationSeconds:
      session.activeDurationSeconds +
      activeSecondsBetween(session.lastActiveAt, now),
    lastActiveAt: now,
  }
}

function assertTask(task: LearningTask): void {
  if (
    task.schemaVersion !== 1 ||
    task.domain !== 'vocabulary' ||
    task.targetModuleId !== 'vocabulary'
  ) {
    throw new VocabularyError(
      'task-incompatible',
      'Vocabulary sessions only accept vocabulary v1 learning tasks.',
    )
  }
}

export function createVocabularySession(
  task: LearningTask,
  questions: readonly VocabularyQuestion[],
  now: string,
): VocabularySession {
  assertTask(task)
  assertTimestamp(now)
  if (questions.length === 0) {
    throw new VocabularyError(
      'content-invalid',
      'A scored vocabulary session requires at least one question.',
    )
  }

  return {
    schemaVersion: VOCABULARY_SESSION_SCHEMA_VERSION,
    task,
    questions,
    questionIndex: 0,
    selectedOptionId: null,
    answers: [],
    phase: 'answering',
    pausedFromPhase: null,
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    lastActiveAt: now,
    updatedAt: now,
    pendingEvents: [],
    failure: null,
    stream: null,
  }
}

export function createFailedVocabularySession(
  task: LearningTask,
  failure: VocabularySessionFailure,
  now: string,
): VocabularySession {
  assertTask(task)
  assertTimestamp(now)
  return {
    schemaVersion: VOCABULARY_SESSION_SCHEMA_VERSION,
    task,
    questions: [],
    questionIndex: 0,
    selectedOptionId: null,
    answers: [],
    phase: 'error',
    pausedFromPhase: null,
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    lastActiveAt: null,
    updatedAt: now,
    pendingEvents: [],
    failure,
    stream: null,
  }
}

export function replaceVocabularyStreamQuestion(
  session: VocabularySession,
  question: VocabularyQuestion,
  stream: VocabularyStreamState,
  now: string,
): VocabularySession {
  return {
    ...session,
    questions: [question],
    questionIndex: 0,
    selectedOptionId: null,
    answers: [],
    phase: 'answering',
    pausedFromPhase: null,
    lastActiveAt: now,
    updatedAt: now,
    stream,
    failure: null,
  }
}

export function completeVocabularyStreamSession(
  session: VocabularySession,
  stream: VocabularyStreamState,
  now: string,
): VocabularySession {
  return {
    ...session,
    phase: 'completed',
    selectedOptionId: null,
    lastActiveAt: null,
    updatedAt: now,
    stream,
  }
}

export function getCurrentVocabularyQuestion(
  session: VocabularySession,
): VocabularyQuestion | null {
  return session.questions[session.questionIndex] ?? null
}

export function selectVocabularyOption(
  session: VocabularySession,
  optionId: string,
  now: string,
): VocabularySession {
  if (session.phase !== 'answering') {
    throw new VocabularyError(
      'session-transition-invalid',
      'Options can only be selected while answering.',
    )
  }
  const question = getCurrentVocabularyQuestion(session)
  if (!question) {
    throw new VocabularyError(
      'session-transition-invalid',
      'The session has no active question.',
    )
  }
  if (!question.options.some((option) => option.id === optionId)) {
    throw new VocabularyError(
      'session-transition-invalid',
      `Option ${optionId} does not belong to the active question.`,
    )
  }

  return {
    ...session,
    ...touchActiveSession(session, now),
    selectedOptionId: optionId,
    updatedAt: now,
  }
}

export function submitVocabularyAnswer(
  session: VocabularySession,
  now: string,
): VocabularySession {
  if (session.phase !== 'answering' || session.selectedOptionId === null) {
    throw new VocabularyError(
      'session-transition-invalid',
      'Select an answer before submitting.',
    )
  }
  const question = getCurrentVocabularyQuestion(session)
  if (!question) {
    throw new VocabularyError(
      'session-transition-invalid',
      'The session has no active question.',
    )
  }
  if (session.answers.some((answer) => answer.questionId === question.id)) {
    throw new VocabularyError(
      'session-transition-invalid',
      'The active question was already submitted.',
    )
  }

  const correct = judgeVocabularyAnswer(question, session.selectedOptionId)
  return {
    ...session,
    ...touchActiveSession(session, now),
    answers: [
      ...session.answers,
      {
        questionId: question.id,
        selectedOptionId: session.selectedOptionId,
        correct,
        submittedAt: now,
      },
    ],
    phase: 'feedback',
    updatedAt: now,
  }
}

export function advanceVocabularySession(
  session: VocabularySession,
  now: string,
): VocabularySession {
  if (session.phase !== 'feedback') {
    throw new VocabularyError(
      'session-transition-invalid',
      'The session can advance only after feedback.',
    )
  }

  const activeTime = touchActiveSession(session, now)
  if (session.questionIndex + 1 >= session.questions.length) {
    return {
      ...session,
      ...activeTime,
      phase: 'completed',
      selectedOptionId: null,
      lastActiveAt: null,
      updatedAt: now,
    }
  }

  return {
    ...session,
    ...activeTime,
    questionIndex: session.questionIndex + 1,
    selectedOptionId: null,
    phase: 'answering',
    updatedAt: now,
  }
}

export function pauseVocabularySession(
  session: VocabularySession,
  now: string,
): VocabularySession {
  if (session.phase !== 'answering' && session.phase !== 'feedback') {
    throw new VocabularyError(
      'session-transition-invalid',
      'Only an active vocabulary session can be paused.',
    )
  }
  const activeTime = touchActiveSession(session, now)
  return {
    ...session,
    ...activeTime,
    phase: 'paused',
    pausedFromPhase: session.phase,
    lastActiveAt: null,
    updatedAt: now,
  }
}

export function resumeVocabularySession(
  session: VocabularySession,
  now: string,
): VocabularySession {
  if (session.phase !== 'paused' || session.pausedFromPhase === null) {
    throw new VocabularyError(
      'session-transition-invalid',
      'Only a paused vocabulary session can resume.',
    )
  }
  return {
    ...session,
    phase: session.pausedFromPhase,
    pausedFromPhase: null,
    lastActiveAt: now,
    updatedAt: now,
  }
}

export function failVocabularySession(
  session: VocabularySession,
  failure: VocabularySessionFailure,
  now: string,
): VocabularySession {
  if (
    session.phase === 'completed' ||
    session.phase === 'error'
  ) {
    throw new VocabularyError(
      'session-transition-invalid',
      'A completed or failed vocabulary session cannot fail again.',
    )
  }
  const activeTime = touchActiveSession(session, now)
  return {
    ...session,
    ...activeTime,
    phase: 'error',
    pausedFromPhase: null,
    lastActiveAt: null,
    failure,
    updatedAt: now,
  }
}

export function getVocabularySessionResult(
  session: VocabularySession,
): VocabularySessionResult {
  const correctCount = session.answers.filter((answer) => answer.correct).length
  const questionCount = session.questions.length
  const incorrectQuestionIds = new Set(
    session.answers
      .filter((answer) => !answer.correct)
      .map((answer) => answer.questionId),
  )
  const errorTags = new Set<StandardErrorTag>()

  for (const question of session.questions) {
    if (incorrectQuestionIds.has(question.id)) {
      errorTags.add(question.errorTag)
    }
  }

  return {
    correctCount,
    questionCount,
    performanceScore:
      questionCount === 0 ? 0 : correctCount / questionCount,
    errorTags: [...errorTags],
  }
}

export function getVocabularyAnswerFeedback(
  session: VocabularySession,
): VocabularyAnswerFeedback | null {
  if (session.phase !== 'feedback') {
    return null
  }
  const question = getCurrentVocabularyQuestion(session)
  const answer = question
    ? session.answers.find((entry) => entry.questionId === question.id)
    : undefined
  if (!question || !answer) {
    throw new VocabularyError(
      'session-transition-invalid',
      'Feedback requires a submitted answer for the active question.',
    )
  }
  const correctOption = question.options.find(
    (option) => option.id === question.correctOptionId,
  )
  if (!correctOption) {
    throw new VocabularyError(
      'content-invalid',
      'The correct option is missing from the active question.',
    )
  }

  return {
    correct: answer.correct,
    title: answer.correct ? '回答正确' : '需要再看一次',
    description: answer.correct
      ? '这个表达已完成一次正确提取。'
      : `正确答案：${correctOption.label}`,
    exampleEn: question.exampleEn,
    explanationZh: question.explanationZh,
  }
}

export function withPendingVocabularyEvent(
  session: VocabularySession,
  event: VocabularySession['pendingEvents'][number],
  now: string,
): VocabularySession {
  if (session.pendingEvents.some((candidate) => candidate.id === event.id)) {
    return session
  }
  return {
    ...session,
    pendingEvents: [...session.pendingEvents, event],
    updatedAt: now,
  }
}

export function withoutPendingVocabularyEvent(
  session: VocabularySession,
  eventId: string,
  now: string,
): VocabularySession {
  return {
    ...session,
    pendingEvents: session.pendingEvents.filter(
      (event) => event.id !== eventId,
    ),
    updatedAt: now,
  }
}
