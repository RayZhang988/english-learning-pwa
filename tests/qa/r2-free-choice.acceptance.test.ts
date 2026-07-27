import { describe, expect, it } from 'vitest'
import {
  applyPlanEvent,
  createPlanProgress,
  evaluatePlanTaskStart,
  getPlanTaskAccess,
  getResumeDecision,
  summarizePlanActivity,
  type AbilityDomain,
  type DailyPlan,
  type LearningAttemptCompletedEvent,
  type LearningTask,
  type LearningTaskPausedEvent,
  type LearningTaskStartedEvent,
  type PlanProgress,
} from '../../src/learning-engine/index.ts'
import {
  toPracticeModulesViewModel,
} from '../../src/app/learning/view-model.ts'

const DOMAINS = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly AbilityDomain[]

const COMPLETION_ORDERS = [
  ['vocabulary', 'listening', 'speaking'],
  ['vocabulary', 'speaking', 'listening'],
  ['listening', 'vocabulary', 'speaking'],
  ['listening', 'speaking', 'vocabulary'],
  ['speaking', 'vocabulary', 'listening'],
  ['speaking', 'listening', 'vocabulary'],
] as const satisfies readonly (
  readonly [AbilityDomain, AbilityDomain, AbilityDomain]
)[]

function planFixture(): DailyPlan {
  const planId = 'qa-r2:2026-07-27'
  return {
    schemaVersion: 1,
    planId,
    localDate: '2026-07-27',
    generatedAt: '2026-07-27T08:00:00.000Z',
    targetSeconds: 2_700,
    plannedSeconds: 2_700,
    unfilledSeconds: 0,
    status: 'ready',
    tasks: DOMAINS.map((domain, index) => ({
      schemaVersion: 1,
      taskId: `${planId}:task:${domain}`,
      planId,
      sequence: index + 1,
      learningUnitId: `qa-r2-${domain}`,
      contentRef: `lesson://qa-r2/${domain}`,
      domain,
      targetModuleId: domain,
      mode: 'learn',
      origin: 'new',
      difficultyLevel: 3,
      estimatedSeconds: 900,
      required: true,
      dueAt: null,
      skipLimit: 2,
      tags: ['qa-r2'],
    })),
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
    },
    warnings: [],
  }
}

function initialProgress(): PlanProgress {
  const plan = planFixture()
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
    throw new Error(`Missing ${domain} task fixture.`)
  }
  return task
}

function eventTime(index: number): string {
  return `2026-07-27T08:${String(index).padStart(2, '0')}:00.000Z`
}

function startedEvent(
  task: LearningTask,
  id: string,
  index = 1,
): LearningTaskStartedEvent {
  return {
    id,
    type: 'learning.task.started.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(index),
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
  index = 2,
): LearningTaskPausedEvent {
  return {
    id,
    type: 'learning.task.paused.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(index),
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
  index = 3,
): LearningAttemptCompletedEvent {
  return {
    id,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: eventTime(index),
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

describe('R2 daily-task free-choice acceptance', () => {
  it('keeps Today and Training aligned on three real, independent taskIds', () => {
    const progress = initialProgress()
    const access = getPlanTaskAccess(progress)
    const practice = toPracticeModulesViewModel(progress, access)
      .filter((module) => module.moduleId !== 'assessment')

    expect(access.startableTaskIds).toEqual(
      progress.plan.tasks.map((task) => task.taskId),
    )
    expect(new Set(access.startableTaskIds)).toHaveLength(3)
    expect(access.tasks.filter((task) => task.recommended)).toHaveLength(1)
    expect(practice).toHaveLength(3)

    for (const domain of DOMAINS) {
      const task = taskFor(progress, domain)
      const todayAccess = access.tasks.find(
        (candidate) => candidate.taskId === task.taskId,
      )
      const trainingAccess = practice.find(
        (candidate) => candidate.moduleId === domain,
      )
      expect(todayAccess).toMatchObject({
        availability: 'startable',
        targetModuleId: domain,
        unavailableReason: null,
      })
      expect(trainingAccess).toMatchObject({
        availability: 'startable',
        moduleId: domain,
        taskId: task.taskId,
      })
    }

    expect(JSON.stringify({ access, practice })).not.toMatch(
      /尚未轮到|前一任务|next-only|primaryAction|resumeTaskId/u,
    )
  })

  it.each(COMPLETION_ORDERS)(
    'reaches the same 3/3 terminal state for %s → %s → %s',
    (first, second, third) => {
      const order = [first, second, third]
      let progress = initialProgress()

      order.forEach((domain, index) => {
        const task = taskFor(progress, domain)
        expect(
          evaluatePlanTaskStart(progress, task.taskId),
        ).toMatchObject({
          availability: 'startable',
          targetModuleId: domain,
        })
        progress = applyPlanEvent(
          progress,
          startedEvent(task, `qa-start-${domain}-${index}`, index * 2 + 1),
        )
        progress = applyPlanEvent(
          progress,
          completedEvent(
            task,
            `qa-complete-${domain}-${index}`,
            index * 2 + 2,
          ),
        )

        const summary = summarizePlanActivity(progress)
        expect(summary.completedTaskCount).toBe(index + 1)
        expect(summary.planCompleted).toBe(index === 2)
        expect(
          evaluatePlanTaskStart(progress, task.taskId),
        ).toMatchObject({
          availability: 'unavailable',
          unavailableReason: 'task-finished',
          taskStatus: 'completed',
        })
        expect(getPlanTaskAccess(progress).startableTaskIds).toHaveLength(
          2 - index,
        )
      })

      expect(progress.status).toBe('completed')
      expect(progress.tasks).toEqual(
        expect.arrayContaining(
          DOMAINS.map((domain) =>
            expect.objectContaining({
              task: expect.objectContaining({ domain }),
              status: 'completed',
            }),
          ),
        ),
      )
    },
  )

  it('recommends a paused task without locking either alternative', () => {
    let progress = initialProgress()
    const listening = taskFor(progress, 'listening')
    progress = applyPlanEvent(
      progress,
      startedEvent(listening, 'qa-listening-started'),
    )
    progress = applyPlanEvent(
      progress,
      pausedEvent(listening, 'qa-listening-paused'),
    )

    const access = getPlanTaskAccess(progress)
    expect(access.recommendedTaskId).toBe(listening.taskId)
    expect(access.startableTaskIds).toHaveLength(3)
    expect(
      access.tasks.filter(
        (task) =>
          task.taskId !== listening.taskId &&
          task.availability === 'startable' &&
          task.recommended === false,
      ),
    ).toHaveLength(2)
  })

  it('restores old schema 1 progress and derives access without persisting recommendations', () => {
    const progress = initialProgress()
    const listening = taskFor(progress, 'listening')
    const completed = applyPlanEvent(
      progress,
      completedEvent(listening, 'qa-legacy-listening-complete'),
    )
    const restored = structuredClone(completed)

    expect(restored.schemaVersion).toBe(1)
    expect(JSON.stringify(restored)).not.toContain('recommendedTaskId')
    expect(getPlanTaskAccess(restored).startableTaskIds).toEqual([
      taskFor(restored, 'vocabulary').taskId,
      taskFor(restored, 'speaking').taskId,
    ])
    expect(getResumeDecision(restored, '2026-07-27')).toMatchObject({
      action: 'resume-plan',
      recommendedTaskId: taskFor(restored, 'vocabulary').taskId,
      nextTaskId: taskFor(restored, 'vocabulary').taskId,
    })
  })

  it('refuses missing, finished, and identity-corrupted taskIds honestly', () => {
    const progress = initialProgress()
    const vocabulary = taskFor(progress, 'vocabulary')
    const completed = applyPlanEvent(
      progress,
      completedEvent(vocabulary, 'qa-vocabulary-complete'),
    )
    const corrupted: PlanProgress = {
      ...progress,
      tasks: progress.tasks.map((execution) =>
        execution.task.taskId === vocabulary.taskId
          ? {
              ...execution,
              task: {
                ...execution.task,
                contentRef: 'lesson://qa-r2/corrupted',
              },
            }
          : execution,
      ),
    }

    expect(evaluatePlanTaskStart(progress, 'missing-task')).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'not-in-active-plan',
    })
    expect(
      evaluatePlanTaskStart(completed, vocabulary.taskId),
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'task-finished',
    })
    expect(
      evaluatePlanTaskStart(corrupted, vocabulary.taskId),
    ).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'invalid-task-data',
    })
  })
})
