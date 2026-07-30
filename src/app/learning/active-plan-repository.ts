import {
  AppError,
  type PlatformEvent,
} from '../../core/index.ts'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import type {
  DailyPlan,
  LearningAttemptCompletedEvent,
  LearningTask,
  PlanProgress,
  SkipHistoryEntry,
  TaskExecutionState,
} from '../../learning-engine/index.ts'
import type { NamespaceStore } from '../../storage/index.ts'
import { assertLocalDateValue } from './local-date.ts'

export const LEARNING_RUNTIME_STORAGE_NAMESPACE = 'app.learning-runtime'
export const LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION = 1
export const ACTIVE_LEARNING_RUNTIME_KEY = 'active-plan'
const MAX_PROCESSED_EVENT_IDS = 2_000
const MAX_SKIP_HISTORY_ENTRIES = 500

export interface ActiveLearningRuntime {
  readonly schemaVersion: 1
  readonly activePlan: PlanProgress
  readonly completedLearningUnitIds: readonly string[]
  readonly processedEventIds: readonly string[]
  readonly skipHistory: readonly SkipHistoryEntry[]
  /**
   * Latest stream attempt per budget task, retained until the budget-completed
   * event can turn trusted timing segments into one idempotent duration sample.
   * Records created before QA-011 omit it.
   */
  readonly pendingTrainingAttempts?: readonly LearningAttemptCompletedEvent[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireString(
  value: unknown,
  label: string,
  allowNull = false,
): asserts value is string | null {
  if (allowNull && value === null) {
    return
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function requireFiniteNumber(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`)
  }
}

function requireNonNegativeInteger(
  value: unknown,
  label: string,
): asserts value is number {
  requireFiniteNumber(value, label)
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer.`)
  }
}

function assertOptionalTrainingScore(
  value: unknown,
  label: string,
): void {
  if (value === undefined) {
    return
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError(`${label} must be an R7 score object.`)
  }
  requireNonNegativeInteger(value.correctCount, `${label}.correctCount`)
  requireNonNegativeInteger(value.incorrectCount, `${label}.incorrectCount`)
  requireNonNegativeInteger(value.unscorableCount, `${label}.unscorableCount`)
}

function requireStringArray(
  value: unknown,
  label: string,
): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== 'string' || entry.trim().length === 0,
    )
  ) {
    throw new TypeError(`${label} must be a non-empty string array.`)
  }
}

function assertLearningTask(
  value: unknown,
  planId: string,
  label: string,
): asserts value is LearningTask {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError(`${label} is not a v1 LearningTask.`)
  }
  requireString(value.taskId, `${label}.taskId`)
  requireString(value.planId, `${label}.planId`)
  requireString(value.learningUnitId, `${label}.learningUnitId`)
  requireString(value.contentRef, `${label}.contentRef`)
  if (value.planId !== planId) {
    throw new TypeError(`${label}.planId does not match the active plan.`)
  }
  if (
    value.domain !== 'vocabulary' &&
    value.domain !== 'listening' &&
    value.domain !== 'speaking'
  ) {
    throw new TypeError(`${label}.domain is unsupported.`)
  }
  if (value.targetModuleId !== value.domain) {
    throw new TypeError(`${label}.targetModuleId must match its domain.`)
  }
  if (
    value.mode !== 'learn' &&
    value.mode !== 'calibration' &&
    value.mode !== 'review' &&
    value.mode !== 'retry'
  ) {
    throw new TypeError(`${label}.mode is unsupported.`)
  }
  requireFiniteNumber(value.sequence, `${label}.sequence`)
  requireFiniteNumber(value.difficultyLevel, `${label}.difficultyLevel`)
  requireFiniteNumber(value.estimatedSeconds, `${label}.estimatedSeconds`)
  requireFiniteNumber(value.skipLimit, `${label}.skipLimit`)
  requireStringArray(value.tags, `${label}.tags`)
  if (value.trainingBudget !== undefined) {
    const budgetLabel = `${label}.trainingBudget`
    if (
      !isRecord(value.trainingBudget) ||
      value.trainingBudget.schemaVersion !== 1 ||
      value.trainingBudget.targetEffectiveSeconds !== 900
    ) {
      throw new TypeError(
        `${budgetLabel} must be the supported 900-second v1 budget.`,
      )
    }
  }
  if (value.durationEstimate !== undefined) {
    const estimateLabel = `${label}.durationEstimate`
    if (
      !isRecord(value.durationEstimate) ||
      value.durationEstimate.schemaVersion !== 1
    ) {
      throw new TypeError(`${estimateLabel} is not schema version 1.`)
    }
    const estimate = value.durationEstimate
    requireFiniteNumber(
      estimate.estimateSeconds,
      `${estimateLabel}.estimateSeconds`,
    )
    requireNonNegativeInteger(
      estimate.sampleCount,
      `${estimateLabel}.sampleCount`,
    )
    if (
      estimate.basis !== 'content-baseline' &&
      estimate.basis !== 'personal-history'
    ) {
      throw new TypeError(`${estimateLabel}.basis is unsupported.`)
    }
    if (
      estimate.confidence !== 'low' &&
      estimate.confidence !== 'medium' &&
      estimate.confidence !== 'high'
    ) {
      throw new TypeError(
        `${estimateLabel}.confidence is unsupported.`,
      )
    }
    requireString(estimate.contentType, `${estimateLabel}.contentType`)
    requireString(estimate.profileKey, `${estimateLabel}.profileKey`)
    if (
      estimate.baselineSource !== 'structured-content' &&
      estimate.baselineSource !== 'legacy-content-estimate'
    ) {
      throw new TypeError(
        `${estimateLabel}.baselineSource is unsupported.`,
      )
    }
    if (!isRecord(estimate.reasonableRangeSeconds)) {
      throw new TypeError(
        `${estimateLabel}.reasonableRangeSeconds must be an object.`,
      )
    }
    requireFiniteNumber(
      estimate.reasonableRangeSeconds.lower,
      `${estimateLabel}.reasonableRangeSeconds.lower`,
    )
    requireFiniteNumber(
      estimate.reasonableRangeSeconds.upper,
      `${estimateLabel}.reasonableRangeSeconds.upper`,
    )
    if (
      estimate.reasonableRangeSeconds.lower >
        estimate.reasonableRangeSeconds.upper ||
      estimate.estimateSeconds !== value.estimatedSeconds
    ) {
      throw new TypeError(
        `${estimateLabel} is inconsistent with the task estimate.`,
      )
    }
  }
}

function assertDailyPlan(value: unknown): asserts value is DailyPlan {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError('activePlan.plan is not a v1 DailyPlan.')
  }
  requireString(value.planId, 'activePlan.plan.planId')
  requireString(value.localDate, 'activePlan.plan.localDate')
  assertLocalDateValue(value.localDate as string, 'activePlan.plan.localDate')
  requireString(value.generatedAt, 'activePlan.plan.generatedAt')
  if (!Array.isArray(value.tasks)) {
    throw new TypeError('activePlan.plan.tasks must be an array.')
  }
  const taskIds = new Set<string>()
  value.tasks.forEach((task, index) => {
    assertLearningTask(
      task,
      value.planId as string,
      `activePlan.plan.tasks[${index}]`,
    )
    if (taskIds.has(task.taskId)) {
      throw new TypeError('activePlan.plan contains duplicate task IDs.')
    }
    taskIds.add(task.taskId)
  })
}

function assertTaskExecution(
  value: unknown,
  plan: DailyPlan,
  index: number,
): asserts value is TaskExecutionState {
  const label = `activePlan.tasks[${index}]`
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  assertLearningTask(value.task, plan.planId, `${label}.task`)
  if (
    value.status !== 'pending' &&
    value.status !== 'active' &&
    value.status !== 'paused' &&
    value.status !== 'completed' &&
    value.status !== 'skipped' &&
    value.status !== 'blocked'
  ) {
    throw new TypeError(`${label}.status is unsupported.`)
  }
  if (
    value.completionKind !== undefined &&
    value.completionKind !== null &&
    value.completionKind !== 'scored' &&
    value.completionKind !== 'unscorable-practice'
  ) {
    throw new TypeError(`${label}.completionKind is unsupported.`)
  }
  requireFiniteNumber(value.spentSeconds, `${label}.spentSeconds`)
  requireFiniteNumber(value.effectiveSeconds, `${label}.effectiveSeconds`)
  assertOptionalTrainingScore(value.score, `${label}.score`)
  if (value.timingSegmentCount !== undefined) {
    requireNonNegativeInteger(
      value.timingSegmentCount,
      `${label}.timingSegmentCount`,
    )
  }
  if (value.excludedSeconds !== undefined) {
    requireFiniteNumber(
      value.excludedSeconds,
      `${label}.excludedSeconds`,
    )
  }
  if (
    value.effectiveTimeSource !== undefined &&
    value.effectiveTimeSource !== null &&
    value.effectiveTimeSource !== 'timing-segments' &&
    value.effectiveTimeSource !== 'legacy-event-duration'
  ) {
    throw new TypeError(`${label}.effectiveTimeSource is unsupported.`)
  }
  if (
    value.effectiveTimeSource === 'timing-segments' &&
    (typeof value.timingSegmentCount !== 'number' ||
      value.timingSegmentCount < 1 ||
      typeof value.excludedSeconds !== 'number' ||
      value.spentSeconds !==
        value.effectiveSeconds + value.excludedSeconds)
  ) {
    throw new TypeError(
      `${label} timing segment totals are inconsistent.`,
    )
  }
  requireFiniteNumber(value.skipCount, `${label}.skipCount`)
  requireString(value.startedAt, `${label}.startedAt`, true)
  requireString(value.updatedAt, `${label}.updatedAt`)

  if (value.task.trainingBudget === undefined) {
    if (value.training !== undefined) {
      throw new TypeError(
        `${label}.training is not allowed on a legacy task.`,
      )
    }
  } else {
    const trainingLabel = `${label}.training`
    const training = value.training
    if (
      !isRecord(training) ||
      training.schemaVersion !== 1 ||
      training.targetEffectiveSeconds !==
        value.task.trainingBudget.targetEffectiveSeconds
    ) {
      throw new TypeError(
        `${trainingLabel} must match the scheduled training budget.`,
      )
    }
    requireNonNegativeInteger(
      training.remainingEffectiveSeconds,
      `${trainingLabel}.remainingEffectiveSeconds`,
    )
    if (
      training.remainingEffectiveSeconds >
      value.task.trainingBudget.targetEffectiveSeconds
    ) {
      throw new TypeError(
        `${trainingLabel}.remainingEffectiveSeconds exceeds its target.`,
      )
    }
    if (
      training.status !== 'running' &&
      training.status !== 'finish-current-item' &&
      training.status !== 'completed' &&
      training.status !== 'content-exhausted'
    ) {
      throw new TypeError(`${trainingLabel}.status is unsupported.`)
    }
    requireStringArray(
      training.completedItemIds,
      `${trainingLabel}.completedItemIds`,
    )
    if (
      new Set(training.completedItemIds as readonly string[]).size !==
      (training.completedItemIds as readonly string[]).length
    ) {
      throw new TypeError(
        `${trainingLabel}.completedItemIds contains duplicates.`,
      )
    }
    requireString(
      training.nextSupplyCursor,
      `${trainingLabel}.nextSupplyCursor`,
      true,
    )
    if (training.status === 'content-exhausted') {
      if (!isRecord(training.contentExhausted)) {
        throw new TypeError(
          `${trainingLabel}.contentExhausted must describe the blocked supply request.`,
        )
      }
      const exhausted = training.contentExhausted
      requireString(
        exhausted.requestId,
        `${trainingLabel}.contentExhausted.requestId`,
      )
      requireString(
        exhausted.cursor,
        `${trainingLabel}.contentExhausted.cursor`,
        true,
      )
      requireString(
        exhausted.occurredAt,
        `${trainingLabel}.contentExhausted.occurredAt`,
      )
      if (
        exhausted.reason !== 'no-eligible-content' &&
        exhausted.reason !==
          'all-eligible-content-recently-used' &&
        exhausted.reason !== 'provider-failure'
      ) {
        throw new TypeError(
          `${trainingLabel}.contentExhausted.reason is unsupported.`,
        )
      }
    } else if (training.contentExhausted !== null) {
      throw new TypeError(
        `${trainingLabel}.contentExhausted is only valid while blocked.`,
      )
    }
    if (
      (training.status === 'finish-current-item' ||
        training.status === 'completed') &&
      training.remainingEffectiveSeconds !== 0
    ) {
      throw new TypeError(
        `${trainingLabel} reached a terminal budget state with time remaining.`,
      )
    }
    if (
      training.status === 'completed' &&
      value.status !== 'completed'
    ) {
      throw new TypeError(
        `${trainingLabel} is completed but the task is not completed.`,
      )
    }
    if (
      value.status === 'completed' &&
      training.status !== 'completed'
    ) {
      throw new TypeError(
        `${label} cannot complete before its training budget.`,
      )
    }
  }

  const scheduledTask = plan.tasks[index]
  if (
    scheduledTask === undefined ||
    scheduledTask.taskId !== value.task.taskId
  ) {
    throw new TypeError(
      `${label}.task does not match the scheduled task order.`,
    )
  }
  if (
    scheduledTask.trainingBudget?.targetEffectiveSeconds !==
    value.task.trainingBudget?.targetEffectiveSeconds
  ) {
    throw new TypeError(
      `${label}.task training budget does not match the scheduled task.`,
    )
  }
}

function assertPlanProgress(value: unknown): asserts value is PlanProgress {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError('activePlan is not a v1 PlanProgress.')
  }
  assertDailyPlan(value.plan)
  const plan = value.plan
  if (
    value.status !== 'not-started' &&
    value.status !== 'in-progress' &&
    value.status !== 'completed'
  ) {
    throw new TypeError('activePlan.status is unsupported.')
  }
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length !== plan.tasks.length
  ) {
    throw new TypeError(
      'activePlan.tasks must match the scheduled task count.',
    )
  }
  value.tasks.forEach((task, index) => {
    assertTaskExecution(task, plan, index)
  })
  requireStringArray(value.processedEventIds, 'activePlan.processedEventIds')
  requireString(value.updatedAt, 'activePlan.updatedAt')
}

function assertActiveLearningRuntime(
  value: unknown,
): asserts value is ActiveLearningRuntime {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError('Stored learning runtime is not schema version 1.')
  }
  const activePlan = value.activePlan
  assertPlanProgress(activePlan)
  requireStringArray(
    value.completedLearningUnitIds,
    'completedLearningUnitIds',
  )
  requireStringArray(value.processedEventIds, 'processedEventIds')
  if (!Array.isArray(value.skipHistory)) {
    throw new TypeError('skipHistory must be an array.')
  }
  value.skipHistory.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`skipHistory[${index}] must be an object.`)
    }
    requireString(
      entry.learningUnitId,
      `skipHistory[${index}].learningUnitId`,
    )
    requireString(entry.localDate, `skipHistory[${index}].localDate`)
    assertLocalDateValue(
      entry.localDate as string,
      `skipHistory[${index}].localDate`,
    )
    if (
      entry.reason !== 'user-skipped' &&
      entry.reason !== 'time-budget-ended'
    ) {
      throw new TypeError(`skipHistory[${index}].reason is unsupported.`)
    }
  })
  if (value.pendingTrainingAttempts !== undefined) {
    if (!Array.isArray(value.pendingTrainingAttempts)) {
      throw new TypeError(
        'pendingTrainingAttempts must be an array.',
      )
    }
    const taskIds = new Set<string>()
    value.pendingTrainingAttempts.forEach((entry, index) => {
      if (!isRecord(entry)) {
        throw new TypeError(
          `pendingTrainingAttempts[${index}] is not a v1 attempt event.`,
        )
      }
      const parsed = parseLearningEvent(
        entry as unknown as PlatformEvent,
      )
      if (parsed.type !== 'learning.attempt.completed.v1') {
        throw new TypeError(
          `pendingTrainingAttempts[${index}] is not an attempt event.`,
        )
      }
      const execution = activePlan.tasks.find(
        (candidate) =>
          candidate.task.taskId === parsed.payload.taskId,
      )
      if (
        !execution?.task.trainingBudget ||
        parsed.payload.planId !== activePlan.plan.planId ||
        parsed.payload.localDate !==
          activePlan.plan.localDate ||
        parsed.payload.learningUnitId !==
          execution.task.learningUnitId ||
        parsed.payload.contentRef !== execution.task.contentRef ||
        parsed.payload.domain !== execution.task.domain ||
        parsed.payload.targetModuleId !==
          execution.task.targetModuleId ||
        taskIds.has(parsed.payload.taskId)
      ) {
        throw new TypeError(
          `pendingTrainingAttempts[${index}] does not match one unique budget task.`,
        )
      }
      taskIds.add(parsed.payload.taskId)
    })
  }
}

function uniqueRecent(
  values: readonly string[],
  maximum = MAX_PROCESSED_EVENT_IDS,
): readonly string[] {
  return [...new Set(values)].slice(-maximum)
}

export function createActiveLearningRuntime(
  activePlan: PlanProgress,
  previous?: Pick<
    ActiveLearningRuntime,
    | 'completedLearningUnitIds'
    | 'processedEventIds'
    | 'skipHistory'
    | 'pendingTrainingAttempts'
  >,
): ActiveLearningRuntime {
  const budgetTaskIds = new Set(
    activePlan.tasks
      .filter((execution) => execution.task.trainingBudget)
      .map((execution) => execution.task.taskId),
  )
  return {
    schemaVersion: 1,
    activePlan,
    completedLearningUnitIds: uniqueRecent(
      previous?.completedLearningUnitIds ?? [],
      Number.MAX_SAFE_INTEGER,
    ),
    processedEventIds: uniqueRecent(previous?.processedEventIds ?? []),
    skipHistory: (previous?.skipHistory ?? []).slice(
      -MAX_SKIP_HISTORY_ENTRIES,
    ),
    pendingTrainingAttempts:
      previous?.pendingTrainingAttempts?.filter(
        (event) =>
          event.payload.planId === activePlan.plan.planId &&
          budgetTaskIds.has(event.payload.taskId),
      ) ?? [],
  }
}

export class ActivePlanRepository {
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async save(runtime: ActiveLearningRuntime): Promise<void> {
    assertActiveLearningRuntime(runtime)
    await this.#store.put(
      ACTIVE_LEARNING_RUNTIME_KEY,
      runtime,
      LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION,
    )
  }

  async load(): Promise<ActiveLearningRuntime | undefined> {
    const record = await this.#store.get<unknown>(
      ACTIVE_LEARNING_RUNTIME_KEY,
    )
    if (record === undefined) {
      return undefined
    }
    if (record.schemaVersion !== LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION) {
      throw new AppError(
        'schema_incompatible',
        `不支持的学习计划数据版本：${record.schemaVersion}。`,
        {
          recoverable: false,
          details: {
            namespace: LEARNING_RUNTIME_STORAGE_NAMESPACE,
            key: ACTIVE_LEARNING_RUNTIME_KEY,
          },
        },
      )
    }
    try {
      assertActiveLearningRuntime(record.value)
      return record.value
    } catch (error) {
      throw new AppError(
        'schema_incompatible',
        '本地学习计划数据已损坏，无法安全恢复。',
        {
          cause: error,
          recoverable: false,
          details: {
            namespace: LEARNING_RUNTIME_STORAGE_NAMESPACE,
            key: ACTIVE_LEARNING_RUNTIME_KEY,
          },
        },
      )
    }
  }

  async clear(): Promise<void> {
    await this.#store.delete(ACTIVE_LEARNING_RUNTIME_KEY)
  }
}
