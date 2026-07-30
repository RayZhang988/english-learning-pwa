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
  ExtraListeningTrainingScreen,
  ExtraSpeakingTrainingScreen,
  ExtraTrainingCompletionScreen,
  ExtraTrainingPickerScreen,
  ExtraVocabularyTrainingScreen,
  TrainingCompletionDurationScreen,
  VocabularyTrainingScreen,
  type ExtraTrainingActiveSessionViewModel,
  type ExtraTrainingModuleViewModel,
  type ExtraTrainingPickerViewModel,
  type ListeningScreenViewModel,
  type SpeakingScreenViewModel,
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

function buttonByAccessibleLabel(
  node: ReactNode,
  labelFragment: string,
): ReactElement {
  const button = collectHostElements(node, 'button').find((element) =>
    String(
      (element.props as { readonly 'aria-label'?: string })[
        'aria-label'
      ],
    ).includes(labelFragment),
  )

  expect(button).toBeDefined()
  return button!
}

const pickerViewModel: ExtraTrainingPickerViewModel = {
  modules: [
    {
      moduleId: 'vocabulary',
      title: '词汇额外训练',
      description: '在旅游场景词汇中继续练习。',
      targetEffectiveSeconds: 900,
      status: 'available',
      startAction: { label: '开始 15 分钟' },
    },
    {
      moduleId: 'listening',
      title: '听力额外训练',
      description: '从保存的听力题继续。',
      targetEffectiveSeconds: 900,
      status: 'paused',
      sessionId: 'extra:listening:paused',
      remainingEffectiveSeconds: 734,
      completedItemCount: 5,
      resumeAction: { label: '继续上次训练' },
    },
    {
      moduleId: 'speaking',
      title: '口语额外训练',
      description: '继续练习旅行表达。',
      targetEffectiveSeconds: 900,
      status: 'failed',
      sessionId: 'extra:speaking:failed',
      remainingEffectiveSeconds: 612,
      completedItemCount: 4,
      failureReason: 'device-failure',
      failureDescription: '麦克风暂时不可用，进度已经保存。',
      retryAction: { label: '重试口语训练' },
    },
  ],
  returnAction: { label: '返回今日完成' },
}

function runningSession<
  TModuleId extends 'vocabulary' | 'listening' | 'speaking',
>(
  moduleId: TModuleId,
): ExtraTrainingActiveSessionViewModel<TModuleId> {
  return {
    sessionId: `extra:${moduleId}:running`,
    moduleId,
    budget: {
      status: 'running',
      targetEffectiveSeconds: 900,
      remainingEffectiveSeconds: 612,
      completedItemCount: 6,
    },
    exitAction: { label: '退出并保存' },
  }
}

const vocabularyViewModel: VocabularyScreenViewModel = {
  header: {
    eyebrow: 'VOCABULARY',
    title: '旅行词汇',
    durationEstimate: {
      estimateSeconds: 123,
      basis: 'content-baseline',
      sampleCount: 0,
      confidence: 'low',
    },
  },
  instruction: '选择中文释义',
  term: 'itinerary',
  choices: [
    { id: 'choice-itinerary', label: '行程', state: 'default' },
  ],
  action: { label: '提交' },
}

const listeningViewModel: ListeningScreenViewModel = {
  header: {
    eyebrow: 'LISTENING',
    title: '旅行听力',
  },
  instruction: '听对话后选择',
  player: {
    status: 'paused',
    elapsedLabel: '00:02',
    durationLabel: '00:05',
    progressValue: 40,
    statusLabel: '已暂停',
  },
  playbackControls: {
    rate: {
      label: '播放速度',
      currentValue: 1,
      options: [{ value: 1, label: '1 倍' }],
    },
    segment: {
      label: '播放片段',
      currentId: 'line-1',
      options: [{ id: 'line-1', label: '第 1 句' }],
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
    prompt: '旅客要去哪里？',
    choices: [
      { id: 'airport', label: '机场', state: 'default' },
    ],
  },
  action: { label: '提交' },
}

const speakingViewModel: SpeakingScreenViewModel = {
  header: {
    eyebrow: 'SPEAKING',
    title: '旅行口语',
  },
  instruction: '朗读下面的句子',
  prompt: 'Could I have a window seat?',
  recorder: {
    status: 'ready',
    statusLabel: '可以录音',
  },
  action: { label: '下一题' },
}

describe('R6 completed daily plan entry', () => {
  it('replaces the return-only dead end with an explicit optional-practice entry', () => {
    const onContinueTraining = vi.fn()
    const onReturn = vi.fn()
    const screen = TrainingCompletionDurationScreen({
      viewModel: {
        moduleId: 'speaking',
        title: '口语训练完成',
        description: '最后一个每日必做任务已经保存。',
        score: { state: 'available', correctCount: 8, totalCount: 10, percentage: 80, unscorableCount: 0 },
        actualDuration: {
          state: 'reliable',
          effectiveSeconds: 901,
          source: 'timing-segments',
        },
        extraTrainingEntry: {
          action: { label: '继续训练' },
        },
        actionLabel: '返回今日计划',
      },
      onAction: onReturn,
      onContinueTraining,
    })
    const markup = renderToStaticMarkup(screen)
    const buttons = collectHostElements(screen, 'button')

    expect(markup).toContain('今日计划 3/3 已完成')
    expect(markup).toContain('继续训练')
    expect(markup).toContain('15 分钟有效训练')
    expect(markup).toContain('额外练习不会改变今日完成状态')
    expect(buttons).toHaveLength(2)

    ;(
      buttons[0]!.props as { readonly onClick?: () => void }
    ).onClick?.()
    ;(
      buttons[1]!.props as { readonly onClick?: () => void }
    ).onClick?.()
    expect(onContinueTraining).toHaveBeenCalledOnce()
    expect(onReturn).toHaveBeenCalledOnce()
  })

  it('keeps the new entry honest when upstream marks it busy or disabled', () => {
    const onContinueTraining = vi.fn()
    const screen = TrainingCompletionDurationScreen({
      viewModel: {
        moduleId: 'vocabulary',
        title: '词汇训练完成',
        description: '结果已保存。',
        score: { state: 'available', correctCount: 9, totalCount: 10, percentage: 90, unscorableCount: 0 },
        actualDuration: {
          state: 'reliable',
          effectiveSeconds: 900,
          source: 'timing-segments',
        },
        extraTrainingEntry: {
          action: {
            label: '继续训练',
            loading: true,
            disabledReason: '正在保存今日完成状态。',
          },
        },
        actionLabel: '返回今日计划',
      },
      onAction: () => undefined,
      onContinueTraining,
    })
    const button = collectHostElements(screen, 'button')[0]
    const markup = renderToStaticMarkup(screen)

    expect(button).toBeDefined()
    expect(button?.props).toMatchObject({
      disabled: true,
      'aria-busy': true,
    })
    expect(markup).toContain('正在打开')
    expect(markup).toContain('正在保存今日完成状态')
    expect(
      (button!.props as { readonly onClick?: () => void }).onClick,
    ).toBeUndefined()
    expect(onContinueTraining).not.toHaveBeenCalled()
  })
})

describe('R6 module picker intents and states', () => {
  it('returns each real module/session identity through its own callback', () => {
    const onStartRequested = vi.fn()
    const onResumeRequested = vi.fn()
    const onRetryRequested = vi.fn()
    const screen = ExtraTrainingPickerScreen({
      viewModel: pickerViewModel,
      onStartRequested,
      onResumeRequested,
      onRetryRequested,
      onReturnToCompletedPlan: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('继续训练')
    expect(markup).toContain('不会改变今日 3/3 完成状态')
    expect(markup).toContain('data-module-id="vocabulary"')
    expect(markup).toContain('data-module-id="listening"')
    expect(markup).toContain('data-module-id="speaking"')
    expect(markup).toContain('剩余有效时间')
    expect(markup).toContain('12:14')
    expect(markup).toContain('累计完成')
    expect(markup).toContain('5 题')

    ;(
      buttonByAccessibleLabel(
        screen,
        '开始 15 分钟：词汇额外训练',
      ).props as { readonly onClick: () => void }
    ).onClick()
    ;(
      buttonByAccessibleLabel(
        screen,
        '继续上次训练：听力额外训练',
      ).props as { readonly onClick: () => void }
    ).onClick()
    ;(
      buttonByAccessibleLabel(
        screen,
        '重试口语训练：口语额外训练',
      ).props as { readonly onClick: () => void }
    ).onClick()

    expect(onStartRequested).toHaveBeenCalledWith('vocabulary')
    expect(onResumeRequested).toHaveBeenCalledWith(
      'extra:listening:paused',
    )
    expect(onRetryRequested).toHaveBeenCalledWith(
      'extra:speaking:failed',
    )
  })

  it.each([
    [
      {
        moduleId: 'vocabulary',
        title: '词汇额外训练',
        description: '继续练习。',
        targetEffectiveSeconds: 900,
        status: 'running',
        sessionId: 'extra:vocabulary:running',
        remainingEffectiveSeconds: 501,
        completedItemCount: 8,
        resumeAction: { label: '返回进行中的训练' },
      },
      '正在进行',
      '08:21',
    ],
    [
      {
        moduleId: 'listening',
        title: '听力额外训练',
        description: '继续练习。',
        targetEffectiveSeconds: 900,
        status: 'completed',
        sessionId: 'extra:listening:completed',
        remainingEffectiveSeconds: 0,
        completedItemCount: 19,
        startAction: { label: '再练 15 分钟' },
      },
      '本轮已完成',
      '19 题',
    ],
    [
      {
        moduleId: 'speaking',
        title: '口语额外训练',
        description: '继续练习。',
        targetEffectiveSeconds: 900,
        status: 'content-exhausted',
        sessionId: 'extra:speaking:exhausted',
        remainingEffectiveSeconds: 420,
        completedItemCount: 9,
        failureDescription:
          '当前范围内没有可继续提供的合格题目，进度已保存。',
        retryAction: { label: '重新获取题目' },
      },
      '题库暂时不足',
      '进度已保存',
    ],
    [
      {
        moduleId: 'vocabulary',
        title: '词汇额外训练',
        description: '继续练习。',
        targetEffectiveSeconds: 900,
        status: 'expired',
        sessionId: 'extra:vocabulary:expired',
        completedItemCount: 3,
        startAction: { label: '开始今天的新训练' },
      },
      '上次训练已跨日结束',
      '3 题',
    ],
  ] as const)(
    'renders the externally supplied %s state without reclassifying it',
    (module, stateCopy, detailCopy) => {
      const markup = renderToStaticMarkup(
        <ExtraTrainingPickerScreen
          viewModel={{
            modules: [module],
            returnAction: { label: '返回今日完成' },
          }}
          onStartRequested={() => undefined}
          onResumeRequested={() => undefined}
          onRetryRequested={() => undefined}
          onReturnToCompletedPlan={() => undefined}
        />,
      )

      expect(markup).toContain(
        `data-extra-training-status="${module.status}"`,
      )
      expect(markup).toContain(stateCopy)
      expect(markup).toContain(detailCopy)
    },
  )

  it('suppresses a rapid duplicate request until the first intent settles', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const onStartRequested = vi.fn(() => pending)
    const screen = ExtraTrainingPickerScreen({
      viewModel: {
        modules: [pickerViewModel.modules[0]!],
        returnAction: { label: '返回今日完成' },
      },
      onStartRequested,
      onResumeRequested: () => undefined,
      onRetryRequested: () => undefined,
      onReturnToCompletedPlan: () => undefined,
    })
    const button = buttonByAccessibleLabel(
      screen,
      '开始 15 分钟：词汇额外训练',
    )
    const onClick = (
      button.props as { readonly onClick: () => void }
    ).onClick

    onClick()
    onClick()
    expect(onStartRequested).toHaveBeenCalledOnce()
    release()
    await pending
  })

  it('does not send busy or disabled start/retry actions', () => {
    const onStartRequested = vi.fn()
    const onRetryRequested = vi.fn()
    const screen = ExtraTrainingPickerScreen({
      viewModel: {
        modules: [
          {
            ...pickerViewModel.modules[0]!,
            status: 'available',
            startAction: {
              label: '开始 15 分钟',
              disabled: true,
              disabledReason: '请等待当前保存完成。',
            },
          },
          {
            ...(pickerViewModel.modules[2]! as Extract<
              ExtraTrainingModuleViewModel,
              { readonly status: 'failed' }
            >),
            status: 'failed',
            retryAction: {
              label: '重试口语训练',
              loading: true,
            },
          },
        ],
        returnAction: { label: '返回今日完成' },
      },
      onStartRequested,
      onResumeRequested: () => undefined,
      onRetryRequested,
      onReturnToCompletedPlan: () => undefined,
    })
    const buttons = collectHostElements(screen, 'button')
    const markup = renderToStaticMarkup(screen)

    expect(buttons[0]?.props).toMatchObject({ disabled: true })
    expect(buttons[1]?.props).toMatchObject({
      disabled: true,
      'aria-busy': true,
    })
    expect(markup).toContain('请等待当前保存完成')
    expect(markup).toContain('正在处理')
    expect(onStartRequested).not.toHaveBeenCalled()
    expect(onRetryRequested).not.toHaveBeenCalled()
  })
})

describe('R6 dedicated extra-training page adapters', () => {
  it('adapts all three existing training screens without changing their question callbacks', () => {
    const vocabularyMarkup = renderToStaticMarkup(
      <ExtraVocabularyTrainingScreen
        viewModel={vocabularyViewModel}
        extraTraining={runningSession('vocabulary')}
        onExitRequested={() => undefined}
        onRetryRequested={() => undefined}
        onSelect={() => undefined}
        onAction={() => undefined}
      />,
    )
    const listeningMarkup = renderToStaticMarkup(
      <ExtraListeningTrainingScreen
        viewModel={listeningViewModel}
        extraTraining={{
          ...runningSession('listening'),
          budget: {
            status: 'finish-current-item',
            targetEffectiveSeconds: 900,
            remainingEffectiveSeconds: 0,
            completedItemCount: 14,
          },
        }}
        onExitRequested={() => undefined}
        onRetryRequested={() => undefined}
        onToggleAudio={() => undefined}
        onPlaybackRateChange={() => undefined}
        onSegmentChange={() => undefined}
        onRepeatModeChange={() => undefined}
        onQuestionInput={() => undefined}
        onAction={() => undefined}
      />,
    )
    const speakingMarkup = renderToStaticMarkup(
      <ExtraSpeakingTrainingScreen
        viewModel={speakingViewModel}
        extraTraining={runningSession('speaking')}
        onExitRequested={() => undefined}
        onRetryRequested={() => undefined}
        onRecorderAction={() => undefined}
        onAction={() => undefined}
      />,
    )

    for (const markup of [
      vocabularyMarkup,
      listeningMarkup,
      speakingMarkup,
    ]) {
      expect(markup).toContain('额外训练')
      expect(markup).toContain('退出并保存当前进度')
      expect(markup).toContain('不会改变今日 3/3 完成状态')
      expect(markup).toContain('剩余有效时间')
      expect(markup).toContain('累计完成题数')
      expect(markup).not.toContain('完成每日任务')
    }
    expect(vocabularyMarkup).toContain(
      'aria-label="退出并保存额外词汇训练"',
    )
    expect(listeningMarkup).toContain(
      'aria-label="退出并保存额外听力训练"',
    )
    expect(speakingMarkup).toContain(
      'aria-label="退出并保存额外口语训练"',
    )
    expect(listeningMarkup).toContain(
      '时间已到，完成本题后结束',
    )
  })

  it('returns the untouched sessionId for exit and exhausted-content retry', () => {
    const onExitRequested = vi.fn()
    const onRetryRequested = vi.fn()
    const sessionId = 'extra:vocabulary:exact-session'
    const adapter = ExtraVocabularyTrainingScreen({
      viewModel: vocabularyViewModel,
      extraTraining: {
        sessionId,
        moduleId: 'vocabulary',
        budget: {
          status: 'content-exhausted',
          targetEffectiveSeconds: 900,
          remainingEffectiveSeconds: 315,
          completedItemCount: 11,
          contentExhausted: {
            reason: 'all-eligible-content-recently-used',
            description: '近期题目暂时都已使用。',
          },
          retryAction: { label: '重新获取题目' },
        },
        exitAction: { label: '退出并保存' },
      },
      onExitRequested,
      onRetryRequested,
      onSelect: () => undefined,
      onAction: () => undefined,
    })
    const props = adapter.props as {
      readonly onExit: () => void
      readonly onRetryTrainingContent: () => void
    }

    props.onExit()
    props.onRetryTrainingContent()
    expect(onExitRequested).toHaveBeenCalledWith(sessionId)
    expect(onRetryRequested).toHaveBeenCalledWith(sessionId)
  })

  it('prevents exit while upstream is saving and exposes the reason to assistive tech', () => {
    const onExitRequested = vi.fn()
    const markup = renderToStaticMarkup(
      <ExtraSpeakingTrainingScreen
        viewModel={speakingViewModel}
        extraTraining={{
          ...runningSession('speaking'),
          exitAction: {
            label: '退出并保存',
            loading: true,
            disabledReason: '正在保存录音与当前进度。',
          },
        }}
        onExitRequested={onExitRequested}
        onRetryRequested={() => undefined}
        onRecorderAction={() => undefined}
        onAction={() => undefined}
      />,
    )

    expect(markup).toContain(
      'aria-label="正在保存额外口语训练"',
    )
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('正在保存录音与当前进度')
    expect(onExitRequested).not.toHaveBeenCalled()
  })

  it('keeps the normal daily training surface unchanged when no adapter is used', () => {
    const markup = renderToStaticMarkup(
      <VocabularyTrainingScreen
        viewModel={vocabularyViewModel}
        onExit={() => undefined}
        onSelect={() => undefined}
        onAction={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="退出词汇训练"')
    expect(markup).toContain('内容估算')
    expect(markup).not.toContain('EXTRA PRACTICE')
    expect(markup).not.toContain('额外训练')
  })
})

describe('R6 extra-training completion and UI guardrails', () => {
  it('returns completion navigation intents with the original sessionId and exact score UI', () => {
    const onChooseAnotherRequested = vi.fn()
    const onReturnToCompletedPlan = vi.fn()
    const sessionId = 'extra:listening:complete'
    const screen = ExtraTrainingCompletionScreen({
      viewModel: {
        sessionId,
        moduleId: 'listening',
        title: '额外听力训练完成',
        description: '本轮有效训练已经保存。',
        completedItemCount: 21,
        score: { state: 'available', correctCount: 16, totalCount: 20, percentage: 80, unscorableCount: 1 },
        actualDuration: {
          state: 'reliable',
          effectiveSeconds: 917,
          source: 'timing-segments',
        },
        chooseAgainAction: { label: '再练 15 分钟' },
        returnAction: { label: '返回今日完成' },
      },
      onChooseAnotherRequested,
      onReturnToCompletedPlan,
    })
    const markup = renderToStaticMarkup(screen)
    const buttons = collectHostElements(screen, 'button')

    expect(markup).toContain('额外听力训练完成')
    expect(markup).toContain('本轮累计完成 21 题')
    expect(markup).toContain('再练 15 分钟')
    expect(markup).toContain('返回今日完成')
    expect(markup).toContain('16 / 20')
    expect(markup).toContain('正确率 80%')
    expect(markup).toContain('另有 1 题')
    expect(markup).not.toContain('等级')

    ;(
      buttons[0]!.props as { readonly onClick: () => void }
    ).onClick()
    ;(
      buttons[1]!.props as { readonly onClick: () => void }
    ).onClick()
    expect(onChooseAnotherRequested).toHaveBeenCalledWith(sessionId)
    expect(onReturnToCompletedPlan).toHaveBeenCalledWith(sessionId)
  })

  it('retains 320/390px, 200% type, safe-area, focus and touch rules', () => {
    const css = readFileSync(
      new URL('./styles/extra-training.css', import.meta.url),
      'utf8',
    )
    const appCss = readFileSync(
      new URL('./styles/app.css', import.meta.url),
      'utf8',
    )

    expect(css).toContain('width: min(100%, 480px)')
    expect(css).toContain('@media (width <= 360px)')
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('min-height: 48px')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toMatch(/font-size:\s*(?:clamp|[0-9.]+rem)/)
    expect(appCss).toContain(':focus-visible')
  })

  it('contains no timer, session generator, plan mutation or business calculation', () => {
    const source = [
      './extra-training-view-models.ts',
      './extra-training-surfaces.tsx',
    ]
      .map((file) =>
        readFileSync(new URL(file, import.meta.url), 'utf8'),
      )
      .join('\n')

    expect(source).not.toMatch(
      /Date\.now|performance\.now|setInterval|setTimeout/,
    )
    expect(source).not.toMatch(/randomUUID|createExtraTrainingSession/)
    expect(source).not.toMatch(/PlanProgress|dailyPlan\.completed/)
    expect(source).not.toMatch(/remainingEffectiveSeconds\s*[-+]/)
  })
})
