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
export const MINIMUM_DAILY_BUDGET_SECONDS = 5 * 60

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
  readonly estimatedSeconds: number
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
  readonly required: boolean
  readonly dueAt: string | null
  readonly skipLimit: number
  readonly tags: readonly string[]
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

export interface ProgressState {
  readonly schemaVersion: 1
  readonly profileId: string
  readonly assessmentCompletedAt: string
  readonly initializedAt: string
  readonly updatedAt: string
  readonly domains: Readonly<Record<AbilityDomain, DomainProgressState>>
  readonly attempts: readonly AttemptEvidence[]
  readonly dailyActivity: readonly DailyActivity[]
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
  readonly skipCount: number
  readonly startedAt: string | null
  readonly updatedAt: string
}

export interface PlanProgress {
  readonly schemaVersion: 1
  readonly plan: DailyPlan
  readonly status: 'not-started' | 'in-progress' | 'completed'
  readonly tasks: readonly TaskExecutionState[]
  readonly processedEventIds: readonly string[]
  readonly updatedAt: string
}

export interface ResumeDecision {
  readonly schemaVersion: 1
  readonly action: 'resume-plan' | 'generate-new-plan' | 'nothing-to-resume'
  readonly nextTaskId: string | null
  readonly carryOverTasks: readonly LearningTask[]
  readonly reason:
    | 'same-day-incomplete'
    | 'cross-day-carry-over'
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

export type LearningEvent =
  | LearningTaskStartedEvent
  | LearningTaskPausedEvent
  | LearningTaskSkippedEvent
  | LearningAttemptCompletedEvent

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
