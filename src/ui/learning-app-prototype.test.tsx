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
  type DailyPlanViewModel,
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type ProgressViewModel,
} from './index.ts'
import { PracticeModuleGrid } from './learning-app-prototype.tsx'

const currentTaskId = 'plan-2026-07-24:task:2'

const plan: DailyPlanViewModel = {
  dateLabel: '周五 · 7月24日',
  greeting: '晚上好',
  streakDays: 5,
  summary: '45 分钟 · 3 项训练',
  progressLabel: '已完成 1 项',
  progressPercent: 34,
  tasks: [
    {
      id: 'plan-2026-07-24:task:1',
      title: '词汇复习',
      meta: '15 分钟 · 12 项',
      status: 'complete',
      icon: 'book',
      accent: 'mint',
      request: {
        state: 'disabled',
        label: '已完成',
        reason: '这项任务已经完成。',
      },
    },
    {
      id: currentTaskId,
      title: '听力训练',
      meta: '15 分钟 · 1 组',
      status: 'current',
      icon: 'headphones',
      accent: 'indigo',
      request: {
        state: 'enabled',
        label: '下一项',
      },
    },
    {
      id: 'plan-2026-07-24:task:3',
      title: '口语跟读',
      meta: '15 分钟 · 1 组',
      status: 'upcoming',
      icon: 'mic',
      accent: 'coral',
      request: {
        state: 'disabled',
        label: '稍后',
        reason: '完成当前任务后可开始。',
      },
    },
  ],
  primaryAction: {
    state: 'enabled',
    label: '继续今日计划',
    taskId: currentTaskId,
  },
}

const progress: ProgressViewModel = {
  studyDays: '5',
  studyMinutes: '86',
  completedSessions: '18',
  weeklyBars: [],
}

const vocabularyTaskId = 'plan-2026-07-24:practice:vocabulary:exact'
const speakingTaskId = 'plan-2026-07-24:practice:speaking:exact'

const practiceModules: readonly PracticeModuleViewModel[] = [
  {
    moduleId: 'assessment',
    request: {
      state: 'disabled',
      label: '已完成',
      reason: '首次水平测试已完成，第一版暂不支持重复测试。',
    },
  },
  {
    moduleId: 'vocabulary',
    request: {
      state: 'enabled',
      label: '进入训练',
      taskId: vocabularyTaskId,
    },
  },
  {
    moduleId: 'listening',
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '当前没有可执行的听力任务。',
    },
  },
  {
    moduleId: 'speaking',
    request: {
      state: 'enabled',
      label: '进入训练',
      taskId: speakingTaskId,
    },
  },
]

function renderPlan(viewModel: DailyPlanViewModel): string {
  return renderToStaticMarkup(
    <LearningAppPrototype
      plan={viewModel}
      progress={progress}
      onTaskRequested={() => undefined}
    />,
  )
}

function buttonOpeningTag(markup: string, ariaLabel: string): string {
  const escapedLabel = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markup.match(
    new RegExp(`<button[^>]*aria-label="${escapedLabel}"[^>]*>`),
  )

  expect(match).not.toBeNull()
  return match?.[0] ?? ''
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

type PracticeModuleButtonProps = {
  readonly 'aria-label'?: string
  readonly 'data-module-id'?: PracticeModuleId
  readonly 'data-task-id'?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
}

function moduleButton(
  node: ReactNode,
  moduleId: PracticeModuleId,
): ReactElement<PracticeModuleButtonProps> {
  const button = collectHostElements(node, 'button').find(
    (candidate) =>
      (candidate.props as PracticeModuleButtonProps)[
        'data-module-id'
      ] === moduleId,
  )

  expect(button).toBeDefined()
  return button as ReactElement<PracticeModuleButtonProps>
}

describe('LearningAppPrototype task request contract', () => {
  it('preserves the exact LearningTask.taskId on rows and the primary action', () => {
    const markup = renderPlan(plan)
    const currentRow = buttonOpeningTag(markup, '下一项：听力训练')
    const primaryAction = buttonOpeningTag(markup, '继续今日计划')

    expect(currentRow).toContain(`data-task-id="${currentTaskId}"`)
    expect(currentRow).not.toContain('disabled=""')
    expect(primaryAction).toContain(`data-task-id="${currentTaskId}"`)
    expect(primaryAction).not.toContain('disabled=""')
  })

  it('honestly disables completed and unavailable task rows', () => {
    const markup = renderPlan(plan)
    const completedRow = buttonOpeningTag(
      markup,
      '已完成：词汇复习，这项任务已经完成。',
    )
    const unavailableRow = buttonOpeningTag(
      markup,
      '稍后：口语跟读，完成当前任务后可开始。',
    )

    expect(completedRow).toContain('disabled=""')
    expect(completedRow).toContain(
      'data-task-id="plan-2026-07-24:task:1"',
    )
    expect(unavailableRow).toContain('disabled=""')
    expect(unavailableRow).toContain(
      'data-task-id="plan-2026-07-24:task:3"',
    )
  })

  it('does not fall back to another enabled task when the primary task is invalid', () => {
    const markup = renderPlan({
      ...plan,
      primaryAction: {
        state: 'enabled',
        label: '继续今日计划',
        taskId: 'missing-task-id',
      },
    })
    const primaryAction = buttonOpeningTag(
      markup,
      '继续今日计划，当前计划指定的任务暂时不可执行。',
    )

    expect(primaryAction).toContain('disabled=""')
    expect(primaryAction).not.toContain('data-task-id=')
  })

  it('renders an externally disabled primary action without inventing a task id', () => {
    const markup = renderPlan({
      ...plan,
      primaryAction: {
        state: 'disabled',
        label: '当前没有可执行任务',
        reason: '计划中的任务暂时不可用。',
      },
    })
    const primaryAction = buttonOpeningTag(
      markup,
      '当前没有可执行任务，计划中的任务暂时不可用。',
    )

    expect(primaryAction).toContain('disabled=""')
    expect(primaryAction).not.toContain('data-task-id=')
  })
})

describe('LearningAppPrototype practice request contract', () => {
  it('renders stable module identities and exact task ids without an empty-page fallback', () => {
    const screen = PracticeModuleGrid({
      modules: practiceModules,
      onAssessmentRequested: () => undefined,
      onTaskRequested: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)
    const moduleIds = collectHostElements(screen, 'button').map(
      (button) =>
        (button.props as PracticeModuleButtonProps)[
          'data-module-id'
        ],
    )

    expect(moduleIds).toEqual([
      'assessment',
      'vocabulary',
      'listening',
      'speaking',
    ])
    expect(
      moduleButton(screen, 'assessment').props['data-task-id'],
    ).toBeUndefined()
    expect(
      moduleButton(screen, 'vocabulary').props['data-task-id'],
    ).toBe(vocabularyTaskId)
    expect(
      moduleButton(screen, 'speaking').props['data-task-id'],
    ).toBe(speakingTaskId)
    expect(markup).not.toContain('暂无可用训练')
  })

  it('returns the exact LearningTask.taskId for enabled specialty training', () => {
    const onTaskRequested = vi.fn()
    const screen = PracticeModuleGrid({
      modules: practiceModules,
      onAssessmentRequested: () => undefined,
      onTaskRequested,
    })

    moduleButton(screen, 'vocabulary').props.onClick?.()
    moduleButton(screen, 'speaking').props.onClick?.()

    expect(onTaskRequested.mock.calls).toEqual([
      [vocabularyTaskId],
      [speakingTaskId],
    ])
  })

  it('uses a separate callback for assessment without inventing a task id', () => {
    const onAssessmentRequested = vi.fn()
    const onTaskRequested = vi.fn()
    const assessmentEnabled: readonly PracticeModuleViewModel[] = [
      {
        moduleId: 'assessment',
        request: {
          state: 'enabled',
          label: '开始测试',
        },
      },
    ]
    const screen = PracticeModuleGrid({
      modules: assessmentEnabled,
      onAssessmentRequested,
      onTaskRequested,
    })
    const assessmentButton = moduleButton(screen, 'assessment')

    assessmentButton.props.onClick?.()

    expect(onAssessmentRequested).toHaveBeenCalledOnce()
    expect(onTaskRequested).not.toHaveBeenCalled()
    expect(assessmentButton.props['data-task-id']).toBeUndefined()
  })

  it('shows the external reason and removes click behavior for disabled modules', () => {
    const screen = PracticeModuleGrid({
      modules: practiceModules,
      onAssessmentRequested: () => undefined,
      onTaskRequested: () => undefined,
    })
    const assessmentButton = moduleButton(screen, 'assessment')
    const listeningButton = moduleButton(screen, 'listening')
    const markup = renderToStaticMarkup(screen)

    expect(assessmentButton.props.disabled).toBe(true)
    expect(assessmentButton.props.onClick).toBeUndefined()
    expect(assessmentButton.props['aria-label']).toContain(
      '首次水平测试已完成，第一版暂不支持重复测试。',
    )
    expect(listeningButton.props.disabled).toBe(true)
    expect(listeningButton.props.onClick).toBeUndefined()
    expect(listeningButton.props['data-task-id']).toBeUndefined()
    expect(markup).toContain('当前没有可执行的听力任务。')
  })
})
