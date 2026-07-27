import { describe, expect, it } from 'vitest'
import type {
  AbilityDomain,
  DailyPlan,
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTaskPausedEvent,
  LearningTaskSkippedEvent,
  LearningTaskStartedEvent,
  PlanProgress,
} from './contracts.ts'
import {
  applyPlanEvent,
  createPlanProgress,
  getResumeDecision,
  summarizePlanActivity,
} from './lifecycle.ts'
import {
  evaluatePlanTaskStart,
  getPlanTaskAccess,
} from './task-access.ts'

const DOMAINS: readonly AbilityDomain[] = [
  'vocabulary',
  'listening',
  'speaking',
]

function threeTaskPlan(): DailyPlan {
  const planId = 'daily:2026-07-27:r2'
  return {
    schemaVersion: 1,
    planId,
    localDate: '2026-07-27',
    generatedAt: '2026-07-27T08:00:00.000Z',
    targetSeconds: 900,
    plannedSeconds: 900,
    unfilledSeconds: 0,
    status: 'ready',
    tasks: DOMAINS.map((domain, index) => ({
      schemaVersion: 1,
      taskId: `${planId}:task:${index + 1}`,
      planId,
      sequence: index + 1,
      learningUnitId: `r2-${domain}`,
      contentRef: `lesson://r2/${domain}`,
      domain,
      targetModuleId: domain,
      mode: 'learn',
      origin: 'new',
      difficultyLevel: 3,
      estimatedSeconds: 300,
      required: true,
      dueAt: null,
      skipLimit: 2,
      tags: ['r2'],
    })),
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 300,
        plannedSeconds: 300,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 300,
        plannedSeconds: 300,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 300,
        plannedSeconds: 300,
      },
    },
    warnings: [],
  }
}

function initialProgress(): PlanProgress {
  const plan = threeTaskPlan()
  return createPlanProgress(plan, plan.generatedAt)
}

function taskFor(
  progress: PlanProgress,
  domain: AbilityDomain,
): LearningTask {
  const task = progress.plan.tasks.find(
    (candidate) => candidate.domain === domain,
  )
  if (task === undefined) {
    throw new Error(`Missing ${domain} task`)
  }
  return task
}

function eventTime(index: number): string {
  return `2026-07-27T08:${String(index).padStart(2, '0')}:00.000Z`
}

function startedEvent(
  task: LearningTask,
  id: string,
  timeIndex = 1,
): LearningTaskStartedEvent {
  return {
    id,
    type: 'learning.task.started.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(timeIndex),
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-27',
      mode: task.mode,
    },
  }
}

function pausedEvent(
  task: LearningTask,
  id: string,
  timeIndex = 2,
): LearningTaskPausedEvent {
  return {
    id,
    type: 'learning.task.paused.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(timeIndex),
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-27',
      reason: 'user-paused',
      durationSeconds: 30,
    },
  }
}

function completedEvent(
  task: LearningTask,
  id: string,
  timeIndex = 3,
): LearningAttemptCompletedEvent {
  return {
    id,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(timeIndex),
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-27',
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'scored',
      performanceScore: 0.8,
      evidenceQuality: 1,
      assistanceLevel: 0,
      durationSeconds: 120,
      taskCompleted: true,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: null,
    },
  }
}

function skippedEvent(
  task: LearningTask,
  id: string,
): LearningTaskSkippedEvent {
  return {
    id,
    type: 'learning.task.skipped.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(4),
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-27',
      reason: 'user-skipped',
    },
  }
}

const COMPLETION_ORDERS: readonly (readonly [
  AbilityDomain,
  AbilityDomain,
  AbilityDomain,
])[] = [
  ['vocabulary', 'listening', 'speaking'],
  ['vocabulary', 'speaking', 'listening'],
  ['listening', 'vocabulary', 'speaking'],
  ['listening', 'speaking', 'vocabulary'],
  ['speaking', 'vocabulary', 'listening'],
  ['speaking', 'listening', 'vocabulary'],
]

describe('R2 plan task access', () => {
  it('makes vocabulary, listening, and speaking independently startable', () => {
    const initial = initialProgress()
    const access = getPlanTaskAccess(initial)

    expect(access.startableTaskIds).toEqual(
      initial.plan.tasks.map((task) => task.taskId),
    )
    expect(access.tasks).toHaveLength(3)
    expect(
      access.tasks.every(
        (task) =>
          task.availability === 'startable' &&
          task.unavailableReason === null,
      ),
    ).toBe(true)
    expect(
      access.tasks.filter((task) => task.recommended),
    ).toHaveLength(1)
    expect(access.recommendedTaskId).toBe(
      initial.plan.tasks[0].taskId,
    )

    for (const domain of DOMAINS) {
      const fresh = initialProgress()
      const task = taskFor(fresh, domain)
      const started = applyPlanEvent(
        fresh,
        startedEvent(task, `start-with-${domain}`),
      )

      expect(
        started.tasks.find(
          (execution) => execution.task.taskId === task.taskId,
        )?.status,
      ).toBe('active')
      expect(getPlanTaskAccess(started).startableTaskIds).toHaveLength(3)
    }
  })

  it.each(COMPLETION_ORDERS)(
    'accepts the completion order %s → %s → %s',
    (first, second, third) => {
      const order = [first, second, third]
      let progress = initialProgress()

      order.forEach((domain, index) => {
        const task = taskFor(progress, domain)
        const before = getPlanTaskAccess(progress)
        expect(before.startableTaskIds).toContain(task.taskId)

        progress = applyPlanEvent(
          progress,
          startedEvent(
            task,
            `started-${domain}-${index}`,
            index * 2 + 1,
          ),
        )
        progress = applyPlanEvent(
          progress,
          completedEvent(
            task,
            `completed-${domain}-${index}`,
            index * 2 + 2,
          ),
        )

        const summary = summarizePlanActivity(progress)
        expect(summary.completedTaskCount).toBe(index + 1)
        expect(summary.planCompleted).toBe(index === 2)
        const access = getPlanTaskAccess(progress)
        expect(access.startableTaskIds).not.toContain(task.taskId)
        expect(access.startableTaskIds).toHaveLength(2 - index)
        expect(
          access.tasks.find(
            (availability) => availability.taskId === task.taskId,
          ),
        ).toMatchObject({
          availability: 'unavailable',
          unavailableReason: 'task-finished',
          taskStatus: 'completed',
        })
      })

      expect(progress.status).toBe('completed')
      expect(progress.tasks.map((task) => task.status)).toEqual([
        'completed',
        'completed',
        'completed',
      ])
      expect(summarizePlanActivity(progress)).toMatchObject({
        completedTaskCount: 3,
        planCompleted: true,
      })
    },
  )

  it('recommends an interrupted task without locking other tasks', () => {
    let progress = initialProgress()
    const listening = taskFor(progress, 'listening')
    const speaking = taskFor(progress, 'speaking')
    progress = applyPlanEvent(
      progress,
      startedEvent(listening, 'listening-started'),
    )
    progress = applyPlanEvent(
      progress,
      pausedEvent(listening, 'listening-paused'),
    )

    const interrupted = getPlanTaskAccess(progress)
    expect(interrupted.recommendedTaskId).toBe(listening.taskId)
    expect(interrupted.startableTaskIds).toEqual(
      progress.plan.tasks.map((task) => task.taskId),
    )
    expect(evaluatePlanTaskStart(progress, speaking.taskId)).toMatchObject({
      availability: 'startable',
      recommended: false,
      unavailableReason: null,
    })

    const startedElsewhere = applyPlanEvent(
      progress,
      startedEvent(speaking, 'speaking-started'),
    )
    expect(
      startedElsewhere.tasks.find(
        (execution) => execution.task.taskId === speaking.taskId,
      )?.status,
    ).toBe('active')
  })

  it('keeps completion idempotent and never reopens terminal tasks', () => {
    const initial = initialProgress()
    const speaking = taskFor(initial, 'speaking')
    const completion = completedEvent(
      speaking,
      'speaking-completed',
    )
    const completed = applyPlanEvent(initial, completion)

    expect(applyPlanEvent(completed, completion)).toBe(completed)
    expect(
      applyPlanEvent(
        completed,
        completedEvent(speaking, 'speaking-completed-again'),
      ),
    ).toBe(completed)

    const vocabulary = taskFor(completed, 'vocabulary')
    const skipped = applyPlanEvent(
      completed,
      skippedEvent(vocabulary, 'vocabulary-skipped'),
    )
    expect(
      applyPlanEvent(
        skipped,
        startedEvent(vocabulary, 'reopen-skipped'),
      ),
    ).toBe(skipped)
  })

  it('derives stable access after refresh from an old schema 1 plan', () => {
    let legacyProgress = initialProgress()
    const listening = taskFor(legacyProgress, 'listening')
    legacyProgress = applyPlanEvent(
      legacyProgress,
      completedEvent(listening, 'legacy-listening-completed'),
    )

    const restored = structuredClone(legacyProgress)
    const access = getPlanTaskAccess(restored)
    const resume = getResumeDecision(restored, '2026-07-27')

    expect(access.startableTaskIds).toEqual([
      taskFor(restored, 'vocabulary').taskId,
      taskFor(restored, 'speaking').taskId,
    ])
    expect(access.recommendedTaskId).toBe(
      taskFor(restored, 'vocabulary').taskId,
    )
    expect(resume).toMatchObject({
      action: 'resume-plan',
      nextTaskId: access.recommendedTaskId,
      recommendedTaskId: access.recommendedTaskId,
    })
    expect(JSON.stringify(restored)).not.toContain(
      'recommendedTaskId',
    )
  })

  it('reports only true missing, finished, or invalid-data unavailability', () => {
    const progress = initialProgress()
    expect(
      evaluatePlanTaskStart(progress, 'missing-task'),
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'not-in-active-plan',
    })

    const vocabulary = taskFor(progress, 'vocabulary')
    const completed = applyPlanEvent(
      progress,
      completedEvent(vocabulary, 'vocabulary-completed'),
    )
    expect(
      evaluatePlanTaskStart(completed, vocabulary.taskId),
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'task-finished',
    })

    const corrupted: PlanProgress = {
      ...progress,
      tasks: progress.tasks.map((execution) =>
        execution.task.taskId === vocabulary.taskId
          ? {
              ...execution,
              task: {
                ...execution.task,
                contentRef: 'lesson://corrupted',
              },
            }
          : execution,
      ),
    }
    expect(
      evaluatePlanTaskStart(corrupted, vocabulary.taskId),
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'invalid-task-data',
    })
    expect(JSON.stringify(getPlanTaskAccess(progress))).not.toMatch(
      /not-yet|next-only|尚未轮到|前一任务/u,
    )
  })
})
