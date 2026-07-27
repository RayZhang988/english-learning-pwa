export const VOCABULARY_ASSESSMENT_RULES_V2 = {
  minimumReliableEvidence: 8,
  maximumAttempts: 12,
  minimumPerFormat: 3,
  minimumNearThreshold: 3,
  maximumConvergedRange: 3,
  minimumConvergedConfidence: 0.6,
  responseQualityStreakLimit: 4,
  rapidGuessThresholdMs: 2_500,
  targetMinimumMs: 8 * 60_000,
  targetMaximumMs: 12 * 60_000,
  hardLimitMs: 15 * 60_000,
} as const
