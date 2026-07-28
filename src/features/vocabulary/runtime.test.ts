import { describe, expect, it } from 'vitest'
import {
  InMemoryPlatformEventSink,
  createStaticDataSource,
} from '../../core/testing/index.ts'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import type { NetworkStatusService } from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularyError } from './errors.ts'
import { VocabularySessionRepository } from './repository.ts'
import { VocabularyTrainingRuntime } from './runtime.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.records.set(key, {
      namespace: 'feature.vocabulary',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
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

class FailOnceEventSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []
  private failed = false

  async publish(event: PlatformEvent): Promise<void> {
    if (!this.failed) {
      this.failed = true
      throw new Error('temporary event sink failure')
    }
    this.events.push(event)
  }
}

class OutOfOrderNamespaceStore extends MemoryNamespaceStore {
  private delayNext = false
  private releaseDelayedWrite: (() => void) | null = null
  private delayedWriteStarted: Promise<void> = Promise.resolve()
  private markDelayedWriteStarted: (() => void) | null = null

  delayNextPut(): void {
    this.delayNext = true
    this.delayedWriteStarted = new Promise((resolve) => {
      this.markDelayedWriteStarted = resolve
    })
  }

  waitForDelayedPut(): Promise<void> {
    return this.delayedWriteStarted
  }

  release(): void {
    this.releaseDelayedWrite?.()
    this.releaseDelayedWrite = null
  }

  override async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.delayNext) {
      this.delayNext = false
      const release = new Promise<void>((resolve) => {
        this.releaseDelayedWrite = resolve
      })
      this.markDelayedWriteStarted?.()
      this.markDelayedWriteStarted = null
      await release
    }
    await super.put(key, value, schemaVersion)
  }
}

function sequenceClock() {
  let timestamp = Date.parse('2026-07-24T00:00:00.000Z')
  return () => {
    const value = new Date(timestamp).toISOString()
    timestamp += 1_000
    return value
  }
}

function sequenceIds() {
  let id = 0
  return () => {
    id += 1
    return `event-${id}`
  }
}

const offlineNetwork: NetworkStatusService = {
  current: () => 'offline',
  subscribe: () => () => {},
}

const structuredDurationEstimate = {
  schemaVersion: 1,
  estimateSeconds: 123,
  sampleCount: 0,
  basis: 'content-baseline',
  confidence: 'medium',
  contentType: 'vocabulary-set-v1',
  reasonableRangeSeconds: {
    lower: 90,
    upper: 600,
  },
  profileKey: 'vocabulary|learn|vocabulary-set-v1',
  baselineSource: 'structured-content',
} as const

describe('vocabulary training runtime', () => {
  it('streams a stable next item and completes only after finish-current-item', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const task = vocabularyTaskFor(catalog.units[0], {
      trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 },
    })
    let budget: 'running' | 'finish-current-item' = 'running'
    const sink = new InMemoryPlatformEventSink()
    const store = new MemoryNamespaceStore()
    const runtime = new VocabularyTrainingRuntime({
      task, localDate: '2026-07-28', contentSource: createStaticDataSource(catalog), eventSink: sink,
      repository: new VocabularySessionRepository(store), now: sequenceClock(), createId: sequenceIds(),
      trainingBudgetStatus: () => budget,
    })
    let session = await runtime.initialize()
    const firstId = session.stream?.activeItem.itemId
    session = await runtime.select(session.questions[0].correctOptionId)
    session = await runtime.submit()
    session = await runtime.advance()
    expect(session.phase).toBe('answering')
    expect(session.stream?.activeItem.itemId).not.toBe(firstId)
    expect(sink.events.map((event) => event.type)).toContain('learning.training.item.completed.v1')
    expect(sink.events.map((event) => event.type)).not.toContain('learning.training.budget.completed.v1')

    const restored = new VocabularyTrainingRuntime({
      task, localDate: '2026-07-28', contentSource: createStaticDataSource(catalog), eventSink: sink,
      repository: new VocabularySessionRepository(store), now: sequenceClock(), createId: sequenceIds(),
      trainingBudgetStatus: () => budget,
    })
    session = await restored.initialize()
    expect(session.stream?.completedItemIds).toEqual([firstId])
    expect(session.stream?.activeItem.itemId).not.toBe(firstId)

    budget = 'finish-current-item'
    session = await restored.select(session.questions[0].correctOptionId)
    session = await restored.submit()
    session = await restored.advance()
    expect(session.phase).toBe('completed')
    expect(sink.events.map((event) => event.type)).toContain('learning.training.budget.completed.v1')
    const attempts = sink.events
      .map((event) => parseLearningEvent(event))
      .filter((event) => event.type === 'learning.attempt.completed.v1')
    expect(attempts.every((event) => event.payload.taskCompleted === false)).toBe(true)
  })

  it('runs, restores, and completes a structured-duration task against legacy course duration', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0], {
      estimatedSeconds: 123,
      durationEstimate: structuredDurationEstimate,
    })
    const store = new MemoryNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const eventSink = new InMemoryPlatformEventSink()
    const firstRuntime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: createStaticDataSource(catalog),
      eventSink,
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    let session = await firstRuntime.initialize()

    expect(catalog.units[0].estimatedSeconds).toBe(900)
    expect(session.phase).toBe('answering')
    expect(session.questions.length).toBeGreaterThan(0)
    expect(session.task.estimatedSeconds).toBe(123)
    session = await firstRuntime.select(
      session.questions[0].correctOptionId,
    )

    const refreshedTask = {
      ...task,
      estimatedSeconds: 130,
      durationEstimate: {
        ...structuredDurationEstimate,
        estimateSeconds: 130,
      },
    }
    const refreshedRuntime = new VocabularyTrainingRuntime({
      task: refreshedTask,
      localDate: '2026-07-28',
      contentSource: createStaticDataSource(catalog),
      eventSink,
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    session = await refreshedRuntime.initialize()

    expect(session.phase).toBe('answering')
    expect(session.selectedOptionId).not.toBeNull()
    expect(session.task.estimatedSeconds).toBe(123)

    while (session.phase !== 'completed') {
      if (session.phase === 'answering') {
        if (session.selectedOptionId === null) {
          session = await refreshedRuntime.select(
            session.questions[session.questionIndex].correctOptionId,
          )
        }
        session = await refreshedRuntime.submit()
      } else {
        session = await refreshedRuntime.advance()
      }
    }

    const completion = eventSink.events
      .map((event) => parseLearningEvent(event))
      .findLast(
        (event) => event.type === 'learning.attempt.completed.v1',
      )
    expect(completion).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        estimatedSeconds: 123,
        result: 'scored',
        taskCompleted: true,
      },
    })
    expect(
      eventSink.events
        .map((event) => parseLearningEvent(event))
        .some(
          (event) =>
            event.type === 'learning.attempt.completed.v1' &&
            event.payload.result === 'unscorable',
        ),
    ).toBe(false)
  })

  it('persists concurrent selections in invocation order when an older write resolves last', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new OutOfOrderNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    const session = await runtime.initialize()
    const [firstOption, secondOption] = session.questions[0].options

    store.delayNextPut()
    const firstSelection = runtime.select(firstOption.id)
    await store.waitForDelayedPut()
    const secondSelection = runtime.select(secondOption.id)
    await Promise.resolve()
    store.release()
    await Promise.all([firstSelection, secondSelection])

    expect((await repository.load(task))?.selectedOptionId).toBe(
      secondOption.id,
    )
  })

  it('reproduces a previous-question option reaching the next session during a slow advance', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new OutOfOrderNamespaceStore()
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: new InMemoryPlatformEventSink(),
      repository: new VocabularySessionRepository(store),
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    let session = await runtime.initialize()
    const previousQuestionOption =
      session.questions[0].options[0].id
    session = await runtime.select(previousQuestionOption)
    session = await runtime.submit()

    store.delayNextPut()
    const advancing = runtime.advance()
    await store.waitForDelayedPut()
    const staleSelection = runtime.select(previousQuestionOption)
    store.release()
    await advancing

    await expect(staleSelection).rejects.toThrow(
      `Option ${previousQuestionOption} does not belong to the active question.`,
    )
  })

  it('exposes the next question optimistically before a slow advance persists', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new OutOfOrderNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    let session = await runtime.initialize()
    session = await runtime.select(
      session.questions[0].options[0].id,
    )
    session = await runtime.submit()

    const observedSessions: typeof session[] = []
    runtime.subscribe((observed) => {
      observedSessions.push(observed)
    })
    store.delayNextPut()
    const advancing = runtime.advance()
    await store.waitForDelayedPut()

    const optimisticSession = observedSessions.at(-1)!
    expect(optimisticSession).toMatchObject({
      phase: 'answering',
      questionIndex: 1,
      selectedOptionId: null,
    })
    const nextOption =
      optimisticSession.questions[1].options[0].id
    const selecting = runtime.select(nextOption)

    store.release()
    await advancing
    const selected = await selecting

    expect(selected).toMatchObject({
      phase: 'answering',
      questionIndex: 1,
      selectedOptionId: nextOption,
    })
    expect((await repository.load(task))?.selectedOptionId).toBe(nextOption)
  })

  it('persists select, submit, advance, and exit pause in invocation order', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new OutOfOrderNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    const session = await runtime.initialize()

    store.delayNextPut()
    const selecting = runtime.select(
      session.questions[0].options[0].id,
    )
    await store.waitForDelayedPut()
    const submitting = runtime.submit()
    const advancing = runtime.advance()
    const exiting = runtime.pauseIfActive('user-paused')

    store.release()
    await Promise.all([selecting, submitting, advancing, exiting])

    expect(await repository.load(task)).toMatchObject({
      phase: 'paused',
      pausedFromPhase: 'answering',
      questionIndex: 1,
      selectedOptionId: null,
      answers: [{ questionId: session.questions[0].id }],
    })
  })

  it('emits monotonic subscription states across queued microtasks without a stale final write', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new OutOfOrderNamespaceStore()
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: new InMemoryPlatformEventSink(),
      repository: new VocabularySessionRepository(store),
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    const session = await runtime.initialize()
    const observed: string[] = []
    runtime.subscribe((next) => {
      observed.push(
        `${next.questionIndex}:${next.phase}:${next.selectedOptionId ?? '-'}`,
      )
    })

    store.delayNextPut()
    const selectedOptionId = session.questions[0].options[0].id
    const selecting = runtime.select(selectedOptionId)
    await store.waitForDelayedPut()
    const submitting = runtime.submit()
    const advancing = runtime.advance()

    store.release()
    await Promise.all([selecting, submitting, advancing])
    await Promise.resolve()

    expect(observed).toEqual([
      `0:answering:${selectedOptionId}`,
      `0:feedback:${selectedOptionId}`,
      '1:answering:-',
    ])
    expect(runtime.currentSession).toMatchObject({
      questionIndex: 1,
      phase: 'answering',
      selectedOptionId: null,
    })
  })

  it('publishes a scored completion and recovers without duplicating events', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new MemoryNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const eventSink = new InMemoryPlatformEventSink()
    const options = {
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink,
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    }
    const runtime = new VocabularyTrainingRuntime(options)
    let session = await runtime.initialize()

    expect(eventSink.events.map((event) => event.type)).toEqual([
      'learning.task.started.v1',
    ])

    while (session.phase !== 'completed') {
      const question = session.questions[session.questionIndex]
      session = await runtime.select(question.correctOptionId)
      session = await runtime.submit()
      session = await runtime.advance()
    }

    const completion = parseLearningEvent(eventSink.events.at(-1)!)
    expect(completion).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        result: 'scored',
        performanceScore: 1,
        evidenceQuality: 1,
        assistanceLevel: 0,
        taskCompleted: true,
        failureCategory: null,
      },
    })

    const eventCount = eventSink.events.length
    const recoveredRuntime = new VocabularyTrainingRuntime({
      ...options,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    const recovered = await recoveredRuntime.initialize()

    expect(recovered.phase).toBe('completed')
    expect(eventSink.events).toHaveLength(eventCount)
  })

  it('retains a failed event publish and retries the same event id', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const store = new MemoryNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const failingSink = new FailOnceEventSink()
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: failingSink,
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })

    await expect(runtime.initialize()).rejects.toThrow(
      'temporary event sink failure',
    )
    const stored = await repository.load(task)
    expect(stored?.pendingEvents).toHaveLength(1)
    const pendingEventId = stored!.pendingEvents[0].id

    const workingSink = new InMemoryPlatformEventSink()
    const recoveredRuntime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink: workingSink,
      repository,
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    await recoveredRuntime.initialize()

    expect(workingSink.events).toHaveLength(1)
    expect(workingSink.events[0].id).toBe(pendingEventId)
    expect((await repository.load(task))?.pendingEvents).toHaveLength(0)
  })

  it('reports missing offline content as unscorable instead of an incorrect answer', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const eventSink = new InMemoryPlatformEventSink()
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        async load() {
          throw new VocabularyError(
            'content-unavailable',
            'content is not installed',
          )
        },
      },
      eventSink,
      repository: new VocabularySessionRepository(
        new MemoryNamespaceStore(),
      ),
      networkStatus: offlineNetwork,
      now: sequenceClock(),
      createId: sequenceIds(),
    })

    const session = await runtime.initialize()
    const failureEvent = parseLearningEvent(eventSink.events[1])

    expect(session).toMatchObject({
      phase: 'error',
      failure: {
        category: 'network',
      },
    })
    expect(failureEvent).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        result: 'unscorable',
        performanceScore: null,
        taskCompleted: false,
        failureCategory: 'network',
        errorTags: [],
      },
    })
  })

  it('publishes pause and resume events while preserving session progress', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const eventSink = new InMemoryPlatformEventSink()
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: createStaticDataSource(catalog),
      eventSink,
      repository: new VocabularySessionRepository(
        new MemoryNamespaceStore(),
      ),
      now: sequenceClock(),
      createId: sequenceIds(),
    })
    let session = await runtime.initialize()
    const selectedOptionId =
      session.questions[0].correctOptionId
    session = await runtime.select(selectedOptionId)
    session = await runtime.pause('app-backgrounded')

    expect(session.phase).toBe('paused')
    expect(session.selectedOptionId).toBe(selectedOptionId)
    expect(eventSink.events.at(-1)?.type).toBe(
      'learning.task.paused.v1',
    )

    session = await runtime.resume()
    expect(session.phase).toBe('answering')
    expect(session.selectedOptionId).toBe(selectedOptionId)
    expect(eventSink.events.at(-1)?.type).toBe(
      'learning.task.started.v1',
    )
  })
})
