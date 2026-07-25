import { describe, expect, it, vi } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import type { NetworkStatusService } from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { ListeningError } from './errors.ts'
import { ListeningSessionRepository } from './repository.ts'
import { ListeningTrainingRuntime } from './runtime.ts'
import type {
  ListeningSpeechCallbacks,
  ListeningSpeechPort,
  ListeningSpeechRequest,
} from './speech-synthesis.ts'
import {
  choiceQuestion,
  createListeningTask,
  createListeningUnit,
} from './test-fixtures.ts'
import type { ListeningCatalog } from './types.ts'

class MemoryStore implements NamespaceStore {
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
      namespace: 'feature.listening',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

class ImmediateSpeech implements ListeningSpeechPort {
  callbacks: ListeningSpeechCallbacks | null = null
  cancelCount = 0

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  speak(
    _request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.callbacks = callbacks
    callbacks.onStart?.()
  }

  pause(): void {}
  resume(): void {}
  cancel(): void {
    this.cancelCount += 1
  }
  isPaused(): boolean {
    return false
  }
  isSpeaking(): boolean {
    return this.callbacks !== null
  }
}

const online: NetworkStatusService = {
  current: () => 'online',
  subscribe: () => () => undefined,
}

const offline: NetworkStatusService = {
  current: () => 'offline',
  subscribe: () => () => undefined,
}

function clock() {
  let tick = 0
  return () =>
    new Date(
      Date.parse('2026-07-24T12:00:00.000Z') + tick++ * 1_000,
    ).toISOString()
}

function catalog(): ListeningCatalog {
  const unit = createListeningUnit([choiceQuestion])
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    extensionVersion: '1.0.0',
    courseId: 'survival-travel-american-4w',
    units: [unit],
    getUnit: (contentRef) =>
      contentRef === unit.contentRef ? unit : undefined,
  }
}

describe('listening training runtime', () => {
  it('publishes start and scored completion through the durable outbox', async () => {
    const sink = new InMemoryPlatformEventSink()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `id-${++id}`
      })(),
    })

    await runtime.initialize()
    await runtime.togglePlayback()
    await runtime.select('a')
    await runtime.submit()
    const completed = await runtime.advance()

    expect(completed.phase).toBe('completed')
    expect(sink.events.map((event) => event.type)).toEqual([
      'learning.task.started.v1',
      'learning.attempt.completed.v1',
    ])
    expect(sink.events[1].payload).toMatchObject({
      result: 'scored',
      performanceScore: 1,
      taskCompleted: true,
    })
  })

  it('degrades missing offline content to an unscorable network result', async () => {
    const sink = new InMemoryPlatformEventSink()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: {
        load: async () => {
          throw new ListeningError(
            'content-unavailable',
            'Content fetch failed.',
          )
        },
      },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: offline,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `offline-id-${++id}`
      })(),
    })

    const session = await runtime.initialize()

    expect(session.phase).toBe('error')
    expect(session.failure?.category).toBe('network')
    expect(sink.events[1].payload).toMatchObject({
      result: 'unscorable',
      performanceScore: null,
      taskCompleted: false,
      failureCategory: 'network',
    })
  })

  it('cancels speech and publishes a pause when the app backgrounds', async () => {
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech,
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `background-id-${++id}`
      })(),
    })
    await runtime.initialize()
    await runtime.togglePlayback()

    const paused = await runtime.pause('app-backgrounded')

    expect(paused.phase).toBe('paused')
    expect(paused.playback.status).toBe('paused')
    expect(speech.cancelCount).toBeGreaterThan(0)
    expect(sink.events.at(-1)).toMatchObject({
      type: 'learning.task.paused.v1',
      payload: { reason: 'app-backgrounded' },
    })
  })

  it('turns an active audio interruption into unscorable device evidence', async () => {
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech,
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `device-id-${++id}`
      })(),
    })
    await runtime.initialize()
    await runtime.togglePlayback()

    speech.callbacks?.onError?.('audio-busy')

    await vi.waitFor(() => {
      expect(runtime.currentSession?.phase).toBe('error')
    })
    expect(runtime.currentSession?.failure?.category).toBe('device')
    expect(sink.events.at(-1)?.payload).toMatchObject({
      result: 'unscorable',
      performanceScore: null,
      taskCompleted: false,
      failureCategory: 'device',
    })
  })
})
