import type {
  LearningEvent,
  LearningTask,
  StandardErrorTag,
} from '../../learning-engine/index.ts'
import { judgeListeningAnswer } from './answers.ts'
import { ListeningError } from './errors.ts'
import {
  LISTENING_SESSION_SCHEMA_VERSION,
  type ListeningAnswerFeedback,
  type ListeningPlaybackRate,
  type ListeningPlaybackState,
  type ListeningQuestion,
  type ListeningRepeatMode,
  type ListeningSession,
  type ListeningSessionFailure,
  type ListeningSessionResult,
  type ListeningTrainingUnit,
} from './types.ts'

function assertTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new ListeningError(
      'session-transition-invalid',
      `Invalid listening session timestamp: ${value}`,
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
  session: ListeningSession,
  now: string,
): Pick<ListeningSession, 'activeDurationSeconds' | 'lastActiveAt'> {
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
    task.domain !== 'listening' ||
    task.targetModuleId !== 'listening'
  ) {
    throw new ListeningError(
      'task-incompatible',
      'Listening sessions only accept listening v1 learning tasks.',
    )
  }
}

function assertQuestion(question: ListeningQuestion): void {
  if (
    question.segments.length === 0 ||
    !question.segments.some(
      (segment) => segment.id === question.primarySegmentId,
    ) ||
    question.playbackPolicy.allowedRates.length === 0 ||
    !['current-segment', 'all-segments'].includes(
      question.playbackPolicy.sequenceMode,
    )
  ) {
    throw new ListeningError(
      'content-invalid',
      `Listening question ${question.id} has invalid playback metadata.`,
    )
  }
  if (
    question.type !== 'keyword-dictation' &&
    !question.options.some(
      (option) => option.id === question.correctOptionId,
    )
  ) {
    throw new ListeningError(
      'content-invalid',
      `Listening question ${question.id} has no correct option.`,
    )
  }
  if (
    question.type === 'keyword-dictation' &&
    !question.acceptedAnswers.includes(question.standardAnswer)
  ) {
    throw new ListeningError(
      'content-invalid',
      `Listening question ${question.id} omits its standard answer.`,
    )
  }
}

function initialPlayback(
  question: ListeningQuestion,
): ListeningPlaybackState {
  const rate = question.playbackPolicy.allowedRates.includes(1)
    ? 1
    : question.playbackPolicy.allowedRates[0]
  return {
    status: 'idle',
    currentSegmentId: question.primarySegmentId,
    rate,
    repeatMode: 'none',
    playCounts: {},
    errorMessage: null,
  }
}

export function createListeningSession(
  task: LearningTask,
  unit: ListeningTrainingUnit,
  now: string,
): ListeningSession {
  assertTask(task)
  assertTimestamp(now)
  if (
    task.learningUnitId !== unit.learningUnitId ||
    task.contentRef !== unit.contentRef
  ) {
    throw new ListeningError(
      'task-incompatible',
      'Listening task and content unit identities do not match.',
    )
  }
  if (unit.questions.length === 0) {
    throw new ListeningError(
      'content-invalid',
      'A scored listening session requires at least one question.',
    )
  }
  unit.questions.forEach(assertQuestion)
  const question = unit.questions[0]
  return {
    schemaVersion: LISTENING_SESSION_SCHEMA_VERSION,
    task,
    transcript: unit.transcript,
    questions: unit.questions,
    questionIndex: 0,
    selectedOptionId: null,
    dictationInput: '',
    answers: [],
    phase: 'answering',
    pausedFromPhase: null,
    playback: initialPlayback(question),
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    lastActiveAt: now,
    updatedAt: now,
    pendingEvents: [],
    failure: null,
  }
}

export function createFailedListeningSession(
  task: LearningTask,
  failure: ListeningSessionFailure,
  now: string,
): ListeningSession {
  assertTask(task)
  assertTimestamp(now)
  return {
    schemaVersion: LISTENING_SESSION_SCHEMA_VERSION,
    task,
    transcript: [],
    questions: [],
    questionIndex: 0,
    selectedOptionId: null,
    dictationInput: '',
    answers: [],
    phase: 'error',
    pausedFromPhase: null,
    playback: {
      status: 'unavailable',
      currentSegmentId: '',
      rate: 1,
      repeatMode: 'none',
      playCounts: {},
      errorMessage: failure.message,
    },
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    lastActiveAt: null,
    updatedAt: now,
    pendingEvents: [],
    failure,
  }
}

export function getCurrentListeningQuestion(
  session: ListeningSession,
): ListeningQuestion | null {
  return session.questions[session.questionIndex] ?? null
}

export function selectListeningOption(
  session: ListeningSession,
  optionId: string,
  now: string,
): ListeningSession {
  const question = getCurrentListeningQuestion(session)
  if (
    session.phase !== 'answering' ||
    !question ||
    question.type === 'keyword-dictation'
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'A choice can only be selected on an active choice question.',
    )
  }
  if (!question.options.some((option) => option.id === optionId)) {
    throw new ListeningError(
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

export function changeListeningDictation(
  session: ListeningSession,
  value: string,
  now: string,
): ListeningSession {
  const question = getCurrentListeningQuestion(session)
  if (
    session.phase !== 'answering' ||
    question?.type !== 'keyword-dictation'
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'Dictation can only change on an active dictation question.',
    )
  }
  return {
    ...session,
    ...touchActiveSession(session, now),
    dictationInput: value,
    updatedAt: now,
  }
}

export function updateListeningPlayback(
  session: ListeningSession,
  playback: ListeningPlaybackState,
  now: string,
): ListeningSession {
  const question = getCurrentListeningQuestion(session)
  if (
    !question ||
    (session.phase !== 'answering' &&
      session.phase !== 'feedback' &&
      session.phase !== 'paused')
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'Playback state can only update during an active listening question.',
    )
  }
  if (
    !question.segments.some(
      (segment) => segment.id === playback.currentSegmentId,
    ) ||
    !question.playbackPolicy.allowedRates.includes(playback.rate) ||
    (!question.playbackPolicy.allowRepeat &&
      playback.repeatMode !== 'none')
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'Playback state violates the active question policy.',
    )
  }
  return {
    ...session,
    ...touchActiveSession(session, now),
    playback,
    updatedAt: now,
  }
}

function currentResponse(
  session: ListeningSession,
  question: ListeningQuestion,
): string {
  return question.type === 'keyword-dictation'
    ? session.dictationInput
    : (session.selectedOptionId ?? '')
}

export function canSubmitListeningAnswer(
  session: ListeningSession,
): boolean {
  const question = getCurrentListeningQuestion(session)
  if (!question || session.phase !== 'answering') {
    return false
  }
  const response = currentResponse(session, question)
  return (
    response.trim().length > 0 &&
    (session.playback.playCounts[question.primarySegmentId] ?? 0) > 0
  )
}

export function submitListeningAnswer(
  session: ListeningSession,
  now: string,
): ListeningSession {
  const question = getCurrentListeningQuestion(session)
  if (!question || !canSubmitListeningAnswer(session)) {
    throw new ListeningError(
      'session-transition-invalid',
      'Play the prompt and provide an answer before submitting.',
    )
  }
  if (
    session.answers.some((answer) => answer.questionId === question.id)
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'The active listening question was already submitted.',
    )
  }
  const response = currentResponse(session, question)
  const correct = judgeListeningAnswer(question, response)
  return {
    ...session,
    ...touchActiveSession(session, now),
    answers: [
      ...session.answers,
      {
        questionId: question.id,
        response,
        correct,
        submittedAt: now,
        playCount:
          session.playback.playCounts[question.primarySegmentId] ?? 0,
        rate: session.playback.rate,
        repeatMode: session.playback.repeatMode,
      },
    ],
    phase: 'feedback',
    playback: {
      ...session.playback,
      status:
        session.playback.status === 'playing'
          ? 'paused'
          : session.playback.status,
    },
    updatedAt: now,
  }
}

export function advanceListeningSession(
  session: ListeningSession,
  now: string,
): ListeningSession {
  if (session.phase !== 'feedback') {
    throw new ListeningError(
      'session-transition-invalid',
      'The listening session can advance only after feedback.',
    )
  }
  const activeTime = touchActiveSession(session, now)
  if (session.questionIndex + 1 >= session.questions.length) {
    return {
      ...session,
      ...activeTime,
      phase: 'completed',
      selectedOptionId: null,
      dictationInput: '',
      lastActiveAt: null,
      updatedAt: now,
    }
  }
  const nextQuestion = session.questions[session.questionIndex + 1]
  return {
    ...session,
    ...activeTime,
    questionIndex: session.questionIndex + 1,
    selectedOptionId: null,
    dictationInput: '',
    phase: 'answering',
    playback: initialPlayback(nextQuestion),
    updatedAt: now,
  }
}

export function pauseListeningSession(
  session: ListeningSession,
  now: string,
): ListeningSession {
  if (session.phase !== 'answering' && session.phase !== 'feedback') {
    throw new ListeningError(
      'session-transition-invalid',
      'Only an active listening session can be paused.',
    )
  }
  return {
    ...session,
    ...touchActiveSession(session, now),
    phase: 'paused',
    pausedFromPhase: session.phase,
    playback: {
      ...session.playback,
      status:
        session.playback.status === 'unavailable' ||
        session.playback.status === 'error'
          ? session.playback.status
          : 'paused',
    },
    lastActiveAt: null,
    updatedAt: now,
  }
}

export function resumeListeningSession(
  session: ListeningSession,
  now: string,
): ListeningSession {
  if (session.phase !== 'paused' || session.pausedFromPhase === null) {
    throw new ListeningError(
      'session-transition-invalid',
      'Only a paused listening session can resume.',
    )
  }
  return {
    ...session,
    phase: session.pausedFromPhase,
    pausedFromPhase: null,
    playback: {
      ...session.playback,
      status:
        session.playback.status === 'unavailable' ||
        session.playback.status === 'error'
          ? session.playback.status
          : 'idle',
    },
    lastActiveAt: now,
    updatedAt: now,
  }
}

export function failListeningSession(
  session: ListeningSession,
  failure: ListeningSessionFailure,
  now: string,
): ListeningSession {
  if (session.phase === 'completed' || session.phase === 'error') {
    throw new ListeningError(
      'session-transition-invalid',
      'A completed or failed listening session cannot fail again.',
    )
  }
  return {
    ...session,
    ...touchActiveSession(session, now),
    phase: 'error',
    pausedFromPhase: null,
    playback: {
      ...session.playback,
      status: 'error',
      errorMessage: failure.message,
    },
    lastActiveAt: null,
    failure,
    updatedAt: now,
  }
}

function answerAssistance(
  answer: ListeningSession['answers'][number],
): number {
  const replayAssistance = Math.min(
    0.35,
    Math.max(0, answer.playCount - 1) * 0.1,
  )
  const speedAssistance = answer.rate < 1 ? 0.25 : 0
  const repeatAssistance = answer.repeatMode === 'none' ? 0 : 0.15
  return Math.min(1, replayAssistance + speedAssistance + repeatAssistance)
}

export function getListeningSessionResult(
  session: ListeningSession,
): ListeningSessionResult {
  const correctCount = session.answers.filter((answer) => answer.correct).length
  const questionCount = session.questions.length
  const incorrectIds = new Set(
    session.answers
      .filter((answer) => !answer.correct)
      .map((answer) => answer.questionId),
  )
  const errorTags = new Set<StandardErrorTag>()
  for (const question of session.questions) {
    if (incorrectIds.has(question.id)) {
      errorTags.add(question.errorTag)
    }
  }
  const assistanceLevel =
    session.answers.length === 0
      ? 0
      : session.answers.reduce(
          (sum, answer) => sum + answerAssistance(answer),
          0,
        ) / session.answers.length
  return {
    correctCount,
    questionCount,
    performanceScore:
      questionCount === 0 ? 0 : correctCount / questionCount,
    assistanceLevel,
    errorTags: [...errorTags],
  }
}

export function getListeningAnswerFeedback(
  session: ListeningSession,
): ListeningAnswerFeedback | null {
  if (session.phase !== 'feedback') {
    return null
  }
  const question = getCurrentListeningQuestion(session)
  const answer = question
    ? session.answers.find((entry) => entry.questionId === question.id)
    : undefined
  if (!question || !answer) {
    return null
  }
  return {
    correct: answer.correct,
    title: answer.correct ? '听对了' : '再听一遍重点',
    description: answer.correct
      ? '答案与音频信息一致。'
      : '本题已记录，查看原文和解释后继续。',
    rationaleZh: question.rationaleZh,
  }
}

export function withPendingListeningEvent(
  session: ListeningSession,
  event: LearningEvent,
  now: string,
): ListeningSession {
  if (session.pendingEvents.some((entry) => entry.id === event.id)) {
    return session
  }
  return {
    ...session,
    pendingEvents: [...session.pendingEvents, event],
    updatedAt: now,
  }
}

export function withoutPendingListeningEvent(
  session: ListeningSession,
  eventId: string,
  now: string,
): ListeningSession {
  return {
    ...session,
    pendingEvents: session.pendingEvents.filter(
      (event) => event.id !== eventId,
    ),
    updatedAt: now,
  }
}

export function setListeningRate(
  session: ListeningSession,
  rate: ListeningPlaybackRate,
  now: string,
): ListeningSession {
  return updateListeningPlayback(
    session,
    { ...session.playback, rate },
    now,
  )
}

export function setListeningRepeatMode(
  session: ListeningSession,
  repeatMode: ListeningRepeatMode,
  now: string,
): ListeningSession {
  return updateListeningPlayback(
    session,
    { ...session.playback, repeatMode },
    now,
  )
}
