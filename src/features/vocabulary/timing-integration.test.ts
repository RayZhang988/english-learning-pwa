import { describe, expect, it } from 'vitest'
import {
  createStaticDataSource,
} from '../../core/testing/index.ts'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import type {
  DailyPlan,
  LearningTask,
  LearningTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import {
  applyPlanEvent,
  createPlanProgress,
  parseLearningEvent,
} from '../../learning-engine/index.ts'
import {
  EffectiveTimingSession,
  type EffectiveTimingClock,
  type EffectiveTimingScheduler,
  type EffectiveTimingSessionSnapshot,
  type EffectiveTimingSnapshotStore,
  type EffectiveTimingTaskIdentity,
  type TimingLifecycleEvent,
  type TimingLifecyclePort,
  type TimingLifecycleVisibility,
} from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularySessionRepository } from './repository.ts'
import { VocabularyTrainingRuntime } from './runtime.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'
import type {
  VocabularyEffectiveTimingSessionFactoryPort,
  VocabularyEffectiveTimingSessionPort,
  VocabularyTimingPhaseDeclaration,
} from './timing.ts'

const START_WALL_MS = Date.parse('2026-07-27T08:00:00.000Z')

class ManualTime
  implements EffectiveTimingClock, EffectiveTimingScheduler
{
  wallTimeMs = START_WALL_MS
  monotonicTimeMs = 0
  #nextTimerId = 1
  readonly #timers = new Map<
    number,
    { readonly dueAt: number; readonly callback: () => void }
  >()

  now() {
    return {
      wallTimeMs: this.wallTimeMs,
      monotonicTimeMs: this.monotonicTimeMs,
    }
  }

  set(callback: () => void, delayMs: number): unknown {
    const id = this.#nextTimerId
    this.#nextTimerId += 1
    this.#timers.set(id, {
      dueAt: this.monotonicTimeMs + delayMs,
      callback,
    })
    return id
  }

  clear(handle: unknown): void {
    this.#timers.delete(handle as number)
  }

  advance(milliseconds: number): void {
    const target = this.monotonicTimeMs + milliseconds
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort(
          (left, right) =>
            left[1].dueAt - right[1].dueAt || left[0] - right[0],
        )[0]
      if (!next) {
        break
      }
      const [id, timer] = next
      this.#timers.delete(id)
      const elapsed = timer.dueAt - this.monotonicTimeMs
      this.monotonicTimeMs = timer.dueAt
      this.wallTimeMs += elapsed
      timer.callback()
    }
    const remaining = target - this.monotonicTimeMs
    this.monotonicTimeMs = target
    this.wallTimeMs += remaining
  }

  jumpWithoutRunningTimers(milliseconds: number): void {
    this.monotonicTimeMs += milliseconds
    this.wallTimeMs += milliseconds
  }
}

class ManualLifecycle implements TimingLifecyclePort {
  visibility: TimingLifecycleVisibility = 'foreground'
  readonly listeners = new Set<(event: TimingLifecycleEvent) => void>()

  currentVisibility(): TimingLifecycleVisibility {
    return this.visibility
  }

  subscribe(
    listener: (event: TimingLifecycleEvent) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: TimingLifecycleEvent): void {
    if (event.type === 'background') {
      this.visibility = 'background'
    } else if (event.type === 'foreground') {
      this.visibility = 'foreground'
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

class MemoryTimingSnapshotStore
  implements EffectiveTimingSnapshotStore
{
  readonly records = new Map<string, EffectiveTimingSessionSnapshot>()

  async load(identity: EffectiveTimingTaskIdentity) {
    return this.records.get(identity.taskId)
  }

  async save(snapshot: EffectiveTimingSessionSnapshot): Promise<void> {
    this.records.set(
      snapshot.identity.taskId,
      structuredClone(snapshot),
    )
  }

  async delete(identity: EffectiveTimingTaskIdentity): Promise<void> {
    this.records.delete(identity.taskId)
  }
}

class ControllableVocabularyStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  #blockNext = false
  #blocked: Promise<void> = Promise.resolve()
  #notifyBlocked: (() => void) | undefined
  #release: (() => void) | undefined

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  blockNextPut(): void {
    this.#blockNext = true
    this.#blocked = new Promise((resolve) => {
      this.#notifyBlocked = resolve
    })
  }

  waitForBlockedPut(): Promise<void> {
    return this.#blocked
  }

  releasePut(): void {
    this.#release?.()
    this.#release = undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.#blockNext) {
      this.#blockNext = false
      const released = new Promise<void>((resolve) => {
        this.#release = resolve
      })
      this.#notifyBlocked?.()
      this.#notifyBlocked = undefined
      await released
    }
    this.records.set(key, {
      namespace: 'feature.vocabulary',
      key,
      value,
      schemaVersion,
      updatedAt: new Date(START_WALL_MS).toISOString(),
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<readonly string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

class RecordingSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []

  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(event)
  }
}

function timingIdentity(task: LearningTask): EffectiveTimingTaskIdentity {
  return {
    planId: task.planId,
    taskId: task.taskId,
    learningUnitId: task.learningUnitId,
    contentRef: task.contentRef,
    domain: task.domain,
    targetModuleId: task.targetModuleId,
    localDate: '2026-07-27',
    mode: task.mode,
  }
}

function planFor(task: LearningTask): DailyPlan {
  const allocation = (domain: 'vocabulary' | 'listening' | 'speaking') => ({
    domain,
    weaknessWeight: 1,
    targetDifficulty: task.difficultyLevel,
    targetSeconds: domain === 'vocabulary' ? task.estimatedSeconds : 0,
    plannedSeconds: domain === 'vocabulary' ? task.estimatedSeconds : 0,
  })
  return {
    schemaVersion: 1,
    planId: task.planId,
    localDate: '2026-07-27',
    generatedAt: '2026-07-27T08:00:00.000Z',
    targetSeconds: task.estimatedSeconds,
    plannedSeconds: task.estimatedSeconds,
    unfilledSeconds: 0,
    status: 'ready',
    tasks: [task],
    allocations: {
      vocabulary: allocation('vocabulary'),
      listening: allocation('listening'),
      speaking: allocation('speaking'),
    },
    warnings: [],
  }
}

function effectiveFactory(options: {
  readonly task: LearningTask
  readonly sink: PlatformEventSink
  readonly snapshots: EffectiveTimingSnapshotStore
  readonly lifecycle: TimingLifecyclePort
  readonly time: ManualTime
  readonly createId: () => string
}) {
  let sessionPromise: Promise<EffectiveTimingSession> | null = null
  const factory: VocabularyEffectiveTimingSessionFactoryPort = {
    create(taskId, expectedModuleId) {
      expect(taskId).toBe(options.task.taskId)
      expect(expectedModuleId).toBe('vocabulary')
      sessionPromise ??= EffectiveTimingSession.create({
        identity: timingIdentity(options.task),
        eventSink: options.sink,
        snapshotStore: options.snapshots,
        lifecycle: options.lifecycle,
        clock: options.time,
        scheduler: options.time,
        createId: options.createId,
      })
      return sessionPromise
    },
  }
  return {
    factory,
    session() {
      if (!sessionPromise) {
        throw new Error('Timing session has not been requested.')
      }
      return sessionPromise
    },
  }
}

function sequenceIds(prefix: string) {
  let value = 0
  return () => {
    value += 1
    return `${prefix}-${value}`
  }
}

async function vocabularySetup() {
  const catalog = createVocabularyCatalog(
    await loadActualVocabularyDocuments(),
  )
  const task = vocabularyTaskFor(catalog.units[0])
  return { catalog, task }
}

function timingEvents(
  sink: RecordingSink,
): LearningTimingSegmentRecordedEvent[] {
  return sink.events.filter(
    (
      event,
    ): event is LearningTimingSegmentRecordedEvent =>
      event.type === 'learning.timing.segment.recorded.v1',
  )
}

async function completeFromCurrent(
  runtime: VocabularyTrainingRuntime,
  beforeFinalAdvance?: () => void,
) {
  let session = runtime.currentSession!
  while (session.phase !== 'completed') {
    if (session.phase === 'answering') {
      const question = session.questions[session.questionIndex]
      session = await runtime.select(question.correctOptionId)
      session = await runtime.submit()
    } else if (session.phase === 'feedback') {
      if (
        session.questionIndex + 1 === session.questions.length
      ) {
        beforeFinalAdvance?.()
      }
      session = await runtime.advance()
    } else {
      throw new Error(`Unexpected phase ${session.phase}`)
    }
  }
  return session
}

class FailOnceFinishSession
  implements VocabularyEffectiveTimingSessionPort
{
  readonly calls: string[]
  failNextFinish = true
  finished = false

  constructor(calls: string[]) {
    this.calls = calls
  }

  async start(
    _declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {}

  async transition(
    _declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {}

  async activity(): Promise<void> {}

  async pause(): Promise<void> {}

  async resume(
    _declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {}

  async finish(): Promise<void> {
    this.calls.push('timing:finish')
    if (this.failNextFinish) {
      this.failNextFinish = false
      throw new Error('timing finish failed')
    }
    this.finished = true
    this.calls.push('timing:finished')
  }

  async dispose(): Promise<void> {}
}

describe('vocabulary effective timing integration', () => {
  it('excludes persistence, idle, and background while recording answering and feedback', async () => {
    const { catalog, task } = await vocabularySetup()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const vocabularyStore = new ControllableVocabularyStore()
    const repository = new VocabularySessionRepository(vocabularyStore)
    const sink = new RecordingSink()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'timing-session',
    })
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-27',
      contentSource: {
        async load() {
          time.advance(7_000)
          return catalog
        },
      },
      eventSink: sink,
      repository,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('business'),
    })
    let session = await runtime.initialize()

    time.advance(5_000)
    vocabularyStore.blockNextPut()
    const selecting = runtime.select(
      session.questions[0].correctOptionId,
    )
    await vocabularyStore.waitForBlockedPut()
    time.advance(10_000)
    vocabularyStore.releasePut()
    session = await selecting

    time.jumpWithoutRunningTimers(60_000)
    session = await runtime.submit()

    time.advance(3_000)
    lifecycle.emit({
      type: 'background',
      source: 'visibilitychange',
    })
    await (await timing.session()).flush()
    session = await runtime.pause('app-backgrounded')
    expect(session.phase).toBe('paused')

    time.jumpWithoutRunningTimers(120_000)
    lifecycle.emit({
      type: 'foreground',
      source: 'visibilitychange',
    })
    await (await timing.session()).flush()
    session = await runtime.resume()
    expect(session.phase).toBe('feedback')

    time.advance(2_000)
    session = await runtime.advance()
    expect(session.phase).toBe('answering')
    await completeFromCurrent(runtime, () => {
      time.advance(4_000)
    })

    const segments = timingEvents(sink)
    expect(
      segments.map((event) => [
        event.payload.reason,
        event.payload.elapsedSeconds,
      ]),
    ).toEqual([
      ['content-loading', 7],
      ['active-answering', 5],
      ['content-loading', 10],
      ['active-answering', 45],
      ['idle-timeout', 15],
      ['active-feedback', 3],
      ['active-feedback', 2],
      ['active-feedback', 4],
    ])
    expect(
      segments
        .filter((event) => event.payload.reason.startsWith('active-'))
        .reduce(
          (total, event) => total + event.payload.elapsedSeconds,
          0,
        ),
    ).toBe(59)
    expect(
      segments
        .filter(
          (event) =>
            event.payload.reason === 'content-loading' ||
            event.payload.reason === 'idle-timeout',
        )
        .reduce(
          (total, event) => total + event.payload.elapsedSeconds,
          0,
        ),
    ).toBe(32)

    const completionIndex = sink.events.findIndex(
      (event) => event.type === 'learning.attempt.completed.v1',
    )
    const lastTimingIndex = sink.events.findLastIndex(
      (event) => event.type === 'learning.timing.segment.recorded.v1',
    )
    expect(lastTimingIndex).toBeLessThan(completionIndex)
    const completion = parseLearningEvent(
      sink.events[completionIndex],
    )
    expect(completion.type).toBe('learning.attempt.completed.v1')
    if (completion.type === 'learning.attempt.completed.v1') {
      expect(completion.payload.durationSeconds).toBe(0)
    }
    const pauseEvent = sink.events
      .map((event) => parseLearningEvent(event))
      .find(
        (event) => event.type === 'learning.task.paused.v1',
      )
    expect(
      pauseEvent?.type === 'learning.task.paused.v1'
        ? pauseEvent.payload.durationSeconds
        : undefined,
    ).toBe(0)
    expect(snapshots.records.size).toBe(0)

    let progress = createPlanProgress(
      planFor(task),
      '2026-07-27T08:00:00.000Z',
    )
    for (const event of sink.events) {
      progress = applyPlanEvent(
        progress,
        parseLearningEvent(event),
      )
    }
    expect(progress.tasks[0]).toMatchObject({
      status: 'completed',
      effectiveSeconds: 59,
      excludedSeconds: 32,
      timingSegmentCount: 8,
      effectiveTimeSource: 'timing-segments',
    })
  })

  it('disposes on unload and never backfills time across a refresh', async () => {
    const { catalog, task } = await vocabularySetup()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const repository = new VocabularySessionRepository(
      new ControllableVocabularyStore(),
    )
    const sink = new RecordingSink()
    const firstTiming = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'restored-timing-session',
    })
    const common = {
      task,
      localDate: '2026-07-27',
      contentSource: createStaticDataSource(catalog),
      eventSink: sink,
      repository,
      now: () => new Date(time.wallTimeMs).toISOString(),
    }
    const firstRuntime = new VocabularyTrainingRuntime({
      ...common,
      timingSessionFactory: firstTiming.factory,
      createId: sequenceIds('first-business'),
    })

    await firstRuntime.initialize()
    time.advance(10_000)
    await firstRuntime.dispose()
    expect(snapshots.records.get(task.taskId)).toMatchObject({
      suspended: true,
      openSegment: null,
    })

    time.jumpWithoutRunningTimers(3_600_000)
    const secondTiming = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'must-not-replace-restored-id',
    })
    const secondRuntime = new VocabularyTrainingRuntime({
      ...common,
      timingSessionFactory: secondTiming.factory,
      createId: sequenceIds('second-business'),
    })

    const restored = await secondRuntime.initialize()
    expect(restored.phase).toBe('answering')
    time.advance(5_000)
    await secondRuntime.dispose()

    expect(
      timingEvents(sink)
        .filter(
          (event) => event.payload.reason === 'active-answering',
        )
        .map((event) => event.payload.elapsedSeconds),
    ).toEqual([10, 5])
    expect(
      timingEvents(sink).some(
        (event) => event.payload.elapsedSeconds >= 3_600,
      ),
    ).toBe(false)
  })

  it('retries a failed finish before publishing one completion event', async () => {
    const { catalog, task } = await vocabularySetup()
    const calls: string[] = []
    const timingSession = new FailOnceFinishSession(calls)
    const factory: VocabularyEffectiveTimingSessionFactoryPort = {
      async create() {
        return timingSession
      },
    }
    const events: PlatformEvent[] = []
    const sink: PlatformEventSink = {
      async publish(event) {
        calls.push(`event:${event.type}`)
        events.push(event)
      },
    }
    const repository = new VocabularySessionRepository(
      new ControllableVocabularyStore(),
    )
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-27',
      contentSource: createStaticDataSource(catalog),
      eventSink: sink,
      repository,
      timingSessionFactory: factory,
      now: (() => {
        let value = START_WALL_MS
        return () => {
          const result = new Date(value).toISOString()
          value += 1_000
          return result
        }
      })(),
      createId: sequenceIds('business'),
    })
    let session = await runtime.initialize()
    while (session.questionIndex + 1 < session.questions.length) {
      session = await runtime.select(
        session.questions[session.questionIndex].correctOptionId,
      )
      session = await runtime.submit()
      session = await runtime.advance()
    }
    session = await runtime.select(
      session.questions[session.questionIndex].correctOptionId,
    )
    session = await runtime.submit()
    calls.length = 0

    await expect(runtime.advance()).rejects.toThrow(
      'timing finish failed',
    )
    expect(
      events.filter(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toHaveLength(0)
    expect((await repository.load(task))?.pendingEvents).toHaveLength(1)

    calls.length = 0
    await runtime.retryPendingEvents()
    await runtime.retryPendingEvents()

    const finishCompletedIndex = calls.indexOf('timing:finished')
    const completionIndex = calls.indexOf(
      'event:learning.attempt.completed.v1',
    )
    expect(finishCompletedIndex).toBeGreaterThanOrEqual(0)
    expect(finishCompletedIndex).toBeLessThan(completionIndex)
    const completions = events
      .map((event) => parseLearningEvent(event))
      .filter(
        (event) => event.type === 'learning.attempt.completed.v1',
      )
    expect(completions).toHaveLength(1)
    expect(completions[0].payload.durationSeconds).toBe(0)
    expect((await repository.load(task))?.pendingEvents).toHaveLength(0)
    expect(timingSession.finished).toBe(true)
  })
})
