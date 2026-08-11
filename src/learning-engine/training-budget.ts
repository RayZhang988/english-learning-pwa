import type {
  LearningTask,
  LearningTaskSupplyRequest,
  TaskExecutionState,
  TrainingTaskProgress,
} from './contracts.ts'
import { REQUIRED_TASK_EFFECTIVE_SECONDS } from './contracts.ts'

const MAX_COMPLETED_STREAM_ITEM_IDS = 500

export function initialTrainingTaskProgress(
  task: LearningTask,
): TrainingTaskProgress | undefined {
  if (task.trainingBudget === undefined) {
    return undefined
  }
  assertTrainingBudget(task)
  return {
    schemaVersion: 1,
    targetEffectiveSeconds: task.trainingBudget.targetEffectiveSeconds,
    remainingEffectiveSeconds: task.trainingBudget.targetEffectiveSeconds,
    status: 'running',
    completedItemIds: [],
    nextSupplyCursor: null,
    contentExhausted: null,
  }
}

export function remainingEffectiveSeconds(
  task: LearningTask,
  effectiveSeconds: number,
): number | null {
  if (task.trainingBudget === undefined) {
    return null
  }
  return Math.max(
    0,
    task.trainingBudget.targetEffectiveSeconds - Math.max(0, effectiveSeconds),
  )
}

export function withBudgetAfterEffectiveTime(
  execution: TaskExecutionState,
  effectiveSeconds: number,
): TrainingTaskProgress | undefined {
  const current = execution.training
  if (current === undefined) {
    return undefined
  }
  const remaining = remainingEffectiveSeconds(execution.task, effectiveSeconds)
  if (remaining === null) {
    return undefined
  }
  return {
    ...current,
    remainingEffectiveSeconds: remaining,
    status:
      current.status === 'running' && remaining === 0
        ? 'finish-current-item'
        : current.status,
  }
}

export function buildLearningTaskSupplyRequest(
  execution: TaskExecutionState,
): LearningTaskSupplyRequest | null {
  const training = execution.training
  if (
    training === undefined ||
    training.status === 'completed' ||
    training.status === 'content-exhausted'
  ) {
    return null
  }
  const reason =
    training.completedItemIds.length === 0 ? 'initial' : 'continue-after-item'
  const cursorPart = training.nextSupplyCursor ?? 'initial'
  return {
    schemaVersion: 1,
    requestId: `${execution.task.taskId}:supply:${training.completedItemIds.length + 1}:${cursorPart}`,
    planId: execution.task.planId,
    taskId: execution.task.taskId,
    domain: execution.task.domain,
    targetModuleId: execution.task.targetModuleId,
    mode: execution.task.mode,
    targetDifficulty: execution.task.difficultyLevel,
    cursor: training.nextSupplyCursor,
    excludeItemIds: training.completedItemIds,
    ...(training.supplyRound === undefined
      ? {}
      : { supplyRound: training.supplyRound }),
    reason,
  }
}

export function appendCompletedStreamItem(
  training: TrainingTaskProgress,
  itemId: string,
  nextSupplyCursor: string | null,
): TrainingTaskProgress {
  if (training.completedItemIds.includes(itemId)) {
    return training
  }
  return {
    ...training,
    completedItemIds: [...training.completedItemIds, itemId].slice(
      -MAX_COMPLETED_STREAM_ITEM_IDS,
    ),
    nextSupplyCursor,
    contentExhausted: null,
  }
}

export function assertTrainingBudget(
  task: LearningTask,
): void {
  if (task.trainingBudget === undefined) {
    return
  }
  if (
    task.trainingBudget.schemaVersion !== 1 ||
    task.trainingBudget.targetEffectiveSeconds !==
      REQUIRED_TASK_EFFECTIVE_SECONDS
  ) {
    throw new TypeError('Unsupported required training budget')
  }
}
