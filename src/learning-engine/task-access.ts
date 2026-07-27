import type {
  LearningTask,
  PlanProgress,
  PlanTaskAccess,
  PlanTaskAvailability,
  TaskExecutionState,
  TaskExecutionStatus,
} from './contracts.ts'

const STARTABLE_STATUSES: readonly TaskExecutionStatus[] = [
  'pending',
  'active',
  'paused',
  'blocked',
]
const TERMINAL_STATUSES: readonly TaskExecutionStatus[] = [
  'completed',
  'skipped',
]

function isStartableStatus(
  status: TaskExecutionStatus,
): boolean {
  return STARTABLE_STATUSES.includes(status)
}

function isTerminalStatus(
  status: TaskExecutionStatus,
): boolean {
  return TERMINAL_STATUSES.includes(status)
}

function sameTaskIdentity(
  scheduled: LearningTask,
  execution: LearningTask,
): boolean {
  return (
    scheduled.schemaVersion === 1 &&
    execution.schemaVersion === 1 &&
    scheduled.taskId === execution.taskId &&
    scheduled.planId === execution.planId &&
    scheduled.sequence === execution.sequence &&
    scheduled.learningUnitId === execution.learningUnitId &&
    scheduled.contentRef === execution.contentRef &&
    scheduled.domain === execution.domain &&
    scheduled.targetModuleId === execution.targetModuleId &&
    scheduled.mode === execution.mode &&
    scheduled.difficultyLevel === execution.difficultyLevel &&
    scheduled.estimatedSeconds === execution.estimatedSeconds &&
    scheduled.targetModuleId === scheduled.domain &&
    execution.targetModuleId === execution.domain
  )
}

function planStatusIsConsistent(progress: PlanProgress): boolean {
  const allPending = progress.tasks.every(
    (execution) => execution.status === 'pending',
  )
  const allTerminal =
    progress.tasks.length > 0 &&
    progress.tasks.every((execution) =>
      isTerminalStatus(execution.status),
    )
  if (progress.status === 'not-started') {
    return allPending
  }
  if (progress.status === 'completed') {
    return allTerminal
  }
  return !allPending && !allTerminal
}

function taskDataIsValid(
  progress: PlanProgress,
  taskId: string,
): {
  readonly valid: boolean
  readonly execution: TaskExecutionState | null
} {
  const scheduledMatches = progress.plan.tasks.filter(
    (task) => task.taskId === taskId,
  )
  const executionMatches = progress.tasks.filter(
    (execution) => execution.task.taskId === taskId,
  )
  const execution = executionMatches[0] ?? null
  if (
    progress.schemaVersion !== 1 ||
    progress.plan.schemaVersion !== 1 ||
    progress.tasks.length !== progress.plan.tasks.length ||
    !planStatusIsConsistent(progress) ||
    scheduledMatches.length !== 1 ||
    executionMatches.length !== 1 ||
    execution === null
  ) {
    return { valid: false, execution }
  }
  const scheduled = scheduledMatches[0]
  return {
    valid:
      scheduled.planId === progress.plan.planId &&
      sameTaskIdentity(scheduled, execution.task),
    execution,
  }
}

function baseAvailability(
  progress: PlanProgress,
  taskId: string,
): PlanTaskAvailability {
  const scheduled = progress.plan.tasks.some(
    (task) => task.taskId === taskId,
  )
  const executed = progress.tasks.some(
    (execution) => execution.task.taskId === taskId,
  )
  if (!scheduled && !executed) {
    return {
      taskId,
      targetModuleId: null,
      taskStatus: null,
      availability: 'unavailable',
      unavailableReason: 'not-in-active-plan',
      recommended: false,
    }
  }

  const data = taskDataIsValid(progress, taskId)
  if (!data.valid || data.execution === null) {
    return {
      taskId,
      targetModuleId:
        data.execution?.task.targetModuleId ?? null,
      taskStatus: data.execution?.status ?? null,
      availability: 'unavailable',
      unavailableReason: 'invalid-task-data',
      recommended: false,
    }
  }
  if (isTerminalStatus(data.execution.status)) {
    return {
      taskId,
      targetModuleId: data.execution.task.targetModuleId,
      taskStatus: data.execution.status,
      availability: 'unavailable',
      unavailableReason: 'task-finished',
      recommended: false,
    }
  }
  if (!isStartableStatus(data.execution.status)) {
    return {
      taskId,
      targetModuleId: data.execution.task.targetModuleId,
      taskStatus: data.execution.status,
      availability: 'unavailable',
      unavailableReason: 'invalid-task-data',
      recommended: false,
    }
  }
  return {
    taskId,
    targetModuleId: data.execution.task.targetModuleId,
    taskStatus: data.execution.status,
    availability: 'startable',
    unavailableReason: null,
    recommended: false,
  }
}

function recommendationRank(
  execution: TaskExecutionState,
): number {
  if (execution.status === 'active') {
    return 0
  }
  if (execution.status === 'paused') {
    return 1
  }
  if (execution.status === 'blocked') {
    return 2
  }
  if (execution.task.mode === 'retry') {
    return 3
  }
  if (execution.task.origin === 'carry-over') {
    return 4
  }
  if (
    execution.task.origin === 'due-review' ||
    execution.task.mode === 'review'
  ) {
    return 5
  }
  return 6
}

function recommendedTaskId(
  progress: PlanProgress,
  startableTaskIds: ReadonlySet<string>,
): string | null {
  const recommended = progress.tasks
    .filter((execution) =>
      startableTaskIds.has(execution.task.taskId),
    )
    .slice()
    .sort(
      (left, right) =>
        recommendationRank(left) - recommendationRank(right) ||
        left.task.sequence - right.task.sequence ||
        left.task.taskId.localeCompare(right.task.taskId),
    )[0]
  return recommended?.task.taskId ?? null
}

export function getPlanTaskAccess(
  progress: PlanProgress,
): PlanTaskAccess {
  const taskIds = [
    ...new Set([
      ...progress.plan.tasks.map((task) => task.taskId),
      ...progress.tasks.map((execution) => execution.task.taskId),
    ]),
  ]
  const base = taskIds.map((taskId) =>
    baseAvailability(progress, taskId),
  )
  const startableTaskIds = base
    .filter((task) => task.availability === 'startable')
    .map((task) => task.taskId)
  const recommendation = recommendedTaskId(
    progress,
    new Set(startableTaskIds),
  )

  return {
    schemaVersion: 1,
    startableTaskIds,
    recommendedTaskId: recommendation,
    tasks: base.map((task) => ({
      ...task,
      recommended: task.taskId === recommendation,
    })),
  }
}

export function evaluatePlanTaskStart(
  progress: PlanProgress,
  taskId: string,
): PlanTaskAvailability {
  return (
    getPlanTaskAccess(progress).tasks.find(
      (task) => task.taskId === taskId,
    ) ?? baseAvailability(progress, taskId)
  )
}
