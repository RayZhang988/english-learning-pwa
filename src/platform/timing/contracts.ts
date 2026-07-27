import type {
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

export interface EffectiveTimingSessionSnapshot {
  readonly schemaVersion: typeof EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION
  readonly sessionId: string
  readonly identity: EffectiveTimingTaskIdentity
  readonly declaration: EffectiveTimingPhaseDeclaration | null
  /**
   * This is crash-detection metadata, not a resumable stopwatch. Restore
   * always discards it so time spent outside the document is never backfilled.
   */
  readonly openSegment: PersistedTimingOpenSegment | null
  readonly suspended: boolean
  readonly nextEventSequence: number
  readonly pendingEvents: readonly LearningTimingSegmentRecordedEvent[]
  readonly updatedAt: string
}

export interface EffectiveTimingSnapshotStore {
  load(
    identity: EffectiveTimingTaskIdentity,
  ): Promise<EffectiveTimingSessionSnapshot | undefined>
  save(snapshot: EffectiveTimingSessionSnapshot): Promise<void>
  delete(identity: EffectiveTimingTaskIdentity): Promise<void>
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

