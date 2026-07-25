import type {
  PlatformEventSink,
  ReadonlyDataSource,
} from '../../core/index.ts'
import type {
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskSkippedEvent,
} from '../../learning-engine/index.ts'
import {
  browserMicrophonePermission,
  browserNetworkStatus,
  type MicrophonePermissionService,
  type MicrophonePermissionState,
  type NetworkStatusService,
} from '../../platform/index.ts'
import { resolveSpeakingTask } from './content.ts'
import {
  createSpeakingCompletedEvent,
  createSpeakingTaskPausedEvent,
  createSpeakingTaskSkippedEvent,
  createSpeakingTaskStartedEvent,
  createSpeakingUnscorableEvent,
} from './events.ts'
import { SpeakingError, toSpeakingError } from './errors.ts'
import { matchSpeakingText } from './matching.ts'
import {
  browserSpeakingRecognition,
} from './recognition.ts'
import {
  browserSpeakingRecorder,
} from './recording.ts'
import { SpeakingSessionRepository } from './repository.ts'
import {
  advanceSpeakingSession,
  beginSpeakingRecording,
  createFailedSpeakingSession,
  createSpeakingSession,
  getCurrentSpeakingPrompt,
  getSpeakingSessionResult,
  markSpeakingCaptureUnavailable,
  pauseSpeakingSession,
  processSpeakingRecording,
  refreshSpeakingEnvironment,
  resumeSpeakingSession,
  retrySpeakingPrompt,
  submitSpeakingRecording,
  submitSpeakingWithoutRecording,
  withPendingSpeakingEvent,
  withoutPendingSpeakingEvent,
} from './session.ts'
import type {
  SpeakingCatalog,
  SpeakingFallbackReason,
  SpeakingRecognitionErrorCode,
  SpeakingRecognitionHandle,
  SpeakingRecognitionOutcome,
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingPort,
  SpeakingSession,
  SpeakingSessionFailure,
  SpeakingTextMatch,
} from './types.ts'

type TaskPauseReason = LearningTaskPausedEvent['payload']['reason']
type TaskSkipReason = LearningTaskSkippedEvent['payload']['reason']
type SessionListener = (session: SpeakingSession) => void

export interface SpeakingTrainingRuntimeOptions {
  readonly task: LearningTask
  readonly localDate: string
  readonly contentSource: ReadonlyDataSource<SpeakingCatalog>
  readonly eventSink: PlatformEventSink
  readonly repository?: SpeakingSessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly microphonePermission?: MicrophonePermissionService
  readonly recorder?: SpeakingRecordingPort
  readonly recognition?: SpeakingRecognitionPort
  readonly now?: () => string
  readonly createId?: () => string
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function permissionFrom(error: unknown): MicrophonePermissionState {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' ||
      error.name === 'SecurityError')
  ) {
    return 'denied'
  }
  if (
    error instanceof Error &&
    'cause' in error &&
    error.cause instanceof DOMException &&
    (error.cause.name === 'NotAllowedError' ||
      error.cause.name === 'SecurityError')
  ) {
    return 'denied'
  }
  return 'unknown'
}

function recognitionFailure(
  code: SpeakingRecognitionErrorCode,
): {
  readonly reason: SpeakingFallbackReason
  readonly category: 'device' | 'permission' | 'network' | 'interrupted'
} {
  if (code === 'network') {
    return {
      reason: 'recognition-network',
      category: 'network',
    }
  }
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return {
      reason: 'recognition-denied',
      category: 'permission',
    }
  }
  if (code === 'aborted') {
    return {
      reason: 'interrupted',
      category: 'interrupted',
    }
  }
  if (code === 'no-speech') {
    return {
      reason: 'recognition-no-speech',
      category: 'device',
    }
  }
  if (code === 'unavailable') {
    return {
      reason: 'recognition-unsupported',
      category: 'device',
    }
  }
  return {
    reason: 'recognition-failed',
    category: 'device',
  }
}

function bestMatch(
  outcome: Extract<
    SpeakingRecognitionOutcome,
    { readonly status: 'recognized' }
  >,
  acceptedAnswers: readonly string[],
): SpeakingTextMatch {
  const candidates = [
    outcome.transcript,
    ...outcome.alternatives.filter(
      (candidate) => candidate !== outcome.transcript,
    ),
  ]
  return candidates
    .map((candidate) =>
      matchSpeakingText(candidate, acceptedAnswers),
    )
    .reduce((best, candidate) =>
      candidate.similarity > best.similarity ? candidate : best,
    )
}

export class SpeakingTrainingRuntime {
  private readonly task: LearningTask
  private readonly localDate: string
  private readonly contentSource: ReadonlyDataSource<SpeakingCatalog>
  private readonly eventSink: PlatformEventSink
  private readonly repository: SpeakingSessionRepository
  private readonly networkStatus: NetworkStatusService
  private readonly microphonePermission: MicrophonePermissionService
  private readonly recorder: SpeakingRecordingPort
  private readonly recognition: SpeakingRecognitionPort
  private readonly now: () => string
  private readonly createId: () => string
  private readonly listeners = new Set<SessionListener>()
  private session: SpeakingSession | null = null
  private recording: SpeakingRecording | null = null
  private recognitionHandle: SpeakingRecognitionHandle | null = null
  private initializing: Promise<SpeakingSession> | null = null

  constructor(options: SpeakingTrainingRuntimeOptions) {
    this.task = options.task
    this.localDate = options.localDate
    this.contentSource = options.contentSource
    this.eventSink = options.eventSink
    this.repository =
      options.repository ?? new SpeakingSessionRepository()
    this.networkStatus = options.networkStatus ?? browserNetworkStatus
    this.microphonePermission =
      options.microphonePermission ?? browserMicrophonePermission
    this.recorder = options.recorder ?? browserSpeakingRecorder
    this.recognition =
      options.recognition ?? browserSpeakingRecognition
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? defaultId
  }

  get currentSession(): SpeakingSession | null {
    return this.session
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(session: SpeakingSession): void {
    for (const listener of this.listeners) {
      listener(session)
    }
  }

  private identity(now: string) {
    return {
      eventId: `speaking:${this.task.taskId}:${this.createId()}`,
      occurredAt: now,
      localDate: this.localDate,
    }
  }

  private async save(session: SpeakingSession): Promise<SpeakingSession> {
    this.session = session
    await this.repository.save(session)
    this.notify(session)
    return session
  }

  private requireSession(): SpeakingSession {
    if (!this.session) {
      throw new SpeakingError(
        'session-transition-invalid',
        'Speaking runtime has not been initialized.',
      )
    }
    return this.session
  }

  private async flushPendingEvents(): Promise<SpeakingSession> {
    let session = this.requireSession()
    while (session.pendingEvents.length > 0) {
      const event = session.pendingEvents[0]
      await this.eventSink.publish(event)
      session = withoutPendingSpeakingEvent(
        session,
        event.id,
        this.now(),
      )
      await this.save(session)
    }
    return session
  }

  private async permissionState(): Promise<MicrophonePermissionState> {
    try {
      return await this.microphonePermission.query()
    } catch {
      return 'unknown'
    }
  }

  private failureFor(error: unknown): SpeakingSessionFailure {
    const speakingError = toSpeakingError(error)
    if (
      speakingError.code === 'content-unavailable' &&
      this.networkStatus.current() === 'offline'
    ) {
      return {
        category: 'network',
        message: '当前离线，且口语课程尚未完整下载。',
      }
    }
    return {
      category: 'content',
      message: speakingError.message,
    }
  }

  private async startFresh(): Promise<SpeakingSession> {
    const now = this.now()
    const startedEvent = createSpeakingTaskStartedEvent(
      this.task,
      this.identity(now),
    )
    let session: SpeakingSession
    try {
      const [catalog, permission] = await Promise.all([
        this.contentSource.load(),
        this.permissionState(),
      ])
      const unit = resolveSpeakingTask(catalog, this.task)
      session = createSpeakingSession(
        this.task,
        unit,
        permission,
        this.networkStatus.current(),
        this.recorder.capabilities(),
        this.recognition.capabilities(),
        now,
      )
      session = withPendingSpeakingEvent(session, startedEvent, now)
    } catch (error) {
      const failure = this.failureFor(error)
      session = createFailedSpeakingSession(this.task, failure, now)
      session = withPendingSpeakingEvent(session, startedEvent, now)
      session = withPendingSpeakingEvent(
        session,
        createSpeakingTaskPausedEvent(
          this.task,
          'content-failure',
          0,
          this.identity(now),
        ),
        now,
      )
    }
    await this.save(session)
    return this.flushPendingEvents()
  }

  private async initializeInternal(): Promise<SpeakingSession> {
    const stored = await this.repository.load(this.task)
    if (!stored) {
      return this.startFresh()
    }
    const refreshed = refreshSpeakingEnvironment(
      stored,
      await this.permissionState(),
      this.networkStatus.current(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    await this.save(refreshed)
    return this.flushPendingEvents()
  }

  initialize(): Promise<SpeakingSession> {
    if (this.initializing) {
      return this.initializing
    }
    const initialization = this.initializeInternal()
    this.initializing = initialization
    void initialization.finally(() => {
      if (this.initializing === initialization) {
        this.initializing = null
      }
    }).catch(() => undefined)
    return initialization
  }

  private discardRecording(): void {
    if (this.recording) {
      this.recorder.discard(this.recording)
      this.recording = null
    }
  }

  async startRecording(): Promise<SpeakingSession> {
    let session = this.requireSession()
    if (session.phase === 'feedback') {
      this.discardRecording()
      session = retrySpeakingPrompt(
        session,
        this.recorder.capabilities(),
        this.recognition.capabilities(),
        this.now(),
      )
      await this.save(session)
    }
    if (session.phase !== 'practicing') {
      throw new SpeakingError(
        'session-transition-invalid',
        'Speaking session is not ready to record.',
      )
    }

    const network = this.networkStatus.current()
    session = refreshSpeakingEnvironment(
      session,
      session.permission,
      network,
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    await this.save(session)

    let stream: MediaStream
    try {
      stream = await this.microphonePermission.request()
    } catch (error) {
      const permission = permissionFrom(error)
      const permissionDenied = permission === 'denied'
      const unavailable = markSpeakingCaptureUnavailable(
        session,
        permission,
        permissionDenied
          ? 'permission-denied'
          : 'recording-failed',
        permissionDenied
          ? '麦克风权限被拒绝。没有音频就无法提供录音回放。'
          : '无法访问麦克风。没有音频就无法提供录音回放。',
        this.now(),
      )
      return this.save(unavailable)
    }

    const recognitionAvailable =
      network === 'online' &&
      this.recognition.capabilities().supported
    try {
      this.recorder.start(stream)
      this.recognitionHandle = recognitionAvailable
        ? this.recognition.start('en-US')
        : null
      const recordingSession = beginSpeakingRecording(
        session,
        'granted',
        recognitionAvailable,
        this.now(),
      )
      return this.save(recordingSession)
    } catch (error) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      const failed = markSpeakingCaptureUnavailable(
        session,
        'granted',
        'recording-failed',
        toSpeakingError(error).message,
        this.now(),
      )
      return this.save(failed)
    }
  }

  private fallbackWithoutRecognition(
    session: SpeakingSession,
  ): SpeakingRecognitionOutcome {
    if (session.network === 'offline') {
      return {
        status: 'failed',
        code: 'network',
        message: '当前离线；请回放录音自查。',
      }
    }
    return {
      status: 'failed',
      code: 'unavailable',
      message: 'Siri 语音识别不可用；请回放录音自查。',
    }
  }

  async stopRecording(): Promise<SpeakingSession> {
    let session = this.requireSession()
    session = processSpeakingRecording(session, this.now())
    await this.save(session)

    const handle = this.recognitionHandle
    const recognitionResult = handle?.result
    handle?.stop()
    let recording: SpeakingRecording
    try {
      recording = await this.recorder.stop()
    } catch (error) {
      handle?.abort()
      this.recognitionHandle = null
      const failed = markSpeakingCaptureUnavailable(
        session,
        'granted',
        'recording-failed',
        toSpeakingError(error).message,
        this.now(),
      )
      const reviewed = submitSpeakingWithoutRecording(
        failed,
        'recording-failed',
        'device',
        this.now(),
      )
      return this.save(reviewed)
    }
    this.recording = recording
    this.recognitionHandle = null

    const outcome = recognitionResult
      ? await recognitionResult
      : this.fallbackWithoutRecognition(session)
    const prompt = getCurrentSpeakingPrompt(session)
    if (!prompt) {
      throw new SpeakingError(
        'session-transition-invalid',
        'Speaking session points to a missing prompt.',
      )
    }
    if (outcome.status === 'recognized') {
      const reviewed = submitSpeakingRecording(
        session,
        {
          durationMs: recording.durationMs,
          match: bestMatch(outcome, prompt.acceptedAnswers),
          fallbackReason: null,
          failureCategory: null,
          recognitionErrorCode: null,
          recognitionMessage: null,
        },
        this.now(),
      )
      return this.save(reviewed)
    }

    const fallback = recognitionFailure(outcome.code)
    const reviewed = submitSpeakingRecording(
      session,
      {
        durationMs: recording.durationMs,
        match: null,
        fallbackReason: fallback.reason,
        failureCategory: fallback.category,
        recognitionErrorCode: outcome.code,
        recognitionMessage: outcome.message,
      },
      this.now(),
    )
    return this.save(reviewed)
  }

  async playRecording(): Promise<SpeakingSession> {
    const session = this.requireSession()
    if (!this.recording || !session.recorder.playbackAvailable) {
      throw new SpeakingError(
        'playback-failed',
        'No in-memory speaking recording is available to play.',
      )
    }
    const playing = {
      ...session,
      recorder: {
        ...session.recorder,
        status: 'processing' as const,
        message: '正在播放你的录音。',
      },
      updatedAt: this.now(),
    }
    await this.save(playing)
    try {
      await this.recorder.play(this.recording)
      return this.save({
        ...playing,
        recorder: {
          ...playing.recorder,
          status: 'review',
          message: '录音播放完毕。',
        },
        updatedAt: this.now(),
      })
    } catch (error) {
      return this.save({
        ...playing,
        recorder: {
          ...playing.recorder,
          status: 'error',
          playbackAvailable: true,
          message: toSpeakingError(error).message,
        },
        updatedAt: this.now(),
      })
    }
  }

  async continueWithoutRecording(): Promise<SpeakingSession> {
    const session = this.requireSession()
    const permissionDenied =
      session.permission === 'denied' ||
      session.recognition.errorCode === 'not-allowed'
    const reviewed = submitSpeakingWithoutRecording(
      session,
      permissionDenied
        ? 'permission-denied'
        : 'recording-failed',
      permissionDenied ? 'permission' : 'device',
      this.now(),
    )
    return this.save(reviewed)
  }

  async retry(): Promise<SpeakingSession> {
    this.discardRecording()
    const retried = retrySpeakingPrompt(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    return this.save(retried)
  }

  async advance(): Promise<SpeakingSession> {
    const current = this.requireSession()
    const isFinalPrompt =
      current.phase === 'feedback' &&
      current.unit !== null &&
      current.promptIndex + 1 >= current.unit.prompts.length
    if (isFinalPrompt) {
      const preview = getSpeakingSessionResult(current)
      const terminalUnscorable =
        preview.performanceScore === null &&
        (preview.failureCategory === 'device' ||
          preview.failureCategory === 'permission' ||
          preview.failureCategory === 'network')
      if (
        preview.performanceScore === null &&
        !terminalUnscorable
      ) {
        return this.pause('device-failure')
      }
    }
    this.discardRecording()
    let session = advanceSpeakingSession(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    if (session.phase === 'completed') {
      const result = getSpeakingSessionResult(session)
      const durationSeconds = Math.max(
        0,
        session.activeDurationSeconds -
          session.reportedDurationSeconds,
      )
      const now = this.now()
      const event =
        result.performanceScore === null
          ? createSpeakingUnscorableEvent(
              session,
              durationSeconds,
              this.identity(now),
            )
          : createSpeakingCompletedEvent(
              session,
              durationSeconds,
              this.identity(now),
            )
      session = {
        ...session,
        reportedDurationSeconds: session.activeDurationSeconds,
      }
      session = withPendingSpeakingEvent(session, event, now)
    }
    await this.save(session)
    return this.flushPendingEvents()
  }

  async pause(reason: TaskPauseReason): Promise<SpeakingSession> {
    this.recorder.cancel()
    this.recognitionHandle?.abort()
    this.recognitionHandle = null
    this.discardRecording()
    let session = pauseSpeakingSession(
      this.requireSession(),
      this.now(),
    )
    const durationSeconds = Math.max(
      0,
      session.activeDurationSeconds -
        session.reportedDurationSeconds,
    )
    const now = this.now()
    session = {
      ...session,
      reportedDurationSeconds: session.activeDurationSeconds,
    }
    session = withPendingSpeakingEvent(
      session,
      createSpeakingTaskPausedEvent(
        session.task,
        reason,
        durationSeconds,
        this.identity(now),
      ),
      now,
    )
    await this.save(session)
    return this.flushPendingEvents()
  }

  async resume(): Promise<SpeakingSession> {
    const resumed = resumeSpeakingSession(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    return this.save(resumed)
  }

  async skip(reason: TaskSkipReason): Promise<SpeakingSession> {
    const session = this.requireSession()
    const now = this.now()
    const withEvent = withPendingSpeakingEvent(
      session,
      createSpeakingTaskSkippedEvent(
        session.task,
        reason,
        this.identity(now),
      ),
      now,
    )
    await this.save(withEvent)
    return this.flushPendingEvents()
  }

  retryPendingEvents(): Promise<SpeakingSession> {
    return this.flushPendingEvents()
  }

  async restart(): Promise<SpeakingSession> {
    this.dispose()
    await this.repository.remove(this.task.taskId)
    this.session = null
    this.initializing = null
    return this.initialize()
  }

  dispose(): void {
    this.recorder.dispose()
    this.recognitionHandle?.abort()
    this.recognitionHandle = null
    this.recording = null
    this.listeners.clear()
  }
}
