import {
  TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1,
  type AbilityProfileR1,
  type TravelVocabularyAssessmentRuntimeStateR1,
  type TravelVocabularyDraftAnswerR1,
  type TravelVocabularyStageResultR1,
} from '../../features/assessment/index.ts'
import type {
  TravelVocabularyR1ActionViewModel,
  TravelVocabularyR1IntroViewModel,
  TravelVocabularyR1MigrationViewModel,
  TravelVocabularyR1QuestionOptionViewModel,
  TravelVocabularyR1QuestionTarget,
  TravelVocabularyR1QuestionViewModel,
  TravelVocabularyR1ResultsViewModel,
  TravelVocabularyR1ResumeViewModel,
  TravelVocabularyR1StageResultViewModel,
  TravelVocabularyR1StageReviewViewModel,
  TravelVocabularyR1StageRouteItemViewModel,
} from '../../ui/index.ts'
import type { TravelVocabularyR1MigrationSource } from './travel-vocabulary-r1-app-coordinator.ts'

export interface TravelVocabularyR1ViewModelOptions {
  readonly busy?: boolean
  readonly offline?: boolean
}

function action(
  label: string,
  disabled: boolean,
  options: {
    readonly busy?: boolean
    readonly disabledReason?: string
    readonly busyLabel?: string
  } = {},
): TravelVocabularyR1ActionViewModel {
  return {
    label,
    disabled,
    busy: options.busy,
    busyLabel: options.busyLabel,
    disabledReason: disabled ? options.disabledReason : undefined,
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function words(value: number): string {
  return `${value.toLocaleString('zh-CN')} 个`
}

function interval(lower: number, upper: number): string {
  return `${lower.toLocaleString('zh-CN')}–${upper.toLocaleString('zh-CN')} 个`
}

function elapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = rounded % 60
  if (minutes === 0) {
    return `${remainingSeconds} 秒`
  }
  return remainingSeconds === 0
    ? `${minutes} 分钟`
    : `${minutes} 分 ${remainingSeconds} 秒`
}

function progressValue(answered: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((answered / total) * 100)))
}

function stageRoutes(
  currentStage: number,
  completed = false,
): readonly TravelVocabularyR1StageRouteItemViewModel[] {
  return TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1.map((stage) => ({
    id: stage.id,
    order: stage.order,
    label: stage.label,
    state: completed
      ? 'complete'
      : stage.order < currentStage
        ? 'complete'
        : stage.order === currentStage
          ? 'current'
          : 'upcoming',
  }))
}

function offlineNotice(offline: boolean | undefined) {
  return offline
    ? {
        kind: 'offline' as const,
        title: '当前处于离线状态',
        description:
          '题库和作答记录都保存在本机，可以继续测试；请勿清除浏览器网站数据。',
      }
    : undefined
}

function answerState(
  answer: TravelVocabularyDraftAnswerR1 | undefined,
): 'unanswered' | 'answered' | 'uncertain' {
  if (!answer) {
    return 'unanswered'
  }
  return answer.kind === 'uncertain' ? 'uncertain' : 'answered'
}

function questionTarget(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  questionIndex: number,
): TravelVocabularyR1QuestionTarget | null {
  const question = state.questions[questionIndex]
  return question
    ? {
        sessionId: state.sessionId,
        questionId: question.id,
        questionIndex,
      }
    : null
}

function questionOptions(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  busy: boolean,
): readonly [
  TravelVocabularyR1QuestionOptionViewModel,
  TravelVocabularyR1QuestionOptionViewModel,
  TravelVocabularyR1QuestionOptionViewModel,
  TravelVocabularyR1QuestionOptionViewModel,
] {
  const question = state.questions[state.currentQuestionIndex]
  if (!question || question.options.length !== 4) {
    throw new TypeError('R1 当前题必须正好包含四个中文释义选项。')
  }
  const draft = state.draftAnswers[question.id]
  const mapOption = (
    option: (typeof question.options)[number],
  ): TravelVocabularyR1QuestionOptionViewModel => ({
    id: option.id,
    label: option.text,
    selected:
      draft?.kind === 'choice' && draft.optionId === option.id,
    disabled: busy || !state.actions.canAnswer,
  })
  return [
    mapOption(question.options[0]),
    mapOption(question.options[1]),
    mapOption(question.options[2]),
    mapOption(question.options[3]),
  ]
}

function requireStage(
  state: TravelVocabularyAssessmentRuntimeStateR1,
) {
  if (!state.stage) {
    throw new TypeError('R1 当前状态缺少阶段信息。')
  }
  return state.stage
}

function requireStageResult(
  state: TravelVocabularyAssessmentRuntimeStateR1,
): TravelVocabularyStageResultR1 {
  if (!state.latestStageResult) {
    throw new TypeError('R1 阶段结果页缺少已锁定结果。')
  }
  return state.latestStageResult
}

export function toTravelVocabularyR1IntroViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  options: TravelVocabularyR1ViewModelOptions = {},
): TravelVocabularyR1IntroViewModel {
  const busy = options.busy === true
  return {
    sessionId: state.sessionId,
    startAction: action('开始测试', busy || !state.actions.canStart, {
      busy,
      busyLabel: '正在准备题目',
      disabledReason: busy ? '正在保存本机测试记录。' : '当前不能开始测试。',
    }),
    notice: offlineNotice(options.offline),
  }
}

export function toTravelVocabularyR1QuestionViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  options: TravelVocabularyR1ViewModelOptions = {},
): TravelVocabularyR1QuestionViewModel {
  const busy = options.busy === true
  const stage = requireStage(state)
  const question = state.questions[state.currentQuestionIndex]
  if (!question) {
    throw new TypeError('R1 当前题索引没有对应题目。')
  }
  const draft = state.draftAnswers[question.id]
  const previousTarget = questionTarget(
    state,
    state.currentQuestionIndex - 1,
  )
  const nextTarget = questionTarget(
    state,
    state.currentQuestionIndex + 1,
  )
  return {
    sessionId: state.sessionId,
    stage: {
      id: stage.id,
      order: stage.order,
      label: stage.label,
      representativeWordCountLabel: `代表约 ${words(
        stage.representativeWordCount,
      )}旅游英语词汇`,
    },
    stages: stageRoutes(state.progress.currentStage),
    headerProgress: {
      label: `总进度 ${state.progress.answeredOverall} / ${state.progress.totalQuestions}`,
      value: progressValue(
        state.progress.answeredOverall,
        state.progress.totalQuestions,
      ),
    },
    stageProgressLabel: `第 ${state.progress.currentQuestion} / ${state.progress.questionsPerStage} 题`,
    answeredLabel: `本阶段已答 ${state.progress.answeredInStage} / ${state.progress.questionsPerStage}`,
    elapsedLabel: `有效作答时间 ${elapsed(
      state.progress.elapsedSeconds,
    )}`,
    question: {
      id: question.id,
      index: state.currentQuestionIndex,
      numberLabel: `第 ${state.currentQuestionIndex + 1} 题`,
      prompt: question.prompt,
      word: question.word,
      answerState: draft?.kind ?? 'unanswered',
      options: questionOptions(state, busy),
    },
    questionMap: state.questions.map((candidate, index) => ({
      questionId: candidate.id,
      questionIndex: index,
      numberLabel: String(index + 1),
      answerState: answerState(state.draftAnswers[candidate.id]),
      current: index === state.currentQuestionIndex,
      disabled: busy || !state.actions.canNavigate,
    })),
    previousTarget,
    nextTarget,
    previousAction: action('上一题', busy || previousTarget === null, {
      disabledReason:
        previousTarget === null ? '已经是本阶段第一题。' : '正在保存答案。',
    }),
    nextAction: action('下一题', busy || nextTarget === null, {
      disabledReason:
        nextTarget === null ? '已经是本阶段最后一题。' : '正在保存答案。',
    }),
    uncertainAction: action(
      draft?.kind === 'uncertain'
        ? '已标记不认识 / 不确定'
        : '不认识 / 不确定',
      busy || !state.actions.canMarkUncertain,
      {
        disabledReason: busy ? '正在保存答案。' : '当前不能修改答案。',
      },
    ),
    clearAction: draft
      ? action('清除答案', busy || !state.actions.canClearAnswer, {
          disabledReason: busy
            ? '正在保存答案。'
            : '当前答案不能清除。',
        })
      : undefined,
    reviewAction: action('检查并提交本阶段', busy, {
      busy,
      busyLabel: '正在保存答案',
      disabledReason: '正在保存答案。',
    }),
    pauseAction: action('保存并退出', busy || !state.actions.canPause, {
      busy,
      busyLabel: '正在保存',
      disabledReason: busy ? '正在保存答案。' : '当前不能暂停。',
    }),
    notice: offlineNotice(options.offline),
  }
}

export function toTravelVocabularyR1StageReviewViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  options: TravelVocabularyR1ViewModelOptions = {},
): TravelVocabularyR1StageReviewViewModel {
  const busy = options.busy === true
  const stage = requireStage(state)
  const unansweredQuestions = state.questions.flatMap(
    (question, questionIndex) =>
      state.draftAnswers[question.id]
        ? []
        : [
            {
              questionId: question.id,
              questionIndex,
              numberLabel: `第 ${questionIndex + 1} 题`,
              answerState: 'unanswered' as const,
            },
          ],
  )
  return {
    sessionId: state.sessionId,
    stage: {
      id: stage.id,
      order: stage.order,
      label: stage.label,
    },
    headerProgress: {
      label: `总进度 ${state.progress.answeredOverall} / ${state.progress.totalQuestions}`,
      value: progressValue(
        state.progress.answeredOverall,
        state.progress.totalQuestions,
      ),
    },
    answeredLabel: `本阶段已答 ${state.progress.answeredInStage} / ${state.progress.questionsPerStage}`,
    reviewDescription:
      unansweredQuestions.length === 0
        ? '30 题都已作答。提交后本阶段答案和分数将锁定。'
        : `还有 ${unansweredQuestions.length} 题未作答，请返回补答或标记“不认识 / 不确定”。`,
    unansweredQuestions,
    submitAction: action(
      '确认提交本阶段',
      busy || !state.actions.canSubmitStage,
      {
        busy,
        busyLabel: '正在计算阶段结果',
        disabledReason: busy
          ? '正在提交本阶段。'
          : '必须完成或标记全部 30 题后才能提交。',
      },
    ),
    backAction: action('返回修改', busy, {
      disabledReason: '正在提交本阶段。',
    }),
  }
}

export function toTravelVocabularyR1StageResultViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  options: TravelVocabularyR1ViewModelOptions = {},
): TravelVocabularyR1StageResultViewModel {
  const busy = options.busy === true
  const stage = requireStage(state)
  const result = requireStageResult(state)
  return {
    sessionId: state.sessionId,
    stage: {
      id: stage.id,
      order: stage.order,
      label: stage.label,
    },
    stages: stageRoutes(state.progress.currentStage),
    headerProgress: {
      label: `已完成 ${result.stageOrder} / ${state.progress.totalStages} 个阶段`,
      value: progressValue(result.stageOrder, state.progress.totalStages),
    },
    correctCountLabel: `${result.correctCount} / ${result.validQuestionCount}`,
    incorrectCountLabel: `${result.incorrectCount} 题`,
    uncertainCountLabel: `${result.uncertainCount} 题`,
    masteryRateLabel: percent(result.masteryRate),
    representativeWordCountLabel: words(
      result.representativeWordCount,
    ),
    estimatedWordsLabel: words(result.estimatedWords),
    reasonableIntervalLabel: interval(
      result.reasonableInterval.lower,
      result.reasonableInterval.upper,
    ),
    continueAction: action(
      '进入下一阶段',
      busy || !state.actions.canContinueToNextStage,
      {
        busy,
        busyLabel: '正在打开下一阶段',
        disabledReason: busy
          ? '正在保存阶段结果。'
          : '当前不能进入下一阶段。',
      },
    ),
    pauseAction: action('保存并退出', busy || !state.actions.canPause, {
      busy,
      busyLabel: '正在保存',
      disabledReason: busy ? '正在保存阶段结果。' : '当前不能暂停。',
    }),
  }
}

export function toTravelVocabularyR1ResumeViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  options: TravelVocabularyR1ViewModelOptions = {},
): TravelVocabularyR1ResumeViewModel {
  const busy = options.busy === true
  return {
    sessionId: state.sessionId,
    stages: stageRoutes(state.progress.currentStage),
    headerProgress: {
      label: `总进度 ${state.progress.answeredOverall} / ${state.progress.totalQuestions}`,
      value: progressValue(
        state.progress.answeredOverall,
        state.progress.totalQuestions,
      ),
    },
    currentPositionLabel: `第 ${state.progress.currentStage} 阶段 · 第 ${state.progress.currentQuestion} 题`,
    answeredLabel: `本阶段已答 ${state.progress.answeredInStage} / ${state.progress.questionsPerStage}`,
    elapsedLabel: `已记录有效时间 ${elapsed(
      state.progress.elapsedSeconds,
    )}`,
    resumeAction: action('继续原测试', busy || !state.actions.canResume, {
      busy,
      busyLabel: '正在恢复',
      disabledReason: busy ? '正在读取本机记录。' : '当前记录不能恢复。',
    }),
    notice: {
      kind: 'restored',
      title: '题目和选项顺序已经固定',
      description:
        '继续后会回到退出前的同一批题目，刷新不会重新随机抽题。',
    },
  }
}

export function toTravelVocabularyR1MigrationViewModel(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  source: TravelVocabularyR1MigrationSource,
  busy = false,
): TravelVocabularyR1MigrationViewModel {
  const legacySourceLabel = source.includes('v2')
    ? '旧版逐题自适应词汇测试'
    : '旧版综合水平测试'
  return {
    sessionId: state.sessionId,
    legacySourceLabel,
    startAction: action('开始新的 R1 测试', busy || !state.actions.canStart, {
      busy,
      busyLabel: '正在保存新题目',
      disabledReason: busy
        ? '正在保存新的随机题目。'
        : '当前不能开始新测试。',
    }),
  }
}

function stageResultRow(result: TravelVocabularyStageResultR1) {
  return {
    id: result.stageId,
    order: result.stageOrder,
    label: result.stageLabel,
    correctCountLabel: `${result.correctCount} / ${result.validQuestionCount}`,
    masteryRateLabel: percent(result.masteryRate),
    representativeWordCountLabel: words(
      result.representativeWordCount,
    ),
    estimatedWordsLabel: words(result.estimatedWords),
    reasonableIntervalLabel: interval(
      result.reasonableInterval.lower,
      result.reasonableInterval.upper,
    ),
  }
}

export function toTravelVocabularyR1ResultsViewModel(
  profile: AbilityProfileR1,
  busy = false,
): TravelVocabularyR1ResultsViewModel {
  return {
    sessionId: profile.assessmentId,
    levelLabel: profile.resultLevel.label,
    estimatedWordsLabel: words(
      profile.travelVocabulary.estimatedWords,
    ),
    reasonableIntervalLabel: interval(
      profile.travelVocabulary.reasonableInterval.lower,
      profile.travelVocabulary.reasonableInterval.upper,
    ),
    answeredCountLabel: `${profile.travelVocabulary.validQuestionCount} 题`,
    correctCountLabel: `${profile.travelVocabulary.correctCount} 题`,
    uncertainCountLabel: `${profile.travelVocabulary.uncertainCount} 题`,
    elapsedLabel: elapsed(profile.durationSeconds),
    stageResults: profile.travelVocabulary.stageResults.map(
      stageResultRow,
    ),
    vocabularyCalibrationLabel: '已按旅游英语词汇抽样估算',
    listeningCalibrationLabel: '待校准',
    speakingCalibrationLabel: '待校准',
    calibrationDescription:
      '听力和口语没有从词汇结果推导，将在后续正常训练中逐步校准。',
    disclaimer: profile.disclaimer,
    levelDisclaimer: profile.resultLevel.disclaimer,
    continueAction: action('进入今日计划', busy, {
      busy,
      busyLabel: '正在打开今日计划',
      disabledReason: '正在保存能力档案和首日计划。',
    }),
  }
}
