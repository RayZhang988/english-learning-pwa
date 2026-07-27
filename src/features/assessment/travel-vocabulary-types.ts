import type { AssessmentRuntimeSnapshotV1 } from './runtime-types.ts'
import type {
  AbilityDomain,
  AbilityEstimateV1,
  AbilityProfileV1,
  ChoiceOption,
  ConfidenceBand,
} from './types.ts'
import type {
  AbilityProfileV2,
  VocabularyAssessmentRuntimeSnapshotV2,
} from './vocabulary-types.ts'

export type TravelVocabularyStageId =
  | 'stage-1-foundation'
  | 'stage-2-essential'
  | 'stage-3-independent'
  | 'stage-4-advanced'
  | 'stage-5-specialized'

export interface TravelVocabularyCandidateR1 {
  readonly id: string
  readonly word: string
  readonly meaningZh: string
  readonly stageId: TravelVocabularyStageId
}

export interface TravelVocabularyStageR1 {
  readonly id: TravelVocabularyStageId
  readonly order: 1 | 2 | 3 | 4 | 5
  readonly label: string
  readonly description: string
  readonly representativeWordCount: number
  readonly candidates: readonly TravelVocabularyCandidateR1[]
}

export interface TravelVocabularyBankR1 {
  readonly id: 'travel-vocabulary-zh-cn-r1-v1'
  readonly schemaVersion: 3
  readonly assessmentKind: 'staged-travel-vocabulary'
  readonly dataVersion: 'travel-vocabulary-pools-r1-v1'
  readonly estimationModelVersion: 'travel-vocabulary-estimation-r1-v1'
  readonly resultMappingVersion: 'travel-vocabulary-level-map-r1-v1'
  readonly locale: 'en-US'
  readonly meaningLocale: 'zh-CN'
  readonly sampleSizePerStage: 30
  readonly stages: readonly TravelVocabularyStageR1[]
}

export interface TravelVocabularyQuestionPlanR1 {
  readonly id: string
  readonly stageId: TravelVocabularyStageId
  readonly wordId: string
  readonly word: string
  readonly options: readonly ChoiceOption[]
}

export interface TravelVocabularyStagePlanR1 {
  readonly stageId: TravelVocabularyStageId
  readonly questions: readonly TravelVocabularyQuestionPlanR1[]
}

export interface PublicTravelVocabularyQuestionR1 {
  readonly id: string
  readonly stageId: TravelVocabularyStageId
  readonly kind: 'choice'
  readonly prompt: '请选择最接近的中文释义'
  readonly word: string
  readonly options: readonly ChoiceOption[]
  readonly scoring?: never
}

export type TravelVocabularyDraftAnswerR1 =
  | {
      readonly questionId: string
      readonly kind: 'choice'
      readonly optionId: string
    }
  | {
      readonly questionId: string
      readonly kind: 'uncertain'
      readonly optionId: null
    }

export interface TravelVocabularyResponseR1 {
  readonly questionId: string
  readonly wordId: string
  readonly selectedOptionId: string | null
  readonly answer: 'correct' | 'incorrect' | 'uncertain'
}

export interface TravelVocabularyEstimateIntervalR1 {
  readonly lower: number
  readonly upper: number
}

export interface TravelVocabularyStageResultR1 {
  readonly stageId: TravelVocabularyStageId
  readonly stageOrder: 1 | 2 | 3 | 4 | 5
  readonly stageLabel: string
  readonly representativeWordCount: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly uncertainCount: number
  readonly validQuestionCount: number
  readonly masteryRate: number
  readonly estimatedWords: number
  readonly reasonableInterval: TravelVocabularyEstimateIntervalR1
  readonly submittedAt: string
  readonly responses: readonly TravelVocabularyResponseR1[]
}

export interface TravelVocabularyTotalEstimateR1 {
  readonly estimatedWords: number
  readonly reasonableInterval: TravelVocabularyEstimateIntervalR1
  readonly representativeWordCount: number
  readonly correctCount: number
  readonly validQuestionCount: number
  readonly uncertainCount: number
  readonly confidence: number
  readonly confidenceBand: ConfidenceBand
  readonly samplingConfidence: 'approximate-90-percent'
  readonly chanceModel: 'four-choice-with-uncertain-option'
  readonly rounding: 'nearest-10-after-each-stage'
  readonly stageResults: readonly TravelVocabularyStageResultR1[]
}

export type TravelVocabularyResultLevelId =
  | 'kindergarten'
  | 'primary-1'
  | 'primary-2'
  | 'primary-3'
  | 'primary-4'
  | 'primary-5'
  | 'primary-6'
  | 'junior-1'
  | 'junior-2'
  | 'junior-3'
  | 'senior-1'
  | 'senior-2'
  | 'senior-3'
  | 'cet-4-reference'
  | 'cet-6-reference'

export interface TravelVocabularyResultLevelR1 {
  readonly id: TravelVocabularyResultLevelId
  readonly ordinal: number
  readonly label: string
  readonly minimumEstimatedWords: number
  readonly disclaimer: string
}

export interface TravelVocabularyAbilityEstimateR1
  extends Omit<AbilityEstimateV1, 'domain'> {
  readonly domain: AbilityDomain
  readonly calibrationState:
    | 'estimated'
    | 'insufficient-evidence'
    | 'pending-calibration'
}

export type TravelVocabularyCompletionReasonR1 =
  | 'all-stages-completed'
  | 'remaining-marked-unknown'

export interface AbilityProfileR1 {
  readonly schemaVersion: 3
  readonly assessmentKind: 'staged-travel-vocabulary'
  readonly profileId: string
  readonly assessmentId: string
  readonly bankId: string
  readonly bankDataVersion: string
  readonly estimationModelVersion: string
  readonly resultMappingVersion: string
  readonly completedAt: string
  readonly durationSeconds: number
  readonly outcome: 'completed'
  /**
   * New schema-3 profiles always include this field. It remains optional in
   * the TypeScript shape so records written before the R1 fast-answer patch
   * stay source-compatible; readers normalize a missing value to
   * `all-stages-completed`.
   */
  readonly completionReason?: TravelVocabularyCompletionReasonR1
  readonly disclaimer: string
  readonly sampledWordIds: readonly string[]
  readonly travelVocabulary: TravelVocabularyTotalEstimateR1
  readonly resultLevel: TravelVocabularyResultLevelR1
  readonly abilities: Readonly<
    Record<AbilityDomain, TravelVocabularyAbilityEstimateR1>
  >
}

export type AnyAbilityProfileR1 =
  | AbilityProfileV1
  | AbilityProfileV2
  | AbilityProfileR1

export interface TravelVocabularyAssessmentSessionR1 {
  readonly schemaVersion: 3
  readonly assessmentKind: 'staged-travel-vocabulary'
  readonly id: string
  readonly bankId: string
  readonly startedAt: string
  readonly status: 'in-progress' | 'completed'
  readonly completionReason: TravelVocabularyCompletionReasonR1 | null
  readonly currentStageIndex: number
  readonly currentQuestionIndex: number
  readonly stagePlans: readonly TravelVocabularyStagePlanR1[]
  readonly draftAnswers: Readonly<
    Record<string, TravelVocabularyDraftAnswerR1>
  >
  readonly completedStages: readonly TravelVocabularyStageResultR1[]
}

export type TravelVocabularyAssessmentLifecycleR1 =
  | 'intro'
  | 'active'
  | 'stage-summary'
  | 'paused'
  | 'completed'

export type LegacyTravelAssessmentSourceR1 =
  | {
      readonly kind: 'assessment-runtime-v1'
      readonly snapshot: AssessmentRuntimeSnapshotV1
    }
  | {
      readonly kind: 'adaptive-vocabulary-runtime-v2'
      readonly snapshot: VocabularyAssessmentRuntimeSnapshotV2
    }

export interface TravelVocabularyAssessmentRuntimeSnapshotR1 {
  readonly schemaVersion: 3
  readonly assessmentKind: 'staged-travel-vocabulary'
  readonly bankId: string
  readonly lifecycle: TravelVocabularyAssessmentLifecycleR1
  readonly resumeTo: 'active' | 'stage-summary' | null
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly activeElapsedMs: number
  readonly profile: AbilityProfileR1 | null
  readonly legacySource: LegacyTravelAssessmentSourceR1 | null
  readonly migrationNotice:
    | 'legacy-measurement-incompatible-new-sample-required'
    | null
  readonly updatedAt: string
}

export interface TravelVocabularyAssessmentProgressR1 {
  readonly currentStage: number
  readonly totalStages: 5
  readonly currentQuestion: number
  readonly questionsPerStage: 30
  readonly answeredInStage: number
  readonly answeredOverall: number
  readonly totalQuestions: 150
  readonly elapsedSeconds: number
}

export interface TravelVocabularyAssessmentActionsR1 {
  readonly canStart: boolean
  readonly canNavigate: boolean
  readonly canAdvanceToNextQuestion: boolean
  readonly canAnswer: boolean
  readonly canMarkUncertain: boolean
  readonly canClearAnswer: boolean
  readonly canSubmitStage: boolean
  readonly canFinishRemainingUnknown: boolean
  readonly canContinueToNextStage: boolean
  readonly canPause: boolean
  readonly canResume: boolean
}

export interface TravelVocabularyAssessmentRuntimeStateR1 {
  readonly schemaVersion: 3
  readonly assessmentKind: 'staged-travel-vocabulary'
  readonly lifecycle: TravelVocabularyAssessmentLifecycleR1
  readonly sessionId: string
  readonly stage: {
    readonly id: TravelVocabularyStageId
    readonly order: 1 | 2 | 3 | 4 | 5
    readonly label: string
    readonly representativeWordCount: number
  } | null
  readonly questions: readonly PublicTravelVocabularyQuestionR1[]
  readonly currentQuestionIndex: number
  readonly draftAnswers: Readonly<
    Record<string, TravelVocabularyDraftAnswerR1>
  >
  readonly latestStageResult: TravelVocabularyStageResultR1 | null
  readonly completionReason: TravelVocabularyCompletionReasonR1 | null
  readonly remainingQuestionsToMarkUncertain: number
  readonly progress: TravelVocabularyAssessmentProgressR1
  readonly profile: AbilityProfileR1 | null
  readonly migrationNotice:
    | 'legacy-measurement-incompatible-new-sample-required'
    | null
  readonly actions: TravelVocabularyAssessmentActionsR1
}

export type TravelVocabularyProfileCompletionHandlerR1 = (
  profile: AbilityProfileR1,
) => void | Promise<void>

export type RandomSourceR1 = () => number
