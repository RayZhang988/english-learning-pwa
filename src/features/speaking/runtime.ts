import type {
  PlatformEventSink,
  ReadonlyDataSource,
} from '../../core/index.ts'
import type {
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskSkippedEvent,
  LearningTaskSupplyRequest,
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
  createSpeakingStreamAttemptEvent,
  createSpeakingTrainingBudgetCompletedEvent,
  createSpeakingTrainingContentExhaustedEvent,
  createSpeakingTrainingContentRecoveredEvent,
  createSpeakingTrainingItemCompletedEvent,
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
import { SpeakingCatalogSupplyProvider, resolveSpeakingSupplyPrompt, type SpeakingSupplyProvider } from './supply.ts'
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
import {
  SpeakingEffectiveTiming,
  type SpeakingEffectiveTimingSessionFactoryPort,
} from './timing.ts'
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
  SpeakingStreamState,
  SpeakingSupplyItem,
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
  readonly timingSessionFactory?: SpeakingEffectiveTimingSessionFactoryPort
  readonly supplyProvider?: SpeakingSupplyProvider
  readonly trainingBudgetStatus?: () => 'running' | 'finish-current-item'
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
  private readonly timing: SpeakingEffectiveTiming
  private readonly suppliedProvider: SpeakingSupplyProvider | undefined
  private readonly trainingBudgetStatus: (() => 'running' | 'finish-current-item') | undefined
  private readonly continuousTraining: boolean
  private readonly listeners = new Set<SessionListener>()
  private session: SpeakingSession | null = null
  private recording: SpeakingRecording | null = null
  private recognitionHandle: SpeakingRecognitionHandle | null = null
  private initializing: Promise<SpeakingSession> | null = null
  private operationTail: Promise<void> | null = null
  private readonly pendingActions = new Map<
    string,
    Promise<SpeakingSession>
  >()
  private mediaTimingWrite: Promise<void> = Promise.resolve()
  private recordingGeneration = 0
  private playbackGeneration = 0
  private disposePromise: Promise<void> | null = null
  private interruptionRevision = 0
  private readonly interruptionWaiters = new Set<() => void>()

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
    this.timing = new SpeakingEffectiveTiming(
      this.task.taskId,
      options.timingSessionFactory,
    )
    this.suppliedProvider = options.supplyProvider
    this.trainingBudgetStatus = options.trainingBudgetStatus
    this.continuousTraining = Boolean(this.task.trainingBudget && this.trainingBudgetStatus)
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let result: Promise<T>
    if (this.operationTail === null) {
      try {
        result = operation()
      } catch (error) {
        result = Promise.reject(error)
      }
    } else {
      result = this.operationTail.then(operation, operation)
    }
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.operationTail = tail
    void tail.then(() => {
      if (this.operationTail === tail) {
        this.operationTail = null
      }
    })
    return result
  }

  private runAction(
    key: string,
    operation: () => Promise<SpeakingSession>,
  ): Promise<SpeakingSession> {
    const pending = this.pendingActions.get(key)
    if (pending) {
      return pending
    }
    const result = this.enqueue(operation)
    this.pendingActions.set(key, result)
    const clear = () => {
      if (this.pendingActions.get(key) === result) {
        this.pendingActions.delete(key)
      }
    }
    void result.then(clear, clear)
    return result
  }

  private trackMediaTiming(operation: () => Promise<void>): void {
    const write = this.mediaTimingWrite
      .catch(() => undefined)
      .then(operation)
    this.mediaTimingWrite = write
    void write.catch(() => undefined)
  }

  private interruption(
    expectedRevision: number,
  ): {
    readonly promise: Promise<void>
    readonly release: () => void
  } {
    let release = () => undefined
    const promise = new Promise<void>((resolve) => {
      if (this.interruptionRevision !== expectedRevision) {
        resolve()
        return
      }
      const waiter = () => {
        this.interruptionWaiters.delete(waiter)
        resolve()
      }
      this.interruptionWaiters.add(waiter)
      release = () => {
        this.interruptionWaiters.delete(waiter)
      }
    })
    return { promise, release }
  }

  private identity(now: string) {
    return {
      eventId: `speaking:${this.task.taskId}:${this.createId()}`,
      occurredAt: now,
      localDate: this.localDate,
    }
  }

  private async save(
    session: SpeakingSession,
    notify = true,
  ): Promise<SpeakingSession> {
    this.session = session
    await this.repository.save(session)
    if (notify) {
      this.notify(session)
    }
    return session
  }

  private activeTimingPhase(
    session: SpeakingSession = this.requireSession(),
  ): 'practicing' | 'feedback' {
    if (
      session.phase === 'feedback' ||
      (session.phase === 'paused' &&
        session.pausedFromPhase === 'feedback')
    ) {
      return 'feedback'
    }
    return 'practicing'
  }

  private async saveDuringExcludedPersistence(
    session: SpeakingSession,
    options: {
      readonly fromPhase?: 'practicing' | 'feedback'
      readonly recordActivity?: boolean
      readonly activateAfter?: boolean
      readonly notify?: boolean
    } = {},
  ): Promise<SpeakingSession> {
    const fromPhase =
      options.fromPhase ?? this.activeTimingPhase()
    await this.timing.beginPersistenceWait(
      fromPhase,
      options.recordActivity ?? false,
    )
    const saved = await this.save(
      session,
      options.notify ?? true,
    )
    const nextPhase =
      session.phase === 'feedback' ? 'feedback' : 'practicing'
    await this.timing.endPersistenceWait(
      nextPhase,
      options.activateAfter ??
        (session.phase === 'practicing' ||
          session.phase === 'feedback'),
    )
    return saved
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
      if (
        (event.type === 'learning.attempt.completed.v1' &&
          (!this.continuousTraining || event.payload.taskCompleted)) ||
        event.type === 'learning.training.budget.completed.v1'
      ) {
        await this.timing.finish()
      }
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

  private untrustedLegacyDuration(
    session: SpeakingSession,
  ): number {
    if (this.timing.enabled) {
      return 0
    }
    return Math.max(
      0,
      session.activeDurationSeconds -
        session.reportedDurationSeconds,
    )
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

  private streamRequest(stream: SpeakingStreamState | null): LearningTaskSupplyRequest {
    const completed = stream?.completedItemIds ?? []
    const cursor = stream?.nextSupplyCursor ?? null
    return {
      schemaVersion: 1,
      requestId: `${this.task.taskId}:supply:${completed.length + 1}:${cursor ?? 'initial'}`,
      planId: this.task.planId, taskId: this.task.taskId,
      domain: 'speaking', targetModuleId: 'speaking', mode: this.task.mode,
      targetDifficulty: this.task.difficultyLevel, cursor, excludeItemIds: completed,
      reason: completed.length === 0 ? 'initial' : 'continue-after-item',
    }
  }

  private async nextStreamItem(catalog: SpeakingCatalog, stream: SpeakingStreamState | null) {
    const provider = this.suppliedProvider ?? new SpeakingCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const request = this.streamRequest(stream)
    const result = await provider.next(request)
    if (result.requestId !== request.requestId) {
      throw new SpeakingError('content-invalid', 'Speaking supply returned a mismatched request.')
    }
    return { request, result }
  }

  private streamState(
    item: SpeakingSupplyItem | null, requestId: string, cursor: string | null,
    prior: SpeakingStreamState | null = null,
  ): SpeakingStreamState {
    return {
      activeItem: item, activeRequestId: requestId, nextSupplyCursor: cursor,
      completedItemIds: prior?.completedItemIds ?? [],
      completedItemCount: prior?.completedItemCount ?? 0,
      recognizedItemCount: prior?.recognizedItemCount ?? 0,
      unscorableItemCount: prior?.unscorableItemCount ?? 0,
      finishCurrentItem: prior?.finishCurrentItem ?? this.trainingBudgetStatus?.() === 'finish-current-item',
      exhaustionRequestId: prior?.exhaustionRequestId ?? null,
      recoveryEventId: prior?.recoveryEventId ?? null,
    }
  }

  private createStreamSession(
    base: SpeakingSession, unit: import('./types.ts').SpeakingTrainingUnit,
    prompt: import('./types.ts').SpeakingPrompt, stream: SpeakingStreamState,
  ): SpeakingSession {
    const seeded = createSpeakingSession(base.task, { ...unit, prompts: [prompt] }, base.permission,
      base.network, this.recorder.capabilities(), this.recognition.capabilities(), this.now())
    return { ...seeded, activeDurationSeconds: base.activeDurationSeconds,
      reportedDurationSeconds: base.reportedDurationSeconds, startedAt: base.startedAt,
      pendingEvents: base.pendingEvents, stream }
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
      if (this.continuousTraining) {
        const { request, result } = await this.nextStreamItem(catalog, null)
        if (result.status !== 'item') {
          session = createFailedSpeakingSession(this.task, { category: 'content', message: '当前没有可继续的口语题目。' }, now)
          session = { ...session, stream: { ...this.streamState(null, request.requestId, request.cursor), exhaustionRequestId: request.requestId } }
          session = withPendingSpeakingEvent(session, startedEvent, now)
          session = withPendingSpeakingEvent(session, createSpeakingTrainingContentExhaustedEvent(this.task, request.requestId, request.cursor, result.reason, this.identity(now)), now)
          await this.save(session)
          return this.flushPendingEvents()
        }
        const supplied = resolveSpeakingSupplyPrompt(catalog, result.item as SpeakingSupplyItem)
        const base = createSpeakingSession(this.task, { ...supplied.unit, prompts: [supplied.prompt] }, permission, this.networkStatus.current(), this.recorder.capabilities(), this.recognition.capabilities(), now)
        session = { ...base, stream: this.streamState(result.item as SpeakingSupplyItem, request.requestId, result.nextCursor) }
      } else {
        const unit = resolveSpeakingTask(catalog, this.task)
        session = createSpeakingSession(this.task, unit, permission, this.networkStatus.current(), this.recorder.capabilities(), this.recognition.capabilities(), now)
      }
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
    await this.timing.startLoading()
    const stored = await this.repository.load(this.task)
    if (!stored) {
      const session = await this.startFresh()
      await this.timing.synchronize(session.phase)
      return session
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
    const session = await this.flushPendingEvents()
    await this.timing.synchronize(session.phase)
    return session
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

  private recordingLifecycle(generation: number) {
    const current = () => generation === this.recordingGeneration
    return {
      onStarted: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.recordingStarted())
        }
      },
      onPaused: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.recordingPaused())
        }
      },
      onResumed: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.recordingResumed())
        }
      },
      onStopped: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.recordingStopped())
        }
      },
      onError: (_error: unknown) => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.recordingStopped())
        }
      },
    }
  }

  private async startRecordingInternal(): Promise<SpeakingSession> {
    const interruptionRevision = this.interruptionRevision
    let session = this.requireSession()
    if (session.phase === 'feedback') {
      this.discardRecording()
      session = retrySpeakingPrompt(
        session,
        this.recorder.capabilities(),
        this.recognition.capabilities(),
        this.now(),
      )
      await this.saveDuringExcludedPersistence(session, {
        fromPhase: 'feedback',
        recordActivity: true,
      })
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
    await this.saveDuringExcludedPersistence(session, {
      recordActivity: true,
    })

    let stream: MediaStream
    await this.timing.beginPermissionWait()
    if (this.interruptionRevision !== interruptionRevision) {
      return this.requireSession()
    }
    const request = this.microphonePermission.request()
    const interrupted = this.interruption(interruptionRevision)
    try {
      const requestResult = await Promise.race([
        request.then((value) => ({
          status: 'granted' as const,
          stream: value,
        })),
        interrupted.promise.then(() => ({
          status: 'interrupted' as const,
          stream: null,
        })),
      ])
      interrupted.release()
      if (requestResult.status === 'interrupted') {
        void request.then(
          (lateStream) => {
            for (const track of lateStream.getTracks()) {
              track.stop()
            }
          },
          () => undefined,
        )
        return this.requireSession()
      }
      stream = requestResult.stream
    } catch (error) {
      interrupted.release()
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
      return this.saveDuringExcludedPersistence(unavailable)
    }

    const recognitionAvailable =
      network === 'online' &&
      this.recognition.capabilities().supported
    await this.timing.beginRecordingWait()
    const recordingGeneration = ++this.recordingGeneration
    try {
      this.recorder.start(
        stream,
        this.recordingLifecycle(recordingGeneration),
      )
      this.recognitionHandle = recognitionAvailable
        ? this.recognition.start('en-US')
        : null
      const recordingSession = beginSpeakingRecording(
        session,
        'granted',
        recognitionAvailable,
        this.now(),
      )
      return this.saveDuringExcludedPersistence(recordingSession)
    } catch (error) {
      this.recordingGeneration += 1
      this.recorder.cancel()
      this.recognitionHandle?.abort()
      this.recognitionHandle = null
      await this.timing.recordingStopped()
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
      return this.saveDuringExcludedPersistence(failed)
    }
  }

  startRecording(): Promise<SpeakingSession> {
    return this.runAction(
      'start-recording',
      () => this.startRecordingInternal(),
    )
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

  private async stopRecordingInternal(): Promise<SpeakingSession> {
    let session = this.requireSession()
    this.recordingGeneration += 1
    await this.mediaTimingWrite
    await this.timing.recordingStopped()
    session = processSpeakingRecording(session, this.now())
    await this.saveDuringExcludedPersistence(session, {
      activateAfter: false,
    })

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
      return this.saveDuringExcludedPersistence(reviewed)
    }
    this.recording = recording
    this.recognitionHandle = null

    const recognitionRevision = this.interruptionRevision
    if (recognitionResult) {
      await this.timing.beginRecognitionWait()
    }
    const recognitionInterrupted =
      this.interruption(recognitionRevision)
    const outcome = recognitionResult
      ? await Promise.race([
          recognitionResult,
          recognitionInterrupted.promise.then(
            (): SpeakingRecognitionOutcome => ({
              status: 'failed',
              code: 'aborted',
              message: '语音识别被页面中断。',
            }),
          ),
        ])
      : this.fallbackWithoutRecognition(session)
    recognitionInterrupted.release()
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
      return this.saveDuringExcludedPersistence(reviewed)
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
    return this.saveDuringExcludedPersistence(reviewed)
  }

  stopRecording(): Promise<SpeakingSession> {
    return this.runAction(
      'stop-recording',
      () => this.stopRecordingInternal(),
    )
  }

  private playbackLifecycle(generation: number) {
    const current = () => generation === this.playbackGeneration
    return {
      onStarted: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.playbackStarted())
        }
      },
      onPaused: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.playbackPaused())
        }
      },
      onWaiting: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.playbackWaiting())
        }
      },
      onEnded: () => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.playbackEnded())
        }
      },
      onError: (_error: unknown) => {
        if (current()) {
          this.trackMediaTiming(() => this.timing.playbackEnded())
        }
      },
    }
  }

  private async playRecordingInternal(): Promise<SpeakingSession> {
    const session = this.requireSession()
    if (!this.recording || !session.recorder.playbackAvailable) {
      throw new SpeakingError(
        'playback-failed',
        'No in-memory speaking recording is available to play.',
      )
    }
    await this.timing.beginPlaybackWait()
    const playing = {
      ...session,
      recorder: {
        ...session.recorder,
        status: 'processing' as const,
        message: '正在播放你的录音。',
      },
      updatedAt: this.now(),
    }
    await this.saveDuringExcludedPersistence(playing, {
      fromPhase: 'feedback',
      activateAfter: false,
    })
    const playbackGeneration = ++this.playbackGeneration
    try {
      await this.recorder.play(
        this.recording,
        this.playbackLifecycle(playbackGeneration),
      )
      await this.mediaTimingWrite
      await this.timing.playbackEnded()
      return this.saveDuringExcludedPersistence({
        ...playing,
        recorder: {
          ...playing.recorder,
          status: 'review',
          message: '录音播放完毕。',
        },
        updatedAt: this.now(),
      }, {
        fromPhase: 'feedback',
      })
    } catch (error) {
      await this.mediaTimingWrite
      await this.timing.playbackEnded()
      return this.saveDuringExcludedPersistence({
        ...playing,
        recorder: {
          ...playing.recorder,
          status: 'error',
          playbackAvailable: true,
          message: toSpeakingError(error).message,
        },
        updatedAt: this.now(),
      }, {
        fromPhase: 'feedback',
      })
    }
  }

  playRecording(): Promise<SpeakingSession> {
    return this.runAction(
      'play-recording',
      () => this.playRecordingInternal(),
    )
  }

  private async continueWithoutRecordingInternal():
    Promise<SpeakingSession> {
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
    return this.saveDuringExcludedPersistence(reviewed, {
      recordActivity: true,
    })
  }

  continueWithoutRecording(): Promise<SpeakingSession> {
    return this.runAction('continue-without-recording', () =>
      this.continueWithoutRecordingInternal(),
    )
  }

  private async retryInternal(): Promise<SpeakingSession> {
    this.discardRecording()
    const retried = retrySpeakingPrompt(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    return this.saveDuringExcludedPersistence(retried, {
      fromPhase: 'feedback',
      recordActivity: true,
    })
  }

  retry(): Promise<SpeakingSession> {
    return this.runAction('retry-prompt', () => this.retryInternal())
  }

  private async advanceInternal(): Promise<SpeakingSession> {
    const current = this.requireSession()
    const isFinalPrompt =
      current.phase === 'feedback' &&
      current.unit !== null &&
      current.promptIndex + 1 >= current.unit.prompts.length
    if (isFinalPrompt && !this.continuousTraining) {
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
        return this.pauseInternal('device-failure')
      }
    }
    this.discardRecording()
    this.playbackGeneration += 1
    this.recorder.stopPlayback()
    await this.mediaTimingWrite
    let session = advanceSpeakingSession(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    const activeItem = current.stream?.activeItem
    if (session.phase === 'completed' && this.continuousTraining && current.stream && activeItem) {
      const active = current.stream
      const result = getSpeakingSessionResult(current)
      const alreadyCompleted = active.completedItemIds.includes(activeItem.itemId)
      const completedStream: SpeakingStreamState = {
        ...active,
        completedItemIds: alreadyCompleted ? active.completedItemIds : [...active.completedItemIds, activeItem.itemId],
        completedItemCount: active.completedItemCount + (alreadyCompleted ? 0 : 1),
        recognizedItemCount: active.recognizedItemCount + (result.performanceScore === null ? 0 : 1),
        unscorableItemCount: active.unscorableItemCount + (result.performanceScore === null ? 1 : 0),
        finishCurrentItem: active.finishCurrentItem || this.trainingBudgetStatus?.() === 'finish-current-item',
      }
      const now = this.now()
      session = { ...session, reportedDurationSeconds: session.activeDurationSeconds }
      session = withPendingSpeakingEvent(session, createSpeakingStreamAttemptEvent(current, this.untrustedLegacyDuration(current), this.identity(now)), now)
      session = withPendingSpeakingEvent(session, createSpeakingTrainingItemCompletedEvent(this.task, activeItem, active.activeRequestId, active.nextSupplyCursor, result.performanceScore === null ? 'unscorable-practice' : 'scored', this.identity(now)), now)
      if (completedStream.finishCurrentItem) {
        session = { ...session, stream: completedStream }
        session = withPendingSpeakingEvent(session, createSpeakingTrainingBudgetCompletedEvent(this.task, activeItem.itemId, completedStream.completedItemCount, this.identity(now)), now)
      } else {
        try {
          const catalog = await this.contentSource.load()
          const { request, result: next } = await this.nextStreamItem(catalog, completedStream)
          if (next.status !== 'item') {
            session = { ...session, phase: 'error', pausedFromPhase: null, lastActiveAt: null,
              failure: { category: 'content', message: '当前没有可继续的口语题目。' },
              stream: { ...completedStream, exhaustionRequestId: request.requestId, recoveryEventId: null }, updatedAt: now }
            session = withPendingSpeakingEvent(session, createSpeakingTrainingContentExhaustedEvent(this.task, request.requestId, request.cursor, next.reason, this.identity(now)), now)
          } else {
            const supplied = resolveSpeakingSupplyPrompt(catalog, next.item as SpeakingSupplyItem)
            session = this.createStreamSession(session, supplied.unit, supplied.prompt,
              this.streamState(next.item as SpeakingSupplyItem, request.requestId, next.nextCursor, completedStream))
          }
        } catch (error) {
          session = { ...session, phase: 'error', pausedFromPhase: null, lastActiveAt: null,
            failure: this.failureFor(error), stream: completedStream, updatedAt: now }
        }
      }
    } else if (session.phase === 'completed') {
      const result = getSpeakingSessionResult(session)
      const durationSeconds = this.untrustedLegacyDuration(session)
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
    await this.saveDuringExcludedPersistence(session, {
      fromPhase: 'feedback',
      recordActivity: true,
      activateAfter: session.phase !== 'completed',
      notify: session.phase !== 'completed',
    })
    return this.flushPendingEvents()
  }

  advance(): Promise<SpeakingSession> {
    return this.runAction('advance', () => this.advanceInternal())
  }

  private interruptMedia(): void {
    this.interruptionRevision += 1
    for (const interrupt of [...this.interruptionWaiters]) {
      interrupt()
    }
    this.recordingGeneration += 1
    this.playbackGeneration += 1
    this.recorder.cancel()
    this.recorder.stopPlayback()
    this.recognitionHandle?.abort()
    this.recognitionHandle = null
  }

  private async pauseInternal(
    reason: TaskPauseReason,
  ): Promise<SpeakingSession> {
    const current = this.requireSession()
    if (current.phase === 'paused') {
      return current
    }
    await this.mediaTimingWrite
    await this.timing.pause()
    this.discardRecording()
    let session = pauseSpeakingSession(
      current,
      this.now(),
    )
    const durationSeconds = this.untrustedLegacyDuration(session)
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

  pause(reason: TaskPauseReason): Promise<SpeakingSession> {
    const key = `pause:${reason}`
    if (!this.pendingActions.has(key)) {
      this.interruptMedia()
    }
    return this.runAction(key, () => this.pauseInternal(reason))
  }

  private async resumeInternal(): Promise<SpeakingSession> {
    const resumed = resumeSpeakingSession(
      this.requireSession(),
      this.recorder.capabilities(),
      this.recognition.capabilities(),
      this.now(),
    )
    return this.saveDuringExcludedPersistence(resumed)
  }

  resume(): Promise<SpeakingSession> {
    return this.runAction('resume', () => this.resumeInternal())
  }

  private async skipInternal(
    reason: TaskSkipReason,
  ): Promise<SpeakingSession> {
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

  skip(reason: TaskSkipReason): Promise<SpeakingSession> {
    return this.runAction(
      `skip:${reason}`,
      () => this.skipInternal(reason),
    )
  }

  retryPendingEvents(): Promise<SpeakingSession> {
    return this.runAction(
      'retry-pending-events',
      () => this.flushPendingEvents(),
    )
  }

  retrySupply(): Promise<SpeakingSession> {
    return this.runAction('retry-supply', async () => {
      const current = this.requireSession()
      if (!this.continuousTraining || current.phase !== 'error' || !current.stream) {
        throw new SpeakingError('session-transition-invalid', 'Speaking supply is not awaiting a retry.')
      }
      if (current.stream.exhaustionRequestId === null) {
        throw new SpeakingError('session-transition-invalid', 'Speaking stream has no acknowledged exhaustion to recover.')
      }
      await this.timing.startLoading()
      const exhaustionRequestId = current.stream.exhaustionRequestId
      const recoveryEventId = current.stream.recoveryEventId ??
        `speaking:${this.task.taskId}:content-recovered:${exhaustionRequestId}`
      let catalog: SpeakingCatalog
      let request: LearningTaskSupplyRequest
      let result: Awaited<ReturnType<SpeakingSupplyProvider['next']>>
      try {
        catalog = await this.contentSource.load()
        const next = await this.nextStreamItem(catalog, current.stream)
        request = next.request
        result = next.result
      } catch (error) {
        const failed = { ...current, failure: this.failureFor(error), updatedAt: this.now() }
        return this.save(failed)
      }
      if (result.status !== 'item') {
        // The task remains blocked by its original persisted exhaustion.
        // Replacing that identity would make 04 reject a later recovery.
        return this.requireSession()
      }
      const now = this.now()
      let recovery = this.requireSession()
      if (recovery.stream?.recoveryEventId === null) {
        recovery = {
          ...recovery,
          stream: { ...recovery.stream, recoveryEventId },
          updatedAt: now,
        }
        recovery = withPendingSpeakingEvent(
          recovery,
          createSpeakingTrainingContentRecoveredEvent(
            this.task,
            exhaustionRequestId,
            { eventId: recoveryEventId, occurredAt: now, localDate: this.localDate },
          ),
          now,
        )
        await this.save(recovery)
      }
      recovery = await this.flushPendingEvents()
      const supplied = resolveSpeakingSupplyPrompt(catalog, result.item as SpeakingSupplyItem)
      const session = this.createStreamSession(recovery, supplied.unit, supplied.prompt,
        { ...recovery.stream!, activeItem: result.item as SpeakingSupplyItem,
          activeRequestId: request.requestId, nextSupplyCursor: result.nextCursor,
          exhaustionRequestId: null, recoveryEventId: null })
      await this.saveDuringExcludedPersistence(session)
      return this.flushPendingEvents()
    })
  }

  private async restartInternal(): Promise<SpeakingSession> {
    this.interruptMedia()
    await this.mediaTimingWrite
    await this.timing.startLoading()
    if (this.session && this.session.pendingEvents.length > 0) {
      await this.flushPendingEvents()
    }
    await this.repository.remove(this.task.taskId)
    this.session = null
    this.initializing = null
    const session = await this.startFresh()
    await this.timing.synchronize(session.phase)
    return session
  }

  restart(): Promise<SpeakingSession> {
    return this.runAction('restart', () => this.restartInternal())
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.interruptMedia()
    this.recorder.dispose()
    const disposal = this.enqueue(async () => {
      await this.initializing
      await this.mediaTimingWrite
      await this.timing.dispose()
      this.recording = null
      this.listeners.clear()
    })
    this.disposePromise = disposal
    const clear = () => {
      if (this.disposePromise === disposal) {
        this.disposePromise = null
      }
    }
    void disposal.then(clear, clear)
    return disposal
  }
}
