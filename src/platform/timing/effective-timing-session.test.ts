import { describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import type {
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
} from '../index.ts'

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
      const delta = timer.dueAt - this.monotonicTimeMs
      this.monotonicTimeMs = timer.dueAt
      this.wallTimeMs += delta
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

class MemorySnapshotStore implements EffectiveTimingSnapshotStore {
  readonly records = new Map<string, EffectiveTimingSessionSnapshot>()

  async load(identity: EffectiveTimingTaskIdentity) {
    return this.records.get(identity.taskId)
  }

  async save(snapshot: EffectiveTimingSessionSnapshot): Promise<void> {
    this.records.set(snapshot.identity.taskId, structuredClone(snapshot))
  }

  async delete(identity: EffectiveTimingTaskIdentity): Promise<void> {
    this.records.delete(identity.taskId)
  }
}

class RecordingSink implements PlatformEventSink {
  readonly events: LearningTimingSegmentRecordedEvent[] = []
  readonly calls: PlatformEvent[] = []
  failNext = false
  #blockNext = false
  #notifyBlocked: (() => void) | undefined
  #releaseBlocked: (() => void) | undefined

  blockNextPublish(): Promise<void> {
    this.#blockNext = true
    return new Promise((resolve) => {
      this.#notifyBlocked = resolve
    })
  }

  releaseBlockedPublish(): void {
    this.#releaseBlocked?.()
    this.#releaseBlocked = undefined
  }

  async publish(event: PlatformEvent): Promise<void> {
    this.calls.push(event)
    if (this.#blockNext) {
      this.#blockNext = false
      await new Promise<void>((resolve) => {
        this.#releaseBlocked = resolve
        this.#notifyBlocked?.()
        this.#notifyBlocked = undefined
      })
    }
    if (this.failNext) {
      this.failNext = false
      throw new Error('simulated publish failure')
    }
    if (!this.events.some((candidate) => candidate.id === event.id)) {
      this.events.push(
        event as LearningTimingSegmentRecordedEvent,
      )
    }
  }
}

function identity(
  taskId = 'plan-1:task:vocabulary',
): EffectiveTimingTaskIdentity {
  return {
    planId: 'plan-1',
    taskId,
    learningUnitId: `unit:${taskId}`,
    contentRef: `lesson://${taskId}`,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    localDate: '2026-07-27',
    mode: 'learn',
  }
}

async function createHarness(
  options: {
    readonly taskId?: string
    readonly snapshots?: MemorySnapshotStore
    readonly sink?: RecordingSink
    readonly time?: ManualTime
    readonly lifecycle?: ManualLifecycle
    readonly createId?: () => string
  } = {},
) {
  const time = options.time ?? new ManualTime()
  const lifecycle = options.lifecycle ?? new ManualLifecycle()
  const snapshots = options.snapshots ?? new MemorySnapshotStore()
  const sink = options.sink ?? new RecordingSink()
  const session = await EffectiveTimingSession.create({
    identity: identity(options.taskId),
    eventSink: sink,
    snapshotStore: snapshots,
    lifecycle,
    clock: time,
    scheduler: time,
    createId: options.createId ?? (() => `session-${options.taskId ?? '1'}`),
  })
  return { time, lifecycle, snapshots, sink, session }
}

function reasons(sink: RecordingSink): readonly string[] {
  return sink.events.map((event) => event.payload.reason)
}

function totalEffectiveSeconds(sink: RecordingSink): number {
  return sink.events
    .filter((event) => event.payload.reason.startsWith('active-'))
    .reduce(
      (total, event) => total + event.payload.elapsedSeconds,
      0,
    )
}

describe('EffectiveTimingSession', () => {
  it('records normal answering and feedback with consistent integer timestamps', async () => {
    const { session, time, sink, snapshots } = await createHarness()

    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(12_400)
    await session.transition({
      phase: 'feedback',
      reason: 'active-feedback',
    })
    time.advance(3_600)
    await session.finish()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'active-feedback',
    ])
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([12, 3])
    for (const event of sink.events) {
      expect(
        (Date.parse(event.payload.endedAt) -
          Date.parse(event.payload.startedAt)) /
          1_000,
      ).toBe(event.payload.elapsedSeconds)
    }
    expect(snapshots.records.size).toBe(0)
  })

  it('cuts interaction segments at 45 seconds, idles 45 seconds after the last activity, and resumes on activity', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })

    time.advance(30_000)
    lifecycle.emit({ type: 'activity', source: 'input' })
    lifecycle.emit({ type: 'activity', source: 'pointer' })
    await session.flush()
    time.advance(15_000)
    await session.flush()
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([45])

    time.advance(30_000)
    await session.flush()
    expect(session.state.suspended).toBe(true)
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([45, 30])

    time.advance(5_000)
    lifecycle.emit({ type: 'activity', source: 'keyboard' })
    await session.flush()
    time.advance(2_000)
    await session.finish()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'active-answering',
      'idle-timeout',
      'active-answering',
    ])
    expect(totalEffectiveSeconds(sink)).toBe(77)
    expect(
      sink.events.find(
        (event) => event.payload.reason === 'idle-timeout',
      )?.payload.elapsedSeconds,
    ).toBe(5)
  })

  it('settles idle boundaries from the monotonic clock when browser timers are delivered late', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })

    time.jumpWithoutRunningTimers(60_000)
    lifecycle.emit({ type: 'activity', source: 'input' })
    await session.flush()
    time.advance(2_000)
    await session.finish()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'idle-timeout',
      'active-answering',
    ])
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([45, 15, 2])
    expect(totalEffectiveSeconds(sink)).toBe(47)
  })

  it('does not count a delayed idle interval when background closes the page', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })

    time.jumpWithoutRunningTimers(60_000)
    lifecycle.emit({ type: 'background', source: 'pagehide' })
    await session.flush()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'idle-timeout',
    ])
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([45, 15])
    expect(totalEffectiveSeconds(sink)).toBe(45)
    expect(session.state.segmentOpen).toBe(false)
  })

  it('captures lifecycle time before queued persistence finishes', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_000)
    const blocked = sink.blockNextPublish()
    const transitioning = session.transition({
      phase: 'feedback',
      reason: 'active-feedback',
    })
    await blocked

    time.advance(1_000)
    lifecycle.emit({ type: 'background', source: 'pagehide' })
    time.jumpWithoutRunningTimers(14_000)
    sink.releaseBlockedPublish()
    await transitioning
    await session.flush()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'active-feedback',
    ])
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([5, 1])
    expect(totalEffectiveSeconds(sink)).toBe(6)
    expect(session.state).toMatchObject({
      visibility: 'background',
      segmentOpen: false,
      suspended: true,
    })
    await session.dispose()
  })

  it('closes on background and requires real activity after foreground', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(10_000)
    lifecycle.emit({ type: 'background', source: 'pagehide' })
    await session.flush()

    time.advance(120_000)
    lifecycle.emit({ type: 'foreground', source: 'pageshow' })
    await session.flush()
    time.advance(5_000)
    await session.flush()
    expect(totalEffectiveSeconds(sink)).toBe(10)
    expect(session.state.segmentOpen).toBe(false)

    lifecycle.emit({ type: 'activity', source: 'touch' })
    await session.flush()
    time.advance(5_000)
    await session.finish()
    expect(totalEffectiveSeconds(sink)).toBe(15)
  })

  it('accepts immediate real activity after pageshow instead of throttling it as a duplicate', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    lifecycle.emit({ type: 'activity', source: 'touch' })
    lifecycle.emit({ type: 'background', source: 'pagehide' })
    lifecycle.emit({ type: 'foreground', source: 'pageshow' })
    lifecycle.emit({ type: 'activity', source: 'touch' })
    await session.flush()

    time.advance(2_000)
    await session.finish()

    expect(totalEffectiveSeconds(sink)).toBe(2)
  })

  it('requires an explicit media resume after returning to the foreground', async () => {
    const { session, time, lifecycle, sink } = await createHarness()
    const media = {
      phase: 'audio-listening' as const,
      reason: 'active-audio-listening' as const,
    }
    await session.start(media)
    time.advance(5_000)
    lifecycle.emit({ type: 'background', source: 'pagehide' })
    await session.flush()
    time.advance(60_000)
    lifecycle.emit({ type: 'foreground', source: 'pageshow' })
    lifecycle.emit({ type: 'activity', source: 'touch' })
    await session.flush()
    time.advance(5_000)
    expect(totalEffectiveSeconds(sink)).toBe(5)
    expect(session.state.segmentOpen).toBe(false)

    await session.resume(media)
    time.advance(2_000)
    await session.finish()
    expect(totalEffectiveSeconds(sink)).toBe(7)
  })

  it('excludes pause, loading, permission, and network waits', async () => {
    const { session, time, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_000)
    await session.pause()
    time.advance(20_000)
    await session.transition({
      phase: 'loading',
      reason: 'content-loading',
    })
    time.advance(10_000)
    await session.transition({
      phase: 'permission-wait',
      reason: 'permission-wait',
    })
    time.advance(10_000)
    await session.transition({
      phase: 'network-wait',
      reason: 'network-wait',
    })
    time.advance(10_000)
    await session.resume({
      phase: 'feedback',
      reason: 'active-feedback',
    })
    time.advance(2_000)
    await session.finish()

    expect(reasons(sink)).toEqual([
      'active-answering',
      'user-paused',
      'content-loading',
      'permission-wait',
      'network-wait',
      'active-feedback',
    ])
    expect(totalEffectiveSeconds(sink)).toBe(7)
  })

  it('safely splits continuous media at 15 minutes without requiring clicks', async () => {
    const { session, time, sink } = await createHarness()
    await session.start({
      phase: 'audio-listening',
      reason: 'active-audio-listening',
    })

    time.advance(1_805_000)
    await session.flush()
    await session.finish()

    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([900, 900, 5])
    expect(
      sink.events.every(
        (event) => event.payload.reason === 'active-audio-listening',
      ),
    ).toBe(true)
  })

  it('does not invent zero-length events during rapid phase changes', async () => {
    const { session, time, sink } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(400)
    await session.transition({
      phase: 'feedback',
      reason: 'active-feedback',
    })
    time.advance(400)
    await session.pause()
    time.advance(300)
    await session.finish()

    expect(sink.events).toEqual([])
  })

  it('persists a failed publish and replays the same event ID exactly once after refresh', async () => {
    const snapshots = new MemorySnapshotStore()
    const time = new ManualTime()
    const lifecycle = new ManualLifecycle()
    const failingSink = new RecordingSink()
    const first = await createHarness({
      snapshots,
      time,
      lifecycle,
      sink: failingSink,
      createId: () => 'stable-session',
    })
    await first.session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_000)
    failingSink.failNext = true
    await expect(first.session.pause()).rejects.toThrow(
      'simulated publish failure',
    )
    const pending = snapshots.records.get(identity().taskId)
    expect(pending?.pendingEvents).toHaveLength(1)
    const pendingId = pending?.pendingEvents[0].id

    const recoveredSink = new RecordingSink()
    const recovered = await createHarness({
      snapshots,
      time,
      lifecycle: new ManualLifecycle(),
      sink: recoveredSink,
      createId: () => 'must-not-replace-restored-id',
    })

    expect(recoveredSink.events.map((event) => event.id)).toEqual([
      pendingId,
    ])
    expect(
      snapshots.records.get(identity().taskId)?.pendingEvents,
    ).toEqual([])
    expect(recovered.session.state.segmentOpen).toBe(false)
    await recovered.session.dispose()
  })

  it('retries a failed finish without losing its pending event and treats duplicate finish as idempotent', async () => {
    const { session, time, sink, snapshots } = await createHarness()
    await session.start({
      phase: 'answering',
      reason: 'active-answering',
    })
    time.advance(5_000)
    sink.failNext = true

    await expect(session.finish()).rejects.toThrow(
      'simulated publish failure',
    )
    const pending =
      snapshots.records.get(identity().taskId)?.pendingEvents[0]
    expect(pending?.id).toBe('timing:session-1:000001')

    await session.finish()
    await session.finish()

    expect(sink.events.map((event) => event.id)).toEqual([
      'timing:session-1:000001',
    ])
    expect(snapshots.records.size).toBe(0)
    expect(session.state.lifecycle).toBe('finished')
  })

  it('drops an unfinished pre-crash segment and never backfills the offline interval', async () => {
    const snapshots = new MemorySnapshotStore()
    const task = identity()
    snapshots.records.set(task.taskId, {
      schemaVersion: 1,
      sessionId: 'crashed-session',
      identity: task,
      declaration: {
        phase: 'answering',
        reason: 'active-answering',
      },
      openSegment: {
        phase: 'answering',
        reason: 'active-answering',
        visibility: 'foreground',
        startedAt: '2026-07-27T07:00:00.000Z',
      },
      suspended: false,
      nextEventSequence: 4,
      pendingEvents: [],
      updatedAt: '2026-07-27T07:00:00.000Z',
    })
    const { session, sink, time, lifecycle } = await createHarness({
      snapshots,
      time: new ManualTime(),
      lifecycle: new ManualLifecycle(),
      sink: new RecordingSink(),
    })

    expect(session.state).toMatchObject({
      segmentOpen: false,
      suspended: true,
    })
    expect(sink.events).toEqual([])
    time.advance(60_000)
    await session.flush()
    expect(sink.events).toEqual([])

    lifecycle.emit({ type: 'activity', source: 'input' })
    await session.flush()
    time.advance(2_000)
    await session.finish()
    expect(
      sink.events.map((event) => event.payload.elapsedSeconds),
    ).toEqual([2])
    expect(sink.events[0].id).toBe(
      'timing:crashed-session:000004',
    )
  })

  it('cleans independent lifecycle subscriptions for multiple sessions', async () => {
    const lifecycle = new ManualLifecycle()
    const time = new ManualTime()
    const first = await createHarness({
      taskId: 'task-1',
      lifecycle,
      time,
    })
    const second = await createHarness({
      taskId: 'task-2',
      lifecycle,
      time,
    })
    expect(lifecycle.listeners.size).toBe(2)

    await first.session.dispose()
    expect(lifecycle.listeners.size).toBe(1)
    await second.session.dispose()
    expect(lifecycle.listeners.size).toBe(0)
  })
})
