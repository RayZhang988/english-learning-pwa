import { readFileSync } from 'node:fs'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  LearningAppPrototype,
  PracticeModuleGrid,
  TodayTaskList,
  type DailyPlanViewModel,
  type DailyTaskViewModel,
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type ProgressViewModel,
  type TrainingPracticeModuleId,
} from './index.ts'
import type { TrainingAreaScreen } from './training-area-surfaces.tsx'

const taskIds = {
  vocabulary: 'plan-2026-07-27:task:vocabulary:exact',
  listening: 'plan-2026-07-27:task:listening:exact',
  speaking: 'plan-2026-07-27:task:speaking:exact',
} as const

const taskPresentation = {
  vocabulary: {
    title: '词汇复习',
    contentSummary: '12 个词',
    icon: 'book',
    accent: 'mint',
    durationEstimate: {
      estimateSeconds: 59,
      basis: 'content-baseline',
      sampleCount: 0,
      confidence: 'low',
    },
  },
  listening: {
    title: '听力训练',
    contentSummary: '1 组对话',
    icon: 'headphones',
    accent: 'indigo',
    durationEstimate: {
      estimateSeconds: 180,
      basis: 'personal-history',
      sampleCount: 3,
      confidence: 'medium',
    },
  },
  speaking: {
    title: '口语跟读',
    contentSummary: '1 组跟读',
    icon: 'mic',
    accent: 'coral',
    durationEstimate: {
      estimateSeconds: 125,
      basis: 'content-baseline',
      sampleCount: 1,
      confidence: 'low',
    },
  },
} as const

function startableTask(
  moduleId: TrainingPracticeModuleId,
  recommended = false,
): DailyTaskViewModel {
  return {
    moduleId,
    taskId: taskIds[moduleId],
    availability: 'startable',
    status: moduleId === 'listening' ? 'active' : 'pending',
    statusLabel: moduleId === 'listening' ? '进行中' : '未完成',
    recommended,
    actionLabel: moduleId === 'listening' ? '继续训练' : '开始训练',
    ...taskPresentation[moduleId],
  }
}

function completedTask(
  moduleId: TrainingPracticeModuleId,
): DailyTaskViewModel {
  return {
    moduleId,
    taskId: taskIds[moduleId],
    availability: 'unavailable',
    status: 'completed',
    statusLabel: '已完成',
    recommended: false,
    unavailableReason: 'task-finished',
    unavailableDescription: '今天的这项任务已经完成。',
    ...taskPresentation[moduleId],
  }
}

function skippedTask(
  moduleId: TrainingPracticeModuleId,
): DailyTaskViewModel {
  return {
    moduleId,
    taskId: taskIds[moduleId],
    availability: 'unavailable',
    status: 'skipped',
    statusLabel: '已跳过',
    recommended: false,
    unavailableReason: 'task-finished',
    unavailableDescription: '今天的这项任务已由计划标记为跳过。',
    ...taskPresentation[moduleId],
  }
}

function unavailableTask(
  moduleId: TrainingPracticeModuleId,
  reason: 'not-in-active-plan' | 'invalid-task-data',
): DailyTaskViewModel {
  return {
    moduleId,
    taskId: reason === 'invalid-task-data' ? null : taskIds[moduleId],
    availability: 'unavailable',
    status: null,
    statusLabel: reason === 'invalid-task-data' ? '数据异常' : '不在计划中',
    recommended: false,
    unavailableReason: reason,
    unavailableDescription:
      reason === 'invalid-task-data'
        ? '任务数据不完整，请稍后重试。'
        : '今天的计划不包含这项任务。',
    ...taskPresentation[moduleId],
  }
}

function allStartableTasks(
  recommendedModule: TrainingPracticeModuleId | null = 'listening',
): readonly DailyTaskViewModel[] {
  return (
    ['vocabulary', 'listening', 'speaking'] as const
  ).map((moduleId) =>
    startableTask(moduleId, moduleId === recommendedModule),
  )
}

const progress: ProgressViewModel = {
  studyDays: '5',
  studyMinutes: '86',
  completedSessions: '18',
  weeklyBars: [],
}

describe('R13-D practice-hub tool placement', () => {
  const tool = { status: 'ready' as const, activeCount: 0, onOpen: vi.fn() }
  const app = (initialSection: 'today' | 'practice', initialTrainingAreaScreen: TrainingAreaScreen = { kind: 'hub' }) => renderToStaticMarkup(<LearningAppPrototype plan={dailyPlan()} progress={progress} onTaskRequested={vi.fn()} practiceModules={practiceModules()} onAssessmentRequested={vi.fn()} initialSection={initialSection} initialTrainingAreaScreen={initialTrainingAreaScreen} wrongAnswerLibrary={tool} />)
  it('shows the one tool only in the practice hub, never Today or area detail pages', () => {
    expect(app('practice').match(/data-wrong-answer-library-entry=/gu)).toHaveLength(1)
    expect(app('practice').match(/data-training-area=/gu)).toHaveLength(3)
    expect(app('today')).not.toContain('data-wrong-answer-library-entry')
    expect(app('practice', { kind: 'daily' })).not.toContain('data-wrong-answer-library-entry')
    expect(app('practice', { kind: 'scenes' })).not.toContain('data-wrong-answer-library-entry')
  })
})

function dailyPlan(
  tasks: readonly DailyTaskViewModel[] = allStartableTasks(),
): DailyPlanViewModel {
  return {
    dateLabel: '周日 · 7月27日',
    greeting: '晚上好',
    streakDays: 5,
    planTargetLabel: '3 项训练',
    progressLabel: '已完成 0 项',
    progressPercent: 0,
    tasks,
  }
}

function practiceModules(
  tasks: readonly DailyTaskViewModel[] = allStartableTasks(),
): readonly PracticeModuleViewModel[] {
  return [
    {
      moduleId: 'assessment',
      request: {
        state: 'disabled',
        label: '已完成',
        reason: '首次水平测试已完成，第一版暂不支持重复测试。',
      },
    },
    ...tasks.map(
      ({
        title: _title,
        contentSummary: _contentSummary,
        icon: _icon,
        accent: _accent,
        ...taskAccess
      }) => taskAccess,
    ),
  ]
}

function collectHostElements(
  node: ReactNode,
  tagName: string,
): ReactElement[] {
  const found: ReactElement[] = []

  function visit(current: ReactNode): void {
    for (const child of Children.toArray(current)) {
      if (!isValidElement(child)) {
        continue
      }

      if (typeof child.type === 'function') {
        const renderFunction = child.type as (
          props: unknown,
        ) => ReactNode
        visit(renderFunction(child.props))
        continue
      }

      if (child.type === tagName) {
        found.push(child)
      }

      visit(
        (child.props as { readonly children?: ReactNode }).children,
      )
    }
  }

  visit(node)
  return found
}

type TaskButtonProps = {
  readonly 'aria-label'?: string
  readonly 'data-availability'?: string
  readonly 'data-module-id'?: PracticeModuleId
  readonly 'data-recommended'?: string
  readonly 'data-task-id'?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly type?: string
}

function taskButton(
  node: ReactNode,
  moduleId: PracticeModuleId,
): ReactElement<TaskButtonProps> {
  const button = collectHostElements(node, 'button').find(
    (candidate) =>
      (candidate.props as TaskButtonProps)['data-module-id'] ===
      moduleId,
  )

  expect(button).toBeDefined()
  return button as ReactElement<TaskButtonProps>
}

describe('R2 today task choices', () => {
  it('keeps all three unfinished tasks clickable and returns each exact taskId once', () => {
    const onTaskRequested = vi.fn()
    const screen = TodayTaskList({
      tasks: allStartableTasks(),
      onTaskRequested,
    })

    for (const moduleId of [
      'vocabulary',
      'listening',
      'speaking',
    ] as const) {
      const button = taskButton(screen, moduleId)
      expect(button.props.disabled).toBe(false)
      expect(button.props.type).toBe('button')
      expect(button.props['data-task-id']).toBe(taskIds[moduleId])
      button.props.onClick?.()
    }

    expect(onTaskRequested.mock.calls).toEqual([
      [taskIds.vocabulary],
      [taskIds.listening],
      [taskIds.speaking],
    ])
  })

  it.each([
    ['vocabulary'],
    ['listening'],
    ['speaking'],
    [null],
  ] as const)(
    'does not turn recommendation %s into an access gate',
    (recommendedModule) => {
      const screen = TodayTaskList({
        tasks: allStartableTasks(recommendedModule),
        onTaskRequested: () => undefined,
      })

      for (const moduleId of [
        'vocabulary',
        'listening',
        'speaking',
      ] as const) {
        const button = taskButton(screen, moduleId)
        expect(button.props.disabled).toBe(false)
        expect(button.props['data-recommended']).toBe(
          moduleId === recommendedModule ? 'true' : 'false',
        )
      }
    },
  )

  it('keeps the other two tasks startable after one task is completed', () => {
    const screen = TodayTaskList({
      tasks: [
        completedTask('vocabulary'),
        startableTask('listening', true),
        startableTask('speaking'),
      ],
      onTaskRequested: () => undefined,
    })

    expect(taskButton(screen, 'vocabulary').props.disabled).toBe(true)
    expect(taskButton(screen, 'listening').props.disabled).toBe(false)
    expect(taskButton(screen, 'speaking').props.disabled).toBe(false)
  })

  it('shows a skipped task as a truthful terminal state instead of restarting it', () => {
    const screen = TodayTaskList({
      tasks: [
        skippedTask('vocabulary'),
        startableTask('listening'),
        startableTask('speaking', true),
      ],
      onTaskRequested: () => undefined,
    })
    const skippedButton = taskButton(screen, 'vocabulary')

    expect(skippedButton.props.disabled).toBe(true)
    expect(skippedButton.props.onClick).toBeUndefined()
    expect(skippedButton.props['aria-label']).toContain('已跳过')
    expect(skippedButton.props['aria-label']).toContain(
      '已由计划标记为跳过',
    )
  })

  it('disables only externally unavailable tasks and exposes their exact reason', () => {
    const onTaskRequested = vi.fn()
    const screen = TodayTaskList({
      tasks: [
        startableTask('vocabulary'),
        unavailableTask('listening', 'not-in-active-plan'),
        unavailableTask('speaking', 'invalid-task-data'),
      ],
      onTaskRequested,
    })
    const listeningButton = taskButton(screen, 'listening')
    const speakingButton = taskButton(screen, 'speaking')

    expect(taskButton(screen, 'vocabulary').props.disabled).toBe(false)
    expect(listeningButton.props.disabled).toBe(true)
    expect(listeningButton.props.onClick).toBeUndefined()
    expect(listeningButton.props['aria-label']).toContain(
      '今天的计划不包含这项任务。',
    )
    expect(speakingButton.props.disabled).toBe(true)
    expect(speakingButton.props['data-task-id']).toBeUndefined()
    expect(speakingButton.props['aria-label']).toContain(
      '任务数据不完整，请稍后重试。',
    )
    expect(onTaskRequested).not.toHaveBeenCalled()
  })

  it('uses free-choice copy and tells VoiceOver that recommendation is non-binding', () => {
    const markup = renderToStaticMarkup(
      <LearningAppPrototype
        plan={dailyPlan()}
        progress={progress}
        onTaskRequested={() => undefined}
      />,
    )
    const recommendedButton = taskButton(
      TodayTaskList({
        tasks: allStartableTasks(),
        onTaskRequested: () => undefined,
      }),
      'listening',
    )

    expect(markup).toContain('任选一项开始')
    expect(markup).toContain('其他可用任务同样可以直接开始')
    expect(markup).not.toContain('接下来')
    expect(markup).not.toContain('尚未轮到')
    expect(markup).not.toContain('完成当前任务后')
    expect(recommendedButton.props['aria-label']).toContain(
      '其他未完成任务同样可选',
    )
  })
})

describe('R6.2 module-level continuation choices', () => {
  it('opens only the completed module from today while other modules keep their daily task actions', () => {
    const onExtraTrainingRequested = vi.fn()
    const onTaskRequested = vi.fn()
    const screen = TodayTaskList({
      tasks: [
        {
          ...taskPresentation.vocabulary,
          moduleId: 'vocabulary',
          availability: 'extra-training',
          taskId: null,
          status: 'completed',
          recommended: false,
          actionLabel: '继续训练',
          extraTrainingDescription: '词汇今日 15 分钟已完成，可以不限时继续训练。',
          openEnded: true,
          statusLabel: '今日 15 分钟已完成',
        },
        startableTask('listening', true),
        startableTask('speaking'),
      ],
      onTaskRequested,
      onExtraTrainingRequested,
    })

    const vocabulary = taskButton(screen, 'vocabulary')
    expect(vocabulary.props.disabled).toBe(false)
    expect(vocabulary.props['data-availability']).toBe('extra-training')
    expect(vocabulary.props['data-task-id']).toBeUndefined()
    expect(vocabulary.props['aria-label']).toContain('今日 15 分钟已完成')
    expect(vocabulary.props['aria-label']).toContain('不限时继续训练')
    vocabulary.props.onClick?.()

    taskButton(screen, 'listening').props.onClick?.()
    taskButton(screen, 'speaking').props.onClick?.()

    expect(onExtraTrainingRequested).toHaveBeenCalledExactlyOnceWith('vocabulary')
    expect(onTaskRequested.mock.calls).toEqual([
      [taskIds.listening],
      [taskIds.speaking],
    ])
  })

  it.each([
    ['0/3', [], 0],
    ['1/3', ['vocabulary'], 1],
    ['2/3', ['vocabulary', 'listening'], 2],
    ['3/3', ['vocabulary', 'listening', 'speaking'], 3],
  ] as const)('renders %s completed modules independently without an aggregate gate', (
    _progress,
    completedModules,
    expectedExtraEntries,
  ) => {
    const onExtraTrainingRequested = vi.fn()
    const completed = completedModules as readonly TrainingPracticeModuleId[]
    const tasks = (['vocabulary', 'listening', 'speaking'] as const).map((moduleId) =>
      completed.includes(moduleId)
        ? {
            ...taskPresentation[moduleId], moduleId, availability: 'extra-training' as const,
            taskId: null, status: 'completed' as const, recommended: false as const,
            actionLabel: '继续训练', extraTrainingDescription: '本模块今日 15 分钟已完成。',
            openEnded: true as const, statusLabel: '今日 15 分钟已完成',
          }
        : startableTask(moduleId),
    )
    const screen = TodayTaskList({ tasks, onTaskRequested: () => undefined, onExtraTrainingRequested })

    expect(collectHostElements(screen, 'button').filter((button) =>
      (button.props as TaskButtonProps)['data-availability'] === 'extra-training',
    )).toHaveLength(expectedExtraEntries)
    expect(renderToStaticMarkup(screen)).not.toContain('完成今日 3/3 后再继续训练')
  })

  it('keeps all three specialty cards clickable and does not swap or duplicate task ids', () => {
    const onTaskRequested = vi.fn()
    const screen = PracticeModuleGrid({
      modules: practiceModules(),
      onAssessmentRequested: () => undefined,
      onTaskRequested,
    })

    for (const moduleId of [
      'vocabulary',
      'listening',
      'speaking',
    ] as const) {
      const button = taskButton(screen, moduleId)
      expect(button.props.disabled).toBe(false)
      expect(button.props['data-task-id']).toBe(taskIds[moduleId])
      button.props.onClick?.()
    }

    expect(onTaskRequested).toHaveBeenCalledTimes(3)
    expect(onTaskRequested.mock.calls).toEqual([
      [taskIds.vocabulary],
      [taskIds.listening],
      [taskIds.speaking],
    ])
  })

  it.each([
    ['vocabulary'],
    ['listening'],
    ['speaking'],
    [null],
  ] as const)(
    'shows recommendation %s without disabling another specialty card',
    (recommendedModule) => {
      const screen = PracticeModuleGrid({
        modules: practiceModules(
          allStartableTasks(recommendedModule),
        ),
        onAssessmentRequested: () => undefined,
        onTaskRequested: () => undefined,
      })

      for (const moduleId of [
        'vocabulary',
        'listening',
        'speaking',
      ] as const) {
        const button = taskButton(screen, moduleId)
        expect(button.props.disabled).toBe(false)
        expect(button.props['data-recommended']).toBe(
          moduleId === recommendedModule ? 'true' : 'false',
        )
      }
    },
  )

  it('keeps completed and malformed cards disabled while the remaining task stays startable', () => {
    const markupTasks = [
      completedTask('vocabulary'),
      startableTask('listening', true),
      unavailableTask('speaking', 'invalid-task-data'),
    ] as const
    const screen = PracticeModuleGrid({
      modules: practiceModules(markupTasks),
      onAssessmentRequested: () => undefined,
      onTaskRequested: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(taskButton(screen, 'vocabulary').props.disabled).toBe(true)
    expect(taskButton(screen, 'listening').props.disabled).toBe(false)
    expect(taskButton(screen, 'speaking').props.disabled).toBe(true)
    expect(markup).toContain('今天的这项任务已经完成。')
    expect(markup).toContain('任务数据不完整，请稍后重试。')
    expect(markup).not.toContain('尚未轮到')
  })

  it('keeps assessment on its separate callback without inventing a task id', () => {
    const onAssessmentRequested = vi.fn()
    const onTaskRequested = vi.fn()
    const screen = PracticeModuleGrid({
      modules: [
        {
          moduleId: 'assessment',
          request: { state: 'enabled', label: '开始测试' },
        },
        ...practiceModules().slice(1),
      ],
      onAssessmentRequested,
      onTaskRequested,
    })
    const assessmentButton = taskButton(screen, 'assessment')

    assessmentButton.props.onClick?.()

    expect(onAssessmentRequested).toHaveBeenCalledOnce()
    expect(onTaskRequested).not.toHaveBeenCalled()
    expect(assessmentButton.props['data-task-id']).toBeUndefined()
  })
})

describe('R2 mobile and accessibility guardrails', () => {
  it('retains native button semantics, focus styling, narrow layout and wrapping text', () => {
    const screen = TodayTaskList({
      tasks: allStartableTasks(),
      onTaskRequested: () => undefined,
    })
    const css = readFileSync(
      new URL('./styles/app.css', import.meta.url),
      'utf8',
    )
    const taskTitleRule =
      css.match(/\.task-row__copy strong\s*\{([^}]*)\}/)?.[1] ?? ''

    for (const moduleId of [
      'vocabulary',
      'listening',
      'speaking',
    ] as const) {
      expect(taskButton(screen, moduleId).props.type).toBe('button')
    }
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (width <= 360px)')
    expect(css).toContain('min-height: 82px')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(taskTitleRule).not.toContain('white-space')
  })
})

describe('R3 task duration presentation', () => {
  it('shows an independent upstream estimate for all three today tasks', () => {
    const tasks = allStartableTasks()
    const screen = TodayTaskList({
      tasks,
      onTaskRequested: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('data-estimate-seconds="59"')
    expect(markup).toContain('data-estimate-seconds="180"')
    expect(markup).toContain('data-estimate-seconds="125"')
    expect(markup).toContain('内容估算')
    expect(markup).toContain('按你的近期速度')
    expect(markup).toContain('不足 1 分钟')
    expect(markup).toContain('约 3 分钟')
    expect(markup).toContain('约 2 分钟')
    expect(markup).not.toContain('15 分钟')

    expect(
      taskButton(screen, 'vocabulary').props['aria-label'],
    ).toContain('预计有效练习不足 1 分钟，内容估算')
    expect(
      taskButton(screen, 'listening').props['aria-label'],
    ).toContain('预计有效练习约 3 分钟，按你的近期速度')
  })

  it('uses the same estimates in training cards without changing task access', () => {
    const screen = PracticeModuleGrid({
      modules: practiceModules(),
      onAssessmentRequested: () => undefined,
      onTaskRequested: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup.match(/data-estimate-seconds=/g)).toHaveLength(3)
    expect(markup).not.toContain('15 分钟')
    for (const moduleId of [
      'vocabulary',
      'listening',
      'speaking',
    ] as const) {
      const button = taskButton(screen, moduleId)
      expect(button.props.disabled).toBe(false)
      expect(button.props['data-task-id']).toBe(taskIds[moduleId])
      expect(button.props['aria-label']).toContain(
        '预计有效练习',
      )
    }
  })

  it('keeps daily allocation wording separate from per-task duration', () => {
    const markup = renderToStaticMarkup(
      <LearningAppPrototype
        plan={{
          ...dailyPlan(),
          planTargetLabel: '今日目标约 45 分钟 · 3 项训练',
        }}
        progress={progress}
        onTaskRequested={() => undefined}
      />,
    )

    expect(markup).toContain('今日目标约 45 分钟')
    expect(markup).toContain('data-estimate-seconds="59"')
    expect(markup).not.toContain('15 分钟')
  })
})
