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

describe('vocabulary training runtime', () => {
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
