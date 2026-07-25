import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  LearningAppPrototype,
  type DailyPlanViewModel,
  type ProgressViewModel,
} from './index.ts'

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
