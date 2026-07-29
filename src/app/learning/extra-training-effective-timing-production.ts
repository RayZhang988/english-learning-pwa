import {
  MAX_INTERACTION_IDLE_SECONDS,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
  type ExtraTrainingSession,
  type ExtraTrainingTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import {
  EffectiveTimingSession,
  browserTimingLifecycle,
  type EffectiveTimingClock,
  type EffectiveTimingEventSink,
  type EffectiveTimingScheduler,
  type TimingLifecyclePort,
} from '../../platform/index.ts'
import { localStorageService } from '../../storage/index.ts'
import {
  EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_NAMESPACE,
  ExtraTrainingEffectiveTimingSnapshotRepository,
  type ExtraTrainingEffectiveTimingIdentity,
  type ExtraTrainingEffectiveTimingSnapshotStore,
} from './extra-training-effective-timing-snapshot-repository.ts'
import { assertLocalDateValue } from './local-date.ts'

export interface ExtraTrainingEventSink {
  /**
   * This deliberately does not use PlatformEventSink.publish(). The separate
   * method prevents the daily plan event sink from being supplied here by
   * structural typing.
   */
  publishExtraTrainingEvent(event: ExtraTrainingEvent): Promise<void>
}

export interface ProductionExtraTrainingEffectiveTimingSessionFactoryOptions {
  readonly eventSink: ExtraTrainingEventSink
  readonly snapshotStore?: ExtraTrainingEffectiveTimingSnapshotStore
  readonly lifecycle?: TimingLifecyclePort
  readonly clock?: EffectiveTimingClock
  readonly scheduler?: EffectiveTimingScheduler
  readonly createId?: () => string
  readonly onError?: (error: unknown) => void
}

export type ExtraTrainingEffectiveTimingSession =
  EffectiveTimingSession<
    ExtraTrainingEffectiveTimingIdentity,
    ExtraTrainingTimingSegmentRecordedEvent
  >

interface SessionCreation {
  readonly identityKey: string
  readonly promise: Promise<ExtraTrainingEffectiveTimingSession>
}

const productionExtraTrainingTimingSnapshots =
  new ExtraTrainingEffectiveTimingSnapshotRepository(
    localStorageService.namespace(
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_NAMESPACE,
    ),
  )

function requireNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function identityFromSession(
  session: ExtraTrainingSession,
): ExtraTrainingEffectiveTimingIdentity {
  const value = session as unknown as Record<string, unknown>
  if ('planId' in value || 'taskId' in value) {
    throw new TypeError(
      'Extra-training timing identity must not contain planId/taskId.',
    )
  }
  if (session.schemaVersion !== 1) {
    throw new TypeError(
      'Extra-training timing requires session schema version 1.',
    )
  }
  requireNonEmptyString(session.sessionId, 'sessionId')
  assertLocalDateValue(session.localDate, 'localDate')
  if (
    session.domain !== 'vocabulary' &&
    session.domain !== 'listening' &&
    session.domain !== 'speaking'
  ) {
    throw new TypeError(
      'Extra-training timing domain is unsupported.',
    )
  }
  if (session.targetModuleId !== session.domain) {
    throw new TypeError(
      'Extra-training timing module must match its domain.',
    )
  }
  if (session.mode !== 'learn') {
    throw new TypeError(
      'Extra-training timing mode must be learn.',
    )
  }
  return {
    sessionId: session.sessionId,
    localDate: session.localDate,
    domain: session.domain,
    targetModuleId: session.targetModuleId,
    mode: session.mode,
  }
}

function identityKey(
  identity: ExtraTrainingEffectiveTimingIdentity,
): string {
  return [
    identity.sessionId,
    identity.localDate,
    identity.domain,
    identity.targetModuleId,
    identity.mode,
  ].join('\u0000')
}

/**
 * Production bridge for R6 optional training. It shares the proven browser
 * timing core with daily tasks while keeping identity, snapshots, and event
 * delivery outside PlanProgress.
 */
export class ProductionExtraTrainingEffectiveTimingSessionFactory {
  readonly #options: ProductionExtraTrainingEffectiveTimingSessionFactoryOptions
  readonly #snapshotStore: ExtraTrainingEffectiveTimingSnapshotStore
  readonly #lifecycle: TimingLifecyclePort
  readonly #sessions = new Map<string, SessionCreation>()
  #publishQueue: Promise<void> = Promise.resolve()

  constructor(
    options: ProductionExtraTrainingEffectiveTimingSessionFactoryOptions,
  ) {
    this.#options = options
    this.#snapshotStore =
      options.snapshotStore ??
      productionExtraTrainingTimingSnapshots
    this.#lifecycle =
      options.lifecycle ?? browserTimingLifecycle
  }

  async create(
    session: ExtraTrainingSession,
  ): Promise<ExtraTrainingEffectiveTimingSession> {
    const identity = identityFromSession(session)
    const current = this.#sessions.get(identity.sessionId)
    const currentIdentityKey = identityKey(identity)
    if (current) {
      if (current.identityKey !== currentIdentityKey) {
        throw new TypeError(
          'Extra-training timing session ID is already bound to another identity.',
        )
      }
      const active = await current.promise
      if (!active.isClosed) {
        return active
      }
      this.#sessions.delete(identity.sessionId)
    }

    const eventSink: EffectiveTimingEventSink<
      ExtraTrainingTimingSegmentRecordedEvent
    > = {
      publish: (event) => this.#publish(event),
    }
    const creation = EffectiveTimingSession.createAdapted<
      ExtraTrainingEffectiveTimingIdentity,
      ExtraTrainingTimingSegmentRecordedEvent
    >({
      identity,
      eventSink,
      eventFactory: {
        create(
          input,
        ): ExtraTrainingTimingSegmentRecordedEvent {
          return {
            id: input.id,
            type: 'learning.extra-training.timing.segment.recorded.v1',
            sourceModuleId: input.identity.targetModuleId,
            occurredAt: input.occurredAt,
            schemaVersion: 1,
            payload: {
              sessionId: input.identity.sessionId,
              localDate: input.identity.localDate,
              domain: input.identity.domain,
              targetModuleId:
                input.identity.targetModuleId,
              mode: input.identity.mode,
              phase: input.phase,
              reason: input.reason,
              visibility: input.visibility,
              startedAt: input.startedAt,
              endedAt: input.endedAt,
              elapsedSeconds: input.elapsedSeconds,
              idleThresholdSeconds:
                MAX_INTERACTION_IDLE_SECONDS,
            },
          }
        },
      },
      eventIdPrefix: 'extra-timing',
      snapshotStore: this.#snapshotStore,
      lifecycle: this.#lifecycle,
      clock: this.#options.clock,
      scheduler: this.#options.scheduler,
      createId: this.#options.createId,
      onError: this.#options.onError,
    })
    const record = {
      identityKey: currentIdentityKey,
      promise: creation,
    }
    this.#sessions.set(identity.sessionId, record)
    try {
      return await creation
    } catch (error) {
      if (this.#sessions.get(identity.sessionId) === record) {
        this.#sessions.delete(identity.sessionId)
      }
      throw error
    }
  }

  #publish(
    event: ExtraTrainingTimingSegmentRecordedEvent,
  ): Promise<void> {
    const parsed = parseExtraTrainingEvent(event)
    if (
      parsed.type !==
      'learning.extra-training.timing.segment.recorded.v1'
    ) {
      throw new TypeError(
        'Extra-training timing factory produced a non-timing event.',
      )
    }
    const next = this.#publishQueue.then(() =>
      this.#options.eventSink.publishExtraTrainingEvent(parsed),
    )
    this.#publishQueue = next.catch(() => undefined)
    return next
  }
}
