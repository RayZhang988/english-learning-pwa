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
  TravelVocabularyR1IntroScreen,
  TravelVocabularyR1MigrationScreen,
  TravelVocabularyR1QuestionScreen,
  TravelVocabularyR1ResultsScreen,
  TravelVocabularyR1ResumeScreen,
  TravelVocabularyR1StageResultScreen,
  TravelVocabularyR1StageReviewScreen,
  TravelVocabularyR1StatusScreen,
  type TravelVocabularyR1ActionViewModel,
  type TravelVocabularyR1QuestionViewModel,
  type TravelVocabularyR1ResultsViewModel,
  type TravelVocabularyR1StageResultViewModel,
  type TravelVocabularyR1StageRouteItemViewModel,
} from './index.ts'

const sessionId = 'travel-r1-session-exact'

const action = (
  label: string,
  disabled = false,
  disabledReason?: string,
): TravelVocabularyR1ActionViewModel => ({
  label,
  disabled,
  disabledReason,
})

const stages: readonly TravelVocabularyR1StageRouteItemViewModel[] = [
  {
    id: 'stage-1-foundation',
    order: 1,
    label: '基础',
    state: 'complete',
  },
  {
    id: 'stage-2-essential',
    order: 2,
    label: '核心',
    state: 'current',
  },
  {
    id: 'stage-3-independent',
    order: 3,
    label: '独立',
    state: 'upcoming',
  },
  {
    id: 'stage-4-advanced',
    order: 4,
    label: '进阶',
    state: 'upcoming',
  },
  {
    id: 'stage-5-specialized',
    order: 5,
    label: '高阶',
    state: 'upcoming',
  },
]

const questionMap: TravelVocabularyR1QuestionViewModel['questionMap'] =
  Array.from({ length: 30 }, (_, index) => ({
    questionId: `r1-question-${index + 1}`,
    questionIndex: index,
    numberLabel: String(index + 1),
    answerState:
      index < 5
        ? 'answered'
        : index === 5
          ? 'uncertain'
          : 'unanswered',
    current: index === 6,
    disabled: false,
  }))

const questionViewModel: TravelVocabularyR1QuestionViewModel = {
  sessionId,
  stage: {
    id: 'stage-2-essential',
    order: 2,
    label: '核心旅行词汇',
    representativeWordCountLabel: '代表 500 个旅游词汇',
  },
  stages,
  headerProgress: {
    label: '总进度 37 / 150',
    value: 24.67,
  },
  stageProgressLabel: '第 7 / 30 题',
  answeredLabel: '本阶段已答 6 题',
  elapsedLabel: '有效时间 08:20',
  question: {
    id: 'r1-question-7',
    index: 6,
    numberLabel: '7',
    prompt: '请选择最接近的中文释义',
    word: 'reservation',
    answerState: 'choice',
    options: [
      {
        id: 'option-hotel',
        label: '预订；预约',
        selected: true,
        disabled: false,
      },
      {
        id: 'option-luggage',
        label: '行李领取处',
        selected: false,
        disabled: false,
      },
      {
        id: 'option-platform',
        label: '站台',
        selected: false,
        disabled: false,
      },
      {
        id: 'option-receipt',
        label: '收据',
        selected: false,
        disabled: false,
      },
    ],
  },
  questionMap,
  previousTarget: {
    sessionId,
    questionId: 'r1-question-6',
    questionIndex: 5,
  },
  nextTarget: {
    sessionId,
    questionId: 'r1-question-8',
    questionIndex: 7,
  },
  previousAction: action('上一题'),
  nextAction: action('下一题'),
  uncertainAction: action('不认识 / 不确定'),
  clearAction: action('清除本题选择'),
  reviewAction: action(
    '检查本阶段',
    false,
    '仍有 24 题未作答，可以先检查。',
  ),
  pauseAction: action('暂停并保存'),
  notice: {
    kind: 'restored',
    title: '已恢复本机进度',
    description: '继续使用上次保存的原题和选项顺序。',
  },
}

const lowScoreStageResult: TravelVocabularyR1StageResultViewModel = {
  sessionId,
  stage: {
    id: 'stage-1-foundation',
    order: 1,
    label: '基础出行词汇',
  },
  stages: stages.map((stage) =>
    stage.order === 1
      ? { ...stage, state: 'complete' as const }
      : stage.order === 2
        ? { ...stage, state: 'current' as const }
        : stage,
  ),
  headerProgress: {
    label: '已完成第 1 / 5 阶段',
    value: 20,
  },
  correctCountLabel: '0 / 30',
  incorrectCountLabel: '18',
  uncertainCountLabel: '12',
  masteryRateLabel: '由 03 提供：0%',
  representativeWordCountLabel: '由 03 提供：300 词',
  estimatedWordsLabel: '由 03 提供：0 词',
  reasonableIntervalLabel: '由 03 提供：0–70 词',
  continueAction: action('进入下一阶段'),
  pauseAction: action('暂停并保存'),
}

const resultStages: TravelVocabularyR1ResultsViewModel['stageResults'] =
  stages.map((stage) => ({
    id: stage.id,
    order: stage.order,
    label: stage.label,
    correctCountLabel: `${stage.order * 4} / 30`,
    masteryRateLabel: `外部比例 ${stage.order}`,
    representativeWordCountLabel: `外部代表词数 ${stage.order}`,
    estimatedWordsLabel: `外部估算 ${stage.order}`,
    reasonableIntervalLabel: `外部区间 ${stage.order}`,
  }))

const resultsViewModel: TravelVocabularyR1ResultsViewModel = {
  sessionId,
  levelLabel: '小学六年级',
  estimatedWordsLabel: '1,030 词',
  reasonableIntervalLabel: '合理区间 760–1,420 词',
  answeredCountLabel: '150 题',
  correctCountLabel: '74 题',
  uncertainCountLabel: '21 题',
  elapsedLabel: '31 分 42 秒',
  stageResults: resultStages,
  vocabularyCalibrationLabel: '已估算',
  listeningCalibrationLabel: '待校准',
  speakingCalibrationLabel: '待校准',
  calibrationDescription:
    '听力和口语会在后续正常训练中逐步校准。',
  disclaimer:
    '这是基于五阶段随机样本的旅游英语词汇量估算，不是精确词数。',
  levelDisclaimer:
    '内部学习标签不代表学历、学校成绩，也不代表通过 CET-4 或 CET-6。',
  continueAction: action('生成首日计划'),
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

type ButtonProps = {
  readonly 'aria-label'?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly role?: string
}

function buttonByAriaLabel(
  node: ReactNode,
  label: string,
): ReactElement<ButtonProps> {
  const button = collectHostElements(node, 'button').find(
    (candidate) =>
      (candidate.props as ButtonProps)['aria-label'] === label,
  )

  expect(button).toBeDefined()
  return button as ReactElement<ButtonProps>
}

function buttonContaining(
  node: ReactNode,
  text: string,
): ReactElement<ButtonProps> {
  const button = collectHostElements(node, 'button').find(
    (candidate) =>
      renderToStaticMarkup(candidate).includes(text),
  )

  expect(button).toBeDefined()
  return button as ReactElement<ButtonProps>
}

describe('R1 travel vocabulary UI contract', () => {
  it('explains the R1-only scope without reviving the v1 duration or domains', () => {
    const onStart = vi.fn()
    const screen = TravelVocabularyR1IntroScreen({
      viewModel: {
        sessionId,
        startAction: action('开始第 1 阶段'),
      },
      onStart,
      onExit: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('只测旅游英语单词')
    expect(markup).toContain('5')
    expect(markup).toContain('30')
    expect(markup).toContain('约 150')
    expect(markup).toContain('不设规定时长')
    expect(markup).toContain('可以退出后继续')
    expect(markup).not.toContain('15–20 分钟')
    expect(markup).not.toContain('听力测试')
    expect(markup).not.toContain('口语测试')

    buttonByAriaLabel(screen, '开始第 1 阶段').props.onClick?.()
    expect(onStart).toHaveBeenCalledWith(sessionId)
  })

  it('returns exact session, question, index and option identifiers', () => {
    const onSelectChoice = vi.fn()
    const onMarkUncertain = vi.fn()
    const onClearAnswer = vi.fn()
    const onNavigate = vi.fn()
    const onReviewStage = vi.fn()
    const onPause = vi.fn()
    const screen = TravelVocabularyR1QuestionScreen({
      viewModel: questionViewModel,
      onExit: () => undefined,
      onSelectChoice,
      onMarkUncertain,
      onClearAnswer,
      onNavigate,
      onReviewStage,
      onPause,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('<details')
    expect(markup).toContain('查看本阶段 30 题')
    expect(collectHostElements(screen, 'button')).toHaveLength(41)

    buttonContaining(screen, '行李领取处').props.onClick?.()
    buttonByAriaLabel(screen, '不认识 / 不确定').props.onClick?.()
    buttonByAriaLabel(screen, '8，未答').props.onClick?.()
    buttonByAriaLabel(screen, '清除本题选择').props.onClick?.()
    buttonByAriaLabel(screen, '检查本阶段').props.onClick?.()
    buttonByAriaLabel(screen, '暂停并保存').props.onClick?.()

    expect(onSelectChoice).toHaveBeenCalledWith({
      sessionId,
      questionId: 'r1-question-7',
      questionIndex: 6,
      optionId: 'option-luggage',
    })
    expect(onMarkUncertain).toHaveBeenCalledWith({
      sessionId,
      questionId: 'r1-question-7',
      questionIndex: 6,
    })
    expect(onNavigate).toHaveBeenCalledWith({
      sessionId,
      questionId: 'r1-question-8',
      questionIndex: 7,
    })
    expect(onClearAnswer).toHaveBeenCalledWith({
      sessionId,
      questionId: 'r1-question-7',
      questionIndex: 6,
    })
    expect(onReviewStage).toHaveBeenCalledWith(sessionId)
    expect(onPause).toHaveBeenCalledWith(sessionId)
  })

  it('lists unanswered questions and removes submit behavior until externally enabled', () => {
    const onSubmitStage = vi.fn()
    const onNavigate = vi.fn()
    const screen = TravelVocabularyR1StageReviewScreen({
      viewModel: {
        sessionId,
        stage: {
          id: 'stage-2-essential',
          order: 2,
          label: '核心旅行词汇',
        },
        headerProgress: {
          label: '第 2 / 5 阶段',
          value: 40,
        },
        answeredLabel: '已答 28 / 30',
        reviewDescription: '还有两题未完成。',
        unansweredQuestions: [
          {
            questionId: 'r1-question-9',
            questionIndex: 8,
            numberLabel: '9',
            answerState: 'unanswered',
          },
          {
            questionId: 'r1-question-24',
            questionIndex: 23,
            numberLabel: '24',
            answerState: 'unanswered',
          },
        ],
        submitAction: action(
          '确认提交本阶段',
          true,
          '还有 2 题未作答。',
        ),
        backAction: action('返回继续检查'),
      },
      onExit: () => undefined,
      onBack: () => undefined,
      onNavigate,
      onSubmitStage,
    })
    const submitButton = buttonByAriaLabel(
      screen,
      '确认提交本阶段，还有 2 题未作答。',
    )

    expect(renderToStaticMarkup(screen)).toContain('仍未作答')
    expect(renderToStaticMarkup(screen)).toContain('>9<')
    expect(renderToStaticMarkup(screen)).toContain('>24<')
    expect(submitButton.props.disabled).toBe(true)
    expect(submitButton.props.onClick).toBeUndefined()
    expect(onSubmitStage).not.toHaveBeenCalled()

    buttonByAriaLabel(screen, '返回第 9 题补答').props.onClick?.()
    expect(onNavigate).toHaveBeenCalledWith({
      sessionId,
      questionId: 'r1-question-9',
      questionIndex: 8,
    })
  })

  it('requires an explicit confirmation and submits only when the adapter enables it', () => {
    const onSubmitStage = vi.fn()
    const screen = TravelVocabularyR1StageReviewScreen({
      viewModel: {
        sessionId,
        stage: {
          id: 'stage-2-essential',
          order: 2,
          label: '核心旅行词汇',
        },
        headerProgress: {
          label: '第 2 / 5 阶段',
          value: 40,
        },
        answeredLabel: '已答 30 / 30',
        reviewDescription: '本阶段所有题目均已有答案。',
        unansweredQuestions: [],
        submitAction: action('确认提交本阶段'),
        backAction: action('返回继续检查'),
      },
      onExit: () => undefined,
      onBack: () => undefined,
      onNavigate: () => undefined,
      onSubmitStage,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('30 题均已作答')
    expect(markup).toContain('提交后')
    expect(markup).toContain('不能再修改')
    buttonByAriaLabel(screen, '确认提交本阶段').props.onClick?.()
    expect(onSubmitStage).toHaveBeenCalledWith(sessionId)
  })

  it('keeps the next stage available for a zero score and displays external estimates verbatim', () => {
    const onContinueToNextStage = vi.fn()
    const screen = TravelVocabularyR1StageResultScreen({
      viewModel: lowScoreStageResult,
      onExit: () => undefined,
      onContinueToNextStage,
      onPause: () => undefined,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('0 / 30')
    expect(markup).toContain('由 03 提供：0%')
    expect(markup).toContain('由 03 提供：0 词')
    expect(markup).toContain('由 03 提供：0–70 词')
    expect(markup).toContain('没有满分门槛')

    const continueButton = buttonByAriaLabel(
      screen,
      '进入下一阶段',
    )
    expect(continueButton.props.disabled).toBe(false)
    continueButton.props.onClick?.()
    expect(onContinueToNextStage).toHaveBeenCalledWith(sessionId)
  })

  it('renders fixed-sample recovery and rejects fake legacy completion', () => {
    const onResume = vi.fn()
    const resumeScreen = TravelVocabularyR1ResumeScreen({
      viewModel: {
        sessionId,
        stages,
        headerProgress: {
          label: '总进度 37 / 150',
          value: 24.67,
        },
        currentPositionLabel: '第 2 阶段 · 第 7 题',
        answeredLabel: '已答 36 题',
        elapsedLabel: '08 分 20 秒',
        resumeAction: action('继续原测试'),
        notice: {
          kind: 'offline',
          title: '当前离线',
          description: '本机保存的原题仍可恢复。',
        },
      },
      onExit: () => undefined,
      onResume,
    })
    const migrationScreen = TravelVocabularyR1MigrationScreen({
      viewModel: {
        sessionId,
        legacySourceLabel: '旧版 v1 / v2 测试记录',
        startAction: action('重新开始旅游英语词汇测试'),
      },
      onExit: () => undefined,
      onStartNewAssessment: () => undefined,
    })

    expect(renderToStaticMarkup(resumeScreen)).toContain(
      '不会刷新换题',
    )
    buttonByAriaLabel(resumeScreen, '继续原测试').props.onClick?.()
    expect(onResume).toHaveBeenCalledWith(sessionId)

    const migrationMarkup = renderToStaticMarkup(migrationScreen)
    expect(migrationMarkup).toContain(
      '需要重新开始新的旅游英语词汇测试',
    )
    expect(migrationMarkup).toContain('不能换算成新的词汇量或等级')
    expect(migrationMarkup).not.toContain('R1 已完成')
  })

  it('shows five supplied result rows, honest calibration states and both disclaimers', () => {
    const onContinue = vi.fn()
    const screen = TravelVocabularyR1ResultsScreen({
      viewModel: resultsViewModel,
      onExit: () => undefined,
      onContinue,
    })
    const markup = renderToStaticMarkup(screen)

    expect(markup).toContain('1,030 词')
    expect(markup).toContain('合理区间 760–1,420 词')
    for (const stage of resultStages) {
      expect(markup).toContain(stage.masteryRateLabel)
      expect(markup).toContain(stage.estimatedWordsLabel)
      expect(markup).toContain(stage.reasonableIntervalLabel)
    }
    expect(markup.match(/待校准/g)).toHaveLength(2)
    expect(markup).toContain('不代表学历')
    expect(markup).toContain('CET-4')
    expect(markup).not.toContain('CEFR')

    buttonByAriaLabel(screen, '生成首日计划').props.onClick?.()
    expect(onContinue).toHaveBeenCalledWith(sessionId)
  })

  it('covers loading, error and offline local-restore states', () => {
    const onRetry = vi.fn()
    const onRestoreLocal = vi.fn()
    const loadingMarkup = renderToStaticMarkup(
      <TravelVocabularyR1StatusScreen
        viewModel={{
          kind: 'loading',
          label: '正在恢复本机测试',
        }}
        onExit={() => undefined}
      />,
    )
    const errorScreen = TravelVocabularyR1StatusScreen({
      viewModel: {
        kind: 'error',
        title: '无法读取测试记录',
        description: '原记录已保留，可以重试。',
        retryAction: action('重新读取'),
      },
      onExit: () => undefined,
      onRetry,
    })
    const offlineScreen = TravelVocabularyR1StatusScreen({
      viewModel: {
        kind: 'offline',
        title: '当前离线',
        description: '可以恢复本机已保存的固定题目。',
        restoreAction: action('恢复本机进度'),
      },
      onExit: () => undefined,
      onRestoreLocal,
    })

    expect(loadingMarkup).toContain('aria-busy="true"')
    expect(loadingMarkup).toContain('正在恢复本机测试')
    expect(renderToStaticMarkup(errorScreen)).toContain(
      'role="alert"',
    )
    buttonByAriaLabel(errorScreen, '重新读取').props.onClick?.()
    buttonByAriaLabel(
      offlineScreen,
      '恢复本机进度',
    ).props.onClick?.()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRestoreLocal).toHaveBeenCalledOnce()
  })

  it('keeps 30-question navigation usable at 320px and 390px with visible focus rules', () => {
    const r1Css = readFileSync(
      new URL('./styles/travel-vocabulary-r1.css', import.meta.url),
      'utf8',
    )
    const appCss = readFileSync(
      new URL('./styles/app.css', import.meta.url),
      'utf8',
    )

    for (const width of [320, 390]) {
      const pagePadding = width <= 360 ? 16 : 20
      const gridPadding = width <= 360 ? 13 : 15
      const gap = width <= 360 ? 7 : 8
      const available = width - pagePadding * 2 - gridPadding * 2
      const required = 44 * 5 + gap * 4

      expect(required).toBeLessThanOrEqual(available)
    }

    expect(r1Css).toContain(
      'grid-template-columns: repeat(5, minmax(44px, 1fr))',
    )
    expect(r1Css).toContain('min-height: 44px')
    expect(r1Css).toContain('@media (width <= 360px)')
    expect(r1Css).toContain('overflow-wrap: anywhere')
    expect(r1Css).toContain('env(safe-area-inset-bottom)')
    expect(appCss).toContain(':focus-visible')
  })
})
