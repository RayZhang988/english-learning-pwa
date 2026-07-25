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
import type {
  VocabularyCatalog,
  VocabularySession,
  VocabularySessionFailure,
} from './types.ts'

type TaskPauseReason = LearningTaskPausedEvent['payload']['reason']
type TaskSkipReason = LearningTaskSkippedEvent['payload']['reason']

export interface VocabularyTrainingRuntimeOptions {
  readonly task: LearningTask
  readonly localDate: string
  readonly contentSource: ReadonlyDataSource<VocabularyCatalog>
  readonly eventSink: PlatformEventSink
  readonly repository?: VocabularySessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly now?: () => string
  readonly createId?: () => string
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
  private session: VocabularySession | null = null
  private initializing: Promise<VocabularySession> | null = null

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
  }

  get currentSession(): VocabularySession | null {
    return this.session
  }

  private identity(now: string) {
    return {
      eventId: `vocabulary:${this.task.taskId}:${this.createId()}`,
      occurredAt: now,
      localDate: this.localDate,
    }
  }

  private async save(session: VocabularySession): Promise<VocabularySession> {
    this.session = session
    await this.repository.save(session)
    return session
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
    const stored = await this.repository.load(this.task)
    if (stored) {
      this.session = stored
      return this.flushPendingEvents()
    }
    return this.startFresh()
  }

  initialize(): Promise<VocabularySession> {
    if (this.initializing) {
      return this.initializing
    }
    const initialization = this.initializeInternal()
    this.initializing = initialization
    const clearInitialization = () => {
      if (this.initializing === initialization) {
        this.initializing = null
      }
    }
    void initialization.then(clearInitialization, clearInitialization)
    return initialization
  }

  async select(optionId: string): Promise<VocabularySession> {
    return this.save(
      selectVocabularyOption(this.requireSession(), optionId, this.now()),
    )
  }

  async submit(): Promise<VocabularySession> {
    return this.save(
      submitVocabularyAnswer(this.requireSession(), this.now()),
    )
  }

  async advance(): Promise<VocabularySession> {
    const now = this.now()
    let session = advanceVocabularySession(this.requireSession(), now)
    if (session.phase === 'completed') {
      const durationSeconds = Math.max(
        0,
        session.activeDurationSeconds - session.reportedDurationSeconds,
      )
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
    return this.flushPendingEvents()
  }

  async pause(reason: TaskPauseReason): Promise<VocabularySession> {
    const now = this.now()
    let session = pauseVocabularySession(this.requireSession(), now)
    const durationSeconds = Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
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

  async resume(): Promise<VocabularySession> {
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
    return this.flushPendingEvents()
  }

  async skip(reason: TaskSkipReason): Promise<VocabularySession> {
    const now = this.now()
    let session = this.requireSession()
    if (session.phase === 'answering' || session.phase === 'feedback') {
      session = pauseVocabularySession(session, now)
      const durationSeconds = Math.max(
        0,
        session.activeDurationSeconds - session.reportedDurationSeconds,
      )
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
  }

  async reportFailure(
    failure: VocabularySessionFailure,
  ): Promise<VocabularySession> {
    const now = this.now()
    let session = failVocabularySession(
      this.requireSession(),
      failure,
      now,
    )
    const durationSeconds = Math.max(
      0,
      session.activeDurationSeconds - session.reportedDurationSeconds,
    )
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
  }

  retryPendingEvents(): Promise<VocabularySession> {
    return this.flushPendingEvents()
  }

  async restart(): Promise<VocabularySession> {
    if (this.session && this.session.pendingEvents.length > 0) {
      await this.flushPendingEvents()
    }
    await this.repository.delete(this.task.taskId)
    this.session = null
    return this.startFresh()
  }
}
