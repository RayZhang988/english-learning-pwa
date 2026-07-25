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
  ListeningSpeechVoice,
} from './speech-synthesis.ts'
import {
  choiceQuestion,
  createListeningTask,
  createListeningUnit,
  dictationQuestion,
} from './test-fixtures.ts'
import type {
  ListeningCatalog,
  ListeningQuestion,
  ListeningSession,
} from './types.ts'

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

interface PendingWrite {
  readonly key: string
  readonly value: unknown
  readonly schemaVersion: number
  readonly resolve: () => void
}

class ControlledWriteStore extends MemoryStore {
  readonly pendingWrites: PendingWrite[] = []
  private controlled = false

  controlWrites(): void {
    this.controlled = true
  }

  override async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (!this.controlled) {
      await super.put(key, value, schemaVersion)
      return
    }
    await new Promise<void>((resolve) => {
      this.pendingWrites.push({
        key,
        value,
        schemaVersion,
        resolve,
      })
    })
  }

  commitNewest(): void {
    const pending = this.pendingWrites.pop()
    if (!pending) {
      throw new Error('No controlled listening write is pending.')
    }
    this.records.set(pending.key, {
      namespace: 'feature.listening',
      key: pending.key,
      value: pending.value,
      schemaVersion: pending.schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
    pending.resolve()
  }
}

async function commitControlledWrites(
  store: ControlledWriteStore,
  count: number,
): Promise<void> {
  for (let committed = 0; committed < count; committed += 1) {
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
  }
}

class ImmediateSpeech implements ListeningSpeechPort {
  callbacks: ListeningSpeechCallbacks | null = null
  cancelCount = 0
  readonly speakRequests: ListeningSpeechRequest[] = []
  private readonly voiceCatalog: readonly ListeningSpeechVoice[]

  constructor(
    voiceCatalog: readonly ListeningSpeechVoice[] = [
      {
        id: 'runtime-local-voice',
        locale: 'en-US',
        localService: true,
      },
    ],
  ) {
    this.voiceCatalog = voiceCatalog
  }

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: this.voiceCatalog.length > 0,
      localEnUsVoiceCount: this.voiceCatalog.length,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  voices() {
    return this.voiceCatalog
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.speakRequests.push(request)
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

function catalog(
  questions: readonly ListeningQuestion[] = [choiceQuestion],
): ListeningCatalog {
  const unit = createListeningUnit(questions)
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

const dialogueDictationQuestion: ListeningQuestion = {
  ...dictationQuestion,
  primarySegmentId: 'dialogue-a-1',
  segments: [
    {
      id: 'dialogue-a-1',
      locale: 'en-US',
      text: 'Good morning.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
    {
      id: 'dialogue-b',
      locale: 'en-US',
      text: 'How can I help?',
      label: 'Blair 的句子',
      speaker: 'Blair',
    },
    {
      id: 'dialogue-a-2',
      locale: 'en-US',
      text: 'I need a ticket.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
  ],
  playbackPolicy: {
    ...dictationQuestion.playbackPolicy,
    sequenceMode: 'all-segments',
  },
}

function dialogueCatalog(): ListeningCatalog {
  const base = catalog([dialogueDictationQuestion])
  const unit = {
    ...base.units[0],
    transcript: [
      {
        id: 'dialogue-line-a-1',
        speaker: 'Alex',
        text: 'Good morning.',
        translationZh: '早上好。',
      },
      {
        id: 'dialogue-line-b',
        speaker: 'Blair',
        text: 'How can I help?',
        translationZh: '我能怎么帮您？',
      },
      {
        id: 'dialogue-line-a-2',
        speaker: 'Alex',
        text: 'I need a ticket.',
        translationZh: '我需要一张票。',
      },
    ],
  }
  return {
    ...base,
    units: [unit],
    getUnit: (contentRef) =>
      contentRef === unit.contentRef ? unit : undefined,
  }
}

describe('listening training runtime', () => {
  it('keeps rapid dictation notifications and persistence on the latest complete value', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `dictation-id-${++id}`
      })(),
    })
    await runtime.initialize()

    const notifications: string[] = []
    const unsubscribe = runtime.subscribe((session) => {
      notifications.push(session.dictationInput)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    const immediateNotifications = [...notifications]

    await commitControlledWrites(store, updates.length)
    const returnedSessions = await Promise.all(updates)
    const restored = await repository.load(createListeningTask())
    unsubscribe()

    expect.soft(immediateNotifications).toEqual(['a', 'ab', 'abc'])
    expect.soft(notifications).toEqual(['a', 'ab', 'abc'])
    expect.soft(
      returnedSessions.map(
        (session: ListeningSession) => session.dictationInput,
      ),
    ).toEqual(['abc', 'abc', 'abc'])
    expect.soft(restored?.dictationInput).toBe('abc')
  })

  it('saves the latest rapid dictation before submitting', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'submit-dictation-id',
    })
    await runtime.initialize()
    await runtime.togglePlayback()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    const submission = runtime.submit()

    await commitControlledWrites(store, 4)
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedFeedbackBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'feedback',
    )
    const storedBeforeFeedbackWrite = await repository.load(task)
    store.commitNewest()
    await Promise.all(updates)
    const submitted = await submission
    const restored = await repository.load(task)

    expect(publishedFeedbackBeforeDurableWrite).toBe(false)
    expect(storedBeforeFeedbackWrite?.phase).toBe('answering')
    expect(submitted.phase).toBe('feedback')
    expect(submitted.dictationInput).toBe('abc')
    expect(submitted.answers.at(-1)?.response).toBe('abc')
    expect(restored).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abc',
    })
  })

  it('keeps a restored same-turn draft while using one continuous neutral dialogue utterance', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const speech = new ImmediateSpeech([
      { id: 'runtime-voice-a', locale: 'en-US', localService: true },
      { id: 'runtime-voice-b', locale: 'en-US', localService: true },
    ])
    const runtimeOptions = {
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => dialogueCatalog(),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech,
      now: clock(),
      createId: () => 'restored-submit-dictation-id',
    } as const
    const firstRuntime = new ListeningTrainingRuntime(runtimeOptions)
    await firstRuntime.initialize()
    await firstRuntime.togglePlayback()
    expect(speech.speakRequests).toEqual([
      {
        text: 'Good morning. How can I help? I need a ticket.',
        locale: 'en-US',
        rate: 1,
      },
    ])
    expect(speech.speakRequests[0].text).not.toMatch(/Alex:|Blair:/u)
    speech.callbacks?.onEnd?.()
    await firstRuntime.changeDictation('abc')
    await firstRuntime.pause('user-paused')
    firstRuntime.dispose()

    const runtime = new ListeningTrainingRuntime(runtimeOptions)
    await runtime.initialize()
    await runtime.resume()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const submission = runtime.submit()
    const latestDraft = Promise.resolve().then(() =>
      runtime.changeDictation('abcdef'),
    )
    void latestDraft.catch(() => undefined)

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    await latestDraft
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedFeedbackBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'feedback',
    )
    store.commitNewest()
    const submitted = await submission
    const restored = await repository.load(task)

    expect(publishedFeedbackBeforeDurableWrite).toBe(false)
    expect(submitted).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abcdef',
    })
    expect(submitted.answers.at(-1)?.response).toBe('abcdef')
    expect(restored).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abcdef',
    })
    expect(restored?.answers.at(-1)?.response).toBe('abcdef')
  })

  it('saves the latest rapid dictation before pausing for exit', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'pause-dictation-id',
    })
    await runtime.initialize()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    let exitReady = false
    const pauseForExit = runtime.pause('user-paused').then((session) => {
      exitReady = true
      return session
    })

    await commitControlledWrites(store, 3)
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedPauseBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'paused',
    )
    const storedBeforePauseWrite = await repository.load(task)
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const exitReadyBeforeFinalWrite = exitReady
    store.commitNewest()
    await Promise.all(updates)
    const paused = await pauseForExit
    const restored = await repository.load(task)

    expect(publishedPauseBeforeDurableWrite).toBe(false)
    expect(storedBeforePauseWrite?.phase).toBe('answering')
    expect(exitReadyBeforeFinalWrite).toBe(false)
    expect(paused).toMatchObject({
      phase: 'paused',
      dictationInput: 'abc',
      pendingEvents: [],
    })
    expect(restored).toMatchObject({
      phase: 'paused',
      dictationInput: 'abc',
      pendingEvents: [],
    })
  })

  it('pauses only after a restored same-turn draft is durable', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const runtimeOptions = {
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'restored-pause-dictation-id',
    } as const
    const firstRuntime = new ListeningTrainingRuntime(runtimeOptions)
    await firstRuntime.initialize()
    await firstRuntime.togglePlayback()
    await firstRuntime.changeDictation('abc')
    await firstRuntime.pause('user-paused')
    firstRuntime.dispose()

    const runtime = new ListeningTrainingRuntime(runtimeOptions)
    await runtime.initialize()
    await runtime.resume()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    let exitReady = false
    const pauseForExit = runtime.pause('user-paused').then((session) => {
      exitReady = true
      return session
    })
    const latestDraft = Promise.resolve().then(() =>
      runtime.changeDictation('abcdef'),
    )
    void latestDraft.catch(() => undefined)

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    await latestDraft
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedPauseBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'paused',
    )
    const exitReadyBeforePauseWrite = exitReady
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    const paused = await pauseForExit
    const restored = await repository.load(task)

    expect(publishedPauseBeforeDurableWrite).toBe(false)
    expect(exitReadyBeforePauseWrite).toBe(false)
    expect(paused).toMatchObject({
      phase: 'paused',
      dictationInput: 'abcdef',
      pendingEvents: [],
    })
    expect(restored).toMatchObject({
      phase: 'paused',
      dictationInput: 'abcdef',
      pendingEvents: [],
    })
  })

  it('does not publish completion before the advanced session is durable', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const sink = new InMemoryPlatformEventSink()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: sink,
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'advance-dictation-id',
    })
    await runtime.initialize()
    await runtime.togglePlayback()
    await runtime.changeDictation('abc')
    await runtime.submit()

    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()
    let advanceResolved = false
    const advance = runtime.advance().then((session) => {
      advanceResolved = true
      return session
    })

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedCompletionBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'completed',
    )
    const storedBeforeCompletionWrite = await repository.load(task)
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const advanceResolvedBeforeFinalWrite = advanceResolved
    store.commitNewest()
    const completed = await advance
    const restored = await repository.load(task)

    expect(publishedCompletionBeforeDurableWrite).toBe(false)
    expect(storedBeforeCompletionWrite?.phase).toBe('feedback')
    expect(advanceResolvedBeforeFinalWrite).toBe(false)
    expect(completed.phase).toBe('completed')
    expect(restored).toMatchObject({
      phase: 'completed',
      pendingEvents: [],
    })
    expect(sink.events.at(-1)?.type).toBe(
      'learning.attempt.completed.v1',
    )
  })

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
      expect(sink.events.at(-1)?.payload).toMatchObject({
        result: 'unscorable',
        performanceScore: null,
        taskCompleted: false,
        failureCategory: 'device',
      })
    })
    expect(runtime.currentSession?.failure?.category).toBe('device')
  })
})
