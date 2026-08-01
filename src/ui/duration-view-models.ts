export type DurationTrainingModuleId =
  | 'vocabulary'
  | 'listening'
  | 'speaking'

export interface TaskDurationEstimateViewModel {
  /**
   * Exact LearningTask.durationEstimate.estimateSeconds, or the persisted
   * LearningTask.estimatedSeconds compatibility value when metadata is absent.
   */
  readonly estimateSeconds: number
  readonly basis: 'content-baseline' | 'personal-history'
  readonly sampleCount: number
  readonly confidence: 'low' | 'medium' | 'high'
}

export type ActualEffectiveDurationViewModel =
  | {
      readonly state: 'reliable'
      readonly effectiveSeconds: number
      readonly source: 'timing-segments'
    }
  | {
      readonly state: 'unavailable'
      readonly reason:
        | 'missing-timing-segments'
        | 'legacy-event-duration'
    }

export interface DailyEffectiveDurationItemViewModel {
  readonly moduleId: DurationTrainingModuleId
  readonly label: string
  readonly duration: ActualEffectiveDurationViewModel
}

export type DailyEffectiveDurationTotalViewModel =
  | {
      readonly coverage: 'complete' | 'partial'
      /**
       * Trusted sum supplied by 01/04. UI must not add item values itself.
       */
      readonly effectiveSeconds: number
      readonly source: 'timing-segments'
    }
  | {
      readonly coverage: 'unavailable'
    }

export interface DailyEffectiveDurationSummaryViewModel {
  readonly items: readonly DailyEffectiveDurationItemViewModel[]
  readonly total: DailyEffectiveDurationTotalViewModel
}

export type TrainingUnitScoreViewModel =
  | {
      readonly state: 'available'
      readonly correctCount: number
      readonly totalCount: number
      readonly percentage: number | null
      readonly unscorableCount: number
    }
  | {
      readonly state: 'unavailable'
      readonly reason: 'legacy-score-missing'
    }

export interface TrainingCompletionDurationViewModel {
  readonly moduleId: DurationTrainingModuleId
  readonly title: string
  readonly description: string
  readonly actualDuration: ActualEffectiveDurationViewModel
  readonly score: TrainingUnitScoreViewModel
  /**
   * Optional completed budget snapshot. Required for new budget tasks and
   * absent for legacy tasks.
   */
  readonly trainingBudget?: import('./training-budget-view-models.ts').TrainingBudgetProgressViewModel & {
    readonly status: 'completed'
  }
  /**
   * Supplied when this module's own daily 15-minute target is complete.
   * Its presence never changes daily-plan progress inside UI.
   */
  readonly extraTrainingEntry?: import('./extra-training-view-models.ts').ModuleCompletedExtraTrainingEntryViewModel
  readonly actionLabel: string
}
