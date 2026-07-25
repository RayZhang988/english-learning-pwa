import type {
  AttemptPlanDisposition,
  LearningAttemptCompletedEvent,
  LearningEvent,
  LearningTask,
  PlanActivitySummary,
  PlanProgress,
  ResumeDecision,
  SkipDecision,
  SkipHistoryEntry,
  TaskExecutionState,
  TaskSkipReason,
} from './contracts.ts'
import {
  assertLocalDate,
  localDateOrdinal,
  parseTimestamp,
} from './utils.ts'

export function createPlanProgress(
  plan: PlanProgress['plan'],
  createdAt: string,
): PlanProgress {
  parseTimestamp(createdAt, 'createdAt')
  return {
    schemaVersion: 1,
    plan,
    status: 'not-started',
    tasks: plan.tasks.map((task) => ({
      task,
      status: 'pending',
      completionKind: null,
      spentSeconds: 0,
      effectiveSeconds: 0,
      skipCount: 0,
      startedAt: null,
      updatedAt: createdAt,
    })),
    processedEventIds: [],
    updatedAt: createdAt,
  }
}

/**
 * Resolves whether an attempt event ends the plan task independently from
 * whether it carries mastery evidence.
 *
 * Speaking v1 publishes one attempt event only after the whole prompt
 * session has ended. A fully exercised fallback session can therefore end
 * the plan task without being scored. Other modules' unscorable events may
 * represent missing content or playback failures and remain resumable.
 */
export function resolveAttemptPlanDisposition(
  event: LearningAttemptCompletedEvent,
): AttemptPlanDisposition {
  if (
    event.payload.result === 'scored' &&
    event.payload.taskCompleted
  ) {
    return 'scored-completion'
  }
  if (
    event.sourceModuleId === 'speaking' &&
    event.payload.domain === 'speaking' &&
    event.payload.targetModuleId === 'speaking' &&
    event.payload.result === 'unscorable' &&
    !event.payload.taskCompleted &&
    (event.payload.failureCategory === 'device' ||
      event.payload.failureCategory === 'permission' ||
      event.payload.failureCategory === 'network' ||
      event.payload.failureCategory === 'interrupted')
  ) {
    return 'unscorable-practice-completion'
  }
  return 'retry-required'
}

function skipWindowCount(
  task: LearningTask,
  history: readonly SkipHistoryEntry[],
  localDate: string,
): number {
  const currentOrdinal = localDateOrdinal(localDate)
  return history.filter((entry) => {
    if (entry.learningUnitId !== task.learningUnitId) {
      return false
    }
    const age = currentOrdinal - localDateOrdinal(entry.localDate)
    if (task.mode === 'review') {
      return age === 0
    }
    return age >= 0 && age < 7
  }).length
}

export function evaluateTaskSkip(
  task: LearningTask,
  history: readonly SkipHistoryEntry[],
  localDate: string,
  reason: TaskSkipReason,
): SkipDecision {
  assertLocalDate(localDate)
  if (reason === 'device-failure' || reason === 'content-failure') {
    return {
      allowed: true,
      nextStatus: 'paused',
      remainingSkips: task.skipLimit,
      reason: 'non-user-failure-retained',
    }
  }
  if (task.mode === 'retry') {
    return {
      allowed: false,
      nextStatus: 'blocked',
      remainingSkips: 0,
      reason: 'retry-must-be-retained',
    }
  }
  const used = skipWindowCount(task, history, localDate)
  if (used >= task.skipLimit) {
    return {
      allowed: false,
      nextStatus: 'blocked',
      remainingSkips: 0,
      reason: 'skip-limit-reached',
    }
  }
  return {
    allowed: true,
    nextStatus: 'skipped',
    remainingSkips: Math.max(0, task.skipLimit - used - 1),
    reason: 'within-limit',
  }
}

export function toSkipHistoryEntry(
  event: Extract<LearningEvent, { type: 'learning.task.skipped.v1' }>,
): SkipHistoryEntry | null {
  if (
    event.payload.reason === 'device-failure' ||
    event.payload.reason === 'content-failure'
  ) {
    return null
  }
  return {
    learningUnitId: event.payload.learningUnitId,
    localDate: event.payload.localDate,
    reason: event.payload.reason,
  }
}

function derivePlanStatus(
  tasks: readonly TaskExecutionState[],
): PlanProgress['status'] {
  if (
    tasks.length > 0 &&
    tasks.every(
      (task) => task.status === 'completed' || task.status === 'skipped',
    )
  ) {
    return 'completed'
  }
  if (tasks.some((task) => task.status !== 'pending')) {
    return 'in-progress'
  }
  return 'not-started'
}

export function applyPlanEvent(
  progress: PlanProgress,
  event: LearningEvent,
  skipHistory: readonly SkipHistoryEntry[] = [],
): PlanProgress {
  if (progress.processedEventIds.includes(event.id)) {
    return progress
  }
  if (event.payload.planId !== progress.plan.planId) {
    throw new TypeError('Event planId does not match PlanProgress')
  }
  const taskIndex = progress.tasks.findIndex(
    (entry) => entry.task.taskId === event.payload.taskId,
  )
  if (taskIndex < 0) {
    throw new TypeError('Event taskId is not part of this plan')
  }
  const execution = progress.tasks[taskIndex]
  if (
    execution.task.learningUnitId !== event.payload.learningUnitId ||
    execution.task.domain !== event.payload.domain ||
    execution.task.contentRef !== event.payload.contentRef ||
    execution.task.targetModuleId !== event.payload.targetModuleId
  ) {
    throw new TypeError('Event task identity does not match scheduled task')
  }
  if (execution.status === 'completed') {
    return progress
  }

  let updated: TaskExecutionState
  if (event.type === 'learning.task.started.v1') {
    updated = {
      ...execution,
      status: 'active',
      startedAt: execution.startedAt ?? event.occurredAt,
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.task.paused.v1') {
    updated = {
      ...execution,
      status: 'paused',
      spentSeconds:
        execution.spentSeconds + Math.max(0, event.payload.durationSeconds),
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.task.skipped.v1') {
    const decision = evaluateTaskSkip(
      execution.task,
      skipHistory,
      event.payload.localDate,
      event.payload.reason,
    )
    updated = {
      ...execution,
      status: decision.nextStatus,
      completionKind: null,
      skipCount:
        decision.reason === 'within-limit'
          ? execution.skipCount + 1
          : execution.skipCount,
      updatedAt: event.occurredAt,
    }
  } else {
    const scored = event.payload.result === 'scored'
    const disposition = resolveAttemptPlanDisposition(event)
    updated = {
      ...execution,
      status:
        disposition === 'retry-required' ? 'paused' : 'completed',
      completionKind:
        disposition === 'scored-completion'
          ? 'scored'
          : disposition === 'unscorable-practice-completion'
            ? 'unscorable-practice'
            : null,
      spentSeconds:
        execution.spentSeconds + Math.max(0, event.payload.durationSeconds),
      effectiveSeconds:
        execution.effectiveSeconds +
        (scored ? Math.max(0, event.payload.durationSeconds) : 0),
      updatedAt: event.occurredAt,
    }
  }

  const tasks = progress.tasks.map((entry, index) =>
    index === taskIndex ? updated : entry,
  )
  return {
    ...progress,
    status: derivePlanStatus(tasks),
    tasks,
    processedEventIds: [...progress.processedEventIds, event.id].slice(-500),
    updatedAt: event.occurredAt,
  }
}

function firstIncompleteTask(
  progress: PlanProgress,
): TaskExecutionState | undefined {
  const priority = ['active', 'paused', 'blocked', 'pending'] as const
  for (const status of priority) {
    const match = progress.tasks.find((task) => task.status === status)
    if (match !== undefined) {
      return match
    }
  }
  return undefined
}

export function getResumeDecision(
  progress: PlanProgress,
  currentLocalDate: string,
): ResumeDecision {
  assertLocalDate(currentLocalDate, 'currentLocalDate')
  if (progress.status === 'completed') {
    return {
      schemaVersion: 1,
      action: 'nothing-to-resume',
      nextTaskId: null,
      carryOverTasks: [],
      reason: 'plan-complete',
    }
  }

  const firstIncomplete = firstIncompleteTask(progress)
  if (firstIncomplete === undefined) {
    return {
      schemaVersion: 1,
      action: 'nothing-to-resume',
      nextTaskId: null,
      carryOverTasks: [],
      reason: 'no-incomplete-tasks',
    }
  }
  if (progress.plan.localDate === currentLocalDate) {
    return {
      schemaVersion: 1,
      action: 'resume-plan',
      nextTaskId: firstIncomplete.task.taskId,
      carryOverTasks: [],
      reason: 'same-day-incomplete',
    }
  }

  const carryOverTasks = progress.tasks
    .filter((execution) => {
      if (
        execution.status === 'completed' ||
        execution.status === 'skipped'
      ) {
        return false
      }
      if (
        execution.task.mode === 'review' ||
        execution.task.mode === 'retry'
      ) {
        return true
      }
      return (
        execution.status === 'active' ||
        execution.status === 'paused' ||
        execution.status === 'blocked'
      )
    })
    .map((execution) => execution.task)
  return {
    schemaVersion: 1,
    action: 'generate-new-plan',
    nextTaskId: null,
    carryOverTasks,
    reason: 'cross-day-carry-over',
  }
}

export function summarizePlanActivity(
  progress: PlanProgress,
): PlanActivitySummary {
  return {
    localDate: progress.plan.localDate,
    plannedSeconds: progress.plan.plannedSeconds,
    effectiveSeconds: progress.tasks.reduce(
      (total, task) => total + task.effectiveSeconds,
      0,
    ),
    completedTaskCount: progress.tasks.filter(
      (task) => task.status === 'completed',
    ).length,
    planCompleted: progress.status === 'completed',
  }
}
