import { describe, expect, it } from 'vitest'
import {
  createLearningEngineState,
  createPlanProgress,
  type DailyPlan,
} from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import {
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
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

  it('maps all four practice cards and preserves each exact current task id', () => {
    const progress = createPlanProgress(
      plan(),
      '2026-07-24T08:00:00.000Z',
    )

    for (const current of progress.tasks) {
      const modules = toPracticeModulesViewModel(
        progress,
        current.task.taskId,
      )
      const assessment = modules[0]
      const specialty = modules.find(
        (module) =>
          module.moduleId === current.task.targetModuleId,
      )

      expect(modules.map((module) => module.moduleId)).toEqual([
        'assessment',
        'vocabulary',
        'listening',
        'speaking',
      ])
      expect(assessment).toEqual({
        moduleId: 'assessment',
        request: {
          state: 'enabled',
          label: '查看测试结果',
        },
      })
      expect(specialty?.request).toEqual({
        state: 'enabled',
        label: '进入训练',
        taskId: current.task.taskId,
      })
      expect(JSON.stringify(modules)).not.toMatch(
        /尚未接入|暂无可用训练|训练内容接入后/u,
      )
    }
  })

  it('labels a legacy profile as a new R1 test instead of a completed R1 result', () => {
    const progress = createPlanProgress(
      plan(),
      '2026-07-24T08:00:00.000Z',
    )

    const modules = toPracticeModulesViewModel(
      progress,
      progress.tasks[0].task.taskId,
      1,
    )

    expect(modules[0]).toEqual({
      moduleId: 'assessment',
      request: {
        state: 'enabled',
        label: '开始 R1 词汇测试',
      },
    })
  })

  it('disables locked, completed, skipped, and missing practice tasks with accurate reasons', () => {
    const progress = createPlanProgress(
      plan(),
      '2026-07-24T08:00:00.000Z',
    )
    const mapped = {
      ...progress,
      tasks: [
        {
          ...progress.tasks[0],
          status: 'completed' as const,
        },
        {
          ...progress.tasks[1],
          status: 'skipped' as const,
        },
      ],
    }

    const modules = toPracticeModulesViewModel(mapped, null)
    const vocabulary = modules.find(
      (module) => module.moduleId === 'vocabulary',
    )
    const listening = modules.find(
      (module) => module.moduleId === 'listening',
    )
    const speaking = modules.find(
      (module) => module.moduleId === 'speaking',
    )

    expect(vocabulary?.request).toEqual({
      state: 'disabled',
      label: '已完成',
      reason: '今天的词汇训练任务已经完成。',
    })
    expect(listening?.request).toEqual({
      state: 'disabled',
      label: '已跳过',
      reason: '今天的听力训练任务已从计划中跳过。',
    })
    expect(speaking?.request).toEqual({
      state: 'disabled',
      label: '今日无任务',
      reason: '当前没有可执行的口语训练任务。',
    })

    const locked = toPracticeModulesViewModel(progress, null)
    for (const module of locked.slice(1)) {
      expect(module.request).toMatchObject({
        state: 'disabled',
        label: '稍后开始',
      })
      expect(
        module.request.state === 'disabled'
          ? module.request.reason
          : '',
      ).toContain('尚未轮到')
    }
  })
})
