import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AssessmentChoiceScreen,
  AssessmentPausedScreen,
  AssessmentSpeechScreen,
  type AssessmentChoiceScreenProps,
  type AssessmentChoiceViewModel,
  type AssessmentPausedViewModel,
  type AssessmentSpeechViewModel,
} from './index.ts'

const sessionId = 'assessment-session-original'
const itemId = 'assessment-item-original'

const choiceViewModel: AssessmentChoiceViewModel = {
  sessionId,
  itemId,
  header: {
    eyebrow: 'VOCABULARY',
    title: '水平测试',
    progress: { label: '词汇阶段 · 第 3 题', value: 32 },
  },
  instruction: '选择最合适的含义',
  prompt: 'What does “check in” mean here?',
  choices: [
    { id: 'option-a', label: '办理入住', state: 'selected' },
    { id: 'option-b', label: '查看里面', state: 'default' },
  ],
  primaryAction: {
    kind: 'submit',
    label: '提交答案',
    disabled: false,
  },
  skipAction: {
    label: '跳过本题',
    disabled: false,
  },
  pauseAction: {
    label: '暂停测试',
    disabled: false,
  },
}

function choiceProps(
  overrides: Partial<AssessmentChoiceScreenProps> = {},
): AssessmentChoiceScreenProps {
  return {
    viewModel: choiceViewModel,
    onExit: () => undefined,
    onSelect: () => undefined,
    onSubmit: () => undefined,
    onContinue: () => undefined,
    onSkip: () => undefined,
    onPause: () => undefined,
    ...overrides,
  }
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
        const props = child.props
        visit(renderFunction(props))
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

function buttonByAriaLabel(
  node: ReactNode,
  ariaLabel: string,
): ReactElement<{
  readonly 'aria-label'?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly type?: string
}> {
  const button = collectHostElements(node, 'button').find(
    (candidate) =>
      (candidate.props as { readonly 'aria-label'?: string })[
        'aria-label'
      ] === ariaLabel,
  )

  expect(button).toBeDefined()
  return button as ReactElement<{
    readonly 'aria-label'?: string
    readonly disabled?: boolean
    readonly onClick?: () => void
    readonly type?: string
  }>
}

describe('assessment UI runtime contract', () => {
  it('returns exact session, item and option IDs for choice actions', () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn()
    const onSkip = vi.fn()
    const onPause = vi.fn()
    const screen = AssessmentChoiceScreen(
      choiceProps({ onSelect, onSubmit, onSkip, onPause }),
    )

    const choiceButton = collectHostElements(screen, 'button').find(
      (button) =>
        (button.props as { readonly role?: string; readonly children?: ReactNode })
          .role === 'radio' &&
        renderToStaticMarkup(button).includes('查看里面'),
    )
    expect(choiceButton).toBeDefined()
    if (!choiceButton) {
      throw new Error('Expected the second assessment choice button')
    }
    const clickChoice = (
      choiceButton.props as { readonly onClick: () => void }
    ).onClick
    clickChoice()
    buttonByAriaLabel(screen, '提交答案').props.onClick?.()
    buttonByAriaLabel(screen, '跳过本题').props.onClick?.()
    buttonByAriaLabel(screen, '暂停测试').props.onClick?.()

    expect(onSelect).toHaveBeenCalledWith({
      sessionId,
      itemId,
      optionId: 'option-b',
    })
    expect(onSubmit).toHaveBeenCalledWith({ sessionId, itemId })
    expect(onSkip).toHaveBeenCalledWith({ sessionId, itemId })
    expect(onPause).toHaveBeenCalledWith({ sessionId, itemId })
  })

  it('uses a dedicated continue callback and displays audio failure fallback', () => {
    const onSubmit = vi.fn()
    const onContinue = vi.fn()
    const viewModel: AssessmentChoiceViewModel = {
      ...choiceViewModel,
      choices: choiceViewModel.choices.map((choice) => ({
        ...choice,
        state: 'disabled',
      })),
      submission: {
        itemId,
        status: 'unscorable',
        failureReason: 'audio-playback-failed',
        fallback: {
          kind: 'retry-audio',
          label: '先检查音频',
          description: '本题没有按答错记录。',
        },
        feedback: {
          tone: 'device',
          title: '音频播放失败',
          description: '本题未计入能力结果。',
        },
      },
      primaryAction: {
        kind: 'continue',
        label: '继续下一题',
        disabled: false,
      },
      skipAction: undefined,
    }
    const screen = AssessmentChoiceScreen(
      choiceProps({ viewModel, onSubmit, onContinue }),
    )
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('data-submission-status="unscorable"')
    expect(markup).toContain(
      'data-failure-reason="audio-playback-failed"',
    )
    expect(markup).toContain('data-fallback="retry-audio"')
    expect(markup).toContain('本题没有按答错记录。')
    expect(markup).toContain('继续下一题')
    expect(markup).not.toContain('提交答案')
    expect(markup).not.toContain('跳过本题')

    buttonByAriaLabel(screen, '继续下一题').props.onClick?.()
    expect(onContinue).toHaveBeenCalledWith({ sessionId, itemId })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('presents a skipped submission as a recorded state without fallback', () => {
    const viewModel: AssessmentChoiceViewModel = {
      ...choiceViewModel,
      submission: {
        itemId,
        status: 'skipped',
        failureReason: 'user-skipped',
        fallback: null,
        feedback: {
          tone: 'info',
          title: '本题已跳过',
          description: '可以继续下一题。',
        },
      },
      primaryAction: {
        kind: 'continue',
        label: '继续下一题',
        disabled: false,
      },
      skipAction: undefined,
    }
    const markup = renderToStaticMarkup(
      <AssessmentChoiceScreen {...choiceProps({ viewModel })} />,
    )

    expect(markup).toContain('data-submission-status="skipped"')
    expect(markup).toContain('data-failure-reason="user-skipped"')
    expect(markup).toContain('本题已跳过')
    expect(markup).not.toContain('data-fallback=')
  })

  it('exposes speech skip and recording-playback degradation without scoring it', () => {
    const onSkip = vi.fn()
    const onPlayback = vi.fn()
    const onToggleAudio = vi.fn()
    const viewModel: AssessmentSpeechViewModel = {
      sessionId,
      itemId,
      header: {
        eyebrow: 'SPEAKING',
        title: '水平测试',
      },
      instruction: '先听音频，再跟读',
      prompt: 'Could you show me where the restroom is?',
      audio: {
        status: 'paused',
        elapsedLabel: '00:00',
        durationLabel: '系统语音',
        progressValue: 0,
        playCountLabel: '0/2 次',
        statusLabel: '可以播放',
      },
      recorder: {
        status: 'review',
        statusLabel: '录音已保存',
        playbackAvailable: true,
      },
      submission: {
        itemId,
        status: 'unscorable',
        failureReason: 'recognition-failed',
        fallback: {
          kind: 'recording-playback',
          label: '录音仍可回放',
          description: '本题未计分。',
        },
        feedback: {
          tone: 'device',
          title: '识别没有成功',
        },
      },
      primaryAction: {
        kind: 'continue',
        label: '继续下一题',
        disabled: false,
      },
      skipAction: {
        label: '跳过本题',
        disabled: false,
      },
    }
    const screen = AssessmentSpeechScreen({
      viewModel,
      onExit: () => undefined,
      onToggleAudio,
      onRecorderAction: () => undefined,
      onPlayback,
      onSubmit: () => undefined,
      onContinue: () => undefined,
      onSkip,
      onPause: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('data-fallback="recording-playback"')
    expect(markup).toContain('data-failure-reason="recognition-failed"')
    expect(markup).toContain('aria-label="音频播放器"')
    expect(markup).toContain('0/2 次')
    buttonByAriaLabel(screen, '跳过本题').props.onClick?.()
    buttonByAriaLabel(screen, '播放音频').props.onClick?.()
    buttonByAriaLabel(screen, '播放录音').props.onClick?.()

    expect(onSkip).toHaveBeenCalledWith({ sessionId, itemId })
    expect(onToggleAudio).toHaveBeenCalledWith({ sessionId, itemId })
    expect(onPlayback).toHaveBeenCalledWith({ sessionId, itemId })
  })

  it('does not render a speech example player without an audio ViewModel', () => {
    const viewModel: AssessmentSpeechViewModel = {
      sessionId,
      itemId,
      header: {
        eyebrow: 'SPEAKING',
        title: '水平测试',
      },
      instruction: '用英语回答',
      prompt: 'What would you say at the hotel desk?',
      recorder: {
        status: 'ready',
        statusLabel: '可以开始录音',
      },
      primaryAction: {
        kind: 'submit',
        label: '提交录音',
        disabled: true,
      },
    }
    const markup = renderToStaticMarkup(
      <AssessmentSpeechScreen
        viewModel={viewModel}
        onExit={() => undefined}
        onToggleAudio={() => undefined}
        onRecorderAction={() => undefined}
        onSubmit={() => undefined}
        onContinue={() => undefined}
        onSkip={() => undefined}
        onPause={() => undefined}
      />,
    )

    expect(markup).not.toContain('aria-label="音频播放器"')
    expect(markup).not.toContain('播放音频')
  })

  it('renders disabled actions honestly with native button semantics', () => {
    const viewModel: AssessmentChoiceViewModel = {
      ...choiceViewModel,
      primaryAction: {
        kind: 'submit',
        label: '提交答案',
        disabled: true,
        disabledReason: '请先选择一个答案。',
      },
      skipAction: {
        label: '跳过本题',
        disabled: true,
        disabledReason: '当前状态不允许跳过。',
      },
    }
    const screen = AssessmentChoiceScreen(choiceProps({ viewModel }))
    const submit = buttonByAriaLabel(
      screen,
      '提交答案，请先选择一个答案。',
    )
    const skip = buttonByAriaLabel(
      screen,
      '跳过本题，当前状态不允许跳过。',
    )

    expect(submit.props.type).toBe('button')
    expect(submit.props.disabled).toBe(true)
    expect(skip.props.type).toBe('button')
    expect(skip.props.disabled).toBe(true)
  })

  it('uses the paused runtime session for resume and stop actions', () => {
    const onResume = vi.fn()
    const onStop = vi.fn()
    const viewModel: AssessmentPausedViewModel = {
      sessionId,
      header: {
        eyebrow: 'ASSESSMENT',
        title: '水平测试',
      },
      statusLabel: '测试已暂停',
      title: '准备好后继续',
      description: '恢复后会回到刚才的状态。',
      resumeAction: {
        label: '继续测试',
        disabled: false,
      },
      stopAction: {
        label: '结束并保留部分结果',
        disabled: false,
      },
    }
    const screen = AssessmentPausedScreen({
      viewModel,
      onExit: () => undefined,
      onResume,
      onStop,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain(
      `data-session-id="${sessionId}"`,
    )
    expect(markup).toContain('aria-labelledby="assessment-paused-title"')
    expect(markup).not.toContain('重新开始')
    buttonByAriaLabel(screen, '继续测试').props.onClick?.()
    buttonByAriaLabel(screen, '结束并保留部分结果').props.onClick?.()

    expect(onResume).toHaveBeenCalledWith(sessionId)
    expect(onStop).toHaveBeenCalledWith(sessionId)
  })
})
