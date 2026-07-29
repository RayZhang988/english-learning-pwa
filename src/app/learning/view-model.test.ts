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
  toActualEffectiveDurationViewModel,
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
  toProgressViewModel,
  toTaskDurationEstimateViewModel,
  toTrainingBudgetProgressViewModel,
  toTrainingCompletionDurationViewModel,
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
      trainingBudget: {
        schemaVersion: 1,
        targetEffectiveSeconds: 900,
      },
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
    expect(viewModel.planTargetLabel).toBe(
      '今日目标约 45 分钟 · 3 项训练',
    )
    expect(
      viewModel.tasks.map((task) => task.contentSummary),
    ).toEqual(['新内容', '新内容', '新内容'])
    expect(
      viewModel.tasks.map((task) =>
        task.availability === 'startable'
          ? task.trainingBudget
          : null,
      ),
    ).toEqual([
      {
        targetEffectiveSeconds: 900,
      },
      {
        targetEffectiveSeconds: 900,
      },
      {
        targetEffectiveSeconds: 900,
      },
    ])
    expect(viewModel).not.toHaveProperty('summary')
    for (const task of viewModel.tasks) {
      expect(task).not.toHaveProperty('meta')
    }
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
      if (
        module?.moduleId !== 'assessment' &&
        module?.availability === 'startable' &&
        todayTask.availability === 'startable'
      ) {
        expect(module.trainingBudget).toEqual(
          todayTask.trainingBudget,
        )
      }
    }
  })

  it('copies a personal estimate without using plan allocation as a task estimate', () => {
    const initial = progress()
    const {
      trainingBudget: _trainingBudget,
      ...legacyTask
    } = initial.plan.tasks[0]
    const personalizedTask = {
      ...legacyTask,
      estimatedSeconds: 137,
      durationEstimate: {
        schemaVersion: 1 as const,
        estimateSeconds: 137,
        basis: 'personal-history' as const,
        sampleCount: 3,
        confidence: 'medium' as const,
        contentType: 'vocabulary-choice',
        profileKey: 'vocabulary:learn:vocabulary-choice',
        baselineSource: 'structured-content' as const,
        reasonableRangeSeconds: {
          lower: 100,
          upper: 180,
        },
      },
    }
    const activePlan: PlanProgress = {
      ...initial,
      plan: {
        ...initial.plan,
        plannedSeconds: 9_999,
        allocations: {
          ...initial.plan.allocations,
          vocabulary: {
            ...initial.plan.allocations.vocabulary,
            plannedSeconds: 8_888,
          },
        },
        tasks: [
          personalizedTask,
          ...initial.plan.tasks.slice(1),
        ],
      },
      tasks: [
        {
          ...initial.tasks[0],
          task: personalizedTask,
        },
        ...initial.tasks.slice(1),
      ],
    }
    const access = getPlanTaskAccess(activePlan)
    const today = toDailyPlanViewModel(
      activePlan,
      engine(),
      access,
      '2026-07-24T08:00:00.000Z',
    )
    const practice = toPracticeModulesViewModel(activePlan, access)

    expect(toTaskDurationEstimateViewModel(personalizedTask)).toEqual({
      estimateSeconds: 137,
      basis: 'personal-history',
      sampleCount: 3,
      confidence: 'medium',
    })
    expect(today.tasks[0]).toMatchObject({
      durationEstimate: {
        estimateSeconds: 137,
        basis: 'personal-history',
        sampleCount: 3,
        confidence: 'medium',
      },
    })
    expect(practice[1]).toMatchObject({
      durationEstimate: {
        estimateSeconds: 137,
        basis: 'personal-history',
      },
    })
    expect(JSON.stringify(today.tasks[0])).not.toContain('8888')
    expect(JSON.stringify(today.tasks[0])).not.toContain('9999')
  })

  it('maps the restored training budget without treating it as an estimate', () => {
    const activePlan = progress()
    const execution = {
      ...activePlan.tasks[0],
      status: 'blocked' as const,
      training: {
        ...activePlan.tasks[0].training!,
        remainingEffectiveSeconds: 517,
        status: 'content-exhausted' as const,
        completedItemIds: ['item-1', 'item-2'],
        nextSupplyCursor: 'item-2',
        contentExhausted: {
          requestId: 'supply-3',
          cursor: 'item-2',
          reason: 'all-eligible-content-recently-used' as const,
          occurredAt: '2026-07-24T08:10:00.000Z',
        },
      },
    }

    expect(
      toTrainingBudgetProgressViewModel(execution),
    ).toEqual({
      targetEffectiveSeconds: 900,
      remainingEffectiveSeconds: 517,
      completedItemCount: 2,
      status: 'content-exhausted',
      contentExhausted: {
        reason: 'all-eligible-content-recently-used',
        description:
          '当前合格题目都已在本次训练中使用，进度与去重记录已保留。',
      },
      retryAction: {
        label: '重新获取题目',
      },
    })
    expect(
      toTrainingCompletionDurationViewModel(
        'vocabulary',
        {
          ...execution,
          status: 'completed',
          training: {
            ...execution.training,
            remainingEffectiveSeconds: 0,
            status: 'completed',
            contentExhausted: null,
          },
        },
      ).trainingBudget,
    ).toEqual({
      targetEffectiveSeconds: 900,
      remainingEffectiveSeconds: 0,
      completedItemCount: 2,
      status: 'completed',
    })
  })

  it('reports only timing-segment durations and never treats missing modules as zero', () => {
    const initial = progress()
    const activePlan: PlanProgress = {
      ...initial,
      status: 'in-progress',
      tasks: initial.tasks.map((execution, index) =>
        index === 0
          ? {
              ...execution,
              status: 'completed',
              completionKind: 'scored',
              spentSeconds: 125,
              effectiveSeconds: 120,
              excludedSeconds: 5,
              timingSegmentCount: 2,
              effectiveTimeSource: 'timing-segments',
            }
          : index === 1
            ? {
                ...execution,
                status: 'completed',
                completionKind: 'scored',
                spentSeconds: 600,
                effectiveSeconds: 600,
                effectiveTimeSource: 'legacy-event-duration',
              }
            : execution,
      ),
    }
    const today = toDailyPlanViewModel(
      activePlan,
      engine(),
      getPlanTaskAccess(activePlan),
      '2026-07-24T08:00:00.000Z',
    )

    expect(today.effectiveTimeSummary).toEqual({
      items: [
        {
          moduleId: 'vocabulary',
          label: '词汇训练',
          duration: {
            state: 'reliable',
            effectiveSeconds: 120,
            source: 'timing-segments',
          },
        },
        {
          moduleId: 'listening',
          label: '听力训练',
          duration: {
            state: 'unavailable',
            reason: 'legacy-event-duration',
          },
        },
        {
          moduleId: 'speaking',
          label: '口语训练',
          duration: {
            state: 'unavailable',
            reason: 'missing-timing-segments',
          },
        },
      ],
      total: {
        coverage: 'partial',
        effectiveSeconds: 120,
        source: 'timing-segments',
      },
    })
    expect(
      toActualEffectiveDurationViewModel(activePlan.tasks[1]),
    ).toEqual({
      state: 'unavailable',
      reason: 'legacy-event-duration',
    })
    expect(
      toTrainingCompletionDurationViewModel(
        'listening',
        activePlan.tasks[1],
      ),
    ).toMatchObject({
      moduleId: 'listening',
      title: '听力训练已完成',
      actualDuration: {
        state: 'unavailable',
        reason: 'legacy-event-duration',
      },
    })
  })

  it('marks the daily total complete only when all three module durations are reliable', () => {
    const initial = progress()
    const activePlan: PlanProgress = {
      ...initial,
      status: 'completed',
      tasks: initial.tasks.map((execution, index) => ({
        ...execution,
        status: 'completed',
        completionKind: 'scored',
        spentSeconds: 60 * (index + 1),
        effectiveSeconds: 60 * (index + 1),
        excludedSeconds: 0,
        timingSegmentCount: 1,
        effectiveTimeSource: 'timing-segments',
      })),
    }
    const today = toDailyPlanViewModel(
      activePlan,
      engine(),
      getPlanTaskAccess(activePlan),
      '2026-07-24T08:00:00.000Z',
    )

    expect(today.effectiveTimeSummary?.total).toEqual({
      coverage: 'complete',
      effectiveSeconds: 360,
      source: 'timing-segments',
    })
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

  it('turns all three finished practice cards into extra-training entries after 3/3', () => {
    const initial = progress()
    const completed: PlanProgress = {
      ...initial,
      status: 'completed',
      tasks: initial.tasks.map((task) => ({
        ...task,
        status: 'completed',
        completionKind: 'scored',
      })),
    }

    const modules = toPracticeModulesViewModel(
      completed,
      getPlanTaskAccess(completed),
      3,
      true,
    )

    expect(modules.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: 'vocabulary',
          availability: 'extra-training',
          actionLabel: '继续训练',
          taskId: null,
          trainingBudget: { targetEffectiveSeconds: 900 },
        }),
        expect.objectContaining({
          moduleId: 'listening',
          availability: 'extra-training',
          actionLabel: '继续训练',
          taskId: null,
          trainingBudget: { targetEffectiveSeconds: 900 },
        }),
        expect.objectContaining({
          moduleId: 'speaking',
          availability: 'extra-training',
          actionLabel: '继续训练',
          taskId: null,
          trainingBudget: { targetEffectiveSeconds: 900 },
        }),
      ]),
    )
  })
})
