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
  browserNetworkStatus,
  type NetworkStatusService,
} from '../../platform/index.ts'
import { resolveListeningTask } from './content.ts'
import { toListeningError, ListeningError } from './errors.ts'
import {
  createListeningCompletedEvent,
  createListeningTaskPausedEvent,
  createListeningTaskSkippedEvent,
  createListeningTaskStartedEvent,
  createListeningUnscorableEvent,
} from './events.ts'
import {
  ListeningPlaybackController,
} from './playback-controller.ts'
import { ListeningSessionRepository } from './repository.ts'
import {
  advanceListeningSession,
  changeListeningDictation,
  createFailedListeningSession,
  createListeningSession,
  failListeningSession,
  getCurrentListeningQuestion,
  pauseListeningSession,
  resumeListeningSession,
  selectListeningOption,
  submitListeningAnswer,
  updateListeningPlayback,
  withPendingListeningEvent,
  withoutPendingListeningEvent,
} from './session.ts'
import {
  browserListeningSpeech,
  type ListeningSpeechErrorCode,
  type ListeningSpeechPort,
} from './speech-synthesis.ts'
import type {
  ListeningCatalog,
  ListeningRepeatMode,
  ListeningSession,
  ListeningSessionFailure,
} from './types.ts'

type TaskPauseReason = LearningTaskPausedEvent['payload']['reason']
type TaskSkipReason = LearningTaskSkippedEvent['payload']['reason']
type SessionListener = (session: ListeningSession) => void

export interface ListeningTrainingRuntimeOptions {
  readonly task: LearningTask
  readonly localDate: string
  readonly contentSource: ReadonlyDataSource<ListeningCatalog>
  readonly eventSink: PlatformEventSink
  readonly repository?: ListeningSessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly speech?: ListeningSpeechPort
  readonly now?: () => string
  readonly createId?: () => string
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

export class ListeningTrainingRuntime {
  private readonly task: LearningTask
  private readonly localDate: string
  private readonly contentSource: ReadonlyDataSource<ListeningCatalog>
  private readonly eventSink: PlatformEventSink
  private readonly repository: ListeningSessionRepository
  private readonly networkStatus: NetworkStatusService
  private readonly speech: ListeningSpeechPort
  private readonly now: () => string
  private readonly createId: () => string
  private readonly listeners = new Set<SessionListener>()
  private session: ListeningSession | null = null
  private controller: ListeningPlaybackController | null = null
  private initializing: Promise<ListeningSession> | null = null
  private sessionRevision = 0
  private sessionWrite: Promise<void> = Promise.resolve()
  private playbackWrite: Promise<void> = Promise.resolve()
  private reportingSpeechFailure = false

  constructor(options: ListeningTrainingRuntimeOptions) {
    this.task = options.task
    this.localDate = options.localDate
    this.contentSource = options.contentSource
    this.eventSink = options.eventSink
    this.repository =
      options.repository ?? new ListeningSessionRepository()
    this.networkStatus = options.networkStatus ?? browserNetworkStatus
    this.speech = options.speech ?? browserListeningSpeech
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? defaultId
  }

  get currentSession(): ListeningSession | null {
    return this.session
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(session: ListeningSession): void {
    for (const listener of this.listeners) {
      listener(session)
    }
  }

  private identity(now: string) {
    return {
      eventId: `listening:${this.task.taskId}:${this.createId()}`,
      occurredAt: now,
      localDate: this.localDate,
    }
  }

  private queueSessionWrite(session: ListeningSession): Promise<void> {
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(() => this.repository.save(session))
    this.sessionWrite = write
    return write
  }

  private stageSession(session: ListeningSession): number {
    this.session = session
    this.sessionRevision += 1
    return this.sessionRevision
  }

  private async save(session: ListeningSession): Promise<ListeningSession> {
    const revision = this.stageSession(session)
    await this.queueSessionWrite(session)
    if (revision === this.sessionRevision) {
      this.notify(session)
    }
    return this.requireSession()
  }

  private async saveDraft(
    session: ListeningSession,
  ): Promise<ListeningSession> {
    this.stageSession(session)
    this.notify(session)
    await this.queueSessionWrite(session)
    return this.requireSession()
  }

  private requireSession(): ListeningSession {
    if (!this.session) {
      throw new ListeningError(
        'session-transition-invalid',
        'Listening runtime has not been initialized.',
      )
    }
    return this.session
  }

  private queuePlaybackSave(session: ListeningSession): void {
    this.stageSession(session)
    this.notify(session)
    this.playbackWrite = this.queueSessionWrite(session)
  }

  private handlePlaybackState(
    playback: ListeningSession['playback'],
  ): void {
    const session = this.session
    if (
      !session ||
      (session.phase !== 'answering' &&
        session.phase !== 'feedback' &&
        session.phase !== 'paused')
    ) {
      return
    }
    try {
      this.queuePlaybackSave(
        updateListeningPlayback(session, playback, this.now()),
      )
    } catch {
      // A late browser callback from a replaced question is intentionally ignored.
    }
  }

  private handleSpeechFailure(code: ListeningSpeechErrorCode): void {
    if (this.reportingSpeechFailure) {
      return
    }
    this.reportingSpeechFailure = true
    const category: ListeningSessionFailure['category'] =
      code === 'network'
        ? 'network'
        : code === 'canceled' || code === 'interrupted'
          ? 'interrupted'
          : 'device'
    void this.reportFailure({
      category,
      message:
        category === 'network'
          ? '设备语音需要网络，但当前播放请求失败。'
          : category === 'interrupted'
            ? '设备中断了本次语音播放。'
            : '设备合成语音暂时不可用。',
    }).finally(() => {
      this.reportingSpeechFailure = false
    })
  }

  private attachController(session: ListeningSession): void {
    this.controller?.dispose()
    this.controller = null
    const question = getCurrentListeningQuestion(session)
    if (
      !question ||
      (session.phase !== 'answering' &&
        session.phase !== 'feedback' &&
        session.phase !== 'paused')
    ) {
      return
    }
    this.controller = new ListeningPlaybackController({
      question,
      initialState: session.playback,
      speech: this.speech,
      onStateChange: (playback) =>
        this.handlePlaybackState(playback),
      onFailure: (code) => this.handleSpeechFailure(code),
    })
  }

  private async flushPendingEvents(): Promise<ListeningSession> {
    let session = this.requireSession()
    while (session.pendingEvents.length > 0) {
      const event = session.pendingEvents[0]
      await this.eventSink.publish(event)
      session = withoutPendingListeningEvent(
        session,
        event.id,
        this.now(),
      )
      await this.save(session)
    }
    return session
  }

  private failureFor(error: unknown): ListeningSessionFailure {
    const listeningError = toListeningError(error)
    if (
      listeningError.code === 'content-unavailable' &&
      this.networkStatus.current() === 'offline'
    ) {
      return {
        category: 'network',
        message: '当前离线，且听力课程尚未完整下载。',
      }
    }
    return {
      category: 'content',
      message: listeningError.message,
    }
  }

  private async startFresh(): Promise<ListeningSession> {
    const now = this.now()
    const startedEvent = createListeningTaskStartedEvent(
      this.task,
      this.identity(now),
    )
    let session: ListeningSession
    try {
      const catalog = await this.contentSource.load()
      const unit = resolveListeningTask(catalog, this.task)
      if (!this.speech.capabilities().supported) {
        throw new ListeningError(
          'speech-unavailable',
          '当前浏览器无法使用设备合成语音。',
        )
      }
      session = createListeningSession(this.task, unit, now)
      session = withPendingListeningEvent(session, startedEvent, now)
    } catch (error) {
      const listeningError = toListeningError(error)
      const failure: ListeningSessionFailure =
        listeningError.code === 'speech-unavailable'
          ? {
              category: 'device',
              message: listeningError.message,
            }
          : this.failureFor(error)
      session = createFailedListeningSession(this.task, failure, now)
      session = withPendingListeningEvent(session, startedEvent, now)
      session = withPendingListeningEvent(
        session,
        createListeningUnscorableEvent(
          this.task,
          failure.category,
          0,
          this.identity(now),
        ),
        now,
      )
    }
    await this.save(session)
    this.attachController(session)
    return this.flushPendingEvents()
  }

  private async initializeInternal(): Promise<ListeningSession> {
    const stored = await this.repository.load(this.task)
    if (stored) {
      const restored =
        stored.playback.status === 'playing'
          ? {
              ...stored,
              playback: { ...stored.playback, status: 'paused' as const },
            }
          : stored
      this.session = restored
      this.attachController(restored)
      return this.flushPendingEvents()
    }
    return this.startFresh()
  }

  initialize(): Promise<ListeningSession> {
    if (this.initializing) {
      return this.initializing
    }
    const initialization = this.initializeInternal()
    this.initializing = initialization
    const clear = () => {
      if (this.initializing === initialization) {
        this.initializing = null
      }
    }
    void initialization.then(clear, clear)
    return initialization
  }

  async togglePlayback(): Promise<ListeningSession> {
    if (!this.controller) {
      throw new ListeningError(
        'speech-unavailable',
        'Listening playback is not available.',
      )
    }
    this.controller.toggle()
    await this.playbackWrite
    return this.requireSession()
  }

  async setRate(rate: number): Promise<ListeningSession> {
    if (!this.controller) {
      throw new ListeningError(
        'speech-unavailable',
        'Listening playback is not available.',
      )
    }
    this.controller.setRate(rate)
    await this.playbackWrite
    return this.requireSession()
  }

  async selectSegment(segmentId: string): Promise<ListeningSession> {
    if (!this.controller) {
      throw new ListeningError(
        'speech-unavailable',
        'Listening playback is not available.',
      )
    }
    this.controller.selectSegment(segmentId)
    await this.playbackWrite
    return this.requireSession()
  }

  async setRepeatMode(
    mode: ListeningRepeatMode,
  ): Promise<ListeningSession> {
    if (!this.controller) {
      throw new ListeningError(
        'speech-unavailable',
        'Listening playback is not available.',
      )
    }
    this.controller.setRepeatMode(mode)
    await this.playbackWrite
    return this.requireSession()
  }

  select(optionId: string): Promise<ListeningSession> {
    return this.saveDraft(
      selectListeningOption(
        this.requireSession(),
        optionId,
        this.now(),
      ),
    )
  }

  changeDictation(value: string): Promise<ListeningSession> {
    return this.saveDraft(
      changeListeningDictation(
        this.requireSession(),
        value,
        this.now(),
      ),
    )
  }

  async submit(): Promise<ListeningSession> {
    this.controller?.interrupt()
    await this.playbackWrite
    return this.save(
      submitListeningAnswer(this.requireSession(), this.now()),
    )
  }

  async advance(): Promise<ListeningSession> {
    this.controller?.dispose()
    const now = this.now()
    let session = advanceListeningSession(this.requireSession(), now)
    if (session.phase === 'completed') {
      const durationSeconds = Math.max(
        0,
        session.activeDurationSeconds - session.reportedDurationSeconds,
      )
      session = {
        ...session,
        reportedDurationSeconds: session.activeDurationSeconds,
      }
      session = withPendingListeningEvent(
        session,
        createListeningCompletedEvent(
          session,
          durationSeconds,
          this.identity(now),
        ),
        now,
      )
    }
    await this.save(session)
    this.attachController(session)
    return this.flushPendingEvents()
  }

  async pause(reason: TaskPauseReason): Promise<ListeningSession> {
    this.controller?.interrupt()
    await this.playbackWrite
    const now = this.now()
    let session = pauseListeningSession(this.requireSession(), now)
    const durationSeconds = Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
    session = {
      ...session,
      reportedDurationSeconds: session.activeDurationSeconds,
    }
    session = withPendingListeningEvent(
      session,
      createListeningTaskPausedEvent(
        session.task,
        reason,
        durationSeconds,
        this.identity(now),
      ),
      now,
    )
    await this.save(session)
    this.attachController(session)
    return this.flushPendingEvents()
  }

  async resume(): Promise<ListeningSession> {
    const now = this.now()
    let session = resumeListeningSession(this.requireSession(), now)
    session = withPendingListeningEvent(
      session,
      createListeningTaskStartedEvent(
        session.task,
        this.identity(now),
      ),
      now,
    )
    await this.save(session)
    this.attachController(session)
    return this.flushPendingEvents()
  }

  async skip(reason: TaskSkipReason): Promise<ListeningSession> {
    let session = this.requireSession()
    if (session.phase === 'answering' || session.phase === 'feedback') {
      session = await this.pause(
        reason === 'time-budget-ended'
          ? 'time-budget-ended'
          : reason === 'device-failure'
            ? 'device-failure'
            : reason === 'content-failure'
              ? 'content-failure'
              : 'user-paused',
      )
    }
    const now = this.now()
    session = withPendingListeningEvent(
      session,
      createListeningTaskSkippedEvent(
        session.task,
        reason,
        this.identity(now),
      ),
      now,
    )
    await this.save(session)
    return this.flushPendingEvents()
  }

  async reportFailure(
    failure: ListeningSessionFailure,
  ): Promise<ListeningSession> {
    const current = this.requireSession()
    if (current.phase === 'error') {
      return current
    }
    this.controller?.dispose()
    const now = this.now()
    let session = failListeningSession(current, failure, now)
    const durationSeconds = Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
    session = {
      ...session,
      reportedDurationSeconds: session.activeDurationSeconds,
    }
    session = withPendingListeningEvent(
      session,
      createListeningUnscorableEvent(
        session.task,
        failure.category,
        durationSeconds,
        this.identity(now),
      ),
      now,
    )
    await this.save(session)
    return this.flushPendingEvents()
  }

  retryPendingEvents(): Promise<ListeningSession> {
    return this.flushPendingEvents()
  }

  async restart(): Promise<ListeningSession> {
    this.controller?.dispose()
    if (this.session && this.session.pendingEvents.length > 0) {
      await this.flushPendingEvents()
    }
    await this.repository.delete(this.task.taskId)
    this.session = null
    return this.startFresh()
  }

  dispose(): void {
    this.controller?.dispose()
    this.controller = null
    this.listeners.clear()
  }
}
