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
  ListeningTrainingScreen,
  PracticeModuleGrid,
  SpeakingTrainingScreen,
  TodayTaskList,
  TrainingBudgetProgress,
  VocabularyTrainingScreen,
  formatTrainingBudgetClock,
  formatTrainingBudgetTarget,
  type DailyTaskViewModel,
  type ListeningScreenViewModel,
  type PracticeModuleViewModel,
  type SpeakingScreenViewModel,
  type TrainingBudgetProgressViewModel,
  type VocabularyScreenViewModel,
} from './index.ts'

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

const budgetTarget = {
  targetEffectiveSeconds: 900,
} as const

function budgetTask(
  moduleId: 'vocabulary' | 'listening' | 'speaking',
): DailyTaskViewModel {
  const presentation = {
    vocabulary: {
      title: '词汇训练',
      contentSummary: '持续供应旅游词汇',
      icon: 'book',
      accent: 'mint',
    },
    listening: {
      title: '听力训练',
      contentSummary: '持续供应旅游听力',
      icon: 'headphones',
      accent: 'indigo',
    },
    speaking: {
      title: '口语训练',
      contentSummary: '持续供应旅游口语',
      icon: 'mic',
      accent: 'coral',
    },
  } as const

  return {
    moduleId,
    taskId: `plan-r3:${moduleId}`,
    availability: 'startable',
    status: 'pending',
    statusLabel: '未完成',
    recommended: moduleId === 'listening',
    actionLabel: '开始训练',
    trainingBudget: budgetTarget,
    ...presentation[moduleId],
  }
}

const legacyTask: DailyTaskViewModel = {
  moduleId: 'vocabulary',
  taskId: 'legacy:vocabulary',
  availability: 'startable',
  status: 'pending',
  statusLabel: '未完成',
  recommended: false,
  actionLabel: '开始训练',
  durationEstimate: {
    estimateSeconds: 123,
    basis: 'content-baseline',
    sampleCount: 0,
    confidence: 'low',
  },
  title: '旧词汇任务',
  contentSummary: '6 个词',
  icon: 'book',
  accent: 'mint',
}

function practiceModules(
  tasks: readonly DailyTaskViewModel[],
): readonly PracticeModuleViewModel[] {
  return [
    {
      moduleId: 'assessment',
      request: {
        state: 'disabled',
        label: '已完成',
        reason: '首次水平测试已完成。',
      },
    },
    ...tasks.map(
      ({
        title: _title,
        contentSummary: _contentSummary,
        icon: _icon,
        accent: _accent,
        ...access
      }) => access,
    ),
  ]
}

function budgetProgress(
  status: 'content-exhausted',
): Extract<
  TrainingBudgetProgressViewModel,
  { readonly status: 'content-exhausted' }
>
function budgetProgress(
  status: TrainingBudgetProgressViewModel['status'],
): TrainingBudgetProgressViewModel
function budgetProgress(
  status: TrainingBudgetProgressViewModel['status'],
): TrainingBudgetProgressViewModel {
  const base = {
    targetEffectiveSeconds: 900,
    remainingEffectiveSeconds:
      status === 'running'
        ? 742
        : status === 'content-exhausted'
          ? 481
          : 0,
    completedItemCount: status === 'running' ? 3 : 8,
  } as const

  return status === 'content-exhausted'
    ? {
        ...base,
        status,
        contentExhausted: {
          reason: 'all-eligible-content-recently-used',
          description: '当前范围内的近期题目已全部使用。',
        },
        retryAction: {
          label: '重新获取题目',
        },
      }
    : { ...base, status }
}

describe('QA-011 entry duration contract', () => {
  it('shows the effective 15-minute budget for all three new tasks in Today and Training', () => {
    const tasks = [
      budgetTask('vocabulary'),
      budgetTask('listening'),
      budgetTask('speaking'),
    ] as const
    const todayMarkup = renderToStaticMarkup(
      <TodayTaskList
        tasks={tasks}
        onTaskRequested={() => undefined}
      />,
    )
    const practiceMarkup = renderToStaticMarkup(
      <PracticeModuleGrid
        modules={practiceModules(tasks)}
        onAssessmentRequested={() => undefined}
        onTaskRequested={() => undefined}
      />,
    )

    for (const markup of [todayMarkup, practiceMarkup]) {
      expect(markup.match(/15 分钟有效训练/g)).toHaveLength(9)
      expect(
        markup.match(/data-training-duration-kind="training-budget"/g),
      ).toHaveLength(3)
      expect(markup).not.toContain('内容估算')
      expect(markup).not.toContain('按你的近期速度')
      expect(markup).not.toContain('约 2 分钟')
      expect(markup).not.toContain('约 3 分钟')
      expect(markup).not.toContain('约 4 分钟')
    }
  })

  it('keeps the old estimate for a task with no training budget', () => {
    const markup = renderToStaticMarkup(
      <TodayTaskList
        tasks={[legacyTask]}
        onTaskRequested={() => undefined}
      />,
    )

    expect(markup).toContain('约 2 分钟')
    expect(markup).toContain('内容估算')
    expect(markup).toContain('data-estimate-seconds="123"')
    expect(markup).not.toContain(
      'data-training-duration-kind="training-budget"',
    )
  })
})

describe('QA-011 effective budget formatting', () => {
  it.each([
    [0, '00:00'],
    [1, '00:01'],
    [59, '00:59'],
    [60, '01:00'],
    [61, '01:01'],
    [900, '15:00'],
    [3_661, '01:01:01'],
  ])('formats %s seconds as a clock snapshot %s', (seconds, label) => {
    expect(formatTrainingBudgetClock(seconds)).toBe(label)
  })

  it('formats the target without turning it into an estimate', () => {
    expect(formatTrainingBudgetTarget(900)).toBe('15 分钟有效训练')
    expect(formatTrainingBudgetTarget(59)).toBe(
      '00:59 有效训练',
    )
  })
})

describe('QA-011 training lifecycle surface', () => {
  it.each([
    ['running', '有效训练进行中'],
    ['finish-current-item', '时间已到，完成本题后结束'],
    ['content-exhausted', '题库暂时不足，训练尚未完成'],
    ['completed', '有效训练目标已完成'],
  ] as const)('renders upstream %s state without changing it', (
    status,
    copy,
  ) => {
    const markup = renderToStaticMarkup(
      <TrainingBudgetProgress
        viewModel={budgetProgress(status)}
        onRetryContent={() => undefined}
      />,
    )

    expect(markup).toContain(`data-budget-status="${status}"`)
    expect(markup).toContain(copy)
    expect(markup).toContain('目标')
    expect(markup).toContain('15:00')
    expect(markup).toContain('剩余有效时间')
    expect(markup).toContain('累计完成题数')
  })

  it('keeps exhaustion incomplete and sends a distinct retry intent once', () => {
    const onRetryContent = vi.fn()
    const screen = TrainingBudgetProgress({
      viewModel: budgetProgress('content-exhausted'),
      onRetryContent,
    })
    const button = collectHostElements(screen, 'button')[0]
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('题库暂时不足')
    expect(markup).toContain('训练尚未完成')
    expect(markup).toContain('当前范围内的近期题目已全部使用')
    expect(markup).not.toContain('训练完成')
    expect(button?.props).toMatchObject({
      type: 'button',
      disabled: false,
    })

    expect(button).toBeDefined()
    ;(button!.props as { readonly onClick?: () => void }).onClick?.()
    expect(onRetryContent).toHaveBeenCalledOnce()
  })

  it.each([
    [{ disabled: true }, '重新获取题目'],
    [{ loading: true }, '正在重新获取'],
  ])('prevents duplicate retry while busy or disabled', (
    actionState,
    visibleLabel,
  ) => {
    const onRetryContent = vi.fn()
    const screen = TrainingBudgetProgress({
      viewModel: {
        ...budgetProgress('content-exhausted'),
        retryAction: {
          label: '重新获取题目',
          ...actionState,
        },
      },
      onRetryContent,
    })
    const button = collectHostElements(screen, 'button')[0]
    const markup = renderToStaticMarkup(screen)

    expect(button?.props).toMatchObject({ disabled: true })
    expect(button).toBeDefined()
    expect(
      (button!.props as { readonly onClick?: () => void }).onClick,
    ).toBeUndefined()
    expect(markup).toContain(visibleLabel)
    expect(onRetryContent).not.toHaveBeenCalled()
  })
})

const vocabularyViewModel: VocabularyScreenViewModel = {
  header: {
    eyebrow: 'VOCABULARY',
    title: '旅游词汇',
    trainingBudget: budgetProgress('running'),
  },
  instruction: '选择中文释义',
  term: 'reservation',
  choices: [
    { id: 'choice-a', label: '预订', state: 'default' },
  ],
  action: { label: '提交' },
}

const listeningViewModel: ListeningScreenViewModel = {
  header: {
    eyebrow: 'LISTENING',
    title: '旅游听力',
    trainingBudget: budgetProgress('finish-current-item'),
  },
  instruction: '听对话后选择',
  player: {
    status: 'ended',
    elapsedLabel: '00:04',
    durationLabel: '00:04',
    progressValue: 100,
    statusLabel: '播放完毕',
  },
  playbackControls: {
    rate: {
      label: '播放速度',
      currentValue: 1,
      options: [{ value: 1, label: '1 倍' }],
    },
    segment: {
      label: '播放片段',
      currentId: 'all',
      options: [{ id: 'all', label: '完整对话' }],
    },
    repeat: {
      label: '重复方式',
      currentMode: 'none',
      options: [{ value: 'none', label: '不重复' }],
    },
  },
  question: {
    kind: 'single-choice',
    available: true,
    prompt: '对话发生在哪里？',
    choices: [{ id: 'hotel', label: '酒店', state: 'default' }],
  },
  action: { label: '提交' },
}

const speakingViewModel: SpeakingScreenViewModel = {
  header: {
    eyebrow: 'SPEAKING',
    title: '旅游口语',
    trainingBudget: budgetProgress('content-exhausted'),
  },
  instruction: '跟读',
  prompt: 'I have a reservation.',
  recorder: {
    status: 'ready',
    statusLabel: '可以录音',
  },
  action: { label: '开始录音' },
}

describe('QA-011 three training page contract', () => {
  it('renders the same budget facts in vocabulary, listening and speaking', () => {
    const retry = vi.fn()
    const screens = [
      VocabularyTrainingScreen({
        viewModel: vocabularyViewModel,
        onExit: () => undefined,
        onSelect: () => undefined,
        onAction: () => undefined,
        onRetryTrainingContent: retry,
      }),
      ListeningTrainingScreen({
        viewModel: listeningViewModel,
        onExit: () => undefined,
        onToggleAudio: () => undefined,
        onPlaybackRateChange: () => undefined,
        onSegmentChange: () => undefined,
        onRepeatModeChange: () => undefined,
        onQuestionInput: () => undefined,
        onAction: () => undefined,
        onRetryTrainingContent: retry,
      }),
      SpeakingTrainingScreen({
        viewModel: speakingViewModel,
        onExit: () => undefined,
        onRecorderAction: () => undefined,
        onAction: () => undefined,
        onRetryTrainingContent: retry,
      }),
    ]

    expect(renderToStaticMarkup(screens[0])).toContain(
      '有效训练进行中',
    )
    expect(renderToStaticMarkup(screens[1])).toContain(
      '时间已到，完成本题后结束',
    )
    expect(renderToStaticMarkup(screens[2])).toContain(
      '题库暂时不足，训练尚未完成',
    )
    for (const screen of screens) {
      expect(renderToStaticMarkup(screen)).toContain('15:00')
      expect(
        (screen.props as {
          readonly onRetryTrainingContent?: () => void
        }).onRetryTrainingContent,
      ).toBe(retry)
    }
  })

  it('contains no UI clock or task-completion implementation', () => {
    const source = [
      readFileSync(
        new URL('./training-budget-surfaces.tsx', import.meta.url),
        'utf8',
      ),
      readFileSync(
        new URL('./training-primitives.tsx', import.meta.url),
        'utf8',
      ),
    ].join('\n')

    expect(source).not.toMatch(
      /\b(?:setInterval|setTimeout|Date\.now|performance\.now)\b/,
    )
    expect(source).not.toContain('budget-completed')
    expect(source).not.toContain('item-completed')
    expect(source).not.toContain('nextSupplyCursor')
  })

  it('keeps 320/390px, dynamic type, touch and VoiceOver guardrails', () => {
    const appCss = readFileSync(
      new URL('./styles/app.css', import.meta.url),
      'utf8',
    )
    const budgetCss = readFileSync(
      new URL('./styles/training-budget.css', import.meta.url),
      'utf8',
    )
    const markup = renderToStaticMarkup(
      <TrainingBudgetProgress
        viewModel={{
          ...budgetProgress('content-exhausted'),
          contentExhausted: {
            reason: 'provider-failure',
            description:
              '当前题库提供器暂时无法返回适合本任务的旅游英语内容，请稍后重试。',
          },
        }}
        onRetryContent={() => undefined}
      />,
    )

    expect(appCss).toContain('@import "./training-budget.css"')
    expect(budgetCss).toContain('@media (width <= 360px)')
    expect(budgetCss).toContain('min-height: 48px')
    expect(budgetCss).toContain('overflow-wrap: anywhere')
    expect(budgetCss).toContain('grid-template-columns: repeat(2')
    expect(budgetCss).toContain('font-size: clamp(')
    expect(markup).toContain('aria-label=')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('type="button"')
  })
})
