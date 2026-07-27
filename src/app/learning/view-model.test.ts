import { describe, expect, it } from 'vitest'
import {
  createLearningEngineState,
  createPlanProgress,
  getPlanTaskAccess,
  type DailyPlan,
  type PlanProgress,
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

function progress(): PlanProgress {
  return createPlanProgress(
    plan(),
    '2026-07-24T08:00:00.000Z',
  )
}

function engine() {
  return createLearningEngineState(
    abilityProfile(),
    '2026-07-24T08:00:00.000Z',
  )
}

describe('learning app view-model integration', () => {
  it('maps all three Today tasks as startable with their own exact task ids', () => {
    const activePlan = progress()
    const taskAccess = getPlanTaskAccess(activePlan)

    const viewModel = toDailyPlanViewModel(
      activePlan,
      engine(),
      taskAccess,
      '2026-07-24T08:00:00.000Z',
    )

    expect(viewModel.tasks.map((task) => task.taskId)).toEqual(
      activePlan.tasks.map((task) => task.task.taskId),
    )
    expect(
      viewModel.tasks.map((task) => task.availability),
    ).toEqual(['startable', 'startable', 'startable'])
    expect(
      viewModel.tasks.filter(
        (task) =>
          task.availability === 'startable' && task.recommended,
      ),
    ).toHaveLength(1)
    expect(JSON.stringify(viewModel)).not.toMatch(
      /primaryAction|尚未轮到|完成当前任务后/u,
    )
  })

  it('uses the same task access and exact ids for Today and Practice', () => {
    const activePlan = progress()
    const taskAccess = getPlanTaskAccess(activePlan)
    const today = toDailyPlanViewModel(
      activePlan,
      engine(),
      taskAccess,
      '2026-07-24T08:00:00.000Z',
    )
    const modules = toPracticeModulesViewModel(
      activePlan,
      taskAccess,
    )

    for (const todayTask of today.tasks) {
      const module = modules.find(
        (candidate) =>
          candidate.moduleId === todayTask.moduleId,
      )
      expect(module).toMatchObject({
        availability: todayTask.availability,
        taskId: todayTask.taskId,
        recommended: todayTask.recommended,
      })
    }
  })

  it('keeps unfinished tasks startable after another task completes', () => {
    const initial = progress()
    const activePlan: PlanProgress = {
      ...initial,
      status: 'in-progress',
      tasks: initial.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              status: 'completed',
              completionKind: 'scored',
            }
          : task,
      ),
    }
    const taskAccess = getPlanTaskAccess(activePlan)
    const today = toDailyPlanViewModel(
      activePlan,
      engine(),
      taskAccess,
      '2026-07-24T08:00:00.000Z',
    )

    expect(today.tasks[0]).toMatchObject({
      availability: 'unavailable',
      taskId: activePlan.tasks[0].task.taskId,
      status: 'completed',
      unavailableReason: 'task-finished',
      unavailableDescription: '今天的词汇训练任务已经完成。',
    })
    expect(today.tasks.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: 'listening',
          availability: 'startable',
          taskId: activePlan.tasks[1].task.taskId,
        }),
        expect.objectContaining({
          moduleId: 'speaking',
          availability: 'startable',
          taskId: activePlan.tasks[2].task.taskId,
        }),
      ]),
    )
  })

  it('derives progress display only from persisted engine activity', () => {
    const currentEngine = engine()
    const viewModel = toProgressViewModel({
      ...currentEngine,
      progress: {
        ...currentEngine.progress,
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

  it('maps all four Practice cards without placeholder content', () => {
    const activePlan = progress()
    const modules = toPracticeModulesViewModel(
      activePlan,
      getPlanTaskAccess(activePlan),
    )

    expect(modules.map((module) => module.moduleId)).toEqual([
      'assessment',
      'vocabulary',
      'listening',
      'speaking',
    ])
    expect(modules[0]).toEqual({
      moduleId: 'assessment',
      request: {
        state: 'enabled',
        label: '查看测试结果',
      },
    })
    expect(
      modules.slice(1).every(
        (module) =>
          module.moduleId !== 'assessment' &&
          module.availability === 'startable',
      ),
    ).toBe(true)
    expect(JSON.stringify(modules)).not.toMatch(
      /尚未轮到|尚未接入|暂无可用训练|训练内容接入后/u,
    )
  })

  it('labels a legacy profile as a new R1 test instead of a completed R1 result', () => {
    const activePlan = progress()

    const modules = toPracticeModulesViewModel(
      activePlan,
      getPlanTaskAccess(activePlan),
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

  it('disables completed, skipped, missing, and malformed tasks with honest reasons', () => {
    const initial = progress()
    const terminal: PlanProgress = {
      ...initial,
      plan: {
        ...initial.plan,
        tasks: initial.plan.tasks.slice(0, 2),
      },
      status: 'completed',
      tasks: [
        {
          ...initial.tasks[0],
          status: 'completed',
          completionKind: 'scored',
        },
        {
          ...initial.tasks[1],
          status: 'skipped',
        },
      ],
    }
    const terminalModules = toPracticeModulesViewModel(
      terminal,
      getPlanTaskAccess(terminal),
    )

    expect(
      terminalModules.find(
        (module) => module.moduleId === 'vocabulary',
      ),
    ).toMatchObject({
      availability: 'unavailable',
      taskId: terminal.tasks[0].task.taskId,
      statusLabel: '已完成',
      unavailableReason: 'task-finished',
      unavailableDescription: '今天的词汇训练任务已经完成。',
    })
    expect(
      terminalModules.find(
        (module) => module.moduleId === 'listening',
      ),
    ).toMatchObject({
      availability: 'unavailable',
      taskId: terminal.tasks[1].task.taskId,
      statusLabel: '已跳过',
      unavailableReason: 'task-finished',
      unavailableDescription:
        '今天的听力训练任务已从计划中跳过。',
    })
    expect(
      terminalModules.find(
        (module) => module.moduleId === 'speaking',
      ),
    ).toMatchObject({
      availability: 'unavailable',
      taskId: null,
      statusLabel: '今日无任务',
      unavailableReason: 'not-in-active-plan',
      unavailableDescription: '当前计划没有口语训练任务。',
    })

    const malformed: PlanProgress = {
      ...initial,
      tasks: initial.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              task: {
                ...task.task,
                contentRef: 'lesson://wrong/content',
              },
            }
          : task,
      ),
    }
    const malformedModules = toPracticeModulesViewModel(
      malformed,
      getPlanTaskAccess(malformed),
    )
    expect(
      malformedModules.find(
        (module) => module.moduleId === 'vocabulary',
      ),
    ).toMatchObject({
      availability: 'unavailable',
      statusLabel: '任务异常',
      unavailableReason: 'invalid-task-data',
    })
  })
})
