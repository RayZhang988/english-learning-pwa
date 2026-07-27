import type {
  PlatformEventSink,
} from '../../core/index.ts'
import {
  MAX_CONTINUOUS_ACTIVE_MEDIA_SECONDS,
  MAX_INTERACTION_IDLE_SECONDS,
  MAX_RELIABLE_EFFECTIVE_SECONDS,
  type LearningTimingPhase,
  type LearningTimingSegmentReason,
  type LearningTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import {
  EFFECTIVE_TIMING_ACTIVITY_THROTTLE_MS,
  EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION,
  type EffectiveTimingClock,
  type EffectiveTimingPhaseDeclaration,
  type EffectiveTimingScheduler,
  type EffectiveTimingSessionState,
  type EffectiveTimingSnapshotStore,
  type EffectiveTimingTaskIdentity,
  type TimingLifecyclePort,
  type TimingLifecycleVisibility,
  type TimingPoint,
} from './contracts.ts'

interface RuntimeOpenSegment {
  readonly phase: LearningTimingPhase
  readonly reason: LearningTimingSegmentReason
  readonly visibility: 'foreground'
  readonly startedAtWallMs: number
  readonly startedAtMonotonicMs: number
}

interface CreateEffectiveTimingSessionOptions {
  readonly identity: EffectiveTimingTaskIdentity
  readonly eventSink: PlatformEventSink
  readonly snapshotStore: EffectiveTimingSnapshotStore
  readonly lifecycle: TimingLifecyclePort
  readonly clock?: EffectiveTimingClock
  readonly scheduler?: EffectiveTimingScheduler
  readonly createId?: () => string
  readonly onError?: (error: unknown) => void
}

const ACTIVE_INTERACTION_REASONS = new Set<
  LearningTimingSegmentReason
>(['active-answering', 'active-feedback'])
const ACTIVE_MEDIA_REASONS = new Set<LearningTimingSegmentReason>([
  'active-audio-listening',
  'active-recording',
  'active-playback',
])

function defaultClock(): EffectiveTimingClock {
  return {
    now() {
      const wallTimeMs = Date.now()
      const monotonicTimeMs =
        typeof performance === 'undefined'
          ? wallTimeMs
          : performance.now()
      return { wallTimeMs, monotonicTimeMs }
    },
  }
}

function defaultScheduler(): EffectiveTimingScheduler {
  return {
    set(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs)
    },
    clear(handle) {
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      )
    },
  }
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function isInteraction(
  declaration: EffectiveTimingPhaseDeclaration | null,
): boolean {
  return (
    declaration !== null &&
    ACTIVE_INTERACTION_REASONS.has(declaration.reason)
  )
}

function isActiveReason(
  reason: LearningTimingSegmentReason,
): boolean {
  return (
    ACTIVE_INTERACTION_REASONS.has(reason) ||
    ACTIVE_MEDIA_REASONS.has(reason)
  )
}

function maximumSegmentSeconds(
  reason: LearningTimingSegmentReason,
): number {
  if (ACTIVE_INTERACTION_REASONS.has(reason)) {
    return MAX_INTERACTION_IDLE_SECONDS
  }
  if (ACTIVE_MEDIA_REASONS.has(reason)) {
    return MAX_CONTINUOUS_ACTIVE_MEDIA_SECONDS
  }
  return MAX_RELIABLE_EFFECTIVE_SECONDS
}

function assertTimingPoint(point: TimingPoint): void {
  if (
    !Number.isFinite(point.wallTimeMs) ||
    !Number.isFinite(point.monotonicTimeMs)
  ) {
    throw new TypeError('Timing clocks must return finite milliseconds.')
  }
}

function sameDeclaration(
  left: EffectiveTimingPhaseDeclaration | null,
  right: EffectiveTimingPhaseDeclaration,
): boolean {
  return left?.phase === right.phase && left.reason === right.reason
}

function isoTimestamp(wallTimeMs: number): string {
  const value = new Date(wallTimeMs)
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('Timing wall clock produced an invalid timestamp.')
  }
  return value.toISOString()
}

/**
 * Shared task timing infrastructure.
 *
 * Modules declare phases. This class owns browser lifecycle handling,
 * segmentation, event identity, durable retry, and the 45-second idle policy.
 */
export class EffectiveTimingSession {
  readonly #identity: EffectiveTimingTaskIdentity
  readonly #eventSink: PlatformEventSink
  readonly #snapshotStore: EffectiveTimingSnapshotStore
  readonly #lifecycle: TimingLifecyclePort
  readonly #clock: EffectiveTimingClock
  readonly #scheduler: EffectiveTimingScheduler
  readonly #createId: () => string
  readonly #onError: ((error: unknown) => void) | undefined
  #sessionId = ''
  #visibility: TimingLifecycleVisibility
  #declaration: EffectiveTimingPhaseDeclaration | null = null
  #openSegment: RuntimeOpenSegment | null = null
  #suspended = true
  #nextEventSequence = 1
  #pendingEvents: LearningTimingSegmentRecordedEvent[] = []
  #lastActivityAtMonotonicMs: number | null = null
  #lastHandledActivityAtMonotonicMs = Number.NEGATIVE_INFINITY
  #timer: unknown
  #unsubscribeLifecycle: (() => void) | undefined
  #lifecycleState: EffectiveTimingSessionState['lifecycle'] = 'ready'
  #operationQueue: Promise<void> = Promise.resolve()

  private constructor(options: CreateEffectiveTimingSessionOptions) {
    this.#identity = options.identity
    this.#eventSink = options.eventSink
    this.#snapshotStore = options.snapshotStore
    this.#lifecycle = options.lifecycle
    this.#clock = options.clock ?? defaultClock()
    this.#scheduler = options.scheduler ?? defaultScheduler()
    this.#createId = options.createId ?? defaultId
    this.#onError = options.onError
    this.#visibility = this.#lifecycle.currentVisibility()
  }

  static async create(
    options: CreateEffectiveTimingSessionOptions,
  ): Promise<EffectiveTimingSession> {
    const session = new EffectiveTimingSession(options)
    await session.#initialize()
    return session
  }

  get state(): EffectiveTimingSessionState {
    return {
      lifecycle: this.#lifecycleState,
      visibility: this.#visibility,
      declaration: this.#declaration,
      segmentOpen: this.#openSegment !== null,
      suspended: this.#suspended,
      pendingEventCount: this.#pendingEvents.length,
    }
  }

  get isClosed(): boolean {
    return this.#lifecycleState !== 'ready'
  }

  start(
    declaration: EffectiveTimingPhaseDeclaration,
  ): Promise<void> {
    const point = this.#now()
    return this.#enqueue(() =>
      this.#transitionTo(declaration, point),
    )
  }

  transition(
    declaration: EffectiveTimingPhaseDeclaration,
  ): Promise<void> {
    const point = this.#now()
    return this.#enqueue(() =>
      this.#transitionTo(declaration, point),
    )
  }

  /**
   * Records real user activity. Browser pointer/keyboard/input/touch activity
   * calls the same method, so modules normally need this only for non-DOM
   * interaction sources.
   */
  activity(): Promise<void> {
    const point = this.#now()
    return this.#enqueue(() => this.#handleActivity(point))
  }

  pause(): Promise<void> {
    return this.transition({
      phase: 'paused',
      reason: 'user-paused',
    })
  }

  /**
   * Foreground/pageshow never restarts timing by itself. A module uses resume
   * to assert that its declared phase is still genuinely active.
   */
  resume(
    declaration: EffectiveTimingPhaseDeclaration = this.#requireDeclaration(),
  ): Promise<void> {
    const point = this.#now()
    return this.#enqueue(() => this.#resumeWith(declaration, point))
  }

  /**
   * Waits for lifecycle work and durable event retries already queued by this
   * session. It does not create or close a segment.
   */
  flush(): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertReady()
      await this.#flushPendingEvents()
    })
  }

  finish(): Promise<void> {
    const point = this.#now()
    return this.#enqueue(async () => {
      if (this.#lifecycleState === 'finished') {
        return
      }
      this.#assertReady()
      const events = this.#settleDueBoundariesThrough(
        point.monotonicTimeMs,
      )
      events.push(
        ...this.#closeOpenSegment(point.monotonicTimeMs),
      )
      this.#declaration = null
      this.#suspended = true
      this.#lastActivityAtMonotonicMs = null
      this.#clearTimer()
      await this.#commit(events)
      await this.#snapshotStore.delete(this.#identity)
      this.#detachLifecycle()
      this.#lifecycleState = 'finished'
    })
  }

  /**
   * Route teardown closes the current segment and retains a suspended
   * snapshot. A later session can recover the declaration, but it still needs
   * explicit activity/resume before a new segment opens.
   */
  dispose(): Promise<void> {
    const point = this.#now()
    return this.#enqueue(async () => {
      if (this.#lifecycleState !== 'ready') {
        return
      }
      try {
        const events = this.#settleDueBoundariesThrough(
          point.monotonicTimeMs,
        )
        events.push(
          ...this.#closeOpenSegment(point.monotonicTimeMs),
        )
        this.#suspended = true
        this.#lastActivityAtMonotonicMs = null
        this.#clearTimer()
        await this.#commit(events)
      } finally {
        this.#detachLifecycle()
        this.#lifecycleState = 'disposed'
      }
    })
  }

  async #initialize(): Promise<void> {
    const restored = await this.#snapshotStore.load(this.#identity)
    if (restored) {
      this.#sessionId = restored.sessionId
      this.#declaration = restored.declaration
      this.#nextEventSequence = restored.nextEventSequence
      this.#pendingEvents = [...restored.pendingEvents]
      // A monotonic clock cannot cross a document lifetime. Never backfill an
      // open pre-crash interval using the new document's clock.
      this.#openSegment = null
      this.#suspended = true
      this.#lastActivityAtMonotonicMs = null
      await this.#saveSnapshot()
      await this.#flushPendingEvents()
    } else {
      this.#sessionId = this.#createId()
      if (this.#sessionId.trim().length === 0) {
        throw new TypeError('Timing session ID cannot be empty.')
      }
      await this.#saveSnapshot()
    }
    this.#visibility = this.#lifecycle.currentVisibility()
    this.#unsubscribeLifecycle = this.#lifecycle.subscribe((event) => {
      try {
        const point = this.#now()
        let operation: Promise<void>
        if (event.type === 'background') {
          operation = this.#enqueue(() =>
            this.#moveToBackground(point),
          )
        } else if (event.type === 'foreground') {
          operation = this.#enqueue(() => this.#moveToForeground())
        } else {
          operation = this.#enqueue(() =>
            this.#handleActivity(point),
          )
        }
        void operation.catch((error: unknown) => {
          this.#onError?.(error)
        })
      } catch (error) {
        this.#onError?.(error)
      }
    })
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#operationQueue.then(operation)
    this.#operationQueue = next.catch(() => undefined)
    return next
  }

  #assertReady(): void {
    if (this.#lifecycleState !== 'ready') {
      throw new TypeError('The effective timing session is closed.')
    }
  }

  #requireDeclaration(): EffectiveTimingPhaseDeclaration {
    if (!this.#declaration) {
      throw new TypeError(
        'A timing phase must be declared before the session can resume.',
      )
    }
    return this.#declaration
  }

  #now(): TimingPoint {
    const point = this.#clock.now()
    assertTimingPoint(point)
    return point
  }

  async #transitionTo(
    declaration: EffectiveTimingPhaseDeclaration,
    point: TimingPoint,
  ): Promise<void> {
    this.#assertReady()
    const events = this.#settleDueBoundariesThrough(
      point.monotonicTimeMs,
    )
    if (
      sameDeclaration(this.#declaration, declaration) &&
      this.#openSegment?.phase === declaration.phase &&
      this.#openSegment.reason === declaration.reason
    ) {
      if (isInteraction(declaration)) {
        this.#registerActivity(point.monotonicTimeMs)
      }
      if (events.length > 0) {
        await this.#commit(events)
      }
      this.#scheduleBoundary()
      return
    }

    events.push(
      ...this.#closeOpenSegment(point.monotonicTimeMs),
    )
    this.#declaration = declaration
    this.#suspended = this.#visibility !== 'foreground'
    this.#lastActivityAtMonotonicMs = isInteraction(declaration)
      ? point.monotonicTimeMs
      : null
    if (this.#visibility === 'foreground') {
      this.#open(declaration, point)
      this.#suspended = !isActiveReason(declaration.reason)
    }
    await this.#commit(events)
    this.#scheduleBoundary()
  }

  async #resumeWith(
    declaration: EffectiveTimingPhaseDeclaration,
    point: TimingPoint,
  ): Promise<void> {
    this.#assertReady()
    const events = this.#settleDueBoundariesThrough(
      point.monotonicTimeMs,
    )
    events.push(
      ...this.#closeOpenSegment(point.monotonicTimeMs),
    )
    this.#declaration = declaration
    this.#lastActivityAtMonotonicMs = isInteraction(declaration)
      ? point.monotonicTimeMs
      : null
    if (this.#visibility === 'foreground') {
      this.#open(declaration, point)
      this.#suspended = !isActiveReason(declaration.reason)
    } else {
      this.#suspended = true
    }
    await this.#commit(events)
    this.#scheduleBoundary()
  }

  async #handleActivity(point: TimingPoint): Promise<void> {
    this.#assertReady()
    const declaration = this.#declaration
    if (
      this.#visibility !== 'foreground' ||
      !isInteraction(declaration) ||
      declaration === null
    ) {
      return
    }
    const events = this.#settleDueBoundariesThrough(
      point.monotonicTimeMs,
    )
    if (
      point.monotonicTimeMs -
        this.#lastHandledActivityAtMonotonicMs <
      EFFECTIVE_TIMING_ACTIVITY_THROTTLE_MS
    ) {
      if (events.length > 0) {
        await this.#commit(events)
      }
      this.#scheduleBoundary()
      return
    }
    this.#lastHandledActivityAtMonotonicMs =
      point.monotonicTimeMs
    this.#registerActivity(point.monotonicTimeMs)

    if (
      this.#openSegment &&
      ACTIVE_INTERACTION_REASONS.has(this.#openSegment.reason)
    ) {
      this.#suspended = false
      if (events.length > 0) {
        await this.#commit(events)
      }
      this.#scheduleBoundary()
      return
    }

    events.push(
      ...this.#closeOpenSegment(point.monotonicTimeMs),
    )
    this.#open(declaration, point)
    this.#suspended = false
    await this.#commit(events)
    this.#scheduleBoundary()
  }

  #registerActivity(monotonicTimeMs: number): void {
    this.#lastActivityAtMonotonicMs = monotonicTimeMs
  }

  async #moveToBackground(point: TimingPoint): Promise<void> {
    if (
      this.#lifecycleState !== 'ready' ||
      this.#visibility === 'background'
    ) {
      return
    }
    const events = this.#settleDueBoundariesThrough(
      point.monotonicTimeMs,
    )
    events.push(
      ...this.#closeOpenSegment(point.monotonicTimeMs),
    )
    this.#visibility = 'background'
    this.#suspended = true
    this.#lastActivityAtMonotonicMs = null
    this.#lastHandledActivityAtMonotonicMs =
      Number.NEGATIVE_INFINITY
    this.#clearTimer()
    await this.#commit(events)
  }

  async #moveToForeground(): Promise<void> {
    if (
      this.#lifecycleState !== 'ready' ||
      this.#visibility === 'foreground'
    ) {
      return
    }
    this.#visibility = 'foreground'
    this.#suspended = true
    this.#lastActivityAtMonotonicMs = null
    this.#lastHandledActivityAtMonotonicMs =
      Number.NEGATIVE_INFINITY
    await this.#commit([])
  }

  #open(
    declaration: {
      readonly phase: LearningTimingPhase
      readonly reason: LearningTimingSegmentReason
    },
    point: TimingPoint,
  ): void {
    if (this.#openSegment) {
      throw new TypeError('A timing segment is already open.')
    }
    this.#openSegment = {
      phase: declaration.phase,
      reason: declaration.reason,
      visibility: 'foreground',
      startedAtWallMs: point.wallTimeMs,
      startedAtMonotonicMs: point.monotonicTimeMs,
    }
  }

  #closeOpenSegment(
    endedAtMonotonicMs: number,
  ): LearningTimingSegmentRecordedEvent[] {
    const open = this.#openSegment
    if (!open) {
      return []
    }
    this.#openSegment = null
    const elapsedMs =
      endedAtMonotonicMs - open.startedAtMonotonicMs
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError(
        'The monotonic clock moved backwards during a timing segment.',
      )
    }
    const elapsedSeconds = Math.floor(elapsedMs / 1_000)
    if (elapsedSeconds < 1) {
      return []
    }

    const events: LearningTimingSegmentRecordedEvent[] = []
    const maximum = maximumSegmentSeconds(open.reason)
    let remaining = elapsedSeconds
    let startedAtWallMs = open.startedAtWallMs
    while (remaining > 0) {
      const chunkSeconds = Math.min(maximum, remaining)
      const endedAtWallMs =
        startedAtWallMs + chunkSeconds * 1_000
      const startedAt = isoTimestamp(startedAtWallMs)
      const endedAt = isoTimestamp(endedAtWallMs)
      const sequence = this.#nextEventSequence
      this.#nextEventSequence += 1
      events.push({
        id: `timing:${this.#sessionId}:${String(sequence).padStart(6, '0')}`,
        type: 'learning.timing.segment.recorded.v1',
        sourceModuleId: this.#identity.targetModuleId,
        occurredAt: endedAt,
        schemaVersion: 1,
        payload: {
          ...this.#identity,
          phase: open.phase,
          reason: open.reason,
          visibility: open.visibility,
          startedAt,
          endedAt,
          elapsedSeconds: chunkSeconds,
          idleThresholdSeconds: MAX_INTERACTION_IDLE_SECONDS,
        },
      })
      remaining -= chunkSeconds
      startedAtWallMs = endedAtWallMs
    }
    return events
  }

  /**
   * Settles every boundary that is already in the past before handling the
   * current action. Browser timers may be delayed by a busy main thread or
   * lifecycle throttling, so correctness cannot depend on a timeout firing at
   * its requested instant.
   */
  #settleDueBoundariesThrough(
    monotonicTimeMs: number,
  ): LearningTimingSegmentRecordedEvent[] {
    const events: LearningTimingSegmentRecordedEvent[] = []
    while (this.#openSegment) {
      const open = this.#openSegment
      if (monotonicTimeMs < open.startedAtMonotonicMs) {
        throw new RangeError(
          'The monotonic clock moved backwards during a timing segment.',
        )
      }
      const segmentDeadline =
        open.startedAtMonotonicMs +
        maximumSegmentSeconds(open.reason) * 1_000
      const idleDeadline =
        ACTIVE_INTERACTION_REASONS.has(open.reason) &&
        this.#lastActivityAtMonotonicMs !== null
          ? this.#lastActivityAtMonotonicMs +
            MAX_INTERACTION_IDLE_SECONDS * 1_000
          : Number.POSITIVE_INFINITY
      const deadline = Math.min(segmentDeadline, idleDeadline)
      if (monotonicTimeMs < deadline) {
        break
      }

      const boundary: TimingPoint = {
        wallTimeMs:
          open.startedAtWallMs +
          (deadline - open.startedAtMonotonicMs),
        monotonicTimeMs: deadline,
      }
      events.push(...this.#closeOpenSegment(deadline))
      if (idleDeadline <= segmentDeadline) {
        this.#open(
          {
            phase: 'idle',
            reason: 'idle-timeout',
          },
          boundary,
        )
        this.#suspended = true
      } else {
        this.#open(
          {
            phase: open.phase,
            reason: open.reason,
          },
          boundary,
        )
        this.#suspended = !isActiveReason(open.reason)
      }
    }
    return events
  }

  async #commit(
    events: readonly LearningTimingSegmentRecordedEvent[],
  ): Promise<void> {
    this.#pendingEvents.push(...events)
    await this.#saveSnapshot()
    await this.#flushPendingEvents()
  }

  async #flushPendingEvents(): Promise<void> {
    while (this.#pendingEvents.length > 0) {
      const event = this.#pendingEvents[0]
      await this.#eventSink.publish(event)
      this.#pendingEvents.shift()
      await this.#saveSnapshot()
    }
  }

  async #saveSnapshot(): Promise<void> {
    const point = this.#now()
    await this.#snapshotStore.save({
      schemaVersion: EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION,
      sessionId: this.#sessionId,
      identity: this.#identity,
      declaration: this.#declaration,
      openSegment: this.#openSegment
        ? {
            phase: this.#openSegment.phase,
            reason: this.#openSegment.reason,
            visibility: this.#openSegment.visibility,
            startedAt: isoTimestamp(
              this.#openSegment.startedAtWallMs,
            ),
          }
        : null,
      suspended: this.#suspended,
      nextEventSequence: this.#nextEventSequence,
      pendingEvents: [...this.#pendingEvents],
      updatedAt: isoTimestamp(point.wallTimeMs),
    })
  }

  #scheduleBoundary(): void {
    this.#clearTimer()
    const open = this.#openSegment
    if (
      !open ||
      this.#visibility !== 'foreground' ||
      this.#lifecycleState !== 'ready'
    ) {
      return
    }
    let deadline =
      open.startedAtMonotonicMs +
      maximumSegmentSeconds(open.reason) * 1_000
    if (
      ACTIVE_INTERACTION_REASONS.has(open.reason) &&
      this.#lastActivityAtMonotonicMs !== null
    ) {
      deadline = Math.min(
        deadline,
        this.#lastActivityAtMonotonicMs +
          MAX_INTERACTION_IDLE_SECONDS * 1_000,
      )
    }
    const now = this.#now()
    const delayMs = Math.max(0, deadline - now.monotonicTimeMs)
    this.#timer = this.#scheduler.set(() => {
      this.#timer = undefined
      try {
        const point = this.#now()
        void this.#enqueue(() =>
          this.#handleBoundary(point),
        ).catch((error: unknown) => {
          this.#onError?.(error)
        })
      } catch (error) {
        this.#onError?.(error)
      }
    }, delayMs)
  }

  async #handleBoundary(now: TimingPoint): Promise<void> {
    if (
      !this.#openSegment ||
      this.#visibility !== 'foreground' ||
      this.#lifecycleState !== 'ready'
    ) {
      return
    }
    const events = this.#settleDueBoundariesThrough(
      now.monotonicTimeMs,
    )
    await this.#commit(events)
    this.#scheduleBoundary()
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      this.#scheduler.clear(this.#timer)
      this.#timer = undefined
    }
  }

  #detachLifecycle(): void {
    this.#clearTimer()
    this.#unsubscribeLifecycle?.()
    this.#unsubscribeLifecycle = undefined
  }
}

export type { CreateEffectiveTimingSessionOptions }
