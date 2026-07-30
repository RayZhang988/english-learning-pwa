import type {
  ActualEffectiveDurationViewModel,
  DurationTrainingModuleId,
  TrainingUnitScoreViewModel,
} from './duration-view-models.ts'

export type ExtraTrainingModuleId = DurationTrainingModuleId

export interface ExtraTrainingActionViewModel {
  readonly label: string
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly disabledReason?: string
}

interface ExtraTrainingModuleBaseViewModel {
  readonly moduleId: ExtraTrainingModuleId
  readonly title: string
  readonly description: string
}

interface ExtraTrainingProgressViewModel {
  /**
   * Exact upstream snapshot. UI formats but never decrements this value.
   */
  readonly effectiveSeconds: number
  /**
   * Exact upstream count. UI does not derive it from rendered questions.
   */
  readonly completedItemCount: number
}

export type ExtraTrainingFailureReason =
  | 'provider-failure'
  | 'device-failure'

export type ExtraTrainingModuleViewModel =
  | (ExtraTrainingModuleBaseViewModel & {
      readonly status: 'available'
      readonly startAction: ExtraTrainingActionViewModel
    })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'paused'
        readonly sessionId: string
        readonly resumeAction: ExtraTrainingActionViewModel
        readonly newRoundAction: ExtraTrainingActionViewModel
      })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'running'
        readonly sessionId: string
        readonly resumeAction: ExtraTrainingActionViewModel
        readonly newRoundAction: ExtraTrainingActionViewModel
      })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'completed'
        readonly sessionId: string
        readonly startAction: ExtraTrainingActionViewModel
      })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'content-exhausted'
        readonly sessionId: string
        readonly failureDescription: string
        readonly retryAction: ExtraTrainingActionViewModel
      })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'failed'
        readonly sessionId: string
        readonly failureReason: ExtraTrainingFailureReason
        readonly failureDescription: string
        readonly retryAction: ExtraTrainingActionViewModel
      })
  | (ExtraTrainingModuleBaseViewModel & {
      readonly status: 'expired'
      readonly sessionId: string
      readonly completedItemCount: number
      readonly startAction: ExtraTrainingActionViewModel
    })

export interface ExtraTrainingPickerViewModel {
  readonly modules: readonly ExtraTrainingModuleViewModel[]
  readonly returnAction: ExtraTrainingActionViewModel & {
    readonly label: '返回今日完成'
  }
}

export interface CompletedDailyPlanExtraTrainingEntryViewModel {
  readonly action: ExtraTrainingActionViewModel & {
    readonly label: '继续训练'
  }
}

export type ExtraTrainingActiveProgressViewModel =
  | {
      readonly status: 'running'
      readonly effectiveSeconds: number
      readonly completedItemCount: number
    }
  | {
      readonly status: 'content-exhausted'
      readonly effectiveSeconds: number
      readonly completedItemCount: number
      readonly contentExhausted: {
        readonly reason: 'provider-failure' | 'no-eligible-content'
        readonly description: string
      }
      readonly retryAction: ExtraTrainingActionViewModel
    }

export interface ExtraTrainingActiveSessionViewModel<
  TModuleId extends ExtraTrainingModuleId = ExtraTrainingModuleId,
> {
  /**
   * Stable ID created by 04/01 and returned unchanged by all session actions.
   */
  readonly sessionId: string
  readonly moduleId: TModuleId
  readonly progress: ExtraTrainingActiveProgressViewModel
  readonly exitAction: ExtraTrainingActionViewModel & {
    readonly label: '退出并保存'
  }
}

export interface ExtraTrainingCompletionViewModel {
  readonly sessionId: string
  readonly moduleId: ExtraTrainingModuleId
  readonly title: string
  readonly description: string
  readonly completedItemCount: number
  readonly score: TrainingUnitScoreViewModel
  readonly actualDuration: ActualEffectiveDurationViewModel
  readonly chooseAgainAction: ExtraTrainingActionViewModel
  readonly returnAction: ExtraTrainingActionViewModel & {
    readonly label: '返回今日完成'
  }
}
