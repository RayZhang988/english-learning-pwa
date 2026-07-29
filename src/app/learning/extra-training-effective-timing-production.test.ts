import { describe, expect, it } from 'vitest'
import {
  applyExtraTrainingEvent,
  parseExtraTrainingEvent,
  parseLearningEvent,
  type ExtraTrainingEvent,
  type ExtraTrainingSession,
  type ExtraTrainingState,
  type ExtraTrainingTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import type {
  EffectiveTimingClock,
  EffectiveTimingScheduler,
  ExtraTrainingEffectiveTimingSessionFactoryPort,
  ExtraTrainingEventSink,
  TimingLifecycleEvent,
  TimingLifecyclePort,
  TimingLifecycleVisibility,
} from '../../platform/index.ts'
import {
  ProductionExtraTrainingEffectiveTimingSessionFactory,
} from './extra-training-effective-timing-production.ts'
import type {
  ExtraTrainingEffectiveTimingIdentity,
  ExtraTrainingEffectiveTimingSnapshot,
  ExtraTrainingEffectiveTimingSnapshotStore,
} from './extra-training-effective-timing-snapshot-repository.ts'

const START_WALL_MS = Date.parse(
  '2026-07-29T08:00:00.000Z',
)

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
            left[1].dueAt - right[1].dueAt ||
            left[0] - right[0],
        )[0]
      if (!next) {
        break
      }
      const [id, timer] = next
      this.#timers.delete(id)
      const delta = timer.dueAt - this.monotonicTimeMs
      this.monotonicTimeMs = timer.dueAt
      this.wallTimeMs += delta
      timer.callback()
    }
    const remaining = target - this.monotonicTimeMs
    this.monotonicTimeMs = target
    this.wallTimeMs += remaining
  }
}

class ManualLifecycle implements TimingLifecyclePort {
  visibility: TimingLifecycleVisibility = 'foreground'
  readonly listeners = new Set<
    (event: TimingLifecycleEvent) => void
  >()

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

class MemorySnapshotStore
  implements ExtraTrainingEffectiveTimingSnapshotStore
{
  readonly records = new Map<
    string,
    ExtraTrainingEffectiveTimingSnapshot
  >()

  async load(identity: ExtraTrainingEffectiveTimingIdentity) {
    return this.records.get(identity.sessionId)
  }

  async save(
    snapshot: ExtraTrainingEffectiveTimingSnapshot,
  ): Promise<void> {
    this.records.set(
      snapshot.identity.sessionId,
      structuredClone(snapshot),
    )
  }

  async delete(
    identity: ExtraTrainingEffectiveTimingIdentity,
  ): Promise<void> {
    this.records.delete(identity.sessionId)
  }
}

class RecordingExtraTrainingEventSink
  implements ExtraTrainingEventSink
{
  readonly calls: ExtraTrainingEvent[] = []
  readonly events: ExtraTrainingTimingSegmentRecordedEvent[] = []
  failNext = false
  #blockNext = false
  #blocked: (() => void) | undefined
  #release: (() => void) | undefined
  activePublishes = 0
  maximumConcurrentPublishes = 0

  blockNextPublish(): Promise<void> {
    this.#blockNext = true
    return new Promise((resolve) => {
      this.#blocked = resolve
    })
  }

  releaseBlockedPublish(): void {
    this.#release?.()
    this.#release = undefined
  }

  async publishExtraTrainingEvent(
    event: ExtraTrainingEvent,
  ): Promise<void> {
    this.calls.push(event)
    this.activePublishes += 1
    this.maximumConcurrentPublishes = Math.max(
      this.maximumConcurrentPublishes,
      this.activePublishes,
    )
    try {
      if (this.#blockNext) {
        this.#blockNext = false
        await new Promise<void>((resolve) => {
          this.#release = resolve
          this.#blocked?.()
          this.#blocked = undefined
        })
      }
      if (this.failNext) {
        this.failNext = false
        throw new Error('simulated extra-training save failure')
      }
      if (
        event.type !==
        'learning.extra-training.timing.segment.recorded.v1'
      ) {
        throw new TypeError('unexpected non-timing event')
      }
      if (
        !this.events.some(
          (candidate) => candidate.id === event.id,
        )
      ) {
        this.events.push(event)
      }
    } finally {
      this.activePublishes -= 1
    }
  }
}

class ApplyingExtraTrainingEventSink
  extends RecordingExtraTrainingEventSink
{
  state: ExtraTrainingState
  failAfterApply = false
  readonly deliveryAttempts: string[] = []

  constructor(session: ExtraTrainingSession) {
    super()
    this.state = {
      schemaVersion: 1,
      sessions: {
        [session.sessionId]: session,
      },
      processedEventIds: [],
    }
  }

  override async publishExtraTrainingEvent(
    event: ExtraTrainingEvent,
  ): Promise<void> {
    this.deliveryAttempts.push(event.id)
    this.state = applyExtraTrainingEvent(this.state, event)
    if (this.failAfterApply) {
      this.failAfterApply = false
      throw new Error('simulated acknowledgement failure')
    }
    await super.publishExtraTrainingEvent(event)
  }
}

function extraTrainingSession(
  overrides: Partial<ExtraTrainingSession> = {},
): ExtraTrainingSession {
  return {
    schemaVersion: 1,
    sessionId: 'extra-session-vocabulary',
    localDate: '2026-07-29',
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    mode: 'learn',
    targetDifficulty: 2.5,
    targetEffectiveSeconds: 900,
    remainingEffectiveSeconds: 900,
    status: 'running',
    nextSupplyCursor: null,
    excludeItemIds: [],
    priorityItemIds: {
      'recent-error': [],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    },
    completedItemCount: 0,
    startedAt: '2026-07-29T08:00:00.000Z',
    updatedAt: '2026-07-29T08:00:00.000Z',
    endedAt: null,
    endReason: null,
    ...overrides,
  }
}

function createFactory(
  options: {
    readonly sink?: RecordingExtraTrainingEventSink
    readonly snapshots?: MemorySnapshotStore
    readonly lifecycle?: ManualLifecycle
    readonly time?: ManualTime
    readonly createId?: () => string
  } = {},
) {
  const sink =
    options.sink ?? new RecordingExtraTrainingEventSink()
  const snapshots =
    options.snapshots ?? new MemorySnapshotStore()
  const lifecycle =
    options.lifecycle ?? new ManualLifecycle()
  const time = options.time ?? new ManualTime()
  const factory =
    new ProductionExtraTrainingEffectiveTimingSessionFactory({
      eventSink: sink,
      snapshotStore: snapshots,
      lifecycle,
      clock: time,
      scheduler: time,
      createId:
        options.createId ?? (() => 'stable-extra-timing-session'),
    })
  return { factory, sink, snapshots, lifecycle, time }
}

function totalActiveSeconds(
  events: readonly ExtraTrainingTimingSegmentRecordedEvent[],
): number {
  return events
    .filter((event) =>
      event.payload.reason.startsWith('active-'),
    )
    .reduce(
      (total, event) =>
        total + event.payload.elapsedSeconds,
      0,
    )
}

describe('ProductionExtraTrainingEffectiveTimingSessionFactory', () => {
  it('implements the public platform factory and isolated event-sink ports', () => {
    const { factory, sink } = createFactory()
    const publicFactory: ExtraTrainingEffectiveTimingSessionFactoryPort =
      factory
    const publicSink: ExtraTrainingEventSink = sink

    expect(publicFactory).toBe(factory)
    expect(publicSink).toBe(sink)
  })

  it('publishes a separately parsed event with only the extra-training identity', async () => {
    const { factory, sink, time } = createFactory()
    const session = await factory.create(extraTrainingSession())

    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_400)
    await session.pause()

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    expect(event).toMatchObject({
      id: 'extra-timing:stable-extra-timing-session:000001',
      type: 'learning.extra-training.timing.segment.recorded.v1',
      sourceModuleId: 'vocabulary',
      payload: {
        sessionId: 'extra-session-vocabulary',
        localDate: '2026-07-29',
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        mode: 'learn',
        elapsedSeconds: 5,
      },
    })
    expect('planId' in event.payload).toBe(false)
    expect('taskId' in event.payload).toBe(false)
    expect(() => parseExtraTrainingEvent(event)).not.toThrow()
    expect(() => parseLearningEvent(event)).toThrow(
      'Unsupported learning event type',
    )
    expect(
      JSON.parse(JSON.stringify(event)),
    ).toEqual(event)
    await session.dispose()
  })

  it('deduplicates concurrent mounts but rejects reuse of a sessionId for another identity', async () => {
    const { factory } = createFactory()
    const source = extraTrainingSession()
    const [first, second] = await Promise.all([
      factory.create(source),
      factory.create(source),
    ])

    expect(first).toBe(second)
    await expect(
      factory.create(
        extraTrainingSession({
          localDate: '2026-07-30',
        }),
      ),
    ).rejects.toThrow(
      'already bound to another identity',
    )
    await first.dispose()
  })

  it('applies the 45-second idle policy and never restarts merely because the page is foregrounded', async () => {
    const { factory, sink, lifecycle, time } =
      createFactory()
    const session = await factory.create(extraTrainingSession())
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })

    time.advance(10_000)
    lifecycle.emit({
      type: 'background',
      source: 'pagehide',
    })
    await session.flush()
    time.advance(60_000)
    lifecycle.emit({
      type: 'foreground',
      source: 'pageshow',
    })
    await session.flush()
    time.advance(5_000)
    await session.flush()
    expect(totalActiveSeconds(sink.events)).toBe(10)

    lifecycle.emit({ type: 'activity', source: 'touch' })
    await session.flush()
    time.advance(50_000)
    await session.flush()
    await session.pause()
    expect(
      sink.events.map(
        (event) => event.payload.elapsedSeconds,
      ),
    ).toEqual([10, 45, 5])
    expect(
      sink.events.map((event) => event.payload.reason),
    ).toEqual([
      'active-answering',
      'active-answering',
      'idle-timeout',
    ])
    expect(totalActiveSeconds(sink.events)).toBe(55)
    await session.dispose()
  })

  it('supports listening and speaking media phases with 15-minute safety segmentation and explicit pause', async () => {
    const time = new ManualTime()
    let nextId = 1
    const { factory, sink } = createFactory({
      time,
      createId: () => `media-session-${nextId++}`,
    })
    const listening = await factory.create(
      extraTrainingSession({
        sessionId: 'extra-listening',
        domain: 'listening',
        targetModuleId: 'listening',
      }),
    )
    await listening.start({
      phase: 'audio-listening',
      reason: 'active-audio-listening',
    })
    time.advance(905_000)
    await listening.pause()

    const speaking = await factory.create(
      extraTrainingSession({
        sessionId: 'extra-speaking',
        domain: 'speaking',
        targetModuleId: 'speaking',
      }),
    )
    await speaking.start({
      phase: 'recording',
      reason: 'active-recording',
    })
    time.advance(2_000)
    await speaking.transition({
      phase: 'playback',
      reason: 'active-playback',
    })
    time.advance(3_000)
    await speaking.pause()

    expect(
      sink.events.map(
        (event) => [
          event.payload.sessionId,
          event.payload.reason,
          event.payload.elapsedSeconds,
        ],
      ),
    ).toEqual([
      ['extra-listening', 'active-audio-listening', 900],
      ['extra-listening', 'active-audio-listening', 5],
      ['extra-speaking', 'active-recording', 2],
      ['extra-speaking', 'active-playback', 3],
    ])
    await listening.dispose()
    await speaking.dispose()
  })

  it('replays a stable pending ID after refresh without double-applying a saved event', async () => {
    const snapshots = new MemorySnapshotStore()
    const time = new ManualTime()
    const source = extraTrainingSession()
    const firstSink =
      new ApplyingExtraTrainingEventSink(source)
    const first = createFactory({
      snapshots,
      time,
      sink: firstSink,
      createId: () => 'replay-stable-id',
    })
    const firstSession = await first.factory.create(source)
    await firstSession.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_000)
    firstSink.failAfterApply = true
    await expect(firstSession.pause()).rejects.toThrow(
      'simulated acknowledgement failure',
    )
    expect(
      firstSink.state.sessions[source.sessionId]
        .remainingEffectiveSeconds,
    ).toBe(895)
    expect(firstSink.state.processedEventIds).toHaveLength(1)

    const pending = snapshots.records.get(source.sessionId)
    expect(pending?.pendingEvents).toHaveLength(1)
    const pendingId = pending?.pendingEvents[0].id
    expect(pendingId).toBe(
      'extra-timing:replay-stable-id:000001',
    )

    const recovered = createFactory({
      snapshots,
      time,
      sink: firstSink,
      lifecycle: new ManualLifecycle(),
      createId: () => 'must-not-replace-restored-id',
    })
    const recoveredSession =
      await recovered.factory.create(source)

    expect(
      firstSink.events.map((event) => event.id),
    ).toEqual([pendingId])
    expect(firstSink.deliveryAttempts).toEqual([
      pendingId,
      pendingId,
    ])
    expect(
      firstSink.state.sessions[source.sessionId]
        .remainingEffectiveSeconds,
    ).toBe(895)
    expect(firstSink.state.processedEventIds).toEqual([
      pendingId,
    ])
    expect(
      snapshots.records.get(source.sessionId)?.pendingEvents,
    ).toEqual([])
    expect(recoveredSession.state).toMatchObject({
      segmentOpen: false,
      suspended: true,
    })
    await recoveredSession.dispose()
  })

  it('drops an open pre-crash segment instead of backfilling the offline interval', async () => {
    const snapshots = new MemorySnapshotStore()
    const time = new ManualTime()
    const first = createFactory({
      snapshots,
      time,
      createId: () => 'crashed-extra-timing',
    })
    const source = extraTrainingSession()
    const firstSession = await first.factory.create(source)
    await firstSession.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    expect(
      snapshots.records.get(source.sessionId)?.openSegment,
    ).not.toBeNull()

    const recoveredSink =
      new RecordingExtraTrainingEventSink()
    const recoveredLifecycle = new ManualLifecycle()
    const recovered = createFactory({
      snapshots,
      time,
      sink: recoveredSink,
      lifecycle: recoveredLifecycle,
    })
    const recoveredSession =
      await recovered.factory.create(source)

    time.advance(60_000)
    await recoveredSession.flush()
    expect(recoveredSink.events).toEqual([])
    recoveredLifecycle.emit({
      type: 'activity',
      source: 'input',
    })
    await recoveredSession.flush()
    time.advance(2_000)
    await recoveredSession.finish()
    expect(
      recoveredSink.events.map(
        (event) => event.payload.elapsedSeconds,
      ),
    ).toEqual([2])
    expect(recoveredSink.events[0].id).toBe(
      'extra-timing:crashed-extra-timing:000001',
    )
  })

  it('serializes durable delivery across simultaneous extra-training sessions', async () => {
    const sink = new RecordingExtraTrainingEventSink()
    const snapshots = new MemorySnapshotStore()
    const time = new ManualTime()
    let nextId = 1
    const { factory } = createFactory({
      sink,
      snapshots,
      time,
      createId: () => `parallel-${nextId++}`,
    })
    const vocabulary = await factory.create(
      extraTrainingSession(),
    )
    const listening = await factory.create(
      extraTrainingSession({
        sessionId: 'extra-listening',
        domain: 'listening',
        targetModuleId: 'listening',
      }),
    )
    await vocabulary.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    await listening.start({
      phase: 'audio-listening',
      reason: 'active-audio-listening',
    })
    time.advance(2_000)
    const blocked = sink.blockNextPublish()
    const firstPause = vocabulary.pause()
    const secondPause = listening.pause()
    await blocked

    expect(sink.calls).toHaveLength(1)
    expect(sink.maximumConcurrentPublishes).toBe(1)
    expect(
      snapshots.records.get('extra-listening')?.pendingEvents,
    ).toHaveLength(1)

    sink.releaseBlockedPublish()
    await Promise.all([firstPause, secondPause])
    expect(sink.calls).toHaveLength(2)
    expect(sink.maximumConcurrentPublishes).toBe(1)
    await vocabulary.dispose()
    await listening.dispose()
  })
})
