import type { CefrBand } from './levels.ts'

export type AbilityDomain = 'vocabulary' | 'listening' | 'speaking'

export type AssessmentItemFormat =
  | 'word-meaning'
  | 'sentence-understanding'
  | 'listening-gist'
  | 'listening-detail'
  | 'listening-inference'
  | 'read-aloud'
  | 'repeat'
  | 'spoken-response'

export interface ChoiceOption {
  readonly id: string
  readonly text: string
}

interface AssessmentItemBase {
  readonly id: string
  readonly schemaVersion: 1
  readonly domain: AbilityDomain
  readonly format: AssessmentItemFormat
  readonly difficulty: number
  readonly discrimination: number
  readonly expectedSeconds: number
  readonly prompt: string
  readonly tags: readonly string[]
}

export interface ChoiceAssessmentItem extends AssessmentItemBase {
  readonly kind: 'choice'
  readonly stimulus: {
    readonly text: string | null
    readonly audioText: string | null
    readonly maxPlays: number
  }
  readonly options: readonly ChoiceOption[]
  readonly scoring: {
    readonly correctOptionId: string
  }
}

export type SpeechRubric = 'read-aloud' | 'repeat' | 'spoken-response'

export interface SpeechAssessmentItem extends AssessmentItemBase {
  readonly kind: 'speech'
  readonly stimulus: {
    readonly text: string | null
    readonly audioText: string | null
    readonly maxPlays: number
  }
  readonly scoring: {
    readonly rubric: SpeechRubric
    readonly referenceText: string | null
    /**
     * Each inner array contains equivalent phrases. A response covers the
     * concept when it contains at least one phrase from that array.
     */
    readonly keyConcepts: readonly (readonly string[])[]
  }
}

export type AssessmentItem = ChoiceAssessmentItem | SpeechAssessmentItem

export interface PublicChoiceAssessmentItem
  extends Omit<ChoiceAssessmentItem, 'scoring'> {
  readonly scoring?: never
}

export interface PublicSpeechAssessmentItem
  extends Omit<SpeechAssessmentItem, 'scoring'> {
  readonly scoring?: never
}

export type PublicAssessmentItem =
  | PublicChoiceAssessmentItem
  | PublicSpeechAssessmentItem

export interface AssessmentBank {
  readonly id: string
  readonly schemaVersion: 1
  readonly locale: 'en-US'
  readonly items: readonly AssessmentItem[]
}

export interface SpeechMetrics {
  readonly completeness: number
  readonly intelligibility: number
  readonly fluency: number
  readonly languageControl: number
  readonly taskCompletion: number
  /**
   * Reliability of the recognizer result, not a learner ability score.
   */
  readonly recognitionConfidence: number
}

export interface ScoredSpeechObservation {
  readonly status: 'scored'
  readonly transcript: string
  readonly metrics: SpeechMetrics
}

export type SpeechFailureReason =
  | 'permission-denied'
  | 'recognizer-unavailable'
  | 'offline'
  | 'no-speech'
  | 'recognition-failed'
  | 'recording-failed'

export interface FailedSpeechObservation {
  readonly status: 'unscorable'
  readonly reason: SpeechFailureReason
  readonly recordingAvailable: boolean
}

export type SpeechObservation =
  | ScoredSpeechObservation
  | FailedSpeechObservation

export interface ChoiceSubmission {
  readonly kind: 'choice'
  readonly selectedOptionId: string | null
  readonly durationMs: number
}

export interface SpeechSubmission {
  readonly kind: 'speech'
  readonly observation: SpeechObservation
  readonly durationMs: number
}

export type NonSpeechFailureReason =
  | 'audio-unavailable'
  | 'audio-playback-failed'
  | 'item-corrupt'
  | 'user-skipped'

export interface UnscorableSubmission {
  readonly kind: 'unscorable'
  readonly reason: NonSpeechFailureReason
  readonly durationMs: number
}

export type AssessmentSubmission =
  | ChoiceSubmission
  | SpeechSubmission
  | UnscorableSubmission

export interface AssessmentResponseRecord {
  readonly itemId: string
  readonly domain: AbilityDomain
  readonly format: AssessmentItemFormat
  readonly submittedAt: string
  readonly durationMs: number
  readonly score: number | null
  readonly reliability: number
  readonly failureReason: SpeechFailureReason | NonSpeechFailureReason | null
}

export interface DomainEstimateState {
  readonly domain: AbilityDomain
  readonly level: number
  readonly information: number
  readonly standardError: number
  readonly scoredCount: number
  readonly attemptedCount: number
  readonly consecutiveFailures: number
  readonly reliabilityTotal: number
  readonly coveredFormats: readonly AssessmentItemFormat[]
  readonly lastScore: number | null
  readonly status: 'collecting' | 'stopped' | 'unavailable'
  readonly stopReason:
    | 'precision-reached'
    | 'item-limit'
    | 'consecutive-failures'
    | 'bank-exhausted'
    | 'time-limit'
    | 'user-stopped'
    | null
}

export type AssessmentPhase =
  | 'vocabulary'
  | 'listening'
  | 'speaking'
  | 'complete'

export interface AssessmentSession {
  readonly schemaVersion: 1
  readonly id: string
  readonly bankId: string
  readonly startedAt: string
  readonly phase: AssessmentPhase
  readonly status: 'in-progress' | 'completed' | 'partial'
  readonly currentItemId: string | null
  readonly responses: readonly AssessmentResponseRecord[]
  readonly estimates: Readonly<Record<AbilityDomain, DomainEstimateState>>
  readonly completionReason:
    | 'all-domains-stopped'
    | 'time-limit'
    | 'user-stopped'
    | null
}

export type ConfidenceBand = 'high' | 'moderate' | 'low' | 'insufficient'

export interface AbilityEstimate {
  readonly domain: AbilityDomain
  readonly status: 'estimated' | 'low-confidence' | 'unavailable'
  readonly internalLevel: number | null
  readonly internalRange: {
    readonly lower: number
    readonly upper: number
  } | null
  readonly score100: number | null
  readonly cefrEstimate: CefrBand
  readonly cefrRange: {
    readonly lower: CefrBand
    readonly upper: CefrBand
  } | null
  readonly confidence: number
  readonly confidenceBand: ConfidenceBand
  readonly standardError: number | null
  readonly evidenceCount: number
  readonly attemptedCount: number
  readonly reliability: number
  readonly boundary:
    | 'within-range'
    | 'lower-censored'
    | 'upper-censored'
    | 'unknown'
  readonly message: string
  readonly warnings: readonly string[]
}

export interface AbilityProfile {
  readonly schemaVersion: 1
  readonly profileId: string
  readonly assessmentId: string
  readonly bankId: string
  readonly completedAt: string
  readonly durationSeconds: number
  readonly outcome: 'completed' | 'partial'
  readonly disclaimer: string
  readonly abilities: Readonly<Record<AbilityDomain, AbilityEstimate>>
}

/**
 * Frozen legacy aliases. v1 remains readable and recoverable, but new first
 * use placement must use the vocabulary-only v2 contract.
 */
export type AbilityEstimateV1 = AbilityEstimate
export type AbilityProfileV1 = AbilityProfile
