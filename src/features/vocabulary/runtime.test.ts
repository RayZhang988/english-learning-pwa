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
import { applyWrongAnswerEvidence, createWrongAnswerLibraryState, type WrongAnswerEvidence } from '../../learning-engine/index.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'
import type { WrongAnswerEvidenceSink, ReviewContentIndex } from './wrong-answer-review.ts'
import type { NetworkStatusService } from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularyError } from './errors.ts'
import { VocabularySessionRepository } from './repository.ts'
import { VocabularyTrainingRuntime } from './runtime.ts'
import type { VocabularySupplyProvider } from './supply.ts'
import type { VocabularySupplyItem } from './types.ts'
import { loadReleasedReviewContentIndex } from '../../app/review-content-test-fixtures.ts'
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

class FailRecoveredOnceEventSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []
  private failed = false

  async publish(event: PlatformEvent): Promise<void> {
    if (event.type === 'learning.training.content.recovered.v1' && !this.failed) {
      this.failed = true
      throw new Error('temporary recovery publish failure')
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
  it('persists the acknowledged randomized supply cursor before a refresh', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const candidates = (catalog.trainingSupplyIndex as { candidates: VocabularySupplyItem[] }).candidates
      .filter((candidate) => candidate.domain === 'vocabulary' && candidate.difficultyLevel === 1)
    const round = createTrainingSupplyRound({ seed: 'vocabulary-refresh', candidateItemIds: candidates.map((candidate) => candidate.itemId), shortTermExcludedItemIds: [] })
    const requests: import('../../learning-engine/index.ts').LearningTaskSupplyRequest[] = []
    const supplyProvider: VocabularySupplyProvider = { async next(request) {
      requests.push(request)
      const item = candidates.find((candidate) => candidate.itemId === request.supplyRound?.order[request.supplyRound.cursor])!
      return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
    } }
    const task = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const store = new MemoryNamespaceStore()
    const sink = new InMemoryPlatformEventSink()
    const options = { task, localDate: '2026-08-11', contentSource: createStaticDataSource(catalog), eventSink: sink, repository: new VocabularySessionRepository(store), supplyProvider, trainingBudgetStatus: () => 'running' as const, supplyRound: round } as unknown as ConstructorParameters<typeof VocabularyTrainingRuntime>[0]
    const runtime = new VocabularyTrainingRuntime(options)
    const session = await runtime.initialize()

    expect(requests[0]?.supplyRound).toEqual(round)
    expect(session.stream?.supplyRound).toMatchObject({ seed: 'vocabulary-refresh', cursor: 1 })

    const refreshed = new VocabularyTrainingRuntime(options)
    const restored = await refreshed.initialize()
    expect(restored.stream?.supplyRound).toEqual(session.stream?.supplyRound)

    await refreshed.select(restored.questions[0]!.correctOptionId)
    await refreshed.submit()
    await refreshed.advance()
    expect(sink.events.find((event) => event.type === 'learning.training.item.completed.v1')?.payload).toMatchObject({
      supplyRound: { seed: 'vocabulary-refresh', cursor: 1 },
    })
  })

  it('durably replays one failed daily wrong-answer evidence with the same identity', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments()); const item = (catalog.trainingSupplyIndex as { candidates: VocabularySupplyItem[] }).candidates.find((candidate) => candidate.domain === 'vocabulary')!; const index = await loadReleasedReviewContentIndex() as ReviewContentIndex
    let state = createWrongAnswerLibraryState(); const seen: string[] = []; let fail = true
    const wrongSink: WrongAnswerEvidenceSink = { async publish(evidence: WrongAnswerEvidence) { seen.push(evidence.eventId); if (fail) { fail = false; throw new Error('wrong sink failed') }; state = applyWrongAnswerEvidence(state, evidence).state } }
    const store = new MemoryNamespaceStore(); const task = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }); const provider: VocabularySupplyProvider = { async next(request) { return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId } } }
    const options = { task, localDate: '2026-08-03', contentSource: createStaticDataSource(catalog), eventSink: new InMemoryPlatformEventSink(), repository: new VocabularySessionRepository(store), now: sequenceClock(), createId: sequenceIds(), supplyProvider: provider, trainingBudgetStatus: () => 'running' as const, wrongAnswerReview: { index, sink: wrongSink, source: 'daily-training' as const } }
    const first = new VocabularyTrainingRuntime(options); let session = await first.initialize(); const wrong = session.questions[0].options.find((option) => option.id !== session.questions[0].correctOptionId)!; await first.select(wrong.id); await expect(first.submit()).rejects.toThrow('wrong sink failed'); expect(first.currentSession?.pendingWrongAnswerEvidence).toHaveLength(1)
    const second = new VocabularyTrainingRuntime(options); session = await second.initialize(); expect(seen).toHaveLength(2); expect(seen[0]).toBe(seen[1]); expect(session.pendingWrongAnswerEvidence).toEqual([]); expect(Object.values(state.records)[0]?.incorrectCount).toBe(1)
  })
  it('publishes one durable recovery before a retried item and budget completion', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const candidates = (catalog.trainingSupplyIndex as { candidates: VocabularySupplyItem[] }).candidates
    const [first, second] = candidates.filter((item) => item.itemId.includes('w1d1-v') && item.source.variantId === 'term-to-meaning-choice')
    let calls = 0
    const supplyProvider: VocabularySupplyProvider = {
      async next(request) {
        calls += 1
        if (calls === 1) return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: first, nextCursor: first.itemId }
        if (calls === 2) return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
        return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: second, nextCursor: second.itemId }
      },
    }
    let budget: 'running' | 'finish-current-item' = 'running'
    const sink = new InMemoryPlatformEventSink()
    const task = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const store = new MemoryNamespaceStore()
    const repository = new VocabularySessionRepository(store)
    const runtime = new VocabularyTrainingRuntime({ task, localDate: '2026-07-28', contentSource: createStaticDataSource(catalog), eventSink: sink, repository, now: sequenceClock(), createId: sequenceIds(), supplyProvider, trainingBudgetStatus: () => budget })
    let session = await runtime.initialize()
    session = await runtime.select(session.questions[0].correctOptionId)
    session = await runtime.submit()
    session = await runtime.advance()
    expect(session.phase).toBe('error')
    const exhaustion = sink.events.find((event) => event.type === 'learning.training.content.exhausted.v1')
    expect(exhaustion).toBeDefined()

    const refreshed = new VocabularyTrainingRuntime({ task, localDate: '2026-07-28', contentSource: createStaticDataSource(catalog), eventSink: sink, repository: new VocabularySessionRepository(store), now: sequenceClock(), createId: sequenceIds(), supplyProvider, trainingBudgetStatus: () => budget })
    await refreshed.initialize()
    session = await refreshed.retrySupply()
    expect(session.phase).toBe('answering')
    expect(session.stream?.completedItemIds).toEqual([first.itemId])
    expect(session.stream?.exhaustionRequestId).toBeNull()
    const recovery = sink.events.filter((event) => event.type === 'learning.training.content.recovered.v1')
    expect(recovery).toHaveLength(1)
    const exhaustedPayload = (parseLearningEvent(exhaustion!) as Extract<ReturnType<typeof parseLearningEvent>, { type: 'learning.training.content.exhausted.v1' }>).payload
    const recoveredPayload = (parseLearningEvent(recovery[0]) as Extract<ReturnType<typeof parseLearningEvent>, { type: 'learning.training.content.recovered.v1' }>).payload
    expect(recoveredPayload.exhaustionRequestId).toBe(exhaustedPayload.requestId)

    budget = 'finish-current-item'
    session = await refreshed.select(session.questions[0].correctOptionId)
    session = await refreshed.submit()
    session = await refreshed.advance()
    const types = sink.events.map((event) => event.type)
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.lastIndexOf('learning.training.item.completed.v1'))
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.indexOf('learning.training.budget.completed.v1'))
  })

  it('restores a failed recovery outbox event without generating a second recovery identity', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const candidates = (catalog.trainingSupplyIndex as { candidates: VocabularySupplyItem[] }).candidates
    const [first, second] = candidates.filter((item) => item.itemId.includes('w1d1-v') && item.source.variantId === 'term-to-meaning-choice')
    let calls = 0
    const supplyProvider: VocabularySupplyProvider = { async next(request) {
      calls += 1
      if (calls === 1) return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: first, nextCursor: first.itemId }
      if (calls === 2) return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: second, nextCursor: second.itemId }
    } }
    const sink = new FailRecoveredOnceEventSink()
    const runtime = new VocabularyTrainingRuntime({
      task: vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: createStaticDataSource(catalog), eventSink: sink, repository: new VocabularySessionRepository(new MemoryNamespaceStore()), now: sequenceClock(), createId: sequenceIds(), supplyProvider, trainingBudgetStatus: () => 'running',
    })
    let session = await runtime.initialize()
    session = await runtime.select(session.questions[0].correctOptionId)
    session = await runtime.submit()
    await runtime.advance()
    await expect(runtime.retrySupply()).rejects.toThrow('temporary recovery publish failure')
    expect(runtime.currentSession?.pendingEvents.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
    session = await runtime.retrySupply()
    expect(session.phase).toBe('answering')
    expect(sink.events.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
    expect(session.stream?.completedItemIds).toEqual([first.itemId])
  })

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
