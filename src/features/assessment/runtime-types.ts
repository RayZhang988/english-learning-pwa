import type { AssessmentFallback } from './scoring.ts'
import type {
  AbilityDomain,
  AbilityProfile,
  AssessmentPhase,
  AssessmentSession,
  NonSpeechFailureReason,
  PublicAssessmentItem,
  SpeechFailureReason,
} from './types.ts'

export const ASSESSMENT_RUNTIME_SCHEMA_VERSION = 1 as const
export const ASSESSMENT_RUNTIME_SNAPSHOT_KEY =
  'active-assessment-runtime-v1'

export type AssessmentRuntimeLifecycle =
  | 'intro'
  | 'active'
  | 'feedback'
  | 'paused'
  | 'completed'

export interface AssessmentSubmissionSummary {
  readonly itemId: string
  readonly status: 'recorded' | 'unscorable' | 'skipped'
  readonly failureReason:
    | SpeechFailureReason
    | NonSpeechFailureReason
    | null
  readonly fallback: AssessmentFallback
}

export interface AssessmentRuntimeProgress {
  readonly phase: AssessmentPhase
  readonly domain: AbilityDomain | null
  readonly elapsedSeconds: number
  readonly targetMinimumSeconds: number
  readonly hardLimitSeconds: number
  readonly totalAttempted: number
  readonly totalMaximum: number
  readonly domainAttempted: number
  readonly domainMinimum: number
  readonly domainMaximum: number
}

export interface AssessmentRuntimeActions {
  readonly canStart: boolean
  readonly canSelectChoice: boolean
  readonly canSubmitChoice: boolean
  readonly canSubmitSpeech: boolean
  readonly canReportItemFailure: boolean
  readonly canSkip: boolean
  readonly canContinue: boolean
  readonly canPause: boolean
  readonly canResume: boolean
  readonly canStop: boolean
}

/**
 * Answer-free state intended for route hosts and presentation adapters.
 */
export interface AssessmentRuntimeState {
  readonly schemaVersion: 1
  readonly lifecycle: AssessmentRuntimeLifecycle
  readonly sessionId: string
  readonly phase: AssessmentPhase
  readonly item: PublicAssessmentItem | null
  readonly selectedOptionId: string | null
  readonly progress: AssessmentRuntimeProgress
  readonly lastSubmission: AssessmentSubmissionSummary | null
  readonly profile: AbilityProfile | null
  readonly actions: AssessmentRuntimeActions
}

/**
 * Portable value owned by 03. 01 may persist it, but must not reinterpret or
 * partially reconstruct its fields.
 */
export interface AssessmentRuntimeSnapshotV1 {
  readonly schemaVersion: 1
  readonly bankId: string
  readonly lifecycle: AssessmentRuntimeLifecycle
  readonly resumeTo: 'active' | 'feedback' | null
  readonly session: AssessmentSession
  readonly selectedOptionId: string | null
  readonly activeElapsedMs: number
  readonly itemStartedAtActiveMs: number | null
  readonly lastSubmission: AssessmentSubmissionSummary | null
  readonly profile: AbilityProfile | null
  readonly updatedAt: string
}

export type AbilityProfileCompletionHandler = (
  profile: AbilityProfile,
) => void | Promise<void>
