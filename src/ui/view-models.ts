import type { TaskDurationEstimateViewModel } from './duration-view-models.ts'
import type { TrainingBudgetProgressViewModel } from './training-budget-view-models.ts'

export type AbilityDomainId = 'vocabulary' | 'listening' | 'speaking'

export type ChoiceVisualState =
  | 'default'
  | 'selected'
  | 'correct'
  | 'incorrect'
  | 'disabled'

export interface ChoiceViewModel {
  readonly id: string
  readonly label: string
  readonly supportingText?: string
  readonly state: ChoiceVisualState
}

export interface TrainingProgressViewModel {
  readonly label: string
  readonly value: number
}

interface TrainingHeaderBaseViewModel {
  readonly eyebrow: string
  readonly title: string
  readonly progress?: TrainingProgressViewModel
}

export type TrainingHeaderViewModel =
  TrainingHeaderBaseViewModel &
    (
      | {
          /**
           * Legacy or non-budget task estimate. It never controls completion.
           */
          readonly durationEstimate?: TaskDurationEstimateViewModel
          readonly trainingBudget?: undefined
        }
      | {
          /**
           * Exact upstream training-budget snapshot. UI never advances it.
           */
          readonly trainingBudget: TrainingBudgetProgressViewModel
          readonly durationEstimate?: never
        }
    )

export interface FeedbackViewModel {
  readonly tone: 'success' | 'correction' | 'info' | 'device'
  readonly title: string
  readonly description?: string
}

export interface AudioPlayerViewModel {
  readonly status:
    | 'idle'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'unavailable'
    | 'error'
  readonly elapsedLabel: string
  readonly durationLabel: string
  readonly progressValue: number
  readonly rateLabel?: string
  readonly playCountLabel?: string
  readonly statusLabel: string
}

export interface ListeningPlaybackRateOptionViewModel {
  readonly value: number
  readonly label: string
  readonly disabled?: boolean
}

export interface ListeningSegmentViewModel {
  /**
   * Stable content-owned identifier. The UI returns this value unchanged.
   */
  readonly id: string
  readonly label: string
  readonly supportingText?: string
  readonly disabled?: boolean
}

export type ListeningRepeatMode = 'none' | 'segment' | 'all'

export interface ListeningRepeatOptionViewModel {
  readonly value: ListeningRepeatMode
  readonly label: string
  readonly disabled?: boolean
}

export interface ListeningPlaybackControlsViewModel {
  readonly rate: {
    readonly label: string
    readonly currentValue: number
    readonly options: readonly ListeningPlaybackRateOptionViewModel[]
    readonly disabled?: boolean
  }
  readonly segment: {
    readonly label: string
    readonly currentId: string
    readonly options: readonly ListeningSegmentViewModel[]
    readonly disabled?: boolean
  }
  readonly repeat: {
    readonly label: string
    readonly currentMode: ListeningRepeatMode
    readonly options: readonly ListeningRepeatOptionViewModel[]
    readonly disabled?: boolean
  }
}

export interface ListeningSingleChoiceQuestionViewModel {
  readonly kind: 'single-choice'
  readonly prompt: string
  readonly choices: readonly ChoiceViewModel[]
}

export type ListeningTextInputVisualState =
  | 'empty'
  | 'ready'
  | 'submitting'
  | 'submitted'

export interface ListeningKeywordDictationQuestionViewModel {
  readonly kind: 'keyword-dictation'
  readonly prompt: string
  readonly requirements: {
    readonly targetLabel: string
    readonly countLabel: string
    readonly orderLabel: string
    readonly formatLabel: string
  }
  readonly textInput: {
    readonly label: string
    readonly value: string
    readonly placeholder: string
    readonly disabled: boolean
    readonly state: ListeningTextInputVisualState
    readonly description?: string
    readonly statusLabel?: string
  }
  readonly review?: {
    readonly response: string
    readonly standardAnswer: string
    readonly targetKeywords: readonly string[]
    readonly resultLabel: string
  }
}

export type ListeningQuestionViewModel =
  | ListeningSingleChoiceQuestionViewModel
  | ListeningKeywordDictationQuestionViewModel

export type ListeningQuestionInputIntent =
  | {
      readonly type: 'select-choice'
      readonly choiceId: string
    }
  | {
      readonly type: 'change-keyword-dictation'
      readonly value: string
    }

export interface RecorderViewModel {
  readonly status:
    | 'permission'
    | 'ready'
    | 'recording'
    | 'processing'
    | 'review'
    | 'unavailable'
    | 'error'
  readonly statusLabel: string
  readonly timeLabel?: string
  readonly description?: string
  readonly playbackAvailable?: boolean
}

export interface AbilityResultViewModel {
  readonly domain: AbilityDomainId
  readonly label: string
  readonly status: 'estimated' | 'low-confidence' | 'unavailable'
  readonly levelLabel: string
  readonly rangeLabel?: string
  readonly confidenceLabel: string
  readonly message: string
  readonly warnings: readonly string[]
}

export interface DomainProgressViewModel {
  readonly domain: AbilityDomainId
  readonly label: string
  readonly currentLevelLabel: string
  readonly levelChangeLabel: string
  readonly trend:
    | 'improving'
    | 'stable'
    | 'declining'
    | 'insufficient-evidence'
  readonly progressValue: number
  readonly performanceLabel: string
  readonly retentionLabel: string
  readonly masteryLabel: string
  readonly confidenceLabel: string
  readonly commonErrors: readonly string[]
}
