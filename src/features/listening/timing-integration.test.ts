import { describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import type {
  LearningTask,
  LearningTimingSegmentRecordedEvent,
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
  dictationQuestion,
} from './test-fixtures.ts'
import type {
  ListeningEffectiveTimingSessionFactoryPort,
  ListeningEffectiveTimingSessionPort,
  ListeningTimingPhaseDeclaration,
} from './timing.ts'
import type {
  ListeningCatalog,
  ListeningSession,
} from './types.ts'

const START_WALL_MS = Date.parse('2026-07-28T08:00:00.000Z')

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

class AdvancingListeningStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  nextPutDelayMs = 0
  private readonly time: ManualTime

  constructor(time: ManualTime) {
    this.time = time
  }

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.nextPutDelayMs > 0) {
      this.time.advance(this.nextPutDelayMs)
      this.nextPutDelayMs = 0
    }
    this.records.set(key, {
      namespace: 'feature.listening',
      key,
      value: structuredClone(value),
      schemaVersion,
      updatedAt: new Date(this.time.wallTimeMs).toISOString(),
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

interface PendingListeningWrite {
  readonly key: string
  readonly value: unknown
  readonly schemaVersion: number
  readonly resolve: () => void
}

class ControlledListeningStore extends AdvancingListeningStore {
  readonly pendingWrites: PendingListeningWrite[] = []
  controlled = false
  private readonly controlledTime: ManualTime

  constructor(controlledTime: ManualTime) {
    super(controlledTime)
    this.controlledTime = controlledTime
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
        value: structuredClone(value),
        schemaVersion,
        resolve,
      })
    })
  }

  releaseNext(delayMs = 0): void {
    const pending = this.pendingWrites.shift()
    if (!pending) {
      throw new Error('No controlled listening write is pending.')
    }
    this.controlledTime.advance(delayMs)
    this.records.set(pending.key, {
      namespace: 'feature.listening',
      key: pending.key,
      value: pending.value,
      schemaVersion: pending.schemaVersion,
      updatedAt: new Date(
        this.controlledTime.wallTimeMs,
      ).toISOString(),
    })
    pending.resolve()
  }
}

class RecordingSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []

  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(event)
  }
}

class ManualSpeech implements ListeningSpeechPort {
  callbacks: ListeningSpeechCallbacks | null = null
  paused = false
  speaking = false
  readonly requests: ListeningSpeechRequest[] = []

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      localEnUsVoiceCount: 1,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  voices() {
    return [
      {
        id: 'manual-local-en-us',
        locale: 'en-US' as const,
        localService: true as const,
      },
    ]
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.requests.push(request)
    this.callbacks = callbacks
    this.speaking = false
    this.paused = false
  }

  start(): void {
    this.speaking = true
    this.callbacks?.onStart?.()
  }

  end(): void {
    this.speaking = false
    this.paused = false
    this.callbacks?.onEnd?.()
  }

  error(): void {
    this.speaking = false
    this.paused = false
    this.callbacks?.onError?.('audio-busy')
  }

  pause(): void {
    this.paused = true
    this.callbacks?.onPause?.()
  }

  resume(): void {
    this.paused = false
    this.speaking = true
    this.callbacks?.onResume?.()
  }

  cancel(): void {
    this.paused = false
    this.speaking = false
  }

  isPaused(): boolean {
    return this.paused
  }

  isSpeaking(): boolean {
    return this.speaking
  }
}

function catalog(
  question = choiceQuestion,
): ListeningCatalog {
  const unit = createListeningUnit([question])
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

function timingIdentity(task: LearningTask): EffectiveTimingTaskIdentity {
  return {
    planId: task.planId,
    taskId: task.taskId,
    learningUnitId: task.learningUnitId,
    contentRef: task.contentRef,
    domain: task.domain,
    targetModuleId: task.targetModuleId,
    localDate: '2026-07-28',
    mode: task.mode,
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
  let current: Promise<EffectiveTimingSession> | null = null
  const factory: ListeningEffectiveTimingSessionFactoryPort = {
    async create(taskId, expectedModuleId) {
      expect(taskId).toBe(options.task.taskId)
      expect(expectedModuleId).toBe('listening')
      if (current) {
        const session = await current
        if (!session.isClosed) {
          return session
        }
      }
      current = EffectiveTimingSession.create({
        identity: timingIdentity(options.task),
        eventSink: options.sink,
        snapshotStore: options.snapshots,
        lifecycle: options.lifecycle,
        clock: options.time,
        scheduler: options.time,
        createId: options.createId,
      })
      return current
    },
  }
  return {
    factory,
    session() {
      if (!current) {
        throw new Error('Timing session has not been requested.')
      }
      return current
    },
  }
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

function sequenceIds(prefix: string) {
  let value = 0
  return () => {
    value += 1
    return `${prefix}-${value}`
  }
}

function choiceCorrectOptionId(): string {
  if (choiceQuestion.type === 'keyword-dictation') {
    throw new TypeError('The choice fixture must remain a choice question.')
  }
  return choiceQuestion.correctOptionId
}

describe('listening effective timing integration', () => {
  it('uses actual speech callbacks, excludes waits, and finishes before completion', async () => {
    const task = createListeningTask()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const listeningStore = new AdvancingListeningStore(time)
    const repository = new ListeningSessionRepository(listeningStore)
    const sink = new RecordingSink()
    const speech = new ManualSpeech()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'listening-timing-session',
    })
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: {
        async load() {
          time.advance(7_000)
          return catalog()
        },
      },
      eventSink: sink,
      repository,
      speech,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('listening-business'),
    })

    await runtime.initialize()
    await runtime.togglePlayback()
    time.advance(9_000)
    expect(
      timingEvents(sink).some(
        (event) =>
          event.payload.reason === 'active-audio-listening',
      ),
    ).toBe(false)

    speech.start()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')
    time.advance(5_000)
    await runtime.togglePlayback()
    time.advance(10_000)
    await runtime.togglePlayback()
    time.advance(4_000)

    lifecycle.emit({
      type: 'background',
      source: 'visibilitychange',
    })
    await (await timing.session()).flush()
    await runtime.pause('app-backgrounded')
    time.advance(20_000)
    lifecycle.emit({
      type: 'foreground',
      source: 'visibilitychange',
    })
    await (await timing.session()).flush()
    const audioBeforeForegroundResume = timingEvents(sink)
      .filter(
        (event) =>
          event.payload.reason === 'active-audio-listening',
      )
      .reduce(
        (total, event) => total + event.payload.elapsedSeconds,
        0,
      )
    await runtime.resume()
    expect(speech.requests).toHaveLength(1)

    await runtime.togglePlayback()
    time.advance(3_000)
    speech.start()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')
    time.advance(6_000)
    speech.end()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')

    time.jumpWithoutRunningTimers(60_000)
    listeningStore.nextPutDelayMs = 10_000
    await runtime.select(choiceCorrectOptionId())
    listeningStore.nextPutDelayMs = 8_000
    await runtime.submit()
    time.advance(3_000)
    listeningStore.nextPutDelayMs = 2_000
    const completed = await runtime.advance()

    expect(completed.phase).toBe('completed')
    expect(snapshots.records.size).toBe(0)
    const events = timingEvents(sink)
    const durationByReason = new Map<string, number>()
    for (const event of events) {
      durationByReason.set(
        event.payload.reason,
        (durationByReason.get(event.payload.reason) ?? 0) +
          event.payload.elapsedSeconds,
      )
    }
    expect(durationByReason.get('active-audio-listening')).toBe(15)
    expect(audioBeforeForegroundResume).toBe(9)
    expect(durationByReason.get('active-answering')).toBe(45)
    expect(durationByReason.get('idle-timeout')).toBe(15)
    expect(durationByReason.get('active-feedback')).toBe(3)
    expect(durationByReason.get('media-loading')).toBe(12)
    expect(durationByReason.get('content-loading')).toBeGreaterThanOrEqual(
      27,
    )

    const completionIndex = sink.events.findIndex(
      (event) => event.type === 'learning.attempt.completed.v1',
    )
    const lastTimingIndex = sink.events.findLastIndex(
      (event) =>
        event.type === 'learning.timing.segment.recorded.v1',
    )
    expect(lastTimingIndex).toBeLessThan(completionIndex)
    expect(sink.events[completionIndex]).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        durationSeconds: 0,
        taskCompleted: true,
      },
    })
    const pauseEvent = sink.events.find(
      (event) => event.type === 'learning.task.paused.v1',
    )
    expect(pauseEvent).toMatchObject({
      payload: { durationSeconds: 0 },
    })
  })

  it('disposes on unload and never backfills time across refresh', async () => {
    const task = createListeningTask()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const listeningStore = new AdvancingListeningStore(time)
    const repository = new ListeningSessionRepository(listeningStore)
    const sink = new RecordingSink()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: sequenceIds('restored-timing'),
    })
    const firstSpeech = new ManualSpeech()
    const options = {
      task,
      localDate: '2026-07-28',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('restored-business'),
    } as const
    const firstRuntime = new ListeningTrainingRuntime({
      ...options,
      speech: firstSpeech,
    })

    await firstRuntime.initialize()
    await firstRuntime.togglePlayback()
    firstSpeech.start()
    await (await timing.session()).flush()
    await firstRuntime.setRepeatMode('none')
    time.advance(5_000)
    await firstRuntime.dispose()
    expect(snapshots.records.size).toBe(1)

    time.advance(120_000)
    const secondSpeech = new ManualSpeech()
    const secondRuntime = new ListeningTrainingRuntime({
      ...options,
      speech: secondSpeech,
    })
    const restored = await secondRuntime.initialize()
    expect(restored.playback.status).toBe('paused')
    time.advance(20_000)
    await secondRuntime.togglePlayback()
    time.advance(2_000)
    secondSpeech.start()
    await (await timing.session()).flush()
    await secondRuntime.setRepeatMode('none')
    time.advance(4_000)
    await secondRuntime.dispose()

    const audioSeconds = timingEvents(sink)
      .filter(
        (event) =>
          event.payload.reason === 'active-audio-listening',
      )
      .reduce(
        (total, event) => total + event.payload.elapsedSeconds,
        0,
      )
    expect(audioSeconds).toBe(9)
    expect(
      timingEvents(sink).some(
        (event) => event.payload.elapsedSeconds >= 120,
      ),
    ).toBe(false)
  })

  it('retries timing finish before publishing or displaying completion', async () => {
    const task = createListeningTask()
    const sink = new RecordingSink()
    const speech = new ManualSpeech()
    const calls: string[] = []
    const timingSession = new FailOnceFinishTimingSession(calls)
    const timingFactory: ListeningEffectiveTimingSessionFactoryPort = {
      async create() {
        return timingSession
      },
    }
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: { load: async () => catalog() },
      eventSink: {
        async publish(event) {
          calls.push(`event:${event.type}`)
          await sink.publish(event)
        },
      },
      repository: new ListeningSessionRepository(
        new AdvancingListeningStore(new ManualTime()),
      ),
      speech,
      timingSessionFactory: timingFactory,
      now: () => new Date(START_WALL_MS).toISOString(),
      createId: sequenceIds('finish-retry'),
    })
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => notifications.push(session))

    await runtime.initialize()
    await runtime.togglePlayback()
    speech.start()
    speech.end()
    await runtime.setRate(1)
    await runtime.select(choiceCorrectOptionId())
    await runtime.submit()
    await expect(runtime.advance()).rejects.toThrow(
      'timing finish failed',
    )

    expect(
      sink.events.some(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toBe(false)
    expect(
      notifications.some((session) => session.phase === 'completed'),
    ).toBe(false)
    expect(runtime.currentSession).toMatchObject({
      phase: 'completed',
    })
    expect(runtime.currentSession?.pendingEvents).toHaveLength(1)

    const completed = await runtime.retryPendingEvents()
    expect(completed.phase).toBe('completed')
    expect(
      notifications.filter(
        (session) => session.phase === 'completed',
      ),
    ).toHaveLength(1)
    const finishCompleted = calls.indexOf('timing:finished')
    const completionPublished = calls.indexOf(
      'event:learning.attempt.completed.v1',
    )
    expect(finishCompleted).toBeGreaterThanOrEqual(0)
    expect(finishCompleted).toBeLessThan(completionPublished)
  })

  it('keeps the newest rapid dictation with timing and slow serialized storage', async () => {
    const task = createListeningTask()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const listeningStore = new ControlledListeningStore(time)
    const repository = new ListeningSessionRepository(listeningStore)
    const sink = new RecordingSink()
    const speech = new ManualSpeech()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'dictation-timing',
    })
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: { load: async () => catalog(dictationQuestion) },
      eventSink: sink,
      repository,
      speech,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('dictation-business'),
    })

    await runtime.initialize()
    await runtime.togglePlayback()
    speech.start()
    speech.end()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')
    listeningStore.controlled = true

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    const submission = runtime.submit()

    // The completed prompt is already durable; the controlled queue now
    // contains the three drafts followed by the feedback transition.
    for (let write = 0; write < 4; write += 1) {
      for (
        let turn = 0;
        turn < 1_000 &&
        listeningStore.pendingWrites.length === 0;
        turn += 1
      ) {
        await Promise.resolve()
      }
      expect(listeningStore.pendingWrites.length).toBe(1)
      listeningStore.releaseNext(2_000)
    }
    const submitted = await submission
    await Promise.all(updates)
    const restored = await repository.load(task)

    expect(submitted).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abc',
    })
    expect(submitted.answers.at(-1)?.response).toBe('abc')
    expect(restored).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abc',
    })
    expect(restored?.answers.at(-1)?.response).toBe('abc')
    expect(
      timingEvents(sink)
        .filter(
          (event) => event.payload.reason === 'content-loading',
        )
        .reduce(
          (total, event) => total + event.payload.elapsedSeconds,
          0,
        ),
    ).toBeGreaterThanOrEqual(8)
    await runtime.dispose()
  })

  it('serializes immediate submit, exit pause, and unload disposal', async () => {
    const task = createListeningTask()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const listeningStore = new ControlledListeningStore(time)
    const repository = new ListeningSessionRepository(listeningStore)
    const sink = new RecordingSink()
    const speech = new ManualSpeech()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'exit-timing',
    })
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: { load: async () => catalog(dictationQuestion) },
      eventSink: sink,
      repository,
      speech,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('exit-business'),
    })

    await runtime.initialize()
    await runtime.togglePlayback()
    speech.start()
    speech.end()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')
    listeningStore.controlled = true

    const draft = runtime.changeDictation('abc')
    const submission = runtime.submit()
    const exit = (async () => {
      await runtime.pause('user-paused')
      await runtime.dispose()
    })()
    let exitSettled = false
    let exitError: unknown
    void exit.then(
      () => {
        exitSettled = true
      },
      (error: unknown) => {
        exitError = error
        exitSettled = true
      },
    )

    for (let turn = 0; turn < 4_000 && !exitSettled; turn += 1) {
      await Promise.resolve()
      if (listeningStore.pendingWrites.length > 0) {
        listeningStore.releaseNext(2_000)
      }
    }
    expect(exitSettled).toBe(true)
    expect(exitError).toBeUndefined()
    await Promise.all([draft, submission, exit])

    const restored = await repository.load(task)
    expect(restored).toMatchObject({
      phase: 'paused',
      pausedFromPhase: 'feedback',
      dictationInput: 'abc',
      pendingEvents: [],
    })
    expect(restored?.answers.at(-1)?.response).toBe('abc')
    expect(
      sink.events.some(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toBe(false)
    expect(
      sink.events.find(
        (event) => event.type === 'learning.task.paused.v1',
      ),
    ).toMatchObject({
      type: 'learning.task.paused.v1',
      payload: { durationSeconds: 0 },
    })
    expect((await timing.session()).state.lifecycle).toBe('disposed')
    expect(snapshots.records.size).toBe(1)
  })

  it('closes timing on synthesis error without inventing a scored attempt', async () => {
    const task = createListeningTask()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const snapshots = new MemoryTimingSnapshotStore()
    const sink = new RecordingSink()
    const timing = effectiveFactory({
      task,
      sink,
      snapshots,
      lifecycle,
      time,
      createId: () => 'error-timing',
    })
    const speech = new ManualSpeech()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-28',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(
        new AdvancingListeningStore(time),
      ),
      speech,
      timingSessionFactory: timing.factory,
      now: () => new Date(time.wallTimeMs).toISOString(),
      createId: sequenceIds('error-business'),
    })

    await runtime.initialize()
    await runtime.togglePlayback()
    speech.start()
    await (await timing.session()).flush()
    await runtime.setRepeatMode('none')
    time.advance(4_000)
    speech.error()
    await runtime.retryPendingEvents()

    expect(runtime.currentSession?.phase).toBe('error')
    expect(
      timingEvents(sink)
        .filter(
          (event) =>
            event.payload.reason === 'active-audio-listening',
        )
        .reduce(
          (total, event) => total + event.payload.elapsedSeconds,
          0,
        ),
    ).toBe(4)
    expect(sink.events.at(-1)).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        result: 'unscorable',
        durationSeconds: 0,
        taskCompleted: false,
      },
    })
    await runtime.dispose()
  })
})

class FailOnceFinishTimingSession
  implements ListeningEffectiveTimingSessionPort
{
  failNextFinish = true
  private readonly calls: string[]

  constructor(calls: string[]) {
    this.calls = calls
  }

  async start(
    _declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {}

  async transition(
    _declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {}

  async activity(): Promise<void> {}

  async pause(): Promise<void> {}

  async resume(
    _declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {}

  async finish(): Promise<void> {
    this.calls.push('timing:finish')
    if (this.failNextFinish) {
      this.failNextFinish = false
      throw new Error('timing finish failed')
    }
    this.calls.push('timing:finished')
  }

  async dispose(): Promise<void> {}
}
