import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ActualEffectiveDuration,
  DailyEffectiveDurationSummary,
  TaskDurationEstimate,
  TrainingCompletionDurationScreen,
  TrainingScreen,
  formatDurationEstimateBasis,
  formatEffectiveDuration,
  formatEstimatedDuration,
  type DailyEffectiveDurationSummaryViewModel,
} from './index.ts'

describe('R3 duration formatting', () => {
  it.each([
    [0, '不足 1 分钟'],
    [1, '不足 1 分钟'],
    [59, '不足 1 分钟'],
    [60, '约 1 分钟'],
    [125, '约 2 分钟'],
    [330, '约 6 分钟'],
  ])('formats expected %s seconds as %s without false precision', (
    seconds,
    label,
  ) => {
    expect(formatEstimatedDuration(seconds)).toBe(label)
  })

  it.each([
    [0, '0 秒'],
    [59, '59 秒'],
    [60, '1 分钟'],
    [61, '1 分钟 1 秒'],
    [3_725, '1 小时 2 分钟 5 秒'],
  ])('formats effective %s seconds exactly as %s', (
    seconds,
    label,
  ) => {
    expect(formatEffectiveDuration(seconds)).toBe(label)
  })

  it('labels upstream estimate bases without inferring from sample count', () => {
    expect(formatDurationEstimateBasis('content-baseline')).toBe(
      '内容估算',
    )
    expect(formatDurationEstimateBasis('personal-history')).toBe(
      '按你的近期速度',
    )

    const contentMarkup = renderToStaticMarkup(
      <TaskDurationEstimate
        estimate={{
          estimateSeconds: 59,
          basis: 'content-baseline',
          sampleCount: 8,
          confidence: 'high',
        }}
      />,
    )
    const personalMarkup = renderToStaticMarkup(
      <TaskDurationEstimate
        estimate={{
          estimateSeconds: 180,
          basis: 'personal-history',
          sampleCount: 3,
          confidence: 'medium',
        }}
      />,
    )

    expect(contentMarkup).toContain('内容估算')
    expect(contentMarkup).toContain(
      'aria-label="预计有效练习：不足 1 分钟，内容估算"',
    )
    expect(personalMarkup).toContain('按你的近期速度')
    expect(personalMarkup).toContain(
      'aria-label="预计有效练习：约 3 分钟，按你的近期速度"',
    )
  })
})

describe('R3 actual effective duration honesty', () => {
  it('shows an exact effective duration only for timing segments', () => {
    const markup = renderToStaticMarkup(
      <ActualEffectiveDuration
        duration={{
          state: 'reliable',
          effectiveSeconds: 247,
          source: 'timing-segments',
        }}
      />,
    )

    expect(markup).toContain('实际有效练习')
    expect(markup).toContain('4 分钟 7 秒')
    expect(markup).toContain('已排除后台、暂停和长时间无操作')
    expect(markup).toContain('data-duration-state="reliable"')
  })

  it.each([
    ['legacy-event-duration'],
    ['missing-timing-segments'],
  ] as const)(
    'refuses to present %s as trusted actual time',
    (reason) => {
      const markup = renderToStaticMarkup(
        <ActualEffectiveDuration
          duration={{
            state: 'unavailable',
            reason,
          }}
        />,
      )

      expect(markup).toContain('本次暂无可靠用时')
      expect(markup).toContain('不以墙钟时间代替')
      expect(markup).not.toContain('0 分钟')
      expect(markup).toContain('data-duration-state="unavailable"')
    },
  )

  it('keeps the completion action separate from duration display', () => {
    const onAction = vi.fn()
    const screen = TrainingCompletionDurationScreen({
      viewModel: {
        moduleId: 'speaking',
        title: '这是一个用于验证动态字体换行的很长中文训练完成标题',
        description:
          '本次结果由口语模块提供，时长区域只展示可信的前台有效练习。',
        score: {
          state: 'available',
          correctCount: 2,
          totalCount: 3,
          percentage: 67,
          unscorableCount: 1,
        },
        actualDuration: {
          state: 'reliable',
          effectiveSeconds: 52,
          source: 'timing-segments',
        },
        actionLabel: '返回今日计划',
      },
      onAction,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('52 秒')
    expect(markup).toContain('返回今日计划')
    expect(markup).toContain('data-module-id="speaking"')
    screen.props.children.props.children.at(-1).props.onClick()
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('R3 daily effective duration summary', () => {
  const summary: DailyEffectiveDurationSummaryViewModel = {
    items: [
      {
        moduleId: 'vocabulary',
        label: '词汇',
        duration: {
          state: 'reliable',
          effectiveSeconds: 59,
          source: 'timing-segments',
        },
      },
      {
        moduleId: 'listening',
        label: '听力',
        duration: {
          state: 'reliable',
          effectiveSeconds: 180,
          source: 'timing-segments',
        },
      },
      {
        moduleId: 'speaking',
        label: '口语',
        duration: {
          state: 'unavailable',
          reason: 'legacy-event-duration',
        },
      },
    ],
    total: {
      coverage: 'partial',
      effectiveSeconds: 239,
      source: 'timing-segments',
    },
  }

  it('shows three modules and uses the externally supplied partial total', () => {
    const markup = renderToStaticMarkup(
      <DailyEffectiveDurationSummary viewModel={summary} />,
    )

    expect(markup).toContain('data-module-id="vocabulary"')
    expect(markup).toContain('data-module-id="listening"')
    expect(markup).toContain('data-module-id="speaking"')
    expect(markup).toContain('3 分钟 59 秒')
    expect(markup).toContain('59 秒')
    expect(markup).toContain('3 分钟')
    expect(markup).toContain('本次暂无可靠用时')
    expect(markup).toContain('缺失项不会按 0 分钟处理')
    expect(markup).toContain('data-total-coverage="partial"')
  })

  it('does not invent a total when upstream marks it unavailable', () => {
    const markup = renderToStaticMarkup(
      <DailyEffectiveDurationSummary
        viewModel={{
          items: summary.items,
          total: { coverage: 'unavailable' },
        }}
      />,
    )

    expect(markup).toContain('今日暂无可靠用时')
    expect(markup).toContain('不显示推测总时长')
    expect(markup).not.toContain('可信合计</small><strong>0')
  })
})

describe('R3 training entry and UI-only guardrails', () => {
  it('offers the estimate in the training header without timing itself', () => {
    const markup = renderToStaticMarkup(
      <TrainingScreen
        header={{
          eyebrow: 'LISTENING',
          title: '这是一个用于验证窄屏与 200% 字体的很长训练标题',
          progress: { label: '2 / 6', value: 34 },
          durationEstimate: {
            estimateSeconds: 245,
            basis: 'personal-history',
            sampleCount: 4,
            confidence: 'medium',
          },
        }}
        exitLabel="退出听力训练"
        onExit={() => undefined}
      >
        <p>训练内容</p>
      </TrainingScreen>,
    )

    expect(markup).toContain('duration-estimate--strip')
    expect(markup).toContain('约 4 分钟')
    expect(markup).toContain('按你的近期速度')
    expect(markup).toContain('aria-label="退出听力训练"')
  })

  it('retains 320/390px, 44px touch, wrapping and scalable-type rules', () => {
    const durationCss = readFileSync(
      new URL('./styles/duration.css', import.meta.url),
      'utf8',
    )
    const trainingCss = readFileSync(
      new URL('./styles/training.css', import.meta.url),
      'utf8',
    )
    const titleRule =
      trainingCss.match(
        /\.training-topbar__title h1\s*\{([^}]*)\}/,
      )?.[1] ?? ''

    expect(durationCss).toContain('@media (width <= 360px)')
    expect(durationCss).toContain('min-height: 44px')
    expect(durationCss).toContain('overflow-wrap: anywhere')
    expect(durationCss).toContain('env(safe-area-inset-bottom)')
    expect(durationCss).toMatch(/font-size:\s*(?:clamp|[0-9.]+rem)/)
    expect(trainingCss).toContain('grid-template-columns: 46px minmax(0, 1fr) 46px')
    expect(trainingCss).toContain('overflow-wrap: anywhere')
    expect(titleRule).not.toContain('white-space: nowrap')
  })

  it('contains no timer, median, allocation or wall-clock calculation in R3 UI files', () => {
    const source = [
      './duration-format.ts',
      './duration-surfaces.tsx',
      './duration-view-models.ts',
    ]
      .map((file) =>
        readFileSync(new URL(file, import.meta.url), 'utf8'),
      )
      .join('\n')

    expect(source).not.toMatch(/Date\.now|performance\.now/)
    expect(source).not.toMatch(/\bmedian\b/i)
    expect(source).not.toMatch(/plannedSeconds|targetMinutes|spentSeconds/)
    expect(source).not.toMatch(/setInterval|setTimeout/)
  })
})
