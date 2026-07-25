import { describe, expect, it } from 'vitest'
import {
  createLearningEngineState,
  createPlanProgress,
  type DailyPlan,
} from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import {
  toDailyPlanViewModel,
  toProgressViewModel,
} from './view-model.ts'

function plan(): DailyPlan {
  return {
    schemaVersion: 1,
    planId: 'daily:2026-07-24:id-1',
    localDate: '2026-07-24',
    generatedAt: '2026-07-24T08:00:00.000Z',
    targetSeconds: 2_700,
    plannedSeconds: 2_700,
    unfilledSeconds: 0,
    status: 'ready',
    tasks: (
      ['vocabulary', 'listening', 'speaking'] as const
    ).map((domain, index) => ({
      schemaVersion: 1,
      taskId: `daily:2026-07-24:id-1:task:${index + 1}`,
      planId: 'daily:2026-07-24:id-1',
      sequence: index + 1,
      learningUnitId: `unit-${domain}`,
      contentRef: `lesson://course/1/day-1/${domain}`,
      domain,
      targetModuleId: domain,
      mode: 'learn',
      origin: 'new',
      difficultyLevel: 1,
      estimatedSeconds: 900,
      required: true,
      dueAt: null,
      skipLimit: 2,
      tags: ['day:1'],
    })),
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
    },
    warnings: [],
  }
}

describe('learning app view-model integration', () => {
  it('preserves task IDs and enables only the engine resume task', () => {
    const progress = createPlanProgress(
      plan(),
      '2026-07-24T08:00:00.000Z',
    )
    const engine = createLearningEngineState(
      abilityProfile(),
      '2026-07-24T08:00:00.000Z',
    )
    const resumeTaskId = progress.tasks[0].task.taskId

    const viewModel = toDailyPlanViewModel(
      progress,
      engine,
      resumeTaskId,
      '2026-07-24T08:00:00.000Z',
    )

    expect(viewModel.tasks.map((task) => task.id)).toEqual(
      progress.tasks.map((task) => task.task.taskId),
    )
    expect(viewModel.tasks[0].request.state).toBe('enabled')
    expect(viewModel.tasks[1].request.state).toBe('disabled')
    expect(viewModel.primaryAction).toMatchObject({
      state: 'enabled',
      taskId: resumeTaskId,
    })
  })

  it('derives progress display only from persisted engine activity', () => {
    const engine = createLearningEngineState(
      abilityProfile(),
      '2026-07-24T08:00:00.000Z',
    )
    const viewModel = toProgressViewModel({
      ...engine,
      progress: {
        ...engine.progress,
        dailyActivity: [
          {
            localDate: '2026-07-24',
            plannedSeconds: 2_700,
            effectiveSeconds: 1_200,
            completedTaskCount: 2,
            planCompleted: false,
            qualifiesForStreak: true,
          },
        ],
      },
    })

    expect(viewModel).toMatchObject({
      studyDays: '1',
      studyMinutes: '20',
      completedSessions: '2',
    })
  })
})
