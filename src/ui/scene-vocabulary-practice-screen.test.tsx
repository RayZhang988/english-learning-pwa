import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  SceneVocabularyPracticeScreen,
  type SceneVocabularyPracticeScreenProps,
  type SceneVocabularyPracticeView,
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
      if (typeof child.type === 'function') {
        visit(
          (
            child.type as (
              props: Record<string, unknown>,
            ) => ReactNode
          )(child.props as Record<string, unknown>),
        )
        continue
      }
      visit(
        (child.props as { readonly children?: ReactNode }).children,
      )
    }
  }

  visit(node)
  return found
}

function buttonByLabel(node: ReactNode, label: string): ReactElement {
  const button = collectHostElements(node, 'button').find(
    (element) =>
      (element.props as { readonly 'aria-label'?: string })['aria-label'] ===
      label,
  )
  expect(button).toBeDefined()
  return button!
}

function buttonByOptionId(node: ReactNode, optionId: string): ReactElement {
  const button = collectHostElements(node, 'button').find(
    (element) =>
      (element.props as { readonly 'data-scene-vocabulary-option'?: string })[
        'data-scene-vocabulary-option'
      ] === optionId,
  )
  expect(button).toBeDefined()
  return button!
}

const questionView: SceneVocabularyPracticeView = {
  status: 'question',
  progress: {
    answeredCount: 2,
    correctCount: 1,
    incorrectCount: 1,
    accuracy: 0.5,
  },
  question: {
    questionId: 'airport-passport-01',
    promptZh: '这个词是什么意思？',
    sentenceEn: {
      beforeTarget: 'Could I see your ',
      targetText: 'passport',
      afterTarget: ', please?',
    },
    options: [
      { id: 'passport:1', labelZh: '护照', state: 'default' },
      { id: 'passport:2', labelZh: '登机牌', state: 'selected' },
      { id: 'passport:3', labelZh: '行李', state: 'default' },
      { id: 'passport:4', labelZh: '机场', state: 'default' },
    ],
    targetPlayback: {
      intent: 'play-target-only',
      text: 'passport',
      locale: 'en-US',
    },
  },
}

function props(
  presentation: SceneVocabularyPracticeScreenProps['presentation'],
  callbacks: Partial<SceneVocabularyPracticeScreenProps> = {},
): SceneVocabularyPracticeScreenProps {
  return {
    presentation,
    sceneTitle: '机场与航班',
    onExit: vi.fn(),
    onOptionSelected: vi.fn(),
    onSubmit: vi.fn(),
    onContinue: vi.fn(),
    onTargetPlayback: vi.fn(),
    ...callbacks,
  }
}

describe('SceneVocabularyPracticeScreen R13-B display contract', () => {
  it('renders the released phrase, a target-only playback control, and Chinese choices', () => {
    const screen = SceneVocabularyPracticeScreen(
      props({ status: 'ready', view: questionView }),
    )
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('Could I see your ')
    expect(markup).toContain('>passport</button>')
    expect(markup).toContain(', please?')
    expect(markup).toContain('passport 是什么意思？')
    expect(markup).toContain('护照')
    expect(markup).toContain('已答题</dt><dd>2</dd>')
    expect(markup).toContain('答对</dt><dd>1</dd>')
    expect(markup).toContain('正确率</dt><dd>50%</dd>')
    expect(markup).toContain('data-target-playback="play-target-only"')
    expect(markup).not.toContain('audio-player')
    expect(markup).not.toContain('播放整句')
    expect(markup).not.toContain('自评')
  })

  it('returns unchanged target-only and option intents without interpreting correctness', () => {
    const onTargetPlayback = vi.fn()
    const onOptionSelected = vi.fn()
    const screen = SceneVocabularyPracticeScreen(
      props(
        { status: 'ready', view: questionView },
        { onTargetPlayback, onOptionSelected },
      ),
    )

    ;(
      buttonByLabel(screen, '播放单词 passport 的发音').props as {
        readonly onClick: () => void
      }
    ).onClick()
    ;(
      buttonByOptionId(screen, 'passport:1').props as {
        readonly onClick: () => void
      }
    ).onClick()

    expect(onTargetPlayback).toHaveBeenCalledWith(questionView.question!.targetPlayback)
    expect(onOptionSelected).toHaveBeenCalledWith('passport:1')
  })

  it('shows scored feedback and locks choices until the caller continues', () => {
    const onContinue = vi.fn()
    const feedbackView: SceneVocabularyPracticeView = {
      ...questionView,
      status: 'feedback',
      question: {
        ...questionView.question!,
        options: [
          { id: 'passport:1', labelZh: '护照', state: 'correct' },
          { id: 'passport:2', labelZh: '登机牌', state: 'incorrect' },
          { id: 'passport:3', labelZh: '行李', state: 'default' },
          { id: 'passport:4', labelZh: '机场', state: 'default' },
        ],
      },
      feedback: {
        correct: false,
        correctMeaningZh: '护照',
      },
    }
    const screen = SceneVocabularyPracticeScreen(
      props({ status: 'ready', view: feedbackView }, { onContinue }),
    )
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('回答不正确')
    expect(markup).toContain('正确词义：<strong>护照</strong>')
    expect(
      (buttonByOptionId(screen, 'passport:1').props as {
        readonly disabled?: boolean
      }).disabled,
    ).toBe(true)
    const continueButton = collectHostElements(screen, 'button').find(
      (element) =>
        renderToStaticMarkup(element).includes('继续'),
    )
    expect(continueButton).toBeDefined()
    ;(
      continueButton!.props as { readonly onClick: () => void }
    ).onClick()
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('renders ongoing cumulative accuracy without a pool-sized completion target', () => {
    const markup = renderToStaticMarkup(
      SceneVocabularyPracticeScreen(props({ status: 'ready', view: questionView })),
    )

    expect(markup).not.toContain('/ 6')
    expect(markup).not.toContain('场景词汇练习完成')
    expect(markup).not.toContain('倒计时')
    expect(markup).not.toContain('你觉得自己答对了吗')
  })

  it('offers an explicit saved-session choice and formats zero answers as unavailable', () => {
    const onResumePrevious = vi.fn()
    const onStartNewRound = vi.fn()
    const resumeView: SceneVocabularyPracticeView = {
      ...questionView,
      progress: {
        answeredCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        accuracy: null,
      },
    }
    const screen = SceneVocabularyPracticeScreen(props(
      { status: 'resume-choice', view: resumeView },
      { onResumePrevious, onStartNewRound },
    ))
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('继续上次训练？')
    expect(markup).toContain('正确率</dt><dd>暂无</dd>')
    expect(markup).not.toContain('/ 6')
    const buttons = collectHostElements(screen, 'button')
    const resume = buttons.find((element) => renderToStaticMarkup(element).includes('继续上次训练'))!
    const newRound = buttons.find((element) => renderToStaticMarkup(element).includes('开始新一轮'))!
    ;(resume.props as { readonly onClick: () => void }).onClick()
    ;(newRound.props as { readonly onClick: () => void }).onClick()
    expect(onResumePrevious).toHaveBeenCalledOnce()
    expect(onStartNewRound).toHaveBeenCalledOnce()
  })

  it('shows loading, error, and restored-progress feedback supplied by the integration', () => {
    const loading = renderToStaticMarkup(
      SceneVocabularyPracticeScreen(
        props({ status: 'loading', label: '正在恢复机场场景练习' }),
      ),
    )
    const error = renderToStaticMarkup(
      SceneVocabularyPracticeScreen(
        props({
          status: 'error',
          description: '课程内容暂时无法读取，已保存的练习不会丢失。',
        }, { onRetry: vi.fn() }),
      ),
    )
    const restored = renderToStaticMarkup(
      SceneVocabularyPracticeScreen(
        props({
          status: 'ready',
          view: questionView,
          recoveryNotice: {
            title: '已恢复上次练习',
            description: '已答 2 题，继续完成本场练习。',
          },
        }),
      ),
    )

    expect(loading).toContain('正在恢复机场场景练习')
    expect(error).toContain('课程内容暂时无法读取')
    expect(error).toContain('重新加载')
    expect(restored).toContain('已恢复上次练习')
    expect(restored).toContain('已答 2 题，继续完成本场练习。')
  })
})
