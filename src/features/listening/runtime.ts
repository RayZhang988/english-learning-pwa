import type {
  PlatformEventSink,
  ReadonlyDataSource,
} from '../../core/index.ts'
import type {
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskSkippedEvent,
  LearningTaskSupplyRequest,
  WrongAnswerEvidence,
  ReviewContentIdentity,
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
  createListeningStreamAttemptEvent,
  createListeningTrainingBudgetCompletedEvent,
  createListeningTrainingContentExhaustedEvent,
  createListeningTrainingContentRecoveredEvent,
  createListeningTrainingItemCompletedEvent,
} from './events.ts'
import {
  ListeningPlaybackController,
  type ListeningPlaybackLifecycleEvent,
} from './playback-controller.ts'
import { ListeningSessionRepository } from './repository.ts'
import {
  advanceListeningSession,
  changeListeningDictation,
  createFailedListeningSession,
  createListeningSession,
  createListeningStreamSession,
  completeListeningStreamSession,
  failListeningSession,
  getCurrentListeningQuestion,
  pauseListeningSession,
  resumeListeningSession,
  replaceListeningStreamQuestion,
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
import {
  ListeningCatalogSupplyProvider,
  resolveListeningSupplyQuestion,
  type ListeningSupplyProvider,
} from './supply.ts'
import {
  ListeningEffectiveTiming,
  type ListeningEffectiveTimingSessionFactoryPort,
} from './timing.ts'
import type {
  ListeningCatalog,
  ListeningRepeatMode,
  ListeningSession,
  ListeningSessionFailure,
  ListeningStreamState,
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
  readonly timingSessionFactory?: ListeningEffectiveTimingSessionFactoryPort
  /** 01 injects this for production; tests may supply a controlled provider. */
  readonly supplyProvider?: ListeningSupplyProvider
  /** Mirrors 04's restored training progress; it is never inferred from wall time. */
  readonly trainingBudgetStatus?: () => 'running' | 'finish-current-item'
  /** 01 resolves this exclusively through 05's review-content-index aliases. */
  readonly reviewIdentityForItem?: (item: import('./types.ts').ListeningSupplyItem) => ReviewContentIdentity | null
  /** Durable host sink for the single unified wrong-answer library. */
  readonly publishWrongAnswerEvidence?: (evidence: WrongAnswerEvidence) => Promise<void>
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
  private readonly timing: ListeningEffectiveTiming
  private readonly suppliedProvider: ListeningSupplyProvider | undefined
  private readonly trainingBudgetStatus: (() => 'running' | 'finish-current-item') | undefined
  private readonly reviewIdentityForItem: ((item: import('./types.ts').ListeningSupplyItem) => ReviewContentIdentity | null) | undefined
  private readonly publishWrongAnswerEvidence: ((evidence: WrongAnswerEvidence) => Promise<void>) | undefined
  /** A budget is continuous only when the 01 host has supplied its restored status port. */
  private readonly continuousTraining: boolean
  private readonly listeners = new Set<SessionListener>()
  private session: ListeningSession | null = null
  private controller: ListeningPlaybackController | null = null
  private initializing: Promise<ListeningSession> | null = null
  private sessionRevision = 0
  private sessionWrite: Promise<void> = Promise.resolve()
  private inputRevision = 0
  private inputWrite: Promise<void> = Promise.resolve()
  private playbackWrite: Promise<void> = Promise.resolve()
  private playbackTimingWrite: Promise<void> = Promise.resolve()
  private speechFailureWrite: Promise<void> = Promise.resolve()
  private operationTail: Promise<void> | null = null
  private reportingSpeechFailure = false
  private disposePromise: Promise<void> | null = null

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
    this.timing = new ListeningEffectiveTiming(
      this.task.taskId,
      options.timingSessionFactory,
    )
    this.suppliedProvider = options.supplyProvider
    this.trainingBudgetStatus = options.trainingBudgetStatus
    this.reviewIdentityForItem = options.reviewIdentityForItem
    this.publishWrongAnswerEvidence = options.publishWrongAnswerEvidence
    this.continuousTraining = Boolean(
      this.task.trainingBudget && this.trainingBudgetStatus,
    )
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

  private async save(
    session: ListeningSession,
    options: {
      readonly notify?: boolean
      readonly beforeNotify?: () => Promise<void>
    } = {},
  ): Promise<ListeningSession> {
    const revision = this.stageSession(session)
    await this.queueSessionWrite(session)
    await options.beforeNotify?.()
    if (revision === this.sessionRevision) {
      if (options.notify !== false) {
        this.notify(session)
      }
    }
    return this.requireSession()
  }

  private async saveDraft(
    session: ListeningSession,
  ): Promise<ListeningSession> {
    this.stageSession(session)
    this.notify(session)
    const write = (async () => {
      await this.timing.beginPersistenceWait('answering', true)
      await this.queueSessionWrite(session)
      await this.timing.endPersistenceWait('answering', true)
    })()
    this.inputRevision += 1
    this.inputWrite = write
    await write
    return this.requireSession()
  }

  private async waitForInputDrafts(): Promise<void> {
    // Browser input events can finish in a microtask immediately after the
    // submit/exit callback starts. Give that input one turn to register its
    // optimistic snapshot before freezing a durable terminal transition.
    await Promise.resolve()
    while (true) {
      const revision = this.inputRevision
      const write = this.inputWrite
      await write
      await Promise.resolve()
      if (
        revision === this.inputRevision &&
        write === this.inputWrite
      ) {
        return
      }
    }
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

  private activeTimingPhase(
    session: ListeningSession = this.requireSession(),
  ): 'answering' | 'feedback' {
    if (session.phase === 'feedback') {
      return 'feedback'
    }
    if (
      session.phase === 'paused' &&
      session.pausedFromPhase === 'feedback'
    ) {
      return 'feedback'
    }
    return 'answering'
  }

  private trackPlaybackTiming(operation: Promise<void>): void {
    const previous = this.playbackTimingWrite
    this.playbackTimingWrite = Promise.all([
      previous,
      operation,
    ]).then(() => undefined)
    void this.playbackTimingWrite.catch(() => undefined)
  }

  private handlePlaybackEvent(
    event: ListeningPlaybackLifecycleEvent,
  ): void {
    const session = this.session
    if (!session) {
      return
    }
    const phase = this.activeTimingPhase(session)
    const operation =
      event === 'waiting'
        ? this.timing.beginMediaWait()
        : event === 'started' || event === 'resumed'
          ? this.timing.mediaStarted()
          : event === 'paused'
            ? this.timing.mediaPaused()
            : event === 'ended'
              ? this.timing.mediaEnded(phase)
              : this.timing.mediaCanceled()
    this.trackPlaybackTiming(operation)
  }

  private queuePlaybackSave(session: ListeningSession): void {
    this.stageSession(session)
    this.notify(session)
    const phase = this.activeTimingPhase(session)
    const activatePhase =
      session.playback.status === 'ended' ||
      session.phase === 'feedback'
    this.playbackWrite = (async () => {
      if (session.phase === 'paused') {
        await this.queueSessionWrite(session)
        return
      }
      await this.timing.beginPersistenceWait(phase, false)
      await this.queueSessionWrite(session)
      await this.timing.endPersistenceWait(phase, activatePhase)
    })()
    void this.playbackWrite.catch(() => undefined)
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
    const reporting = this.reportFailure({
      category,
      message:
        category === 'network'
          ? '设备语音需要网络，但当前播放请求失败。'
          : category === 'interrupted'
            ? '设备中断了本次语音播放。'
            : '设备合成语音暂时不可用。',
    }).then(() => undefined)
    this.speechFailureWrite = reporting
    void reporting.finally(() => {
      if (this.speechFailureWrite === reporting) {
        this.speechFailureWrite = Promise.resolve()
      }
      this.reportingSpeechFailure = false
    }).catch(() => undefined)
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
      onPlaybackEvent: (event) =>
        this.handlePlaybackEvent(event),
      onFailure: (code) => this.handleSpeechFailure(code),
    })
  }

  private async flushPendingEvents(): Promise<ListeningSession> {
    let session = this.requireSession()
    while (session.pendingWrongAnswerEvidence?.length) {
      if (!this.publishWrongAnswerEvidence) break
      const evidence = session.pendingWrongAnswerEvidence[0]!
      await this.publishWrongAnswerEvidence(evidence)
      const acknowledged = { ...session, pendingWrongAnswerEvidence: session.pendingWrongAnswerEvidence.slice(1) }
      try {
        session = await this.save(acknowledged)
      } catch (error) {
        // The library may have accepted the fact, but without an acknowledged
        // local deletion this exact event id must remain replayable.
        this.session = session
        throw error
      }
    }
    while (session.pendingEvents.length > 0) {
      const event = session.pendingEvents[0]
      if (
        (event.type === 'learning.attempt.completed.v1' &&
          event.payload.taskCompleted) ||
        event.type === 'learning.training.budget.completed.v1'
      ) {
        await this.timing.finish()
      }
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

  private untrustedLegacyDuration(
    session: ListeningSession,
  ): number {
    if (this.timing.enabled) {
      return 0
    }
    return Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
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

  private streamRequest(stream: ListeningStreamState | null): LearningTaskSupplyRequest {
    const completed = stream?.completedItemIds ?? []
    const cursor = stream?.nextSupplyCursor ?? null
    return {
      schemaVersion: 1,
      requestId: `${this.task.taskId}:supply:${completed.length + 1}:${cursor ?? 'initial'}`,
      planId: this.task.planId,
      taskId: this.task.taskId,
      domain: 'listening',
      targetModuleId: 'listening',
      mode: this.task.mode,
      targetDifficulty: this.task.difficultyLevel,
      cursor,
      excludeItemIds: completed,
      reason: completed.length === 0 ? 'initial' : 'continue-after-item',
    }
  }

  private async nextStreamItem(
    catalog: ListeningCatalog,
    stream: ListeningStreamState | null,
  ) {
    const provider = this.suppliedProvider ?? new ListeningCatalogSupplyProvider(
      catalog.trainingSupplyIndex,
      catalog,
    )
    const request = this.streamRequest(stream)
    const result = await provider.next(request)
    if (result.requestId !== request.requestId) {
      throw new ListeningError('content-invalid', 'Listening supply returned a mismatched request.')
    }
    return { request, result }
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
      if (!this.speech.capabilities().supported) {
        throw new ListeningError(
          'speech-unavailable',
          '当前浏览器无法使用设备合成语音。',
        )
      }
      if (this.continuousTraining) {
        const { request, result } = await this.nextStreamItem(catalog, null)
        if (result.status !== 'item') {
          session = createFailedListeningSession(this.task, { category: 'content', message: '当前没有可继续的听力题目。' }, now)
          session = withPendingListeningEvent(session, startedEvent, now)
          session = withPendingListeningEvent(session, createListeningTrainingContentExhaustedEvent(this.task, request.requestId, request.cursor, result.reason, this.identity(now)), now)
          await this.save(session)
          return this.flushPendingEvents()
        }
        const supplied = resolveListeningSupplyQuestion(catalog, result.item as import('./types.ts').ListeningSupplyItem)
        session = createListeningStreamSession(this.task, supplied.unit, supplied.question, now)
        session = {
          ...session,
          stream: {
            activeItem: result.item as import('./types.ts').ListeningSupplyItem,
            activeRequestId: request.requestId,
            nextSupplyCursor: result.nextCursor,
            completedItemIds: [],
            completedItemCount: 0,
            correctItemCount: 0,
            finishCurrentItem: this.trainingBudgetStatus?.() === 'finish-current-item',
            exhaustionRequestId: null,
            recoveryEventId: null,
          },
        }
      } else {
        const unit = resolveListeningTask(catalog, this.task)
        session = createListeningSession(this.task, unit, now)
      }
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
    await this.timing.startLoading()
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
      const session = await this.flushPendingEvents()
      await this.timing.synchronize(session.phase, {
        activateAnswering:
          session.phase === 'answering' &&
          session.playback.status === 'ended',
      })
      return session
    }
    const session = await this.startFresh()
    await this.timing.synchronize(session.phase)
    return session
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
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
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
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
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
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
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
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
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

  private async submitInternal(): Promise<ListeningSession> {
    this.controller?.interrupt()
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
    await this.waitForInputDrafts()
    await this.timing.beginPersistenceWait('answering', true)
    const submittedAt = this.now()
    const before = this.requireSession()
    let submitted = submitListeningAnswer(before, submittedAt)
    const answer = submitted.answers.at(-1)
    let identity: ReviewContentIdentity | null | undefined
    try {
      identity = before.stream?.activeItem && this.reviewIdentityForItem?.(before.stream.activeItem)
    } catch {
      // A 05 identity lookup is optional evidence enrichment.  It must not
      // erase a formally scored listening feedback checkpoint.
      identity = null
    }
    if (answer && !answer.correct && identity) {
      const itemId = before.stream!.activeItem.itemId
      submitted = {
        ...submitted,
        pendingWrongAnswerEvidence: [
          ...(submitted.pendingWrongAnswerEvidence ?? []),
          { schemaVersion: 1, eventId: `listening:${this.task.taskId}:${itemId}:${answer.submittedAt}:wrong-answer`, occurredAt: answer.submittedAt, domain: 'listening', source: 'daily-training', outcome: 'incorrect', formallyScored: true, ...identity },
        ],
      }
    }
    const saved = await this.save(
      submitted,
      {
        beforeNotify: () =>
          this.timing.endPersistenceWait('feedback', true),
      },
    )
    void saved
    return this.flushPendingEvents()
  }

  submit(): Promise<ListeningSession> {
    return this.enqueue(() => this.submitInternal())
  }

  private async advanceInternal(): Promise<ListeningSession> {
    this.controller?.dispose()
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
    await this.timing.beginPersistenceWait('feedback', true)
    const now = this.now()
    const current = this.requireSession()
    let session = advanceListeningSession(current, now)
    if (this.continuousTraining && current.stream) {
      const active = current.stream
      const answer = current.answers[0]
      if (!answer) {
        throw new ListeningError('session-transition-invalid', 'Budget listening item requires one submitted answer.')
      }
      const alreadyCompleted = active.completedItemIds.includes(active.activeItem.itemId)
      const completedStream: ListeningStreamState = {
        ...active,
        completedItemIds: alreadyCompleted
          ? active.completedItemIds
          : [...active.completedItemIds, active.activeItem.itemId],
        completedItemCount: active.completedItemCount + (alreadyCompleted ? 0 : 1),
        correctItemCount: active.correctItemCount + (answer.correct ? 1 : 0),
        finishCurrentItem: active.finishCurrentItem || this.trainingBudgetStatus?.() === 'finish-current-item',
      }
      session = withPendingListeningEvent(session, createListeningStreamAttemptEvent(current, this.untrustedLegacyDuration(current), this.identity(now)), now)
      session = withPendingListeningEvent(session, createListeningTrainingItemCompletedEvent(this.task, active.activeItem, active.activeRequestId, active.nextSupplyCursor, this.identity(now)), now)
      if (completedStream.finishCurrentItem) {
        session = completeListeningStreamSession(session, completedStream, now)
        session = withPendingListeningEvent(session, createListeningTrainingBudgetCompletedEvent(this.task, active.activeItem.itemId, completedStream.completedItemCount, this.identity(now)), now)
      } else {
        try {
          const catalog = await this.contentSource.load()
          const { request, result } = await this.nextStreamItem(catalog, completedStream)
          if (result.status !== 'item') {
            session = {
              ...session,
              phase: 'error', pausedFromPhase: null, lastActiveAt: null,
              failure: { category: 'content', message: '当前没有可继续的听力题目。' },
              stream: { ...completedStream, exhaustionRequestId: request.requestId, recoveryEventId: null }, updatedAt: now,
            }
            session = withPendingListeningEvent(session, createListeningTrainingContentExhaustedEvent(this.task, request.requestId, request.cursor, result.reason, this.identity(now)), now)
          } else {
            const supplied = resolveListeningSupplyQuestion(catalog, result.item as import('./types.ts').ListeningSupplyItem)
            session = replaceListeningStreamQuestion(session, supplied.unit, supplied.question, {
              ...completedStream,
              activeItem: result.item as import('./types.ts').ListeningSupplyItem,
              activeRequestId: request.requestId,
              nextSupplyCursor: result.nextCursor,
            }, now)
          }
        } catch (error) {
          session = {
            ...session,
            phase: 'error', pausedFromPhase: null, lastActiveAt: null,
            failure: this.failureFor(error), stream: completedStream, updatedAt: now,
          }
        }
      }
    }
    if (session.phase === 'completed' && !this.continuousTraining) {
      const durationSeconds = this.untrustedLegacyDuration(session)
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
    await this.save(session, {
      notify: session.phase !== 'completed',
      beforeNotify:
        session.phase === 'completed'
          ? undefined
          : () =>
              this.timing.endPersistenceWait('answering', false),
    })
    this.attachController(session)
    return this.flushPendingEvents()
  }

  advance(): Promise<ListeningSession> {
    return this.enqueue(() => this.advanceInternal())
  }

  private async pauseInternal(
    reason: TaskPauseReason,
  ): Promise<ListeningSession> {
    const current = this.requireSession()
    if (current.phase === 'paused') {
      return current
    }
    this.controller?.interrupt()
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
    await this.waitForInputDrafts()
    await this.timing.pause()
    const now = this.now()
    let session = pauseListeningSession(this.requireSession(), now)
    const durationSeconds = this.untrustedLegacyDuration(session)
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

  pause(reason: TaskPauseReason): Promise<ListeningSession> {
    return this.enqueue(() => this.pauseInternal(reason))
  }

  private async resumeInternal(): Promise<ListeningSession> {
    await this.timing.startLoading()
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
    session = await this.flushPendingEvents()
    await this.timing.synchronize(session.phase, {
      resume: true,
      activateAnswering: true,
    })
    return session
  }

  resume(): Promise<ListeningSession> {
    return this.enqueue(() => this.resumeInternal())
  }

  private async skipInternal(
    reason: TaskSkipReason,
  ): Promise<ListeningSession> {
    let session = this.requireSession()
    if (session.phase === 'answering' || session.phase === 'feedback') {
      session = await this.pauseInternal(
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

  skip(reason: TaskSkipReason): Promise<ListeningSession> {
    return this.enqueue(() => this.skipInternal(reason))
  }

  private async reportFailureInternal(
    failure: ListeningSessionFailure,
  ): Promise<ListeningSession> {
    const current = this.requireSession()
    if (current.phase === 'error') {
      return current
    }
    this.controller?.dispose()
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
    await this.timing.startLoading()
    const now = this.now()
    let session = failListeningSession(current, failure, now)
    const durationSeconds = this.untrustedLegacyDuration(session)
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

  reportFailure(
    failure: ListeningSessionFailure,
  ): Promise<ListeningSession> {
    return this.enqueue(() =>
      this.reportFailureInternal(failure),
    )
  }

  private async retryPendingEventsInternal(): Promise<ListeningSession> {
    await this.speechFailureWrite
    return this.flushPendingEvents()
  }

  retryPendingEvents(): Promise<ListeningSession> {
    return this.enqueue(() => this.retryPendingEventsInternal())
  }

  /** Retries an explicit supply failure without discarding acknowledged item ids. */
  retrySupply(): Promise<ListeningSession> {
    return this.enqueue(async () => {
      await this.timing.startLoading()
      const current = this.requireSession()
      if (!this.continuousTraining || current.phase !== 'error' || !current.stream) {
        throw new ListeningError('session-transition-invalid', 'Only an exhausted listening stream can request more content.')
      }
      if (current.stream.exhaustionRequestId === null) {
        throw new ListeningError('session-transition-invalid', 'Listening stream has no acknowledged exhaustion to recover.')
      }
      const exhaustionRequestId = current.stream.exhaustionRequestId
      const recoveryEventId = current.stream.recoveryEventId ??
        `listening:${this.task.taskId}:content-recovered:${exhaustionRequestId}`
      const catalog = await this.contentSource.load()
      const { request, result } = await this.nextStreamItem(catalog, current.stream)
      if (result.status !== 'item') {
        // The task is already blocked by the persisted exhaustion request.
        // Do not replace that identity or create an invalid second exhaustion.
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
        recovery = withPendingListeningEvent(
          recovery,
          createListeningTrainingContentRecoveredEvent(
            this.task,
            exhaustionRequestId,
            { eventId: recoveryEventId, occurredAt: now, localDate: this.localDate },
          ),
          now,
        )
        await this.save(recovery)
      }
      recovery = await this.flushPendingEvents()
      const supplied = resolveListeningSupplyQuestion(catalog, result.item as import('./types.ts').ListeningSupplyItem)
      const session = replaceListeningStreamQuestion(recovery, supplied.unit, supplied.question, {
        ...recovery.stream!,
        activeItem: result.item as import('./types.ts').ListeningSupplyItem,
        activeRequestId: request.requestId,
        nextSupplyCursor: result.nextCursor,
        exhaustionRequestId: null,
        recoveryEventId: null,
      }, now)
      await this.save(session)
      this.attachController(session)
      await this.timing.synchronize(session.phase, { activateAnswering: true })
      return session
    })
  }

  private async restartInternal(): Promise<ListeningSession> {
    this.controller?.dispose()
    await Promise.all([
      this.playbackWrite,
      this.playbackTimingWrite,
    ])
    await this.timing.startLoading()
    if (this.session && this.session.pendingEvents.length > 0) {
      await this.flushPendingEvents()
    }
    await this.repository.delete(this.task.taskId)
    this.session = null
    const session = await this.startFresh()
    await this.timing.synchronize(session.phase)
    return session
  }

  restart(): Promise<ListeningSession> {
    return this.enqueue(() => this.restartInternal())
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.controller?.dispose()
    this.controller = null
    const disposal = this.enqueue(async () => {
      await this.initializing
      await Promise.all([
        this.playbackWrite,
        this.playbackTimingWrite,
        this.speechFailureWrite,
      ])
      await this.waitForInputDrafts()
      await this.timing.dispose()
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
