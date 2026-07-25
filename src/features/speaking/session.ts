import type { LearningEvent, LearningTask } from '../../learning-engine/index.ts'
import type {
  MicrophonePermissionState,
  NetworkStatus,
} from '../../platform/index.ts'
import { SpeakingError } from './errors.ts'
import type {
  SpeakingAnswerRecord,
  SpeakingFallbackReason,
  SpeakingRecognitionCapabilities,
  SpeakingRecognitionState,
  SpeakingRecorderState,
  SpeakingRecordingCapabilities,
  SpeakingSession,
  SpeakingSessionFailure,
  SpeakingSessionResult,
  SpeakingTextMatch,
  SpeakingTrainingUnit,
} from './types.ts'

function activeSecondsBetween(from: string, to: string): number {
  const elapsed = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 0
  }
  return Math.floor(elapsed / 1_000)
}

function touchActive(
  session: SpeakingSession,
  now: string,
): Pick<SpeakingSession, 'activeDurationSeconds' | 'lastActiveAt'> {
  if (
    session.lastActiveAt === null ||
    (session.phase !== 'practicing' &&
      session.phase !== 'feedback')
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
    task.domain !== 'speaking' ||
    task.targetModuleId !== 'speaking'
  ) {
    throw new SpeakingError(
      'task-incompatible',
      'Speaking session requires a speaking learning task.',
    )
  }
}

function initialRecorder(
  permission: MicrophonePermissionState,
  capabilities: SpeakingRecordingCapabilities,
): SpeakingRecorderState {
  if (!capabilities.supported || permission === 'unsupported') {
    return {
      status: 'unavailable',
      durationMs: 0,
      playbackAvailable: false,
      message: '当前浏览器不支持麦克风录音。',
    }
  }
  if (permission === 'granted') {
    return {
      status: 'ready',
      durationMs: 0,
      playbackAvailable: false,
      message: null,
    }
  }
  return {
    status: 'permission',
    durationMs: 0,
    playbackAvailable: false,
    message:
      permission === 'denied'
        ? '麦克风权限已被拒绝；可在 Safari 网站设置中重新允许。'
        : '开始录音时需要允许麦克风。',
  }
}

function initialRecognition(
  network: NetworkStatus,
  capabilities: SpeakingRecognitionCapabilities,
): SpeakingRecognitionState {
  if (network === 'offline') {
    return {
      status: 'unavailable',
      transcript: null,
      errorCode: 'network',
      message: '当前离线；仍可录音和回放，但不进行文本识别。',
    }
  }
  if (!capabilities.supported) {
    return {
      status: 'unavailable',
      transcript: null,
      errorCode: 'unavailable',
      message: '当前 Safari 未提供语音识别；仍可录音和回放。',
    }
  }
  return {
    status: 'idle',
    transcript: null,
    errorCode: null,
    message: null,
  }
}

export function createSpeakingSession(
  task: LearningTask,
  unit: SpeakingTrainingUnit,
  permission: MicrophonePermissionState,
  network: NetworkStatus,
  recordingCapabilities: SpeakingRecordingCapabilities,
  recognitionCapabilities: SpeakingRecognitionCapabilities,
  now: string,
): SpeakingSession {
  assertTask(task)
  if (
    task.learningUnitId !== unit.learningUnitId ||
    task.contentRef !== unit.contentRef
  ) {
    throw new SpeakingError(
      'task-incompatible',
      'Speaking task and content unit identities do not match.',
    )
  }
  if (unit.prompts.length === 0) {
    throw new SpeakingError(
      'content-invalid',
      'Speaking unit has no prompts.',
    )
  }
  return {
    schemaVersion: 1,
    task,
    unit,
    phase: 'practicing',
    pausedFromPhase: null,
    promptIndex: 0,
    answers: [],
    permission,
    network,
    recorder: initialRecorder(permission, recordingCapabilities),
    recognition: initialRecognition(network, recognitionCapabilities),
    retryCount: 0,
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    updatedAt: now,
    lastActiveAt: now,
    pendingEvents: [],
    failure: null,
  }
}

export function createFailedSpeakingSession(
  task: LearningTask,
  failure: SpeakingSessionFailure,
  now: string,
): SpeakingSession {
  assertTask(task)
  return {
    schemaVersion: 1,
    task,
    unit: null,
    phase: 'error',
    pausedFromPhase: null,
    promptIndex: 0,
    answers: [],
    permission: 'unknown',
    network: failure.category === 'network' ? 'offline' : 'online',
    recorder: {
      status: 'unavailable',
      durationMs: 0,
      playbackAvailable: false,
      message: failure.message,
    },
    recognition: {
      status: 'unavailable',
      transcript: null,
      errorCode: 'unavailable',
      message: failure.message,
    },
    retryCount: 0,
    activeDurationSeconds: 0,
    reportedDurationSeconds: 0,
    startedAt: now,
    updatedAt: now,
    lastActiveAt: null,
    pendingEvents: [],
    failure,
  }
}

export function getCurrentSpeakingPrompt(session: SpeakingSession) {
  return session.unit?.prompts[session.promptIndex]
}

function requirePracticing(session: SpeakingSession): void {
  if (session.phase !== 'practicing') {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session is not accepting a recording.',
    )
  }
}

export function beginSpeakingRecording(
  session: SpeakingSession,
  permission: MicrophonePermissionState,
  recognitionAvailable: boolean,
  now: string,
): SpeakingSession {
  requirePracticing(session)
  if (
    session.recorder.status === 'unavailable' ||
    session.recorder.status === 'recording' ||
    session.recorder.status === 'processing'
  ) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Recorder is not ready to start.',
    )
  }
  return {
    ...session,
    ...touchActive(session, now),
    permission,
    recorder: {
      status: 'recording',
      durationMs: 0,
      playbackAvailable: false,
      message: '正在录音。',
    },
    recognition: recognitionAvailable
      ? {
          status: 'listening',
          transcript: null,
          errorCode: null,
          message: '正在尝试识别文本。',
        }
      : session.recognition,
    updatedAt: now,
  }
}

export function processSpeakingRecording(
  session: SpeakingSession,
  now: string,
): SpeakingSession {
  requirePracticing(session)
  if (session.recorder.status !== 'recording') {
    throw new SpeakingError(
      'session-transition-invalid',
      'No active speaking recording can be stopped.',
    )
  }
  return {
    ...session,
    ...touchActive(session, now),
    recorder: {
      ...session.recorder,
      status: 'processing',
      message: '正在整理录音。',
    },
    recognition:
      session.recognition.status === 'listening'
        ? {
            ...session.recognition,
            status: 'processing',
            message: '正在等待识别文本。',
          }
        : session.recognition,
    updatedAt: now,
  }
}

interface SubmitRecordingInput {
  readonly durationMs: number
  readonly match: SpeakingTextMatch | null
  readonly fallbackReason: SpeakingFallbackReason | null
  readonly failureCategory:
    | 'device'
    | 'permission'
    | 'network'
    | 'interrupted'
    | null
  readonly recognitionErrorCode:
    | SpeakingRecognitionState['errorCode']
  readonly recognitionMessage: string | null
}

export function submitSpeakingRecording(
  session: SpeakingSession,
  input: SubmitRecordingInput,
  now: string,
): SpeakingSession {
  requirePracticing(session)
  const prompt = getCurrentSpeakingPrompt(session)
  if (!prompt) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session points to a missing prompt.',
    )
  }
  const answer: SpeakingAnswerRecord = {
    promptId: prompt.id,
    recorded: true,
    recordingDurationMs: Math.max(0, Math.floor(input.durationMs)),
    transcript: input.match?.transcript ?? null,
    match: input.match,
    fallbackReason: input.fallbackReason,
    failureCategory: input.failureCategory,
    retryCount: session.retryCount,
    submittedAt: now,
  }
  const answers = session.answers.filter(
    (candidate) => candidate.promptId !== prompt.id,
  )
  return {
    ...session,
    ...touchActive(session, now),
    phase: 'feedback',
    answers: [...answers, answer],
    recorder: {
      status: 'review',
      durationMs: answer.recordingDurationMs,
      playbackAvailable: true,
      message:
        input.match === null
          ? '录音已保留。请回放自查；本次不提供文本接近度。'
          : '录音已保留，可随时回放。',
    },
    recognition:
      input.match === null
        ? {
            status: 'unavailable',
            transcript: null,
            errorCode: input.recognitionErrorCode,
            message: input.recognitionMessage,
          }
        : {
            status: 'recognized',
            transcript: input.match.transcript,
            errorCode: null,
            message: null,
          },
    updatedAt: now,
  }
}

export function markSpeakingCaptureUnavailable(
  session: SpeakingSession,
  permission: MicrophonePermissionState,
  reason: SpeakingFallbackReason,
  message: string,
  now: string,
): SpeakingSession {
  requirePracticing(session)
  return {
    ...session,
    ...touchActive(session, now),
    permission,
    recorder: {
      status:
        reason === 'permission-denied' ||
        reason === 'recording-unsupported'
          ? 'unavailable'
          : 'error',
      durationMs: 0,
      playbackAvailable: false,
      message,
    },
    recognition: {
      status: 'unavailable',
      transcript: null,
      errorCode:
        reason === 'permission-denied'
          ? 'not-allowed'
          : 'unavailable',
      message,
    },
    updatedAt: now,
  }
}

export function submitSpeakingWithoutRecording(
  session: SpeakingSession,
  reason: SpeakingFallbackReason,
  failureCategory:
    | 'device'
    | 'permission'
    | 'network'
    | 'interrupted',
  now: string,
): SpeakingSession {
  requirePracticing(session)
  if (
    session.recorder.status !== 'unavailable' &&
    session.recorder.status !== 'error'
  ) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Recording is still available for this speaking prompt.',
    )
  }
  const prompt = getCurrentSpeakingPrompt(session)
  if (!prompt) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session points to a missing prompt.',
    )
  }
  const answer: SpeakingAnswerRecord = {
    promptId: prompt.id,
    recorded: false,
    recordingDurationMs: 0,
    transcript: null,
    match: null,
    fallbackReason: reason,
    failureCategory,
    retryCount: session.retryCount,
    submittedAt: now,
  }
  return {
    ...session,
    ...touchActive(session, now),
    phase: 'feedback',
    answers: [
      ...session.answers.filter(
        (candidate) => candidate.promptId !== prompt.id,
      ),
      answer,
    ],
    recorder: {
      ...session.recorder,
      playbackAvailable: false,
    },
    updatedAt: now,
  }
}

export function retrySpeakingPrompt(
  session: SpeakingSession,
  recordingCapabilities: SpeakingRecordingCapabilities,
  recognitionCapabilities: SpeakingRecognitionCapabilities,
  now: string,
): SpeakingSession {
  if (session.phase !== 'feedback') {
    throw new SpeakingError(
      'session-transition-invalid',
      'Only a reviewed speaking prompt can be retried.',
    )
  }
  const prompt = getCurrentSpeakingPrompt(session)
  if (!prompt) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session points to a missing prompt.',
    )
  }
  return {
    ...session,
    ...touchActive(session, now),
    phase: 'practicing',
    answers: session.answers.filter(
      (answer) => answer.promptId !== prompt.id,
    ),
    recorder: initialRecorder(
      session.permission,
      recordingCapabilities,
    ),
    recognition: initialRecognition(
      session.network,
      recognitionCapabilities,
    ),
    retryCount: session.retryCount + 1,
    updatedAt: now,
  }
}

export function advanceSpeakingSession(
  session: SpeakingSession,
  recordingCapabilities: SpeakingRecordingCapabilities,
  recognitionCapabilities: SpeakingRecognitionCapabilities,
  now: string,
): SpeakingSession {
  if (session.phase !== 'feedback' || !session.unit) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session has no reviewed prompt to advance.',
    )
  }
  const active = touchActive(session, now)
  if (session.promptIndex + 1 >= session.unit.prompts.length) {
    return {
      ...session,
      ...active,
      phase: 'completed',
      pausedFromPhase: null,
      recorder: {
        status: 'ready',
        durationMs: 0,
        playbackAvailable: false,
        message: null,
      },
      recognition: initialRecognition(
        session.network,
        recognitionCapabilities,
      ),
      lastActiveAt: null,
      updatedAt: now,
    }
  }
  return {
    ...session,
    ...active,
    phase: 'practicing',
    promptIndex: session.promptIndex + 1,
    recorder: initialRecorder(
      session.permission,
      recordingCapabilities,
    ),
    recognition: initialRecognition(
      session.network,
      recognitionCapabilities,
    ),
    retryCount: 0,
    updatedAt: now,
  }
}

export function pauseSpeakingSession(
  session: SpeakingSession,
  now: string,
): SpeakingSession {
  if (
    session.phase !== 'practicing' &&
    session.phase !== 'feedback'
  ) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session cannot be paused from its current phase.',
    )
  }
  const active = touchActive(session, now)
  return {
    ...session,
    ...active,
    phase: 'paused',
    pausedFromPhase: session.phase,
    recorder: {
      status:
        session.recorder.status === 'unavailable'
          ? 'unavailable'
          : 'ready',
      durationMs: 0,
      playbackAvailable: false,
      message:
        session.recorder.status === 'unavailable'
          ? session.recorder.message
          : '训练已暂停；活动录音不会在后台保留。',
    },
    recognition: {
      ...session.recognition,
      status:
        session.recognition.status === 'unavailable'
          ? 'unavailable'
          : 'idle',
      transcript: null,
    },
    lastActiveAt: null,
    updatedAt: now,
  }
}

export function resumeSpeakingSession(
  session: SpeakingSession,
  recordingCapabilities: SpeakingRecordingCapabilities,
  recognitionCapabilities: SpeakingRecognitionCapabilities,
  now: string,
): SpeakingSession {
  if (session.phase !== 'paused' || session.pausedFromPhase === null) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Speaking session is not paused.',
    )
  }
  const resumePhase = session.pausedFromPhase
  return {
    ...session,
    phase: resumePhase,
    pausedFromPhase: null,
    recorder:
      resumePhase === 'feedback'
        ? {
            status: 'review',
            durationMs: 0,
            playbackAvailable: false,
            message: '页面恢复后旧录音不再保留；可继续或重新录音。',
          }
        : initialRecorder(
            session.permission,
            recordingCapabilities,
          ),
    recognition: initialRecognition(
      session.network,
      recognitionCapabilities,
    ),
    lastActiveAt: now,
    updatedAt: now,
  }
}

export function refreshSpeakingEnvironment(
  session: SpeakingSession,
  permission: MicrophonePermissionState,
  network: NetworkStatus,
  recordingCapabilities: SpeakingRecordingCapabilities,
  recognitionCapabilities: SpeakingRecognitionCapabilities,
  now: string,
): SpeakingSession {
  if (
    session.phase === 'completed' ||
    session.phase === 'error'
  ) {
    return {
      ...session,
      permission,
      network,
      updatedAt: now,
    }
  }
  const activePhase =
    session.phase === 'paused'
      ? session.pausedFromPhase ?? 'practicing'
      : session.phase
  return {
    ...session,
    permission,
    network,
    recorder:
      activePhase === 'feedback'
        ? {
            status: 'review',
            durationMs: session.recorder.durationMs,
            playbackAvailable: false,
            message: '旧录音不会跨页面恢复；可继续或重新录音。',
          }
        : initialRecorder(permission, recordingCapabilities),
    recognition: initialRecognition(
      network,
      recognitionCapabilities,
    ),
    updatedAt: now,
  }
}

export function withPendingSpeakingEvent(
  session: SpeakingSession,
  event: LearningEvent,
  now: string,
): SpeakingSession {
  if (session.pendingEvents.some((pending) => pending.id === event.id)) {
    return session
  }
  return {
    ...session,
    pendingEvents: [...session.pendingEvents, event],
    updatedAt: now,
  }
}

export function withoutPendingSpeakingEvent(
  session: SpeakingSession,
  eventId: string,
  now: string,
): SpeakingSession {
  return {
    ...session,
    pendingEvents: session.pendingEvents.filter(
      (event) => event.id !== eventId,
    ),
    updatedAt: now,
  }
}

const matchScores = {
  match: 1,
  close: 0.8,
  partial: 0.4,
  different: 0,
} as const

function failureCategory(
  answers: readonly SpeakingAnswerRecord[],
): SpeakingSessionResult['failureCategory'] {
  const categories = answers
    .map((answer) => answer.failureCategory)
    .filter((category) => category !== null)
  for (const category of [
    'permission',
    'network',
    'interrupted',
    'device',
  ] as const) {
    if (categories.includes(category)) {
      return category
    }
  }
  return null
}

export function getSpeakingSessionResult(
  session: SpeakingSession,
): SpeakingSessionResult {
  if (!session.unit) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Failed speaking sessions have no scored result.',
    )
  }
  const recognized = session.answers.filter(
    (answer) => answer.match !== null,
  )
  const performanceScore =
    recognized.length === 0
      ? null
      : recognized.reduce(
          (sum, answer) =>
            sum + matchScores[answer.match?.level ?? 'different'],
          0,
        ) / recognized.length
  const hasLowMatch = recognized.some(
    (answer) =>
      answer.match?.level === 'partial' ||
      answer.match?.level === 'different',
  )
  const retries = session.answers.reduce(
    (sum, answer) => sum + answer.retryCount,
    0,
  )
  return {
    promptCount: session.unit.prompts.length,
    recognizedCount: recognized.length,
    unscorableCount: session.answers.length - recognized.length,
    performanceScore:
      performanceScore === null
        ? null
        : Number(performanceScore.toFixed(4)),
    evidenceQuality: Number(
      (
        (recognized.length / session.unit.prompts.length) *
        0.75
      ).toFixed(4),
    ),
    assistanceLevel: Number(
      Math.min(
        1,
        0.25 + retries / Math.max(1, session.unit.prompts.length) * 0.2,
      ).toFixed(4),
    ),
    errorTags: hasLowMatch ? ['other'] : [],
    failureCategory: failureCategory(session.answers),
  }
}
