import { AppError } from '../../core/index.ts'
import type {
  DailyPlan,
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

function requireFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`)
  }
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
  requireFiniteNumber(value.skipCount, `${label}.skipCount`)
  requireString(value.startedAt, `${label}.startedAt`, true)
  requireString(value.updatedAt, `${label}.updatedAt`)

  const scheduledTask = plan.tasks[index]
  if (
    scheduledTask === undefined ||
    scheduledTask.taskId !== value.task.taskId
  ) {
    throw new TypeError(
      `${label}.task does not match the scheduled task order.`,
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
  assertPlanProgress(value.activePlan)
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
    'completedLearningUnitIds' | 'processedEventIds' | 'skipHistory'
  >,
): ActiveLearningRuntime {
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
