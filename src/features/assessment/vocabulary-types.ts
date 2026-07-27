import type { CefrBand } from './levels.ts'
import type { AssessmentRuntimeSnapshotV1 } from './runtime-types.ts'
import type { AbilityProfileR1 } from './travel-vocabulary-types.ts'
import type {
  AbilityDomain,
  AbilityEstimateV1,
  AbilityProfileV1,
  ChoiceOption,
  ConfidenceBand,
} from './types.ts'

export type VocabularyAssessmentFormatV2 =
  | 'word-meaning'
  | 'sentence-understanding'

export type VocabularyFrequencyTierV2 =
  | 'foundation'
  | 'high-frequency'
  | 'mid-frequency'
  | 'low-frequency'
  | 'advanced'

export interface VocabularyItemCalibrationV2 {
  readonly scale: 'internal-lexical-difficulty-v2'
  readonly status: 'expert-provisional'
  readonly frequencyTier: VocabularyFrequencyTierV2
  readonly difficultyStandardError: number
  /**
   * v2 deliberately has no external corpus-to-total-word-count calibration.
   */
  readonly wordCountCalibration: 'unavailable'
}

export interface VocabularyAssessmentItemV2 {
  readonly id: string
  readonly schemaVersion: 2
  readonly domain: 'vocabulary'
  readonly kind: 'choice'
  readonly format: VocabularyAssessmentFormatV2
  readonly difficulty: number
  readonly discrimination: number
  readonly expectedSeconds: number
  readonly prompt: string
  readonly tags: readonly string[]
  readonly stimulus: {
    readonly text: string
    readonly audioText: null
    readonly maxPlays: 0
  }
  readonly options: readonly ChoiceOption[]
  readonly scoring: {
    readonly correctOptionId: string
  }
  readonly calibration: VocabularyItemCalibrationV2
}

export interface PublicVocabularyAssessmentItemV2
  extends Omit<VocabularyAssessmentItemV2, 'scoring'> {
  readonly scoring?: never
}

export interface VocabularyAssessmentBankV2 {
  readonly id: 'placement-vocabulary-en-us-v2'
  readonly schemaVersion: 2
  readonly assessmentKind: 'adaptive-vocabulary'
  readonly locale: 'en-US'
  readonly items: readonly VocabularyAssessmentItemV2[]
}

export type VocabularyAnswerV2 =
  | 'correct'
  | 'incorrect'
  | 'uncertain'

export interface VocabularyAssessmentResponseV2 {
  readonly itemId: string
  readonly format: VocabularyAssessmentFormatV2
  readonly difficulty: number
  readonly submittedAt: string
  readonly durationMs: number
  readonly answer: VocabularyAnswerV2
  readonly score: number
  readonly reliability: number
  readonly rapidGuess: boolean
}

export type VocabularyAssessmentStopReasonV2 =
  | 'threshold-converged'
  | 'lower-boundary'
  | 'upper-boundary'
  | 'item-limit'
  | 'time-limit'
  | 'response-quality-limit'
  | 'bank-exhausted'
  | 'user-stopped'
  | 'legacy-migrated'

export interface VocabularyAdaptiveEstimateV2 {
  readonly level: number
  readonly information: number
  readonly standardError: number
  readonly lowerBound: number
  readonly upperBound: number
  readonly hasLowerEvidence: boolean
  readonly hasUpperEvidence: boolean
  readonly nextDifficulty: number
  readonly attemptedCount: number
  readonly reliableEvidenceCount: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly uncertainCount: number
  readonly rapidGuessCount: number
  readonly guessingStreak: number
  readonly consecutiveCorrect: number
  readonly consecutiveIncorrect: number
  readonly consecutiveUncertain: number
  readonly reversalCount: number
  readonly nearThresholdCount: number
  readonly reliabilityTotal: number
  readonly wordMeaningCount: number
  readonly sentenceUnderstandingCount: number
  readonly lastAnswer: VocabularyAnswerV2 | null
  readonly confidence: number
  readonly status: 'collecting' | 'stopped'
  readonly stopReason: VocabularyAssessmentStopReasonV2 | null
}

export interface VocabularyAssessmentSessionV2 {
  readonly schemaVersion: 2
  readonly assessmentKind: 'adaptive-vocabulary'
  readonly id: string
  readonly bankId: string
  readonly startedAt: string
  readonly phase: 'vocabulary' | 'complete'
  readonly status: 'in-progress' | 'completed' | 'partial'
  readonly currentItemId: string | null
  readonly responses: readonly VocabularyAssessmentResponseV2[]
  readonly estimate: VocabularyAdaptiveEstimateV2
  readonly completionReason: VocabularyAssessmentStopReasonV2 | null
}

export type AbilityCalibrationStateV2 =
  | 'estimated'
  | 'insufficient-evidence'
  | 'pending-calibration'

export interface AbilityEstimateV2
  extends Omit<AbilityEstimateV1, 'domain'> {
  readonly domain: AbilityDomain
  readonly calibrationState: AbilityCalibrationStateV2
}

export interface VocabularySizeEstimateV2 {
  readonly status:
    | 'estimated-internal-band'
    | 'insufficient-evidence'
  readonly unit: 'internal-lexical-level'
  readonly internalRange: {
    readonly lower: number
    readonly upper: number
  } | null
  readonly wordCountRange: null
  readonly wordCountCalibration: 'unavailable'
  readonly label: string
  readonly message: string
}

export interface AbilityProfileV2 {
  readonly schemaVersion: 2
  readonly assessmentKind: 'adaptive-vocabulary'
  readonly profileId: string
  readonly assessmentId: string
  readonly bankId: string
  readonly completedAt: string
  readonly durationSeconds: number
  readonly outcome: 'completed' | 'partial'
  readonly disclaimer: string
  readonly vocabularySize: VocabularySizeEstimateV2
  readonly abilities: Readonly<Record<AbilityDomain, AbilityEstimateV2>>
}

export type AnyAbilityProfile =
  | AbilityProfileV1
  | AbilityProfileV2
  | AbilityProfileR1

export type VocabularyAssessmentLifecycleV2 =
  | 'intro'
  | 'active'
  | 'feedback'
  | 'paused'
  | 'completed'

export interface VocabularySubmissionSummaryV2 {
  readonly itemId: string
  readonly status: 'recorded' | 'uncertain'
}

export interface VocabularyAssessmentProgressV2 {
  readonly phase: 'vocabulary' | 'complete'
  readonly elapsedSeconds: number
  readonly targetMinimumSeconds: number
  readonly targetMaximumSeconds: number
  readonly hardLimitSeconds: number
  readonly attempted: number
  readonly minimumEvidence: number
  readonly maximumAttempts: number
  readonly estimatedLevel: number
  readonly estimatedRange: {
    readonly lower: number
    readonly upper: number
  }
  readonly confidence: number
  readonly confidenceBand: ConfidenceBand
}

export interface VocabularyAssessmentActionsV2 {
  readonly canStart: boolean
  readonly canSelectChoice: boolean
  readonly canSubmitChoice: boolean
  readonly canMarkUncertain: boolean
  readonly canSkip: boolean
  readonly canContinue: boolean
  readonly canPause: boolean
  readonly canResume: boolean
  readonly canStop: boolean
}

export interface VocabularyAssessmentRuntimeStateV2 {
  readonly schemaVersion: 2
  readonly assessmentKind: 'adaptive-vocabulary'
  readonly lifecycle: VocabularyAssessmentLifecycleV2
  readonly sessionId: string
  readonly phase: 'vocabulary' | 'complete'
  readonly item: PublicVocabularyAssessmentItemV2 | null
  readonly selectedOptionId: string | null
  readonly progress: VocabularyAssessmentProgressV2
  readonly lastSubmission: VocabularySubmissionSummaryV2 | null
  readonly profile: AbilityProfileV2 | null
  readonly actions: VocabularyAssessmentActionsV2
}

export interface LegacyAssessmentSourceV1 {
  readonly kind: 'assessment-runtime-v1'
  readonly snapshot: AssessmentRuntimeSnapshotV1
}

export interface VocabularyAssessmentRuntimeSnapshotV2 {
  readonly schemaVersion: 2
  readonly assessmentKind: 'adaptive-vocabulary'
  readonly bankId: string
  readonly lifecycle: VocabularyAssessmentLifecycleV2
  readonly resumeTo: 'active' | 'feedback' | null
  readonly session: VocabularyAssessmentSessionV2
  readonly selectedOptionId: string | null
  readonly activeElapsedMs: number
  readonly itemStartedAtActiveMs: number | null
  readonly lastSubmission: VocabularySubmissionSummaryV2 | null
  readonly profile: AbilityProfileV2 | null
  readonly legacySource: LegacyAssessmentSourceV1 | null
  readonly updatedAt: string
}

export type VocabularyAbilityProfileCompletionHandler = (
  profile: AbilityProfileV2,
) => void | Promise<void>

export interface VocabularyEstimatePresentationV2 {
  readonly internalLevel: number | null
  readonly internalRange: {
    readonly lower: number
    readonly upper: number
  } | null
  readonly cefrEstimate: CefrBand
  readonly confidence: number
  readonly confidenceBand: ConfidenceBand
  readonly boundary:
    | 'within-range'
    | 'lower-censored'
    | 'upper-censored'
    | 'unknown'
}
