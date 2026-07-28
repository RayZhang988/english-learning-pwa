import {
  type PlatformEventSink,
  type ReadonlyDataSource,
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
import { resolveVocabularyTask } from './content.ts'
import { toVocabularyError, VocabularyError } from './errors.ts'
import {
  createVocabularyCompletedEvent,
  createVocabularyTaskPausedEvent,
  createVocabularyTaskSkippedEvent,
  createVocabularyTaskStartedEvent,
  createVocabularyUnscorableEvent,
} from './events.ts'
import { buildVocabularyQuestions } from './questions.ts'
import { VocabularySessionRepository } from './repository.ts'
import {
  advanceVocabularySession,
  createFailedVocabularySession,
  createVocabularySession,
  failVocabularySession,
  pauseVocabularySession,
  resumeVocabularySession,
  selectVocabularyOption,
  submitVocabularyAnswer,
  withPendingVocabularyEvent,
  withoutPendingVocabularyEvent,
} from './session.ts'
import {
  VocabularyEffectiveTiming,
  type VocabularyEffectiveTimingSessionFactoryPort,
} from './timing.ts'
import type {
  VocabularyCatalog,
  VocabularySession,
  VocabularySessionFailure,
} from './types.ts'

type TaskPauseReason = LearningTaskPausedEvent['payload']['reason']
type TaskSkipReason = LearningTaskSkippedEvent['payload']['reason']
export type VocabularySessionListener = (
  session: VocabularySession,
) => void

export interface VocabularyTrainingRuntimeOptions {
  readonly task: LearningTask
  readonly localDate: string
  readonly contentSource: ReadonlyDataSource<VocabularyCatalog>
  readonly eventSink: PlatformEventSink
  readonly repository?: VocabularySessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly now?: () => string
  readonly createId?: () => string
  readonly timingSessionFactory?: VocabularyEffectiveTimingSessionFactoryPort
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

export class VocabularyTrainingRuntime {
  private readonly task: LearningTask
  private readonly localDate: string
  private readonly contentSource: ReadonlyDataSource<VocabularyCatalog>
  private readonly eventSink: PlatformEventSink
  private readonly repository: VocabularySessionRepository
  private readonly networkStatus: NetworkStatusService
  private readonly now: () => string
  private readonly createId: () => string
  private readonly timing: VocabularyEffectiveTiming
  private session: VocabularySession | null = null
  private initializing: Promise<VocabularySession> | null = null
  private operationTail: Promise<void> | null = null
  private readonly sessionListeners = new Set<VocabularySessionListener>()

  constructor(options: VocabularyTrainingRuntimeOptions) {
    this.task = options.task
    this.localDate = options.localDate
    this.contentSource = options.contentSource
    this.eventSink = options.eventSink
    this.repository =
      options.repository ?? new VocabularySessionRepository()
    this.networkStatus = options.networkStatus ?? browserNetworkStatus
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? defaultId
    this.timing = new VocabularyEffectiveTiming(
      this.task.taskId,
      options.timingSessionFactory,
    )
  }

  get currentSession(): VocabularySession | null {
    return this.session
  }

  subscribe(listener: VocabularySessionListener): () => void {
    this.sessionListeners.add(listener)
    return () => {
      this.sessionListeners.delete(listener)
    }
  }

  private setSession(session: VocabularySession): void {
    this.session = session
    for (const listener of this.sessionListeners) {
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
      eventId: `vocabulary:${this.task.taskId}:${this.createId()}`,
      occurredAt: now,
      localDate: this.localDate,
    }
  }

  private async save(session: VocabularySession): Promise<VocabularySession> {
    const previous = this.session
    this.setSession(session)
    try {
      await this.repository.save(session)
      return session
    } catch (error) {
      if (this.session === session && previous) {
        this.setSession(previous)
      } else if (this.session === session) {
        this.session = null
      }
      throw error
    }
  }

  private requireSession(): VocabularySession {
    if (!this.session) {
      throw new VocabularyError(
        'session-transition-invalid',
        'Vocabulary runtime has not been initialized.',
      )
    }
    return this.session
  }

  private async flushPendingEvents(): Promise<VocabularySession> {
    let session = this.requireSession()
    while (session.pendingEvents.length > 0) {
      const event = session.pendingEvents[0]
      if (
        event.type === 'learning.attempt.completed.v1' &&
        event.payload.taskCompleted
      ) {
        await this.timing.finish()
      }
      await this.eventSink.publish(event)
      session = withoutPendingVocabularyEvent(
        session,
        event.id,
        this.now(),
      )
      await this.save(session)
    }
    return session
  }

  private untrustedLegacyDuration(
    session: VocabularySession,
  ): number {
    if (this.timing.enabled) {
      return 0
    }
    return Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
  }

  private failureFor(error: unknown): VocabularySessionFailure {
    const vocabularyError = toVocabularyError(error)
    if (
      vocabularyError.code === 'content-unavailable' &&
      this.networkStatus.current() === 'offline'
    ) {
      return {
        category: 'network',
        message: '当前离线，且该词汇课程尚未完整下载。',
      }
    }
    return {
      category: 'content',
      message: vocabularyError.message,
    }
  }

  private async startFresh(): Promise<VocabularySession> {
    const now = this.now()
    const startedEvent = createVocabularyTaskStartedEvent(
      this.task,
      this.identity(now),
    )
    let session: VocabularySession

    try {
      const catalog = await this.contentSource.load()
      const unit = resolveVocabularyTask(catalog, this.task)
      const questions = buildVocabularyQuestions(unit)
      session = createVocabularySession(this.task, questions, now)
      session = withPendingVocabularyEvent(session, startedEvent, now)
    } catch (error) {
      const failure = this.failureFor(error)
      session = createFailedVocabularySession(this.task, failure, now)
      session = withPendingVocabularyEvent(session, startedEvent, now)
      session = withPendingVocabularyEvent(
        session,
        createVocabularyUnscorableEvent(
          this.task,
          failure.category,
          0,
          this.identity(now),
        ),
        now,
      )
    }

    await this.save(session)
    return this.flushPendingEvents()
  }

  private async initializeInternal(): Promise<VocabularySession> {
    await this.timing.startLoading()
    const stored = await this.repository.load(this.task)
    let session: VocabularySession
    if (stored) {
      this.setSession(stored)
      session = await this.flushPendingEvents()
    } else {
      session = await this.startFresh()
    }
    await this.timing.synchronize(session.phase)
    return session
  }

  initialize(): Promise<VocabularySession> {
    if (this.initializing) {
      return this.initializing
    }
    const initialization = this.enqueue(() => this.initializeInternal())
    this.initializing = initialization
    const clearInitialization = () => {
      if (this.initializing === initialization) {
        this.initializing = null
      }
    }
    void initialization.then(clearInitialization, clearInitialization)
    return initialization
  }

  select(optionId: string): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.beginPersistenceWait(true)
      const session = await this.save(
        selectVocabularyOption(this.requireSession(), optionId, this.now()),
      )
      await this.timing.synchronize(session.phase)
      return session
    })
  }

  submit(): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.beginPersistenceWait(true)
      const session = await this.save(
        submitVocabularyAnswer(this.requireSession(), this.now()),
      )
      await this.timing.synchronize(session.phase)
      return session
    })
  }

  advance(): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.beginPersistenceWait(true)
      const now = this.now()
      let session = advanceVocabularySession(this.requireSession(), now)
      if (session.phase === 'completed') {
        const durationSeconds = this.untrustedLegacyDuration(session)
        session = {
          ...session,
          reportedDurationSeconds: session.activeDurationSeconds,
        }
        session = withPendingVocabularyEvent(
          session,
          createVocabularyCompletedEvent(
            session,
            durationSeconds,
            this.identity(now),
          ),
          now,
        )
      }
      await this.save(session)
      session = await this.flushPendingEvents()
      await this.timing.synchronize(session.phase)
      return session
    })
  }

  private async pauseInternal(
    reason: TaskPauseReason,
  ): Promise<VocabularySession> {
    await this.timing.pause()
    const now = this.now()
    let session = pauseVocabularySession(this.requireSession(), now)
    const durationSeconds = this.untrustedLegacyDuration(session)
    session = {
      ...session,
      reportedDurationSeconds: session.activeDurationSeconds,
    }
    session = withPendingVocabularyEvent(
      session,
      createVocabularyTaskPausedEvent(
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

  pause(reason: TaskPauseReason): Promise<VocabularySession> {
    return this.enqueue(() => this.pauseInternal(reason))
  }

  pauseIfActive(reason: TaskPauseReason): Promise<VocabularySession> {
    return this.enqueue(() => {
      const session = this.requireSession()
      if (session.phase !== 'answering' && session.phase !== 'feedback') {
        return Promise.resolve(session)
      }
      return this.pauseInternal(reason)
    })
  }

  resume(): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.beginPersistenceWait(true)
      const now = this.now()
      let session = resumeVocabularySession(this.requireSession(), now)
      session = withPendingVocabularyEvent(
        session,
        createVocabularyTaskStartedEvent(
          session.task,
          this.identity(now),
        ),
        now,
      )
      await this.save(session)
      session = await this.flushPendingEvents()
      await this.timing.synchronize(session.phase, true)
      return session
    })
  }

  skip(reason: TaskSkipReason): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.pause()
      const now = this.now()
      let session = this.requireSession()
      if (session.phase === 'answering' || session.phase === 'feedback') {
        session = pauseVocabularySession(session, now)
        const durationSeconds = this.untrustedLegacyDuration(session)
        session = {
          ...session,
          reportedDurationSeconds: session.activeDurationSeconds,
        }
        const pauseReason: TaskPauseReason =
          reason === 'time-budget-ended'
            ? 'time-budget-ended'
            : reason === 'device-failure'
              ? 'device-failure'
              : reason === 'content-failure'
                ? 'content-failure'
                : 'user-paused'
        session = withPendingVocabularyEvent(
          session,
          createVocabularyTaskPausedEvent(
            session.task,
            pauseReason,
            durationSeconds,
            this.identity(now),
          ),
          now,
        )
      }
      session = withPendingVocabularyEvent(
        session,
        createVocabularyTaskSkippedEvent(
          session.task,
          reason,
          this.identity(now),
        ),
        now,
      )
      await this.save(session)
      return this.flushPendingEvents()
    })
  }

  reportFailure(
    failure: VocabularySessionFailure,
  ): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.beginPersistenceWait(false)
      const now = this.now()
      let session = failVocabularySession(
        this.requireSession(),
        failure,
        now,
      )
      const durationSeconds = this.untrustedLegacyDuration(session)
      session = {
        ...session,
        reportedDurationSeconds: session.activeDurationSeconds,
      }
      session = withPendingVocabularyEvent(
        session,
        createVocabularyUnscorableEvent(
          session.task,
          failure.category,
          durationSeconds,
          this.identity(now),
        ),
        now,
      )
      await this.save(session)
      return this.flushPendingEvents()
    })
  }

  retryPendingEvents(): Promise<VocabularySession> {
    return this.enqueue(async () => {
      const session = await this.flushPendingEvents()
      await this.timing.synchronize(session.phase)
      return session
    })
  }

  restart(): Promise<VocabularySession> {
    return this.enqueue(async () => {
      await this.timing.startLoading()
      if (this.session && this.session.pendingEvents.length > 0) {
        await this.flushPendingEvents()
      }
      await this.repository.delete(this.task.taskId)
      this.session = null
      const session = await this.startFresh()
      await this.timing.synchronize(session.phase)
      return session
    })
  }

  dispose(): Promise<void> {
    return this.enqueue(() => this.timing.dispose())
  }
}
