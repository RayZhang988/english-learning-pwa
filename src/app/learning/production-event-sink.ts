import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import { AppError } from '../../core/index.ts'
import {
  applyLearningAttempt,
  applyLearningEngineTrainingEvent,
  applyGrowthTrainingCompleted,
  createGrowthState,
  parseLearningEvent,
  recordDailyActivity,
  recordTaskDurationSample,
  summarizePlanActivity,
  toSkipHistoryEntry,
  type LearningEngineState,
  type LearningEvent,
  type LearningAttemptCompletedEvent,
  type LearningTask,
  type PlanProgress,
  type SkipHistoryEntry,
} from '../../learning-engine/index.ts'
import type { LearningEngineRepository } from '../../learning-engine/index.ts'
import {
  type ActiveLearningRuntime,
  type ActivePlanRepository,
  createActiveLearningRuntime,
} from './active-plan-repository.ts'
import { trainingTestMode } from '../../config/training-test-mode.ts'

const MAX_SKIP_HISTORY_ENTRIES = 500

export interface LearningRuntimeUpdate {
  readonly runtime: ActiveLearningRuntime
  readonly engineState: LearningEngineState
}

export type LearningRuntimeUpdateListener = (
  update: LearningRuntimeUpdate,
) => void

function taskForEvent(
  progress: PlanProgress,
  event: LearningEvent,
): LearningTask {
  const execution = progress.tasks.find(
    (entry) => entry.task.taskId === event.payload.taskId,
  )
  if (!execution) {
    throw new TypeError('Event taskId is not part of the active plan.')
  }
  if (event.payload.planId !== progress.plan.planId) {
    throw new TypeError(
      'Event planId does not match the active plan.',
    )
  }
  if (
    event.payload.learningUnitId !==
      execution.task.learningUnitId ||
    event.payload.contentRef !== execution.task.contentRef ||
    event.payload.domain !== execution.task.domain ||
    event.payload.targetModuleId !==
      execution.task.targetModuleId
  ) {
    throw new TypeError(
      'Event identity does not match the scheduled task.',
    )
  }
  if (event.payload.localDate !== progress.plan.localDate) {
    throw new TypeError(
      'Event localDate does not match the active plan date.',
    )
  }
  if (
    (event.type === 'learning.task.started.v1' ||
      event.type === 'learning.attempt.completed.v1' ||
      event.type === 'learning.timing.segment.recorded.v1' ||
      event.type === 'learning.training.item.completed.v1' ||
      event.type ===
        'learning.training.content.exhausted.v1' ||
      event.type ===
        'learning.training.content.recovered.v1' ||
      event.type ===
        'learning.training.budget.completed.v1') &&
    event.payload.mode !== execution.task.mode
  ) {
    throw new TypeError('Event mode does not match the scheduled task.')
  }
  if (
    event.type === 'learning.attempt.completed.v1' &&
    (event.payload.difficultyLevel !== execution.task.difficultyLevel ||
      event.payload.estimatedSeconds !==
        execution.task.estimatedSeconds)
  ) {
    throw new TypeError(
      'Attempt difficulty or duration does not match the scheduled task.',
    )
  }
  return execution.task
}

function completedUnitIds(
  runtime: ActiveLearningRuntime,
  progress: PlanProgress,
): readonly string[] {
  return [
    ...new Set([
      ...runtime.completedLearningUnitIds,
      ...progress.tasks
        .filter((entry) => entry.status === 'completed')
        .map((entry) => entry.task.learningUnitId),
    ]),
  ]
}

function withProcessedEvent(
  runtime: ActiveLearningRuntime,
  progress: PlanProgress,
  eventId: string,
  skipHistory: readonly SkipHistoryEntry[],
  pendingTrainingAttempts:
    readonly LearningAttemptCompletedEvent[] =
      runtime.pendingTrainingAttempts ?? [],
): ActiveLearningRuntime {
  return createActiveLearningRuntime(progress, {
    completedLearningUnitIds: completedUnitIds(runtime, progress),
    processedEventIds: [...runtime.processedEventIds, eventId],
    skipHistory: skipHistory.slice(-MAX_SKIP_HISTORY_ENTRIES),
    pendingTrainingAttempts,
  })
}

function withPendingTrainingAttempt(
  attempts: readonly LearningAttemptCompletedEvent[],
  event: LearningAttemptCompletedEvent,
): readonly LearningAttemptCompletedEvent[] {
  return [
    ...attempts.filter(
      (candidate) =>
        candidate.payload.taskId !== event.payload.taskId,
    ),
    event,
  ]
}

/**
 * Production event boundary shared by all training modules.
 *
 * Engine state is saved before the active plan. If the second write fails,
 * retrying the same event is safe because the learning engine and runtime
 * ledgers both use event IDs for idempotence.
 */
export class ProductionLearningEventSink implements PlatformEventSink {
  readonly #activePlans: ActivePlanRepository
  readonly #engineStates: LearningEngineRepository
  readonly #listeners = new Set<LearningRuntimeUpdateListener>()
  readonly #growthEvidenceEnabled: () => boolean
  #queue: Promise<void> = Promise.resolve()

  constructor(
    activePlans: ActivePlanRepository,
    engineStates: LearningEngineRepository,
    options: { readonly growthEvidenceEnabled?: () => boolean } = {},
  ) {
    this.#activePlans = activePlans
    this.#engineStates = engineStates
    this.#growthEvidenceEnabled = options.growthEvidenceEnabled ?? (() => !trainingTestMode.enabled)
  }

  subscribe(listener: LearningRuntimeUpdateListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  publish(event: PlatformEvent): Promise<void> {
    const operation = this.#queue.then(() => this.#process(event))
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #process(platformEvent: PlatformEvent): Promise<void> {
    const event = parseLearningEvent(platformEvent)
    const runtime = await this.#activePlans.load()
    if (!runtime) {
      throw new AppError(
        'unknown',
        '当前没有可接收训练事件的活动学习计划。',
        { recoverable: true },
      )
    }
    if (runtime.processedEventIds.includes(event.id)) {
      return
    }

    taskForEvent(runtime.activePlan, event)
    const currentExecution = runtime.activePlan.tasks.find(
      (entry) => entry.task.taskId === event.payload.taskId,
    )
    if (
      currentExecution?.status === 'completed' ||
      currentExecution?.status === 'skipped'
    ) {
      const terminalRuntime = withProcessedEvent(
        runtime,
        runtime.activePlan,
        event.id,
        runtime.skipHistory,
      )
      await this.#activePlans.save(terminalRuntime)
      return
    }

    const engineState = await this.#engineStates.load()
    if (!engineState) {
      throw new AppError(
        'unknown',
        '学习引擎尚未初始化，训练结果没有被保存。',
        { recoverable: true },
      )
    }

    const transition = applyLearningEngineTrainingEvent({
      engineState,
      progress: runtime.activePlan,
      event,
      skipHistory: runtime.skipHistory,
    })
    const progress = transition.progress
    let nextEngineState = transition.engineState
    let pendingTrainingAttempts =
      runtime.pendingTrainingAttempts ?? []
    if (event.type === 'learning.attempt.completed.v1') {
      nextEngineState = applyLearningAttempt(
        nextEngineState,
        event,
      ).state
      if (currentExecution?.training) {
        pendingTrainingAttempts = withPendingTrainingAttempt(
          pendingTrainingAttempts,
          event,
        )
      } else {
        nextEngineState = {
          ...nextEngineState,
          progress: recordTaskDurationSample(
            nextEngineState.progress,
            progress,
            event,
          ),
        }
      }
    } else if (
      event.type === 'learning.training.budget.completed.v1'
    ) {
      const pendingAttempt = pendingTrainingAttempts.find(
        (candidate) =>
          candidate.payload.taskId === event.payload.taskId,
      )
      if (pendingAttempt) {
        nextEngineState = {
          ...nextEngineState,
          progress: recordTaskDurationSample(
            nextEngineState.progress,
            progress,
            pendingAttempt,
          ),
        }
      }
      pendingTrainingAttempts =
        pendingTrainingAttempts.filter(
          (candidate) =>
            candidate.payload.taskId !== event.payload.taskId,
        )
    }
    // A required daily training block becomes one R17 formal session only at
    // its real budget completion.  Attempts, unscorable fallbacks, review and
    // trainingTest mode never enter this ledger.
    if (
      event.type === 'learning.training.budget.completed.v1' &&
      this.#growthEvidenceEnabled()
    ) {
      const completed = progress.tasks.find(
        (entry) => entry.task.taskId === event.payload.taskId,
      )
      const score = completed?.score
      if (
        completed?.status === 'completed' &&
        completed.completionKind === 'scored' &&
        score !== undefined &&
        score.correctCount + score.incorrectCount > 0
      ) {
        const growth = nextEngineState.growth ?? createGrowthState()
        nextEngineState = {
          ...nextEngineState,
          growth: applyGrowthTrainingCompleted(growth, {
            eventId: `growth:daily:${event.id}`,
            source: 'daily-training',
            sessionId: `daily:${completed.task.planId}:${completed.task.taskId}`,
            domain: completed.task.domain,
            levelOrdinal: growth.domains[completed.task.domain].currentLevelOrdinal,
            correctCount: score.correctCount,
            incorrectCount: score.incorrectCount,
            localDate: progress.plan.localDate,
            completedAt: event.occurredAt,
          }),
        }
      }
    }
    const activity = summarizePlanActivity(progress)
    nextEngineState = {
      ...nextEngineState,
      progress: recordDailyActivity(nextEngineState.progress, {
        ...activity,
        recordedAt: event.occurredAt,
      }),
    }

    const skipEntry =
      event.type === 'learning.task.skipped.v1'
        ? toSkipHistoryEntry(event)
        : null
    const skipHistory =
      skipEntry === null
        ? runtime.skipHistory
        : [...runtime.skipHistory, skipEntry]
    const nextRuntime = withProcessedEvent(
      runtime,
      progress,
      event.id,
      skipHistory,
      pendingTrainingAttempts,
    )

    await this.#engineStates.save(nextEngineState)
    await this.#activePlans.save(nextRuntime)
    const update = {
      runtime: nextRuntime,
      engineState: nextEngineState,
    }
    for (const listener of this.#listeners) {
      listener(update)
    }
  }
}
