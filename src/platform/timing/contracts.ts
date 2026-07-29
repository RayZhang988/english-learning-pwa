import type { PlatformEvent } from '../../core/index.ts'
import type {
  ExtraTrainingEvent,
  ExtraTrainingSession,
  LearningTaskMode,
  LearningTimingPhase,
  LearningTimingSegmentReason,
  LearningTimingSegmentRecordedEvent,
  TrainingModuleId,
} from '../../learning-engine/index.ts'

export const EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const EFFECTIVE_TIMING_ACTIVITY_THROTTLE_MS = 250

export interface EffectiveTimingTaskIdentity {
  readonly planId: string
  readonly taskId: string
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: TrainingModuleId
  readonly targetModuleId: TrainingModuleId
  readonly localDate: string
  readonly mode: LearningTaskMode
}

export interface EffectiveTimingSegmentEventInput<TIdentity> {
  readonly identity: TIdentity
  readonly id: string
  readonly occurredAt: string
  readonly phase: LearningTimingPhase
  readonly reason: LearningTimingSegmentReason
  readonly visibility: 'foreground'
  readonly startedAt: string
  readonly endedAt: string
  readonly elapsedSeconds: number
  readonly idleThresholdSeconds: number
}

/** Type-specific event port used by an adapted timing session. */
export interface EffectiveTimingEventSink<
  TEvent extends PlatformEvent,
> {
  publish(event: TEvent): Promise<void>
}

export interface EffectiveTimingSegmentEventFactory<
  TIdentity,
  TEvent extends PlatformEvent,
> {
  create(
    input: EffectiveTimingSegmentEventInput<TIdentity>,
  ): TEvent
}

/**
 * Modules declare business phases only. Browser visibility, timestamps,
 * segment IDs, idle transitions, and persistence belong to task 01.
 */
export type EffectiveTimingPhaseDeclaration =
  | {
      readonly phase: 'answering'
      readonly reason: 'active-answering'
    }
  | {
      readonly phase: 'audio-listening'
      readonly reason: 'active-audio-listening'
    }
  | {
      readonly phase: 'recording'
      readonly reason: 'active-recording'
    }
  | {
      readonly phase: 'playback'
      readonly reason: 'active-playback'
    }
  | {
      readonly phase: 'feedback'
      readonly reason: 'active-feedback'
    }
  | {
      readonly phase: 'loading'
      readonly reason: 'content-loading' | 'media-loading'
    }
  | {
      readonly phase: 'permission-wait'
      readonly reason: 'permission-wait'
    }
  | {
      readonly phase: 'network-wait'
      readonly reason: 'network-wait'
    }
  | {
      readonly phase: 'paused'
      readonly reason: 'user-paused'
    }

export interface TimingPoint {
  readonly wallTimeMs: number
  readonly monotonicTimeMs: number
}

export interface EffectiveTimingClock {
  now(): TimingPoint
}

export interface EffectiveTimingScheduler {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export type TimingLifecycleVisibility = 'foreground' | 'background'

export type TimingLifecycleEvent =
  | {
      readonly type: 'background'
      readonly source: 'visibilitychange' | 'pagehide' | 'freeze'
    }
  | {
      readonly type: 'foreground'
      readonly source: 'visibilitychange' | 'pageshow' | 'resume'
    }
  | {
      readonly type: 'activity'
      readonly source: 'pointer' | 'keyboard' | 'input' | 'touch'
    }

export interface TimingLifecyclePort {
  currentVisibility(): TimingLifecycleVisibility
  subscribe(listener: (event: TimingLifecycleEvent) => void): () => void
}

export interface PersistedTimingOpenSegment {
  readonly phase: LearningTimingPhase
  readonly reason: LearningTimingSegmentReason
  readonly visibility: 'foreground'
  readonly startedAt: string
}

export interface EffectiveTimingSessionSnapshot<
  TIdentity = EffectiveTimingTaskIdentity,
  TEvent extends PlatformEvent = LearningTimingSegmentRecordedEvent,
> {
  readonly schemaVersion: typeof EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION
  readonly sessionId: string
  readonly identity: TIdentity
  readonly declaration: EffectiveTimingPhaseDeclaration | null
  /**
   * This is crash-detection metadata, not a resumable stopwatch. Restore
   * always discards it so time spent outside the document is never backfilled.
   */
  readonly openSegment: PersistedTimingOpenSegment | null
  readonly suspended: boolean
  readonly nextEventSequence: number
  readonly pendingEvents: readonly TEvent[]
  readonly updatedAt: string
}

export interface EffectiveTimingSnapshotStore<
  TIdentity = EffectiveTimingTaskIdentity,
  TEvent extends PlatformEvent = LearningTimingSegmentRecordedEvent,
> {
  load(
    identity: TIdentity,
  ): Promise<EffectiveTimingSessionSnapshot<TIdentity, TEvent> | undefined>
  save(
    snapshot: EffectiveTimingSessionSnapshot<TIdentity, TEvent>,
  ): Promise<void>
  delete(identity: TIdentity): Promise<void>
}

export type EffectiveTimingSessionLifecycle =
  | 'ready'
  | 'finished'
  | 'disposed'

export interface EffectiveTimingSessionState {
  readonly lifecycle: EffectiveTimingSessionLifecycle
  readonly visibility: TimingLifecycleVisibility
  readonly declaration: EffectiveTimingPhaseDeclaration | null
  readonly segmentOpen: boolean
  readonly suspended: boolean
  readonly pendingEventCount: number
}

/**
 * Isolated R6 event boundary. The distinct method name prevents a daily
 * PlatformEventSink from satisfying this port by structural typing.
 */
export interface ExtraTrainingEventSink {
  publishExtraTrainingEvent(event: ExtraTrainingEvent): Promise<void>
}

export interface ExtraTrainingEffectiveTimingSessionPort {
  start(declaration: EffectiveTimingPhaseDeclaration): Promise<void>
  transition(declaration: EffectiveTimingPhaseDeclaration): Promise<void>
  activity(): Promise<void>
  pause(): Promise<void>
  resume(declaration: EffectiveTimingPhaseDeclaration): Promise<void>
  finish(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Public module-facing R6 factory. Modules pass a real engine session; the
 * platform/app implementation owns clocks, lifecycle, snapshots and events.
 */
export interface ExtraTrainingEffectiveTimingSessionFactoryPort {
  create(
    session: ExtraTrainingSession,
  ): Promise<ExtraTrainingEffectiveTimingSessionPort>
}
