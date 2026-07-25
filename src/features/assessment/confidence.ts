import type { ConfidenceBand } from './types.ts'

export interface ConfidenceInput {
  readonly standardError: number
  readonly scoredCount: number
  readonly minimumEvidence: number
  readonly coverageRatio: number
  readonly meanReliability: number
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Confidence describes this short test's evidence quality. It is not the
 * probability that a CEFR label is objectively correct.
 */
export function calculateConfidence(input: ConfidenceInput): number {
  const precision = clampUnit(1 - input.standardError / 3.5)
  const evidence = clampUnit(input.scoredCount / input.minimumEvidence)
  const coverage = clampUnit(input.coverageRatio)
  const reliability = clampUnit(input.meanReliability)

  return Math.round(
    clampUnit(
      precision * 0.4 +
        evidence * 0.25 +
        coverage * 0.2 +
        reliability * 0.15,
    ) * 100,
  ) / 100
}

export function confidenceBand(value: number): ConfidenceBand {
  const confidence = clampUnit(value)

  if (confidence >= 0.8) {
    return 'high'
  }

  if (confidence >= 0.6) {
    return 'moderate'
  }

  if (confidence >= 0.4) {
    return 'low'
  }

  return 'insufficient'
}
