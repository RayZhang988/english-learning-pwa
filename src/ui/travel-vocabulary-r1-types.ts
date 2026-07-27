export type TravelVocabularyR1StageId =
  | 'stage-1-foundation'
  | 'stage-2-essential'
  | 'stage-3-independent'
  | 'stage-4-advanced'
  | 'stage-5-specialized'

export type TravelVocabularyR1StageOrder = 1 | 2 | 3 | 4 | 5

export interface TravelVocabularyR1ActionViewModel {
  readonly label: string
  readonly disabled: boolean
  readonly busy?: boolean
  readonly busyLabel?: string
  readonly disabledReason?: string
}

export interface TravelVocabularyR1NoticeViewModel {
  readonly kind: 'offline' | 'restored' | 'info'
  readonly title: string
  readonly description: string
}

export interface TravelVocabularyR1StageRouteItemViewModel {
  readonly id: TravelVocabularyR1StageId
  readonly order: TravelVocabularyR1StageOrder
  readonly label: string
  readonly state: 'complete' | 'current' | 'upcoming'
}

export interface TravelVocabularyR1HeaderProgressViewModel {
  /**
   * Final display label and 0..100 value supplied by the integration layer.
   * The UI never derives either value from question counts.
   */
  readonly label: string
  readonly value: number
}

export interface TravelVocabularyR1IntroViewModel {
  readonly sessionId: string
  readonly startAction: TravelVocabularyR1ActionViewModel
  readonly notice?: TravelVocabularyR1NoticeViewModel
}

export interface TravelVocabularyR1QuestionTarget {
  readonly sessionId: string
  readonly questionId: string
  /**
   * Exact zero-based runtime question index supplied by the integration layer.
   */
  readonly questionIndex: number
}

export interface TravelVocabularyR1ChoiceIntent
  extends TravelVocabularyR1QuestionTarget {
  readonly optionId: string
}

/**
 * A sequential advance is deliberately distinct from arbitrary navigation.
 * The integration layer must map this intent to `advanceToNextQuestion()`.
 */
export interface TravelVocabularyR1AdvanceIntent
  extends TravelVocabularyR1QuestionTarget {
  readonly kind: 'advance-to-next-question'
}

export interface TravelVocabularyR1QuestionOptionViewModel {
  readonly id: string
  readonly label: string
  readonly selected: boolean
  readonly disabled: boolean
}

export interface TravelVocabularyR1QuestionMapItemViewModel
  extends Omit<TravelVocabularyR1QuestionTarget, 'sessionId'> {
  readonly numberLabel: string
  readonly answerState: 'unanswered' | 'answered' | 'uncertain'
  readonly current: boolean
  readonly disabled: boolean
}

export interface TravelVocabularyR1QuestionViewModel {
  readonly sessionId: string
  readonly stage: {
    readonly id: TravelVocabularyR1StageId
    readonly order: TravelVocabularyR1StageOrder
    readonly label: string
    readonly representativeWordCountLabel: string
  }
  readonly stages: readonly TravelVocabularyR1StageRouteItemViewModel[]
  readonly headerProgress: TravelVocabularyR1HeaderProgressViewModel
  readonly stageProgressLabel: string
  readonly answeredLabel: string
  readonly elapsedLabel: string
  readonly question: {
    readonly id: string
    readonly index: number
    readonly numberLabel: string
    readonly prompt: string
    readonly word: string
    readonly answerState: 'unanswered' | 'choice' | 'uncertain'
    readonly options: readonly [
      TravelVocabularyR1QuestionOptionViewModel,
      TravelVocabularyR1QuestionOptionViewModel,
      TravelVocabularyR1QuestionOptionViewModel,
      TravelVocabularyR1QuestionOptionViewModel,
    ]
  }
  readonly questionMap: readonly TravelVocabularyR1QuestionMapItemViewModel[]
  readonly previousTarget: TravelVocabularyR1QuestionTarget | null
  readonly nextTarget: TravelVocabularyR1QuestionTarget | null
  readonly previousAction: TravelVocabularyR1ActionViewModel
  readonly nextAction: TravelVocabularyR1ActionViewModel
  readonly uncertainAction: TravelVocabularyR1ActionViewModel
  readonly clearAction?: TravelVocabularyR1ActionViewModel
  readonly reviewAction: TravelVocabularyR1ActionViewModel
  readonly pauseAction: TravelVocabularyR1ActionViewModel
  readonly notice?: TravelVocabularyR1NoticeViewModel
}

export interface TravelVocabularyR1StageReviewQuestionViewModel
  extends Omit<TravelVocabularyR1QuestionTarget, 'sessionId'> {
  readonly numberLabel: string
  readonly answerState: 'unanswered'
}

export interface TravelVocabularyR1StageReviewViewModel {
  readonly sessionId: string
  readonly stage: {
    readonly id: TravelVocabularyR1StageId
    readonly order: TravelVocabularyR1StageOrder
    readonly label: string
  }
  readonly headerProgress: TravelVocabularyR1HeaderProgressViewModel
  readonly answeredLabel: string
  readonly reviewDescription: string
  /**
   * Explicitly supplied by the integration layer. The UI does not derive this
   * list from answer records.
   */
  readonly unansweredQuestions:
    readonly TravelVocabularyR1StageReviewQuestionViewModel[]
  /**
   * Final display text supplied by the integration layer, for example
   * "还有 2 题未答，提交后将按不会记录". The UI does not count
   * `unansweredQuestions` itself.
   */
  readonly unansweredCountLabel?: string
  readonly submitAction: TravelVocabularyR1ActionViewModel
  readonly backAction: TravelVocabularyR1ActionViewModel
  /**
   * Optional only as a temporary compatibility bridge for the existing 01
   * adapter. New R1 integrations must provide this action.
   */
  readonly finishRemainingAction?: TravelVocabularyR1ActionViewModel
}

export interface TravelVocabularyR1FinishConfirmationViewModel {
  readonly sessionId: string
  readonly headerProgress: TravelVocabularyR1HeaderProgressViewModel
  /**
   * Exact externally formatted value based on
   * `remainingQuestionsToMarkUncertain`, for example "92 题".
   */
  readonly remainingQuestionCountLabel: string
  readonly cancelAction: TravelVocabularyR1ActionViewModel
  readonly confirmAction: TravelVocabularyR1ActionViewModel
}

export interface TravelVocabularyR1StageResultViewModel {
  readonly sessionId: string
  readonly stage: {
    readonly id: TravelVocabularyR1StageId
    readonly order: TravelVocabularyR1StageOrder
    readonly label: string
  }
  readonly stages: readonly TravelVocabularyR1StageRouteItemViewModel[]
  readonly headerProgress: TravelVocabularyR1HeaderProgressViewModel
  readonly correctCountLabel: string
  readonly incorrectCountLabel: string
  readonly uncertainCountLabel: string
  readonly masteryRateLabel: string
  readonly representativeWordCountLabel: string
  readonly estimatedWordsLabel: string
  readonly reasonableIntervalLabel: string
  readonly continueAction: TravelVocabularyR1ActionViewModel
  readonly pauseAction: TravelVocabularyR1ActionViewModel
}

export interface TravelVocabularyR1ResumeViewModel {
  readonly sessionId: string
  readonly stages: readonly TravelVocabularyR1StageRouteItemViewModel[]
  readonly headerProgress: TravelVocabularyR1HeaderProgressViewModel
  readonly currentPositionLabel: string
  readonly answeredLabel: string
  readonly elapsedLabel: string
  readonly resumeAction: TravelVocabularyR1ActionViewModel
  readonly notice?: TravelVocabularyR1NoticeViewModel
}

export interface TravelVocabularyR1MigrationViewModel {
  readonly sessionId: string
  readonly legacySourceLabel: string
  readonly startAction: TravelVocabularyR1ActionViewModel
}

export interface TravelVocabularyR1StageSummaryRowViewModel {
  readonly id: TravelVocabularyR1StageId
  readonly order: TravelVocabularyR1StageOrder
  readonly label: string
  readonly correctCountLabel: string
  readonly masteryRateLabel: string
  readonly representativeWordCountLabel: string
  readonly estimatedWordsLabel: string
  readonly reasonableIntervalLabel: string
}

export interface TravelVocabularyR1ResultsViewModel {
  readonly sessionId: string
  readonly levelLabel: string
  readonly estimatedWordsLabel: string
  readonly reasonableIntervalLabel: string
  readonly answeredCountLabel: string
  readonly correctCountLabel: string
  readonly uncertainCountLabel: string
  readonly elapsedLabel: string
  readonly stageResults: readonly TravelVocabularyR1StageSummaryRowViewModel[]
  readonly vocabularyCalibrationLabel: string
  readonly listeningCalibrationLabel: '待校准'
  readonly speakingCalibrationLabel: '待校准'
  readonly calibrationDescription: string
  readonly disclaimer: string
  readonly levelDisclaimer: string
  readonly continueAction: TravelVocabularyR1ActionViewModel
}

export type TravelVocabularyR1StatusViewModel =
  | {
      readonly kind: 'loading'
      readonly label: string
    }
  | {
      readonly kind: 'error'
      readonly title: string
      readonly description: string
      readonly retryAction: TravelVocabularyR1ActionViewModel
    }
  | {
      readonly kind: 'offline'
      readonly title: string
      readonly description: string
      readonly restoreAction?: TravelVocabularyR1ActionViewModel
    }

export interface TravelVocabularyR1IntroScreenProps {
  readonly viewModel: TravelVocabularyR1IntroViewModel
  readonly onStart: (sessionId: string) => void
  readonly onExit: (sessionId: string) => void
}

export interface TravelVocabularyR1QuestionScreenProps {
  readonly viewModel: TravelVocabularyR1QuestionViewModel
  readonly onExit: (sessionId: string) => void
  readonly onSelectChoice: (intent: TravelVocabularyR1ChoiceIntent) => void
  readonly onMarkUncertain: (
    target: TravelVocabularyR1QuestionTarget,
  ) => void
  readonly onClearAnswer: (
    target: TravelVocabularyR1QuestionTarget,
  ) => void
  readonly onNavigate: (
    target: TravelVocabularyR1QuestionTarget,
  ) => void
  /**
   * Optional only so the previous 01 adapter keeps compiling during the
   * ownership handoff. The next-question control never falls back to
   * `onNavigate`; new integrations must provide this callback.
   */
  readonly onAdvanceToNextQuestion?: (
    intent: TravelVocabularyR1AdvanceIntent,
  ) => void
  readonly onReviewStage: (sessionId: string) => void
  readonly onPause: (sessionId: string) => void
}

export interface TravelVocabularyR1StageReviewScreenProps {
  readonly viewModel: TravelVocabularyR1StageReviewViewModel
  readonly onExit: (sessionId: string) => void
  readonly onBack: (sessionId: string) => void
  readonly onNavigate: (
    target: TravelVocabularyR1QuestionTarget,
  ) => void
  readonly onSubmitStage: (sessionId: string) => void
  /**
   * Opens the UI confirmation state only. It must not call the runtime's
   * final action.
   */
  readonly onRequestFinishRemainingUnknown?: (
    sessionId: string,
  ) => void
}

export interface TravelVocabularyR1FinishConfirmationScreenProps {
  readonly viewModel: TravelVocabularyR1FinishConfirmationViewModel
  readonly onCancelFinishRemainingUnknown: (
    sessionId: string,
  ) => void
  readonly onConfirmFinishRemainingUnknown: (
    sessionId: string,
  ) => void
}

export interface TravelVocabularyR1StageResultScreenProps {
  readonly viewModel: TravelVocabularyR1StageResultViewModel
  readonly onExit: (sessionId: string) => void
  readonly onContinueToNextStage: (sessionId: string) => void
  readonly onPause: (sessionId: string) => void
}

export interface TravelVocabularyR1ResumeScreenProps {
  readonly viewModel: TravelVocabularyR1ResumeViewModel
  readonly onExit: (sessionId: string) => void
  readonly onResume: (sessionId: string) => void
}

export interface TravelVocabularyR1MigrationScreenProps {
  readonly viewModel: TravelVocabularyR1MigrationViewModel
  readonly onExit: (sessionId: string) => void
  readonly onStartNewAssessment: (sessionId: string) => void
}

export interface TravelVocabularyR1ResultsScreenProps {
  readonly viewModel: TravelVocabularyR1ResultsViewModel
  readonly onExit: (sessionId: string) => void
  readonly onContinue: (sessionId: string) => void
}

export interface TravelVocabularyR1StatusScreenProps {
  readonly viewModel: TravelVocabularyR1StatusViewModel
  readonly onExit: () => void
  readonly onRetry?: () => void
  readonly onRestoreLocal?: () => void
}
