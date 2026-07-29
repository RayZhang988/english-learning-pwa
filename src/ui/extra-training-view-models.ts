import type {
  ActualEffectiveDurationViewModel,
  DurationTrainingModuleId,
} from './duration-view-models.ts'
import type { TrainingBudgetProgressViewModel } from './training-budget-view-models.ts'

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
  readonly targetEffectiveSeconds: number
}

interface ExtraTrainingProgressViewModel {
  /**
   * Exact upstream snapshot. UI formats but never decrements this value.
   */
  readonly remainingEffectiveSeconds: number
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
      })
  | (ExtraTrainingModuleBaseViewModel &
      ExtraTrainingProgressViewModel & {
        readonly status: 'running'
        readonly sessionId: string
        readonly resumeAction: ExtraTrainingActionViewModel
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

export type ExtraTrainingActiveBudgetViewModel = Extract<
  TrainingBudgetProgressViewModel,
  {
    readonly status:
      | 'running'
      | 'finish-current-item'
      | 'content-exhausted'
  }
>

export interface ExtraTrainingActiveSessionViewModel<
  TModuleId extends ExtraTrainingModuleId = ExtraTrainingModuleId,
> {
  /**
   * Stable ID created by 04/01 and returned unchanged by all session actions.
   */
  readonly sessionId: string
  readonly moduleId: TModuleId
  readonly budget: ExtraTrainingActiveBudgetViewModel
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
  readonly actualDuration: ActualEffectiveDurationViewModel
  readonly chooseAgainAction: ExtraTrainingActionViewModel & {
    readonly label: '再练 15 分钟'
  }
  readonly returnAction: ExtraTrainingActionViewModel & {
    readonly label: '返回今日完成'
  }
}
