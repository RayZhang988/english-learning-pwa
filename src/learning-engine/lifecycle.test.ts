import { describe, expect, it } from 'vitest'
import type {
  LearningTaskStartedEvent,
  ReviewItemState,
  SkipHistoryEntry,
} from './contracts.ts'
import {
  applyPlanEvent,
  createPlanProgress,
  evaluateTaskSkip,
  getResumeDecision,
} from './lifecycle.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'

function dueReviewItem(): ReviewItemState {
  return {
    schemaVersion: 1,
    learningUnitId: 'review-1',
    contentRef: 'lesson://vocabulary/review-1',
    domain: 'vocabulary',
    difficultyLevel: 5,
    estimatedSeconds: 180,
    memoryDifficulty: 0.5,
    mastery: 0.6,
    stabilityDays: 2,
    successfulReviews: 2,
    lapseCount: 0,
    attemptCount: 2,
    lastAttemptAt: '2026-07-01T00:00:00.000Z',
    lastSuccessfulAt: '2026-07-01T00:00:00.000Z',
    nextReviewAt: '2026-07-02T00:00:00.000Z',
    retryAt: null,
    status: 'reviewing',
    tags: [],
  }
}

describe('plan lifecycle', () => {
  it('resumes the active task on the same day and carries only durable work across days', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const plan = generateDailyPlan({
      planId: 'plan-resume',
      generatedAt: '2026-07-03T00:00:00.000Z',
      localDate: '2026-07-03',
      availableSeconds: 900,
      progress,
      reviewItems: { 'review-1': dueReviewItem() },
      candidates: [
        learningCandidate('vocabulary', 1),
        learningCandidate('listening', 1),
        learningCandidate('speaking', 1),
        learningCandidate('speaking', 2),
      ],
    })
    const newTask = plan.tasks.find((task) => task.origin === 'new')!
    const startedEvent: LearningTaskStartedEvent = {
      id: 'started-1',
      type: 'learning.task.started.v1',
      sourceModuleId: newTask.targetModuleId,
      occurredAt: '2026-07-03T00:05:00.000Z',
      schemaVersion: 1,
      payload: {
        planId: plan.planId,
        taskId: newTask.taskId,
        learningUnitId: newTask.learningUnitId,
        contentRef: newTask.contentRef,
        domain: newTask.domain,
        targetModuleId: newTask.targetModuleId,
        localDate: plan.localDate,
        mode: newTask.mode,
      },
    }
    const running = applyPlanEvent(
      createPlanProgress(plan, plan.generatedAt),
      startedEvent,
    )
    expect(applyPlanEvent(running, startedEvent)).toBe(running)

    expect(getResumeDecision(running, '2026-07-03')).toMatchObject({
      action: 'resume-plan',
      nextTaskId: newTask.taskId,
    })

    const nextDay = getResumeDecision(running, '2026-07-04')
    expect(nextDay.action).toBe('generate-new-plan')
    expect(
      nextDay.carryOverTasks.map((task) => task.learningUnitId),
    ).toContain('review-1')
    expect(
      nextDay.carryOverTasks.map((task) => task.learningUnitId),
    ).toContain(newTask.learningUnitId)
    expect(
      nextDay.carryOverTasks.filter(
        (task) => task.origin === 'new' && task.taskId !== newTask.taskId,
      ),
    ).toEqual([])
  })

  it('blocks retry skips and enforces the seven-day new-task limit', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const plan = generateDailyPlan({
      planId: 'plan-skip',
      generatedAt: '2026-07-07T00:00:00.000Z',
      localDate: '2026-07-07',
      availableSeconds: 600,
      progress,
      reviewItems: {},
      candidates: [
        learningCandidate('vocabulary', 1),
        learningCandidate('listening', 1),
        learningCandidate('speaking', 1),
      ],
    })
    const newTask = plan.tasks[0]
    const history: readonly SkipHistoryEntry[] = [
      {
        learningUnitId: newTask.learningUnitId,
        localDate: '2026-07-02',
        reason: 'user-skipped',
      },
      {
        learningUnitId: newTask.learningUnitId,
        localDate: '2026-07-05',
        reason: 'time-budget-ended',
      },
    ]
    expect(
      evaluateTaskSkip(
        newTask,
        history,
        '2026-07-07',
        'user-skipped',
      ),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'blocked',
      reason: 'skip-limit-reached',
    })

    const retryTask = { ...newTask, mode: 'retry' as const, skipLimit: 0 }
    expect(
      evaluateTaskSkip(
        retryTask,
        [],
        '2026-07-07',
        'user-skipped',
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'retry-must-be-retained',
    })
    expect(
      evaluateTaskSkip(
        retryTask,
        [],
        '2026-07-07',
        'device-failure',
      ),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'paused',
      reason: 'non-user-failure-retained',
    })
  })
})
