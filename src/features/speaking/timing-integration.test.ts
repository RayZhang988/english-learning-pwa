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
  type MicrophonePermissionService,
  type NetworkStatusService,
  type TimingLifecycleEvent,
  type TimingLifecyclePort,
  type TimingLifecycleVisibility,
} from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { SpeakingSessionRepository } from './repository.ts'
import { SpeakingTrainingRuntime } from './runtime.ts'
import {
  createSpeakingCatalogFixture,
  createSpeakingTask,
} from './test-fixtures.ts'
import type {
  SpeakingEffectiveTimingSessionFactoryPort,
  SpeakingEffectiveTimingSessionPort,
  SpeakingTimingPhaseDeclaration,
} from './timing.ts'
import type {
  SpeakingPlaybackLifecycleCallbacks,
  SpeakingRecognitionHandle,
  SpeakingRecognitionOutcome,
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingLifecycleCallbacks,
  SpeakingRecordingPort,
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

class MemoryTimingStore implements EffectiveTimingSnapshotStore {
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

class AdvancingSpeakingStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  nextPutDelayMs = 0
  readonly #time: ManualTime

  constructor(time: ManualTime) {
    this.#time = time
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
      this.#time.advance(this.nextPutDelayMs)
      this.nextPutDelayMs = 0
    }
    this.records.set(key, {
      namespace: 'feature.speaking',
      key,
      value: structuredClone(value),
      schemaVersion,
      updatedAt: new Date(this.#time.wallTimeMs).toISOString(),
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

class RecordingSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []

  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(structuredClone(event))
  }
}

class RealTimingFactory
  implements SpeakingEffectiveTimingSessionFactoryPort
{
  readonly sessions: EffectiveTimingSession[] = []
  readonly #task: LearningTask
  readonly #sink: PlatformEventSink
  readonly #store: EffectiveTimingSnapshotStore
  readonly #lifecycle: TimingLifecyclePort
  readonly #time: ManualTime
  #id = 0

  constructor(options: {
    readonly task: LearningTask
    readonly sink: PlatformEventSink
    readonly store: EffectiveTimingSnapshotStore
    readonly lifecycle: TimingLifecyclePort
    readonly time: ManualTime
  }) {
    this.#task = options.task
    this.#sink = options.sink
    this.#store = options.store
    this.#lifecycle = options.lifecycle
    this.#time = options.time
  }

  async create(
    taskId: string,
    expectedModuleId: 'speaking',
  ): Promise<EffectiveTimingSession> {
    expect(taskId).toBe(this.#task.taskId)
    expect(expectedModuleId).toBe('speaking')
    const identity: EffectiveTimingTaskIdentity = {
      planId: this.#task.planId,
      taskId: this.#task.taskId,
      learningUnitId: this.#task.learningUnitId,
      contentRef: this.#task.contentRef,
      domain: 'speaking',
      targetModuleId: 'speaking',
      localDate: '2026-07-28',
      mode: this.#task.mode,
    }
    const session = await EffectiveTimingSession.create({
      identity,
      eventSink: this.#sink,
      snapshotStore: this.#store,
      lifecycle: this.#lifecycle,
      clock: this.#time,
      scheduler: this.#time,
      createId: () => `speaking-timing-${++this.#id}`,
    })
    this.sessions.push(session)
    return session
  }
}

class ControlledRecorder implements SpeakingRecordingPort {
  recordingLifecycle: SpeakingRecordingLifecycleCallbacks | null = null
  playbackLifecycle: SpeakingPlaybackLifecycleCallbacks | null = null
  playbackResolve: (() => void) | null = null
  playbackReject: ((error: Error) => void) | null = null
  starts = 0
  stops = 0
  cancels = 0

  capabilities() {
    return {
      supported: true,
      supportedMimeTypes: ['audio/mp4'],
    }
  }

  start(
    _stream: MediaStream,
    lifecycle?: SpeakingRecordingLifecycleCallbacks,
  ): void {
    this.starts += 1
    this.recordingLifecycle = lifecycle ?? null
    lifecycle?.onStarted()
  }

  async stop(): Promise<SpeakingRecording> {
    this.stops += 1
    return {
      id: `recording-${this.stops}`,
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 10_000,
    }
  }

  cancel(): void {
    this.cancels += 1
  }

  play(
    _recording: SpeakingRecording,
    lifecycle?: SpeakingPlaybackLifecycleCallbacks,
  ): Promise<void> {
    this.playbackLifecycle = lifecycle ?? null
    lifecycle?.onStarted()
    return new Promise<void>((resolve, reject) => {
      this.playbackResolve = resolve
      this.playbackReject = reject
    })
  }

  endPlayback(): void {
    this.playbackLifecycle?.onEnded()
    this.playbackResolve?.()
    this.playbackResolve = null
    this.playbackReject = null
  }

  failPlayback(): void {
    const error = new Error('playback failed')
    this.playbackLifecycle?.onError(error)
    this.playbackReject?.(error)
    this.playbackResolve = null
    this.playbackReject = null
  }

  stopPlayback(): void {
    if (this.playbackResolve) {
      this.playbackLifecycle?.onPaused()
      this.playbackResolve()
      this.playbackResolve = null
      this.playbackReject = null
    }
  }

  discard(_recording: SpeakingRecording): void {}
  dispose(): void {
    this.stopPlayback()
  }
}

class DeferredRecognition implements SpeakingRecognitionPort {
  resolve: ((outcome: SpeakingRecognitionOutcome) => void) | null = null
  starts = 0

  capabilities() {
    return { supported: true, requiresSiri: true }
  }

  start(_locale: 'en-US'): SpeakingRecognitionHandle {
    this.starts += 1
    const result = new Promise<SpeakingRecognitionOutcome>((resolve) => {
      this.resolve = resolve
    })
    return {
      result,
      stop() {},
      abort() {
        // The browser implementation resolves an aborted outcome itself.
      },
    }
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

const stream = {
  getTracks: () => [{ stop() {} }],
} as unknown as MediaStream

async function settleUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return
    }
    await Promise.resolve()
  }
  throw new Error(`Timed out waiting for ${message}.`)
}

function timingEvents(
  sink: RecordingSink,
): LearningTimingSegmentRecordedEvent[] {
  return sink.events.filter(
    (event): event is LearningTimingSegmentRecordedEvent =>
      event.type === 'learning.timing.segment.recorded.v1',
  )
}

function sumReason(
  events: readonly LearningTimingSegmentRecordedEvent[],
  reason: LearningTimingSegmentRecordedEvent['payload']['reason'],
): number {
  return events
    .filter((event) => event.payload.reason === reason)
    .reduce((sum, event) => sum + event.payload.elapsedSeconds, 0)
}

function createHarness(options: {
  readonly network?: NetworkStatusService
  readonly permission?: MicrophonePermissionService
  readonly repository?: SpeakingSessionRepository
  readonly timingStore?: MemoryTimingStore
  readonly sink?: RecordingSink
  readonly time?: ManualTime
  readonly lifecycle?: ManualLifecycle
  readonly recorder?: ControlledRecorder
  readonly recognition?: SpeakingRecognitionPort
} = {}) {
  const task = createSpeakingTask()
  const time = options.time ?? new ManualTime()
  const lifecycle = options.lifecycle ?? new ManualLifecycle()
  const sink = options.sink ?? new RecordingSink()
  const timingStore = options.timingStore ?? new MemoryTimingStore()
  const speakingStore = new AdvancingSpeakingStore(time)
  const repository =
    options.repository ?? new SpeakingSessionRepository(speakingStore)
  const recorder = options.recorder ?? new ControlledRecorder()
  const recognition =
    options.recognition ?? new DeferredRecognition()
  const timingFactory = new RealTimingFactory({
    task,
    sink,
    store: timingStore,
    lifecycle,
    time,
  })
  let eventId = 0
  const runtime = new SpeakingTrainingRuntime({
    task,
    localDate: '2026-07-28',
    contentSource: {
      load: async () => createSpeakingCatalogFixture(),
    },
    eventSink: sink,
    repository,
    networkStatus: options.network ?? online,
    microphonePermission:
      options.permission ?? {
        query: async () => 'granted',
        request: async () => stream,
      },
    recorder,
    recognition,
    now: () => new Date(time.wallTimeMs).toISOString(),
    createId: () => `speaking-event-${++eventId}`,
    timingSessionFactory: timingFactory,
  })
  return {
    task,
    time,
    lifecycle,
    sink,
    timingStore,
    speakingStore,
    repository,
    recorder,
    recognition,
    timingFactory,
    runtime,
  }
}

describe('speaking R3 effective timing integration', () => {
  it('counts only active answering, actual recording/playback and feedback', async () => {
    const time = new ManualTime()
    const speakingStore = new AdvancingSpeakingStore(time)
    const recognition = new DeferredRecognition()
    const permission: MicrophonePermissionService = {
      query: async () => 'granted',
      request: async () => {
        time.advance(8_000)
        return stream
      },
    }
    const harness = createHarness({
      time,
      permission,
      recognition,
      repository: new SpeakingSessionRepository(speakingStore),
    })

    await harness.runtime.initialize()
    time.advance(50_000)
    await settleUntil(
      () =>
        sumReason(
          timingEvents(harness.sink),
          'active-answering',
        ) === 45,
      '45-second answering idle cutoff',
    )

    speakingStore.nextPutDelayMs = 5_000
    await harness.runtime.startRecording()
    expect(
      harness.timingFactory.sessions[0].state.declaration?.reason,
    ).toBe('active-recording')

    time.advance(6_000)
    harness.recorder.recordingLifecycle?.onPaused()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'user-paused',
      'recording pause',
    )
    time.advance(3_000)
    harness.recorder.recordingLifecycle?.onResumed()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'active-recording',
      'recording resume',
    )
    time.advance(4_000)

    const stopping = harness.runtime.stopRecording()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'network-wait',
      'speech recognition network wait',
    )
    time.advance(9_000)
    recognition.resolve?.({
      status: 'recognized',
      transcript: 'I am from Shanghai',
      alternatives: [],
    })
    const feedback = await stopping
    expect(feedback.phase).toBe('feedback')

    time.advance(5_000)
    const playback = harness.runtime.playRecording()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'active-playback',
      'recording playback start',
    )
    time.advance(3_000)
    harness.recorder.playbackLifecycle?.onWaiting()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'media-loading',
      'playback waiting',
    )
    time.advance(4_000)
    harness.recorder.playbackLifecycle?.onStarted()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'active-playback',
      'playback resume after waiting',
    )
    time.advance(2_000)
    harness.recorder.playbackLifecycle?.onPaused()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'user-paused',
      'playback pause',
    )
    time.advance(3_000)
    harness.recorder.playbackLifecycle?.onStarted()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'active-playback',
      'playback resume',
    )
    time.advance(1_000)
    harness.recorder.endPlayback()
    await playback

    time.advance(2_000)
    const completed = await harness.runtime.advance()
    const segments = timingEvents(harness.sink)
    const attemptIndex = harness.sink.events.findIndex(
      (event) => event.type === 'learning.attempt.completed.v1',
    )
    const lastTimingIndex = harness.sink.events.reduce(
      (latest, event, index) =>
        event.type === 'learning.timing.segment.recorded.v1'
          ? index
          : latest,
      -1,
    )

    expect(completed.phase).toBe('completed')
    expect(sumReason(segments, 'active-answering')).toBe(45)
    expect(sumReason(segments, 'active-recording')).toBe(10)
    expect(sumReason(segments, 'active-playback')).toBe(6)
    expect(sumReason(segments, 'active-feedback')).toBe(7)
    expect(sumReason(segments, 'permission-wait')).toBe(8)
    expect(sumReason(segments, 'network-wait')).toBe(9)
    expect(attemptIndex).toBeGreaterThan(lastTimingIndex)
    expect(harness.sink.events[attemptIndex]).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        result: 'scored',
        durationSeconds: 0,
      },
    })
  })

  it('stops on background, never resumes automatically, and never backfills refresh time', async () => {
    const harness = createHarness()
    await harness.runtime.initialize()
    harness.time.advance(5_000)

    harness.lifecycle.emit({
      type: 'background',
      source: 'visibilitychange',
    })
    await settleUntil(
      () => harness.timingFactory.sessions[0].state.suspended,
      'background suspension',
    )
    harness.time.advance(60_000)
    harness.lifecycle.emit({
      type: 'foreground',
      source: 'visibilitychange',
    })
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.visibility ===
        'foreground',
      'foreground state',
    )
    expect(harness.timingFactory.sessions[0].state.segmentOpen).toBe(
      false,
    )

    await harness.runtime.pause('app-backgrounded')
    await harness.runtime.resume()
    harness.time.advance(4_000)
    await harness.runtime.dispose()
    harness.time.advance(100_000)

    const restoredFactory = new RealTimingFactory({
      task: harness.task,
      sink: harness.sink,
      store: harness.timingStore,
      lifecycle: harness.lifecycle,
      time: harness.time,
    })
    const restored = new SpeakingTrainingRuntime({
      task: harness.task,
      localDate: '2026-07-28',
      contentSource: {
        load: async () => createSpeakingCatalogFixture(),
      },
      eventSink: harness.sink,
      repository: harness.repository,
      networkStatus: online,
      microphonePermission: {
        query: async () => 'granted',
        request: async () => stream,
      },
      recorder: new ControlledRecorder(),
      recognition: new DeferredRecognition(),
      now: () => new Date(harness.time.wallTimeMs).toISOString(),
      createId: () => 'restored-event',
      timingSessionFactory: restoredFactory,
    })
    const restoredSession = await restored.initialize()
    await restored.dispose()

    expect(restoredSession.phase).toBe('practicing')
    expect(
      sumReason(
        timingEvents(harness.sink),
        'active-answering',
      ),
    ).toBe(9)
  })

  it('finishes legal unscorable practice before its attempt event and keeps duration untrusted', async () => {
    const harness = createHarness({
      network: offline,
      recognition: {
        capabilities: () => ({
          supported: false,
          requiresSiri: true,
        }),
        start: () => {
          throw new Error('recognition must stay disabled offline')
        },
      },
    })

    await harness.runtime.initialize()
    await harness.runtime.startRecording()
    harness.time.advance(3_000)
    await harness.runtime.stopRecording()
    harness.time.advance(2_000)
    await harness.runtime.advance()

    const attemptIndex = harness.sink.events.findIndex(
      (event) => event.type === 'learning.attempt.completed.v1',
    )
    const lastTimingIndex = harness.sink.events.reduce(
      (latest, event, index) =>
        event.type === 'learning.timing.segment.recorded.v1'
          ? index
          : latest,
      -1,
    )
    expect(attemptIndex).toBeGreaterThan(lastTimingIndex)
    expect(harness.sink.events[attemptIndex]).toMatchObject({
      payload: {
        result: 'unscorable',
        performanceScore: null,
        evidenceQuality: 0,
        taskCompleted: false,
        failureCategory: 'network',
        durationSeconds: 0,
      },
    })
  })

  it('stops actual recording and playback segments immediately on media errors', async () => {
    const harness = createHarness({
      network: offline,
      recognition: {
        capabilities: () => ({
          supported: false,
          requiresSiri: true,
        }),
        start: () => {
          throw new Error('recognition must stay disabled offline')
        },
      },
    })
    await harness.runtime.initialize()
    await harness.runtime.startRecording()
    harness.time.advance(3_000)
    harness.recorder.recordingLifecycle?.onError(
      new Error('capture failed'),
    )
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'media-loading',
      'recording error exclusion',
    )
    harness.time.advance(5_000)
    await harness.runtime.stopRecording()

    const playback = harness.runtime.playRecording()
    await settleUntil(
      () =>
        harness.timingFactory.sessions[0].state.declaration
          ?.reason === 'active-playback',
      'playback before error',
    )
    harness.time.advance(2_000)
    harness.recorder.failPlayback()
    const reviewed = await playback
    harness.time.advance(4_000)
    await harness.runtime.pause('user-paused')

    expect(reviewed.recorder.status).toBe('error')
    expect(
      sumReason(
        timingEvents(harness.sink),
        'active-recording',
      ),
    ).toBe(3)
    expect(
      sumReason(
        timingEvents(harness.sink),
        'active-playback',
      ),
    ).toBe(2)
  })

  it('deduplicates rapid recording and completion actions', async () => {
    const harness = createHarness({
      network: offline,
      recognition: {
        capabilities: () => ({
          supported: false,
          requiresSiri: true,
        }),
        start: () => {
          throw new Error('recognition must stay disabled offline')
        },
      },
    })
    await harness.runtime.initialize()
    const startOne = harness.runtime.startRecording()
    const startTwo = harness.runtime.startRecording()
    expect(startTwo).toBe(startOne)
    await Promise.all([startOne, startTwo])
    expect(harness.recorder.starts).toBe(1)

    const stopOne = harness.runtime.stopRecording()
    const stopTwo = harness.runtime.stopRecording()
    expect(stopTwo).toBe(stopOne)
    await Promise.all([stopOne, stopTwo])
    expect(harness.recorder.stops).toBe(1)

    const advanceOne = harness.runtime.advance()
    const advanceTwo = harness.runtime.advance()
    expect(advanceTwo).toBe(advanceOne)
    await Promise.all([advanceOne, advanceTwo])
    expect(
      harness.sink.events.filter(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toHaveLength(1)
  })

  it('interrupts permission and recognition waits without starting or hanging media', async () => {
    let resolvePermission: (value: MediaStream) => void = () => {
      throw new Error('Permission resolver is not ready.')
    }
    const stopLateTrack = { stop() {} }
    const stopLateTrackSpy: string[] = []
    stopLateTrack.stop = () => stopLateTrackSpy.push('stopped')
    const permissionRequest = new Promise<MediaStream>((resolve) => {
      resolvePermission = resolve
    })
    let permissionRequestCount = 0
    const permissionHarness = createHarness({
      permission: {
        query: async () => 'prompt',
        request: () => {
          permissionRequestCount += 1
          return permissionRequest
        },
      },
    })
    await permissionHarness.runtime.initialize()
    const starting = permissionHarness.runtime.startRecording()
    await settleUntil(
      () =>
        permissionHarness.timingFactory.sessions[0].state
          .declaration?.reason === 'permission-wait',
      'permission wait',
    )
    await settleUntil(
      () => permissionRequestCount === 1,
      'pending microphone request',
    )
    const pausing = permissionHarness.runtime.pause(
      'app-backgrounded',
    )
    await Promise.all([starting, pausing])
    expect(permissionHarness.recorder.starts).toBe(0)
    expect(permissionHarness.runtime.currentSession?.phase).toBe(
      'paused',
    )
    resolvePermission({
      getTracks: () => [stopLateTrack],
    } as unknown as MediaStream)
    await settleUntil(
      () => stopLateTrackSpy.length === 1,
      'late permission stream cleanup',
    )
    expect(stopLateTrackSpy).toEqual(['stopped'])

    const recognition = new DeferredRecognition()
    const recognitionHarness = createHarness({ recognition })
    await recognitionHarness.runtime.initialize()
    await recognitionHarness.runtime.startRecording()
    const stopping = recognitionHarness.runtime.stopRecording()
    await settleUntil(
      () =>
        recognitionHarness.timingFactory.sessions[0].state
          .declaration?.reason === 'network-wait',
      'recognition wait before interruption',
    )
    const backgrounding = recognitionHarness.runtime.pause(
      'app-backgrounded',
    )
    await Promise.all([stopping, backgrounding])
    expect(recognitionHarness.runtime.currentSession?.phase).toBe(
      'paused',
    )
    expect(
      recognitionHarness.sink.events.some(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toBe(false)
  })
})

class FinishRetryTimingSession
  implements SpeakingEffectiveTimingSessionPort
{
  readonly order: string[]
  failFinishOnce = true

  constructor(order: string[]) {
    this.order = order
  }

  async start(_declaration: SpeakingTimingPhaseDeclaration) {}
  async transition(_declaration: SpeakingTimingPhaseDeclaration) {}
  async activity() {}
  async pause() {}
  async resume(_declaration: SpeakingTimingPhaseDeclaration) {}

  async finish() {
    this.order.push('timing-finish')
    if (this.failFinishOnce) {
      this.failFinishOnce = false
      throw new Error('timing finish failed')
    }
  }

  async dispose() {}
}

describe('speaking timing completion retry', () => {
  it('retains completion in the outbox until timing finish succeeds', async () => {
    const order: string[] = []
    const timingSession = new FinishRetryTimingSession(order)
    const sink: PlatformEventSink = {
      async publish(event) {
        if (event.type === 'learning.attempt.completed.v1') {
          order.push('speaking-attempt')
        }
      },
    }
    const recorder = new ControlledRecorder()
    const runtime = new SpeakingTrainingRuntime({
      task: createSpeakingTask(),
      localDate: '2026-07-28',
      contentSource: {
        load: async () => createSpeakingCatalogFixture(),
      },
      eventSink: sink,
      repository: new SpeakingSessionRepository(
        new AdvancingSpeakingStore(new ManualTime()),
      ),
      networkStatus: offline,
      microphonePermission: {
        query: async () => 'granted',
        request: async () => stream,
      },
      recorder,
      recognition: {
        capabilities: () => ({
          supported: false,
          requiresSiri: true,
        }),
        start: () => {
          throw new Error('recognition must remain unavailable')
        },
      },
      now: () => new Date(START_WALL_MS).toISOString(),
      createId: () => 'completion-retry',
      timingSessionFactory: {
        async create() {
          return timingSession
        },
      },
    })

    await runtime.initialize()
    await runtime.startRecording()
    await runtime.stopRecording()
    await expect(runtime.advance()).rejects.toThrow(
      'timing finish failed',
    )
    expect(order).toEqual(['timing-finish'])
    expect(runtime.currentSession?.pendingEvents).toHaveLength(1)

    await runtime.retryPendingEvents()
    expect(order).toEqual([
      'timing-finish',
      'timing-finish',
      'speaking-attempt',
    ])
    expect(runtime.currentSession?.pendingEvents).toHaveLength(0)
  })
})
