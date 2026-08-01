import type {
  AbilityDomain,
  AbilityProfile,
  AnyAbilityProfile,
  TravelVocabularyResultLevelId,
} from '../features/assessment/index.ts'
import type {
  PlatformEvent,
  PortableData,
} from '../core/index.ts'

export type {
  AbilityDomain,
  AbilityProfile,
  AnyAbilityProfile,
}

export type LearningAbilityProfile = AnyAbilityProfile

export const LEARNING_ENGINE_SCHEMA_VERSION = 1 as const
export const LEARNING_EVENT_SCHEMA_VERSION = 1 as const
export const DEFAULT_DAILY_TARGET_SECONDS = 45 * 60
/** Every required daily domain is an effective-practice stream of 15 minutes. */
export const REQUIRED_TASK_EFFECTIVE_SECONDS = 15 * 60
/**
 * Legacy R6 optional-session budget. R6.1 replaced the optional completion
 * rule with user-controlled, open-ended practice. Keep this value only for
 * reading pre-R6.1 persisted sessions and events.
 */
export const EXTRA_TRAINING_EFFECTIVE_SECONDS = 15 * 60
export const MINIMUM_DAILY_BUDGET_SECONDS = 5 * 60
export const MAX_INTERACTION_IDLE_SECONDS = 45 as const
export const MAX_CONTINUOUS_ACTIVE_MEDIA_SECONDS = 15 * 60
export const MIN_PERSONAL_DURATION_SAMPLE_COUNT = 3
export const PERSONAL_DURATION_SAMPLE_WINDOW = 9
export const MIN_RELIABLE_EFFECTIVE_SECONDS = 5
export const MAX_RELIABLE_EFFECTIVE_SECONDS = 2 * 60 * 60

export type TrainingModuleId =
  | 'vocabulary'
  | 'listening'
  | 'speaking'

export type LearningTaskMode =
  | 'learn'
  | 'calibration'
  | 'review'
  | 'retry'

export type TaskOrigin =
  | 'new'
  | 'due-review'
  | 'retry'
  | 'carry-over'

export interface TaskDurationBaseline {
  readonly schemaVersion: 1
  /**
   * Stable content shape used together with domain and task mode. Examples
   * include `multiple-choice-set`, `dialogue-listening`, and
   * `guided-speaking`.
   */
  readonly contentType: string
  readonly fixedSeconds: number
  readonly itemCount: number
  readonly secondsPerItem: number
  readonly activeAudioSeconds: number
  readonly expectedAudioPlaythroughs: number
  readonly interactionStepCount: number
  readonly secondsPerInteractionStep: number
  readonly minimumSeconds: number
  readonly maximumSeconds: number
}

export type TaskDurationEstimateBasis =
  | 'content-baseline'
  | 'personal-history'

export type TaskDurationEstimateConfidence =
  | 'low'
  | 'medium'
  | 'high'

export interface TaskDurationEstimate {
  readonly schemaVersion: 1
  readonly estimateSeconds: number
  readonly sampleCount: number
  readonly basis: TaskDurationEstimateBasis
  readonly confidence: TaskDurationEstimateConfidence
  readonly contentType: string
  readonly reasonableRangeSeconds: {
    readonly lower: number
    readonly upper: number
  }
  readonly profileKey: string
  readonly baselineSource:
    | 'structured-content'
    | 'legacy-content-estimate'
}

export type StandardErrorTag =
  | 'meaning-recall'
  | 'form-recall'
  | 'sound-discrimination'
  | 'detail-missed'
  | 'inference'
  | 'pronunciation'
  | 'fluency'
  | 'grammar'
  | 'word-choice'
  | 'task-understanding'
  | 'timeout'
  | 'other'

export interface LearningCandidate {
  readonly schemaVersion: 1
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: AbilityDomain
  readonly difficultyLevel: number
  /**
   * Legacy content estimate retained while 01/05 migrate existing packages.
   * It is never the daily allocation target. New content should also provide
   * `durationBaseline`.
   */
  readonly estimatedSeconds: number
  readonly durationBaseline?: TaskDurationBaseline
  readonly tags: readonly string[]
  readonly prerequisitesMet: boolean
}

export interface LearningTask {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly planId: string
  readonly sequence: number
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly mode: LearningTaskMode
  readonly origin: TaskOrigin
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  /**
   * Additive v1 metadata. Old persisted tasks omit it and keep their original
   * `estimatedSeconds`.
   */
  readonly durationEstimate?: TaskDurationEstimate
  /**
   * A required effective-practice budget, separate from the content estimate.
   * It is absent only on plans persisted before QA-011 and those plans retain
   * their legacy completion semantics.
   */
  readonly trainingBudget?: TrainingTaskBudget
  readonly required: boolean
  readonly dueAt: string | null
  readonly skipLimit: number
  readonly tags: readonly string[]
}

export interface TrainingTaskBudget {
  readonly schemaVersion: 1
  readonly targetEffectiveSeconds: typeof REQUIRED_TASK_EFFECTIVE_SECONDS
}

/** A content-agnostic pointer. 04 never interprets the item itself. */
export type LearningTaskSupplyItem = {
  readonly itemId: string
  readonly learningUnitId: string
  readonly contentRef: string
  readonly difficultyLevel: number
  readonly tags: readonly string[]
} & { readonly [key: string]: PortableData }

export interface LearningTaskSupplyRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly planId: string
  readonly taskId: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly mode: LearningTaskMode
  readonly targetDifficulty: number
  /** Opaque provider cursor restored exactly as last acknowledged. */
  readonly cursor: string | null
  /** Includes completed stream items, so providers can avoid short repeats. */
  readonly excludeItemIds: readonly string[]
  readonly reason: 'initial' | 'continue-after-item'
}

export type LearningTaskSupplyResult =
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'item'
      readonly item: LearningTaskSupplyItem
      readonly nextCursor: string | null
    }
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'content-exhausted'
      readonly reason:
        | 'no-eligible-content'
        | 'all-eligible-content-recently-used'
        | 'provider-failure'
    }

/**
 * R6 optional-session priority is a request to the content owner, not a
 * content-selection implementation. Providers try these buckets in order.
 */
export type ExtraTrainingContentPriority =
  | 'recent-error'
  | 'due-review'
  | 'same-day-variant'
  | 'new-optional-content'

export type ExtraTrainingPriorityItemIds = Readonly<
  Record<ExtraTrainingContentPriority, readonly string[]>
>

export type ExtraTrainingStatus =
  | 'running'
  | 'finish-current-item'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'expired'

export type ExtraTrainingEndReason =
  | 'budget-reached'
  | 'user-exited'
  | 'content-exhausted'
  | 'provider-failure'
  | 'device-failure'
  | 'cross-day-expired'
  | 'user-restarted'

/**
 * Exact, additive scoring facts for one training unit.
 *
 * `correctCount + incorrectCount` is the only score denominator.
 * Device, permission, network and other genuinely unscorable outcomes are
 * retained separately and must never be presented as wrong answers.
 * Percentage is deliberately derived instead of persisted.
 */
export interface TrainingUnitScore
  extends Readonly<Record<string, PortableData>> {
  readonly schemaVersion: 1
  readonly correctCount: number
  readonly incorrectCount: number
  readonly unscorableCount: number
}

/** Independent from PlanProgress: extra sessions never become daily tasks. */
export interface ExtraTrainingSession {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly localDate: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly mode: 'learn'
  readonly targetDifficulty: number
  /**
   * R6.1 sessions are open-ended and finish only when the learner exits.
   * Missing means a legacy 900-second session that must be migrated before
   * it is resumed.
   */
  readonly completionMode?: 'open-ended'
  /** Reliable foreground practice accumulated across pause/resume. */
  readonly effectiveSeconds?: number
  /** @deprecated Pre-R6.1 persistence compatibility only. */
  readonly targetEffectiveSeconds?: typeof EXTRA_TRAINING_EFFECTIVE_SECONDS
  /** @deprecated Pre-R6.1 persistence compatibility only. */
  readonly remainingEffectiveSeconds?: number
  readonly status: ExtraTrainingStatus
  readonly nextSupplyCursor: string | null
  readonly excludeItemIds: readonly string[]
  /** Published candidate item IDs supplied by 01/05; 04 never infers them. */
  readonly priorityItemIds?: ExtraTrainingPriorityItemIds
  readonly completedItemCount: number
  /** Additive R7 state. Missing means a pre-R7 session. */
  readonly score?: TrainingUnitScore
  readonly startedAt: string
  readonly updatedAt: string
  readonly endedAt: string | null
  readonly endReason: ExtraTrainingEndReason | null
}

export interface ExtraTrainingState {
  readonly schemaVersion: 1
  readonly sessions: Readonly<Record<string, ExtraTrainingSession>>
  readonly processedEventIds: readonly string[]
}

/**
 * Module-scoped admission for an optional extra-training session.
 *
 * The daily plan may still retain its aggregate 3/3 status, but that status
 * is deliberately not an admission condition: a module earns continuation
 * as soon as its own daily task is completed.
 */
export interface ExtraTrainingEligibility {
  readonly schemaVersion: 1
  readonly localDate: string
  readonly moduleId: TrainingModuleId
  readonly eligible: boolean
  readonly reason:
    | 'daily-task-completed'
    | 'daily-task-incomplete'
    | 'daily-plan-date-mismatch'
    | 'daily-task-missing-or-invalid'
  readonly taskId: string | null
}

export interface ExtraTrainingSupplyRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly sessionId: string
  readonly localDate: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly mode: 'learn'
  readonly targetDifficulty: number
  readonly cursor: string | null
  readonly excludeItemIds: readonly string[]
  readonly priority: readonly ExtraTrainingContentPriority[]
  readonly priorityItemIds: ExtraTrainingPriorityItemIds
  readonly reason: 'initial' | 'continue-after-item' | 'resume'
}

export interface DomainAllocation {
  readonly domain: AbilityDomain
  readonly weaknessWeight: number
  readonly targetDifficulty: number
  readonly targetSeconds: number
  readonly plannedSeconds: number
}

export type DailyPlanStatus = 'ready' | 'partial' | 'empty'

export interface DailyPlan {
  readonly schemaVersion: 1
  readonly planId: string
  readonly localDate: string
  readonly generatedAt: string
  readonly targetSeconds: number
  readonly plannedSeconds: number
  readonly unfilledSeconds: number
  readonly status: DailyPlanStatus
  readonly tasks: readonly LearningTask[]
  readonly allocations: Readonly<Record<AbilityDomain, DomainAllocation>>
  readonly warnings: readonly string[]
}

export interface ReviewItemState {
  readonly schemaVersion: 1
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: AbilityDomain
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly memoryDifficulty: number
  readonly mastery: number
  readonly stabilityDays: number
  readonly successfulReviews: number
  readonly lapseCount: number
  readonly attemptCount: number
  readonly lastAttemptAt: string | null
  readonly lastSuccessfulAt: string | null
  readonly nextReviewAt: string
  readonly retryAt: string | null
  readonly status: 'learning' | 'reviewing' | 'mastered'
  readonly tags: readonly string[]
}

export interface AttemptEvidence {
  readonly eventId: string
  readonly planId: string
  readonly taskId: string
  readonly learningUnitId: string
  readonly domain: AbilityDomain
  readonly mode: LearningTaskMode
  readonly difficultyLevel: number
  readonly performanceScore: number
  readonly effectivePerformance: number
  readonly evidenceQuality: number
  /**
   * Legacy attempt-level diagnostic duration. It has no foreground/idle
   * provenance and must never be used as a personal duration sample.
   */
  readonly durationSeconds: number
  readonly errorTags: readonly StandardErrorTag[]
  readonly occurredAt: string
  readonly localDate: string
}

export interface DomainProgressState {
  readonly domain: AbilityDomain
  readonly assessmentStatus:
    | 'estimated'
    | 'low-confidence'
    | 'unavailable'
  readonly assessmentBoundary:
    | 'within-range'
    | 'lower-censored'
    | 'upper-censored'
    | 'unknown'
  readonly baselineLevel: number
  readonly currentLevel: number
  readonly confidence: number
  readonly recentPerformance: number
  readonly retentionScore: number
  readonly masteryScore: number
  readonly evidenceCount: number
  readonly reliableEvidenceCount: number
  /**
   * R1 leaves listening and speaking pending so ordinary training can
   * calibrate them. Missing means the legacy scheduler behavior is retained.
   */
  readonly pendingCalibrationPolicy?: 'normal-training'
}

export interface R1VocabularyStartPlacement {
  readonly kind: 'r1-conservative-travel-vocabulary'
  readonly mappingVersion: 'learning-r1-first-day-start-v1'
  readonly resultLevelId: TravelVocabularyResultLevelId
  readonly resultLevelOrdinal: number
  readonly resultLevelMinimumEstimatedWords: number
  readonly estimatedWords: number
  readonly reasonableInterval: {
    readonly lower: number
    readonly upper: number
  }
  readonly intervalLowerLevel: number
  readonly pointEstimateLevel: number
  readonly resultLevelFloor: number
  readonly selectedStartLevel: number
}

export interface DailyActivity {
  readonly localDate: string
  readonly plannedSeconds: number
  readonly effectiveSeconds: number
  readonly completedTaskCount: number
  readonly planCompleted: boolean
  readonly qualifiesForStreak: boolean
}

export type TaskDurationSampleSource = 'timing-segments'

export interface TaskDurationSample {
  readonly sampleId: string
  readonly taskId: string
  readonly learningUnitId: string
  readonly domain: AbilityDomain
  readonly mode: LearningTaskMode
  readonly contentType: string
  readonly profileKey: string
  readonly effectiveSeconds: number
  readonly source: TaskDurationSampleSource
  readonly reliable: boolean
  readonly completedAt: string
}

export interface ProgressState {
  readonly schemaVersion: 1
  readonly profileId: string
  readonly assessmentCompletedAt: string
  readonly initializedAt: string
  readonly updatedAt: string
  readonly domains: Readonly<Record<AbilityDomain, DomainProgressState>>
  readonly attempts: readonly AttemptEvidence[]
  readonly dailyActivity: readonly DailyActivity[]
  /**
   * Additive schema-1 timing history. Old records omit this field and remain
   * readable. Only explicitly reliable foreground timing samples may be used
   * for personalization; AttemptEvidence.durationSeconds is diagnostic only.
   */
  readonly durationSamples?: readonly TaskDurationSample[]
  readonly lastReassessmentAt: string | null
  /**
   * Additive v1 persistence metadata. Old records omit it and remain valid.
   */
  readonly r1VocabularyStartPlacement?: R1VocabularyStartPlacement
}

export interface LearningEngineState {
  readonly schemaVersion: 1
  readonly progress: ProgressState
  readonly reviewItems: Readonly<Record<string, ReviewItemState>>
  /** Additive R6 state. Old schema-1 records omit it unchanged. */
  readonly extraTraining?: ExtraTrainingState
}

export type ProgressTrend =
  | 'improving'
  | 'stable'
  | 'declining'
  | 'insufficient-evidence'

export interface CommonErrorMetric {
  readonly tag: StandardErrorTag
  readonly recentCount: number
  readonly weightedCount: number
  readonly errorRate: number
  readonly score: number
}

export interface DomainProgressMetric {
  readonly domain: AbilityDomain
  readonly currentLevel: number
  readonly levelChange: number
  readonly progressScore: number
  readonly recentPerformance: number
  readonly retentionScore: number
  readonly masteryScore: number
  readonly confidence: number
  readonly trend: ProgressTrend
  readonly commonErrors: readonly CommonErrorMetric[]
}

export interface StreakMetric {
  readonly currentDays: number
  readonly longestDays: number
  readonly lastQualifyingDate: string | null
}

export interface ProgressSnapshot {
  readonly schemaVersion: 1
  readonly asOf: string
  readonly domains: Readonly<Record<AbilityDomain, DomainProgressMetric>>
  readonly streak: StreakMetric
}

export interface ReassessmentRecommendation {
  readonly schemaVersion: 1
  readonly due: boolean
  readonly domains: readonly AbilityDomain[]
  readonly reason:
    | 'fourteen-learning-days'
    | 'low-confidence-calibration'
    | 'not-due'
  readonly qualifyingDaysSinceLastAssessment: number
}

export type TaskExecutionStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'skipped'
  | 'blocked'

/**
 * Why a plan task reached `completed`.
 *
 * This is independent from mastery evidence. In particular,
 * `unscorable-practice` means the learner finished the supported fallback
 * practice flow, but no score was produced and no mastery update is allowed.
 *
 * The property is optional on TaskExecutionState so persisted v1 records
 * written before this distinction remain readable.
 */
export type TaskCompletionKind =
  | 'scored'
  | 'unscorable-practice'

export type AttemptPlanDisposition =
  | 'scored-completion'
  | 'unscorable-practice-completion'
  | 'retry-required'

export interface TaskExecutionState {
  readonly task: LearningTask
  readonly status: TaskExecutionStatus
  readonly completionKind?: TaskCompletionKind | null
  readonly spentSeconds: number
  readonly effectiveSeconds: number
  /**
   * Additive schema-1 timing metadata. Missing means a legacy active plan.
   * `spentSeconds` is diagnostic reported elapsed time and may include
   * excluded waits. Only `effectiveSeconds` is actual learning time.
   */
  readonly timingSegmentCount?: number
  readonly excludedSeconds?: number
  readonly effectiveTimeSource?:
    | 'timing-segments'
    | 'legacy-event-duration'
    | null
  readonly skipCount: number
  /** Additive R7 state. Missing means a pre-R7 active plan. */
  readonly score?: TrainingUnitScore
  /** Additive state for a required continuous-training task. */
  readonly training?: TrainingTaskProgress
  readonly startedAt: string | null
  readonly updatedAt: string
}

export type TrainingTaskProgressStatus =
  | 'running'
  | 'finish-current-item'
  | 'completed'
  | 'content-exhausted'

export interface TrainingTaskContentExhausted {
  readonly requestId: string
  readonly cursor: string | null
  readonly reason:
    | 'no-eligible-content'
    | 'all-eligible-content-recently-used'
    | 'provider-failure'
  readonly occurredAt: string
}

export interface TrainingTaskProgress {
  readonly schemaVersion: 1
  readonly targetEffectiveSeconds: typeof REQUIRED_TASK_EFFECTIVE_SECONDS
  readonly remainingEffectiveSeconds: number
  readonly status: TrainingTaskProgressStatus
  readonly completedItemIds: readonly string[]
  readonly nextSupplyCursor: string | null
  readonly contentExhausted: TrainingTaskContentExhausted | null
}

export interface PlanProgress {
  readonly schemaVersion: 1
  readonly plan: DailyPlan
  readonly status: 'not-started' | 'in-progress' | 'completed'
  readonly tasks: readonly TaskExecutionState[]
  readonly processedEventIds: readonly string[]
  readonly updatedAt: string
}

export type PlanTaskUnavailableReason =
  | 'not-in-active-plan'
  | 'task-finished'
  | 'invalid-task-data'

export interface PlanTaskAvailability {
  readonly taskId: string
  readonly targetModuleId: TrainingModuleId | null
  readonly taskStatus: TaskExecutionStatus | null
  readonly availability: 'startable' | 'unavailable'
  readonly unavailableReason: PlanTaskUnavailableReason | null
  readonly recommended: boolean
}

export interface PlanTaskAccess {
  readonly schemaVersion: 1
  readonly startableTaskIds: readonly string[]
  readonly recommendedTaskId: string | null
  readonly tasks: readonly PlanTaskAvailability[]
}

export interface ResumeDecision {
  readonly schemaVersion: 1
  readonly action: 'resume-plan' | 'generate-new-plan' | 'nothing-to-resume'
  /**
   * Non-binding recommendation for compatibility with existing callers.
   * It must never be used as the only task that may start.
   */
  readonly nextTaskId: string | null
  readonly recommendedTaskId: string | null
  readonly carryOverTasks: readonly LearningTask[]
  readonly reason:
    | 'same-day-incomplete'
    | 'cross-day-carry-over'
    | 'content-exhausted'
    | 'plan-complete'
    | 'no-incomplete-tasks'
}

export interface SkipDecision {
  readonly allowed: boolean
  readonly nextStatus: 'skipped' | 'paused' | 'blocked'
  readonly remainingSkips: number
  readonly reason:
    | 'within-limit'
    | 'non-user-failure-retained'
    | 'retry-must-be-retained'
    | 'skip-limit-reached'
}

export interface SkipHistoryEntry {
  readonly learningUnitId: string
  readonly localDate: string
  readonly reason: TaskSkipReason
}

export interface PlanActivitySummary {
  readonly localDate: string
  readonly plannedSeconds: number
  readonly effectiveSeconds: number
  readonly completedTaskCount: number
  readonly planCompleted: boolean
}

export type TaskPauseReason =
  | 'user-paused'
  | 'app-backgrounded'
  | 'device-failure'
  | 'content-failure'
  | 'time-budget-ended'

export type TaskSkipReason =
  | 'user-skipped'
  | 'time-budget-ended'
  | 'device-failure'
  | 'content-failure'

export type AttemptFailureCategory =
  | 'device'
  | 'permission'
  | 'network'
  | 'content'
  | 'interrupted'

export type LearningTimingPhase =
  | 'answering'
  | 'audio-listening'
  | 'recording'
  | 'playback'
  | 'feedback'
  | 'loading'
  | 'permission-wait'
  | 'network-wait'
  | 'paused'
  | 'idle'

export type LearningTimingSegmentReason =
  | 'active-answering'
  | 'active-audio-listening'
  | 'active-recording'
  | 'active-playback'
  | 'active-feedback'
  | 'app-backgrounded'
  | 'user-paused'
  | 'idle-timeout'
  | 'content-loading'
  | 'permission-wait'
  | 'network-wait'
  | 'media-loading'

export type LearningTrainingItemOutcome =
  | 'scored'
  | 'unscorable-practice'

type LearningEventBasePayload = {
  readonly planId: string
  readonly taskId: string
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly localDate: string
}

export type LearningTaskStartedPayload = LearningEventBasePayload & {
  readonly mode: LearningTaskMode
}

export type LearningTaskPausedPayload = LearningEventBasePayload & {
  readonly reason: TaskPauseReason
  readonly durationSeconds: number
}

export type LearningTaskSkippedPayload = LearningEventBasePayload & {
  readonly reason: TaskSkipReason
}

export type LearningAttemptCompletedPayload = LearningEventBasePayload & {
  readonly mode: LearningTaskMode
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly result: 'scored' | 'unscorable'
  readonly performanceScore: number | null
  readonly evidenceQuality: number
  readonly assistanceLevel: number
  readonly durationSeconds: number
  readonly taskCompleted: boolean
  readonly errorTags: readonly StandardErrorTag[]
  readonly contentTags: readonly string[]
  readonly failureCategory: AttemptFailureCategory | null
  /**
   * Exact counts supplied by the owning training module. Optional only for
   * pre-R7 event compatibility; new producers must publish it.
   */
  readonly scoreDelta?: TrainingUnitScore
}

export type LearningTimingSegmentRecordedPayload =
  LearningEventBasePayload & {
    readonly mode: LearningTaskMode
    readonly phase: LearningTimingPhase
    readonly reason: LearningTimingSegmentReason
    readonly visibility: 'foreground' | 'background'
    readonly startedAt: string
    readonly endedAt: string
    readonly elapsedSeconds: number
    /**
     * Producers persist this policy with each segment so restored sessions do
     * not silently switch idle semantics.
     */
    readonly idleThresholdSeconds: typeof MAX_INTERACTION_IDLE_SECONDS
  }

export type LearningTrainingItemCompletedPayload =
  LearningEventBasePayload & {
    readonly mode: LearningTaskMode
    readonly item: LearningTaskSupplyItem
    readonly requestId: string
    readonly nextSupplyCursor: string | null
    readonly outcome: LearningTrainingItemOutcome
  }

export type LearningTrainingContentExhaustedPayload =
  LearningEventBasePayload & {
    readonly mode: LearningTaskMode
    readonly requestId: string
    readonly cursor: string | null
    readonly reason: TrainingTaskContentExhausted['reason']
  }

/**
 * A producer has successfully recovered the exact supply request that was
 * previously reported as exhausted. It carries no replacement item: that
 * item remains a normal subsequent supply/item-completed operation.
 */
export type LearningTrainingContentRecoveredPayload =
  LearningEventBasePayload & {
    readonly mode: LearningTaskMode
    readonly exhaustionRequestId: string
  }

export type LearningTrainingBudgetCompletedPayload =
  LearningEventBasePayload & {
    readonly mode: LearningTaskMode
    readonly lastCompletedItemId: string
    readonly completedItemCount: number
  }

type ExtraTrainingEventBasePayload = {
  readonly sessionId: string
  readonly localDate: string
  readonly domain: AbilityDomain
  readonly targetModuleId: TrainingModuleId
  readonly mode: 'learn'
}

export type ExtraTrainingStartedPayload = ExtraTrainingEventBasePayload

export type ExtraTrainingTimingSegmentRecordedPayload =
  ExtraTrainingEventBasePayload & {
    readonly phase: LearningTimingPhase
    readonly reason: LearningTimingSegmentReason
    readonly visibility: 'foreground' | 'background'
    readonly startedAt: string
    readonly endedAt: string
    readonly elapsedSeconds: number
    readonly idleThresholdSeconds: typeof MAX_INTERACTION_IDLE_SECONDS
  }

export type ExtraTrainingItemCompletedPayload = ExtraTrainingEventBasePayload & {
  readonly item: LearningTaskSupplyItem
  readonly requestId: string
  readonly nextSupplyCursor: string | null
}

export type ExtraTrainingExitedPayload = ExtraTrainingEventBasePayload

export type ExtraTrainingBudgetCompletedPayload =
  ExtraTrainingEventBasePayload & {
    readonly completedItemCount: number
  }

export type ExtraTrainingFailedPayload = ExtraTrainingEventBasePayload & {
  readonly reason: Exclude<ExtraTrainingEndReason, 'budget-reached' | 'user-exited' | 'cross-day-expired'>
}

/**
 * This event deliberately has no `planId` or daily `taskId`. Its scored
 * evidence can update review state through applyExtraTrainingAttempt(), but
 * it is not accepted by applyPlanEvent().
 */
export type ExtraTrainingAttemptCompletedPayload =
  ExtraTrainingEventBasePayload & {
    readonly learningUnitId: string
    readonly contentRef: string
    readonly difficultyLevel: number
    readonly estimatedSeconds: number
    readonly result: 'scored' | 'unscorable'
    readonly performanceScore: number | null
    readonly evidenceQuality: number
    readonly assistanceLevel: number
    readonly durationSeconds: number
    readonly errorTags: readonly StandardErrorTag[]
    readonly contentTags: readonly string[]
    readonly failureCategory: AttemptFailureCategory | null
    /** Exact R7 counts; optional only for pre-R7 event compatibility. */
    readonly scoreDelta?: TrainingUnitScore
  }

type LearningPlatformEvent<
  TType extends string,
  TPayload extends PortableData,
> = PlatformEvent<TType, TPayload>

export type LearningTaskStartedEvent = LearningPlatformEvent<
  'learning.task.started.v1',
  LearningTaskStartedPayload
>

export type LearningTaskPausedEvent = LearningPlatformEvent<
  'learning.task.paused.v1',
  LearningTaskPausedPayload
>

export type LearningTaskSkippedEvent = LearningPlatformEvent<
  'learning.task.skipped.v1',
  LearningTaskSkippedPayload
>

export type LearningAttemptCompletedEvent = LearningPlatformEvent<
  'learning.attempt.completed.v1',
  LearningAttemptCompletedPayload
>

export type LearningTimingSegmentRecordedEvent = LearningPlatformEvent<
  'learning.timing.segment.recorded.v1',
  LearningTimingSegmentRecordedPayload
>

export type LearningTrainingItemCompletedEvent = LearningPlatformEvent<
  'learning.training.item.completed.v1',
  LearningTrainingItemCompletedPayload
>

export type LearningTrainingContentExhaustedEvent = LearningPlatformEvent<
  'learning.training.content.exhausted.v1',
  LearningTrainingContentExhaustedPayload
>

export type LearningTrainingContentRecoveredEvent = LearningPlatformEvent<
  'learning.training.content.recovered.v1',
  LearningTrainingContentRecoveredPayload
>

export type LearningTrainingBudgetCompletedEvent = LearningPlatformEvent<
  'learning.training.budget.completed.v1',
  LearningTrainingBudgetCompletedPayload
>

export type ExtraTrainingStartedEvent = LearningPlatformEvent<
  'learning.extra-training.started.v1',
  ExtraTrainingStartedPayload
>
export type ExtraTrainingTimingSegmentRecordedEvent = LearningPlatformEvent<
  'learning.extra-training.timing.segment.recorded.v1',
  ExtraTrainingTimingSegmentRecordedPayload
>
export type ExtraTrainingItemCompletedEvent = LearningPlatformEvent<
  'learning.extra-training.item.completed.v1',
  ExtraTrainingItemCompletedPayload
>
export type ExtraTrainingExitedEvent = LearningPlatformEvent<
  'learning.extra-training.exited.v1',
  ExtraTrainingExitedPayload
>
export type ExtraTrainingBudgetCompletedEvent = LearningPlatformEvent<
  'learning.extra-training.budget.completed.v1',
  ExtraTrainingBudgetCompletedPayload
>
export type ExtraTrainingFailedEvent = LearningPlatformEvent<
  'learning.extra-training.failed.v1',
  ExtraTrainingFailedPayload
>
export type ExtraTrainingAttemptCompletedEvent = LearningPlatformEvent<
  'learning.extra-training.attempt.completed.v1',
  ExtraTrainingAttemptCompletedPayload
>

export type ExtraTrainingEvent =
  | ExtraTrainingStartedEvent
  | ExtraTrainingTimingSegmentRecordedEvent
  | ExtraTrainingItemCompletedEvent
  | ExtraTrainingExitedEvent
  | ExtraTrainingBudgetCompletedEvent
  | ExtraTrainingFailedEvent
  | ExtraTrainingAttemptCompletedEvent

export type LearningEvent =
  | LearningTaskStartedEvent
  | LearningTaskPausedEvent
  | LearningTaskSkippedEvent
  | LearningAttemptCompletedEvent
  | LearningTimingSegmentRecordedEvent
  | LearningTrainingItemCompletedEvent
  | LearningTrainingContentExhaustedEvent
  | LearningTrainingContentRecoveredEvent
  | LearningTrainingBudgetCompletedEvent

export interface DailyPlanInput {
  readonly planId: string
  readonly generatedAt: string
  readonly localDate: string
  readonly availableSeconds?: number
  readonly progress: ProgressState
  readonly reviewItems: Readonly<Record<string, ReviewItemState>>
  readonly candidates: readonly LearningCandidate[]
  readonly carryOverTasks?: readonly LearningTask[]
}

export interface ApplyAttemptResult {
  readonly state: LearningEngineState
  readonly reviewItem: ReviewItemState | null
  readonly evidenceAccepted: boolean
  readonly reason: 'scored' | 'unscorable' | 'duplicate'
}
