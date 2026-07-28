export type TrainingBudgetStatus =
  | 'running'
  | 'finish-current-item'
  | 'content-exhausted'
  | 'completed'

export type TrainingContentExhaustedReason =
  | 'no-eligible-content'
  | 'all-eligible-content-recently-used'
  | 'provider-failure'

/**
 * A daily effective-training target supplied by 04/01.
 * This is a completion budget, not a content-duration estimate.
 */
export interface TrainingBudgetTargetViewModel {
  readonly targetEffectiveSeconds: number
}

interface TrainingBudgetProgressBaseViewModel
  extends TrainingBudgetTargetViewModel {
  /**
   * Exact upstream snapshot. UI formats but never decrements this value.
   */
  readonly remainingEffectiveSeconds: number
  /**
   * Exact upstream count for the current budget task.
   */
  readonly completedItemCount: number
}

export interface TrainingBudgetRetryActionViewModel {
  readonly label: string
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly disabledReason?: string
}

export type TrainingBudgetProgressViewModel =
  | (TrainingBudgetProgressBaseViewModel & {
      readonly status: 'running'
    })
  | (TrainingBudgetProgressBaseViewModel & {
      readonly status: 'finish-current-item'
    })
  | (TrainingBudgetProgressBaseViewModel & {
      readonly status: 'completed'
    })
  | (TrainingBudgetProgressBaseViewModel & {
      readonly status: 'content-exhausted'
      readonly contentExhausted: {
        readonly reason: TrainingContentExhaustedReason
        /**
         * User-facing fact supplied by 01/05. UI does not infer provider state.
         */
        readonly description: string
      }
      readonly retryAction: TrainingBudgetRetryActionViewModel
    })
