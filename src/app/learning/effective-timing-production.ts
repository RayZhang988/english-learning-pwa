import type {
  PlatformEventSink,
} from '../../core/index.ts'
import type {
  LearningTask,
  TaskExecutionState,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import {
  EffectiveTimingSession,
  browserTimingLifecycle,
  type EffectiveTimingClock,
  type EffectiveTimingScheduler,
  type EffectiveTimingSnapshotStore,
  type TimingLifecyclePort,
} from '../../platform/index.ts'
import { localStorageService } from '../../storage/index.ts'
import {
  EFFECTIVE_TIMING_STORAGE_NAMESPACE,
  EffectiveTimingSnapshotRepository,
} from './effective-timing-snapshot-repository.ts'
import {
  createTrainingTimingClock,
  createTrainingTimingScheduler,
  trainingTestMode,
} from '../../config/training-test-mode.ts'
import { learningAppCoordinator } from './learning-app-coordinator.ts'

export interface ResolvedTimingTask {
  readonly task: LearningTask
  readonly localDate: string
  /** True only for the zero-progress test-mode remnant recovery path. */
  readonly discardUntouchedTestTimingSnapshot?: boolean
}

/**
 * An old 30-second test build could close timing before the learner reached a
 * module.  Its snapshot is disposable only when the plan proves no training
 * ever happened.  This intentionally excludes normal 15-minute learning.
 */
export function shouldDiscardUntouchedTrainingTestTimingSnapshot(
  testModeEnabled: boolean,
  execution: TaskExecutionState | undefined,
): boolean {
  const training = execution?.training
  return (
    testModeEnabled &&
    execution?.status !== 'completed' &&
    execution?.effectiveSeconds === 0 &&
    (execution?.timingSegmentCount ?? 0) === 0 &&
    training?.status === 'running' &&
    training.remainingEffectiveSeconds ===
      execution.task.trainingBudget?.targetEffectiveSeconds &&
    training.completedItemIds.length === 0
  )
}

export interface ProductionEffectiveTimingSessionFactoryOptions {
  readonly resolveTask: (
    taskId: string,
    expectedModuleId?: TrainingModuleId,
  ) => ResolvedTimingTask
  readonly eventSink: PlatformEventSink
  readonly snapshotStore: EffectiveTimingSnapshotStore
  readonly lifecycle: TimingLifecyclePort
  readonly clock?: EffectiveTimingClock
  /** Creates a clock when a task enters training, rather than at app boot. */
  readonly createClock?: () => EffectiveTimingClock | undefined
  readonly snapshotRecoveryMarker?: string
  readonly scheduler?: EffectiveTimingScheduler
  readonly interactionIdleClockSeconds?: number
  readonly maximumActiveClockSeconds?: number
  readonly createId?: () => string
  readonly onError?: (error: unknown) => void
}

/**
 * Production bridge used by 01 route hosts after 06/07/08 expose their R3
 * phase hooks. It validates the real active task before touching a snapshot
 * and deduplicates React remounts for the same task.
 */
export class ProductionEffectiveTimingSessionFactory {
  readonly #options: ProductionEffectiveTimingSessionFactoryOptions
  readonly #sessions = new Map<
    string,
    Promise<EffectiveTimingSession>
  >()

  constructor(options: ProductionEffectiveTimingSessionFactoryOptions) {
    this.#options = options
  }

  async create(
    taskId: string,
    expectedModuleId?: TrainingModuleId,
  ): Promise<EffectiveTimingSession> {
    const resolved = this.#options.resolveTask(
      taskId,
      expectedModuleId,
    )
    const identity = {
      planId: resolved.task.planId,
      taskId: resolved.task.taskId,
      learningUnitId: resolved.task.learningUnitId,
      contentRef: resolved.task.contentRef,
      domain: resolved.task.domain,
      targetModuleId: resolved.task.targetModuleId,
      localDate: resolved.localDate,
      mode: resolved.task.mode,
    }
    const key = `${identity.planId}\u0000${identity.taskId}`
    const current = this.#sessions.get(key)
    if (current) {
      const session = await current
      if (!session.isClosed) {
        return session
      }
      this.#sessions.delete(key)
    }

    if (resolved.discardUntouchedTestTimingSnapshot) {
      const snapshot = await this.#options.snapshotStore.load(identity)
      if (
        snapshot !== undefined &&
        snapshot.recoveryMarker !== this.#options.snapshotRecoveryMarker
      ) {
        await this.#options.snapshotStore.delete(identity)
      }
    }

    const creation = EffectiveTimingSession.create({
      identity,
      eventSink: this.#options.eventSink,
      snapshotStore: this.#options.snapshotStore,
      lifecycle: this.#options.lifecycle,
      clock: this.#options.createClock?.() ?? this.#options.clock,
      scheduler: this.#options.scheduler,
      interactionIdleClockSeconds:
        this.#options.interactionIdleClockSeconds,
      maximumActiveClockSeconds:
        this.#options.maximumActiveClockSeconds,
      snapshotRecoveryMarker: this.#options.snapshotRecoveryMarker,
      createId: this.#options.createId,
      onError: this.#options.onError,
    })
    this.#sessions.set(key, creation)
    try {
      return await creation
    } catch (error) {
      if (this.#sessions.get(key) === creation) {
        this.#sessions.delete(key)
      }
      throw error
    }
  }
}

const productionTimingSnapshots =
  new EffectiveTimingSnapshotRepository(
    localStorageService.namespace(
      EFFECTIVE_TIMING_STORAGE_NAMESPACE,
    ),
  )

export const productionEffectiveTimingSessions =
  new ProductionEffectiveTimingSessionFactory({
    createClock: createTrainingTimingClock,
    scheduler: createTrainingTimingScheduler(),
    interactionIdleClockSeconds:
      trainingTestMode.enabled ? 45 * trainingTestMode.timeScale : undefined,
    maximumActiveClockSeconds:
      trainingTestMode.enabled ? 900 : undefined,
    resolveTask(taskId, expectedModuleId) {
      const task = learningAppCoordinator.resolveTask(
        taskId,
        expectedModuleId,
      )
      const state = learningAppCoordinator.state
      if (state.status !== 'ready') {
        throw new TypeError(
          'The active plan changed while creating a timing session.',
        )
      }
      return {
        task,
        localDate: state.localDate,
        discardUntouchedTestTimingSnapshot:
          shouldDiscardUntouchedTrainingTestTimingSnapshot(
            trainingTestMode.enabled,
            state.runtime.activePlan.tasks.find(
              (candidate) => candidate.task.taskId === task.taskId,
            ),
          ),
      }
    },
    eventSink: learningAppCoordinator.eventSink,
    snapshotStore: productionTimingSnapshots,
    lifecycle: browserTimingLifecycle,
    onError(error) {
      console.error('Effective timing lifecycle operation failed', error)
    },
    snapshotRecoveryMarker: trainingTestMode.enabled
      ? 'training-test-timing-v2'
      : undefined,
  })
