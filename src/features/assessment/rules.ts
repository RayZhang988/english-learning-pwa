import type {
  AbilityDomain,
  AssessmentItemFormat,
} from './types.ts'

export interface RequiredFormatCoverage {
  readonly format: AssessmentItemFormat
  readonly count: number
}

export interface DomainAssessmentRule {
  readonly minimumScored: number
  readonly maximumAttempts: number
  readonly targetStandardError: number
  readonly consecutiveFailureLimit: number
  readonly requiredFormats: readonly RequiredFormatCoverage[]
}

export const DOMAIN_ORDER = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly AbilityDomain[]

export const DOMAIN_RULES: Readonly<
  Record<AbilityDomain, DomainAssessmentRule>
> = {
  vocabulary: {
    minimumScored: 8,
    maximumAttempts: 12,
    targetStandardError: 1.35,
    consecutiveFailureLimit: 2,
    requiredFormats: [
      { format: 'word-meaning', count: 2 },
      { format: 'sentence-understanding', count: 2 },
    ],
  },
  listening: {
    minimumScored: 6,
    maximumAttempts: 9,
    targetStandardError: 1.5,
    consecutiveFailureLimit: 2,
    requiredFormats: [
      { format: 'listening-gist', count: 1 },
      { format: 'listening-detail', count: 1 },
    ],
  },
  speaking: {
    minimumScored: 4,
    maximumAttempts: 6,
    targetStandardError: 1.65,
    consecutiveFailureLimit: 2,
    requiredFormats: [
      { format: 'read-aloud', count: 1 },
      { format: 'repeat', count: 1 },
      { format: 'spoken-response', count: 1 },
    ],
  },
}

export const ASSESSMENT_TIMING = {
  targetMinimumMs: 15 * 60_000,
  stopStartingOptionalItemsMs: 18 * 60_000 + 45_000,
  hardLimitMs: 20 * 60_000,
} as const
