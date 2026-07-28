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
import { getPlanTaskAccess } from './task-access.ts'
import { classifyTimingSegment } from './timing.ts'
import {
  appendCompletedStreamItem,
  initialTrainingTaskProgress,
  withBudgetAfterEffectiveTime,
} from './training-budget.ts'

function withOptionalTraining(
  execution: TaskExecutionState,
  training: TaskExecutionState['training'],
): TaskExecutionState {
  const { training: _discardedTraining, ...withoutTraining } = execution
  return training === undefined
    ? withoutTraining
    : { ...withoutTraining, training }
}

export function createPlanProgress(
  plan: PlanProgress['plan'],
  createdAt: string,
): PlanProgress {
  parseTimestamp(createdAt, 'createdAt')
  return {
    schemaVersion: 1,
    plan,
    status: 'not-started',
    tasks: plan.tasks.map((task) =>
      withOptionalTraining(
        {
          task,
          status: 'pending',
          completionKind: null,
          spentSeconds: 0,
          effectiveSeconds: 0,
          timingSegmentCount: 0,
          excludedSeconds: 0,
          effectiveTimeSource: null,
          skipCount: 0,
          startedAt: null,
          updatedAt: createdAt,
        },
        initialTrainingTaskProgress(task),
      ),
    ),
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
  if (
    (event.type === 'learning.task.started.v1' ||
      event.type === 'learning.attempt.completed.v1' ||
      event.type === 'learning.timing.segment.recorded.v1' ||
      event.type === 'learning.training.item.completed.v1' ||
      event.type === 'learning.training.content.exhausted.v1' ||
      event.type === 'learning.training.content.recovered.v1' ||
      event.type === 'learning.training.budget.completed.v1') &&
    event.payload.mode !== execution.task.mode
  ) {
    throw new TypeError('Event mode does not match scheduled task')
  }
  if (
    execution.status === 'completed' ||
    execution.status === 'skipped'
  ) {
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
    const hasTimingSegments = (execution.timingSegmentCount ?? 0) > 0
    updated = {
      ...execution,
      status: 'paused',
      spentSeconds:
        execution.spentSeconds +
        (hasTimingSegments
          ? 0
          : Math.max(0, event.payload.durationSeconds)),
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
  } else if (event.type === 'learning.timing.segment.recorded.v1') {
    const classification = classifyTimingSegment(event.payload)
    const effectiveSeconds =
      execution.effectiveSeconds + classification.effectiveSeconds
    updated = withOptionalTraining(
      {
        ...execution,
        status:
          classification.included && execution.status === 'pending'
            ? 'active'
            : execution.status,
        spentSeconds:
          execution.spentSeconds + event.payload.elapsedSeconds,
        effectiveSeconds,
        timingSegmentCount: (execution.timingSegmentCount ?? 0) + 1,
        excludedSeconds:
          (execution.excludedSeconds ?? 0) +
          classification.excludedSeconds,
        effectiveTimeSource: 'timing-segments',
        startedAt:
          classification.included
            ? execution.startedAt ?? event.payload.startedAt
            : execution.startedAt,
        updatedAt: event.occurredAt,
      },
      withBudgetAfterEffectiveTime(execution, effectiveSeconds),
    )
  } else if (event.type === 'learning.training.item.completed.v1') {
    if (execution.training === undefined) {
      throw new TypeError('Stream item event requires a training budget')
    }
    if (execution.training.status === 'content-exhausted') {
      throw new TypeError('Cannot complete an item after content exhaustion')
    }
    updated = {
      ...execution,
      status: execution.status === 'pending' ? 'active' : execution.status,
      training: appendCompletedStreamItem(
        execution.training,
        event.payload.item.itemId,
        event.payload.nextSupplyCursor,
      ),
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.training.content.exhausted.v1') {
    if (execution.training === undefined) {
      throw new TypeError('Content exhaustion event requires a training budget')
    }
    updated = {
      ...execution,
      status: 'blocked',
      training: {
        ...execution.training,
        status: 'content-exhausted',
        contentExhausted: {
          requestId: event.payload.requestId,
          cursor: event.payload.cursor,
          reason: event.payload.reason,
          occurredAt: event.occurredAt,
        },
      },
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.training.content.recovered.v1') {
    if (execution.training === undefined) {
      throw new TypeError('Content recovery event requires a training budget')
    }
    if (event.payload.localDate !== progress.plan.localDate) {
      throw new TypeError('Content recovery localDate does not match the plan')
    }
    if (
      execution.training.status !== 'content-exhausted' ||
      execution.training.contentExhausted === null
    ) {
      throw new TypeError('Content recovery requires a content-exhausted task')
    }
    if (
      execution.training.contentExhausted.requestId !==
      event.payload.exhaustionRequestId
    ) {
      throw new TypeError('Content recovery does not match the exhausted request')
    }
    updated = {
      ...execution,
      status: 'active',
      training: {
        ...execution.training,
        status:
          execution.training.remainingEffectiveSeconds === 0
            ? 'finish-current-item'
            : 'running',
        contentExhausted: null,
      },
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.training.budget.completed.v1') {
    if (execution.training === undefined) {
      throw new TypeError('Budget completion event requires a training budget')
    }
    if (execution.training.status !== 'finish-current-item') {
      throw new TypeError('Training budget has not reached its effective target')
    }
    if (
      execution.training.completedItemIds.length !==
        event.payload.completedItemCount ||
      !execution.training.completedItemIds.includes(
        event.payload.lastCompletedItemId,
      )
    ) {
      throw new TypeError('Budget completion does not match completed stream items')
    }
    updated = {
      ...execution,
      status: 'completed',
      completionKind: 'scored',
      training: {
        ...execution.training,
        status: 'completed',
        remainingEffectiveSeconds: 0,
      },
      updatedAt: event.occurredAt,
    }
  } else {
    const disposition = resolveAttemptPlanDisposition(event)
    const hasTimingSegments = (execution.timingSegmentCount ?? 0) > 0
    const legacyDuration = hasTimingSegments
      ? 0
      : Math.max(0, event.payload.durationSeconds)
    const streamTask = execution.training !== undefined
    const legacyEffectiveDuration =
      !streamTask && disposition === 'scored-completion' ? legacyDuration : 0
    const effectiveSeconds = execution.effectiveSeconds + legacyEffectiveDuration
    updated = withOptionalTraining(
      {
        ...execution,
        status:
          streamTask
            ? 'active'
            : disposition === 'retry-required'
              ? 'paused'
              : 'completed',
        completionKind:
          streamTask
            ? null
            : disposition === 'scored-completion'
            ? 'scored'
            : disposition === 'unscorable-practice-completion'
              ? 'unscorable-practice'
              : null,
        spentSeconds:
          execution.spentSeconds + legacyDuration,
        effectiveSeconds,
        effectiveTimeSource: hasTimingSegments
          ? 'timing-segments'
          : legacyEffectiveDuration > 0
            ? 'legacy-event-duration'
            : execution.effectiveTimeSource ?? null,
        updatedAt: event.occurredAt,
      },
      withBudgetAfterEffectiveTime(execution, effectiveSeconds),
    )
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
      recommendedTaskId: null,
      carryOverTasks: [],
      reason: 'plan-complete',
    }
  }

  const taskAccess = getPlanTaskAccess(progress)
  if (
    taskAccess.tasks.some(
      (task) => task.unavailableReason === 'invalid-task-data',
    )
  ) {
    throw new TypeError('PlanProgress contains invalid task data')
  }
  if (progress.tasks.some((task) => task.training?.status === 'content-exhausted')) {
    return {
      schemaVersion: 1,
      action: 'resume-plan',
      nextTaskId: null,
      recommendedTaskId: null,
      carryOverTasks: [],
      reason: 'content-exhausted',
    }
  }
  if (taskAccess.recommendedTaskId === null) {
    return {
      schemaVersion: 1,
      action: 'nothing-to-resume',
      nextTaskId: null,
      recommendedTaskId: null,
      carryOverTasks: [],
      reason: 'no-incomplete-tasks',
    }
  }
  if (progress.plan.localDate === currentLocalDate) {
    return {
      schemaVersion: 1,
      action: 'resume-plan',
      nextTaskId: taskAccess.recommendedTaskId,
      recommendedTaskId: taskAccess.recommendedTaskId,
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
    recommendedTaskId: null,
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
