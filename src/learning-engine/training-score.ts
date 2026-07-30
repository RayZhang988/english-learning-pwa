import type { TrainingUnitScore } from './contracts.ts'

export function emptyTrainingUnitScore(): TrainingUnitScore {
  return {
    schemaVersion: 1,
    correctCount: 0,
    incorrectCount: 0,
    unscorableCount: 0,
  }
}

export function assertTrainingUnitScore(
  score: TrainingUnitScore,
  fieldName = 'score',
): void {
  if (score.schemaVersion !== 1) {
    throw new TypeError(`${fieldName}.schemaVersion must be 1`)
  }
  for (const key of [
    'correctCount',
    'incorrectCount',
    'unscorableCount',
  ] as const) {
    const value = score[key]
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${fieldName}.${key} must be a non-negative integer`)
    }
  }
}

export function mergeTrainingUnitScore(
  current: TrainingUnitScore | undefined,
  delta: TrainingUnitScore | undefined,
): TrainingUnitScore | undefined {
  if (delta === undefined) {
    return current
  }
  assertTrainingUnitScore(delta, 'scoreDelta')
  const base = current ?? emptyTrainingUnitScore()
  assertTrainingUnitScore(base)
  return {
    schemaVersion: 1,
    correctCount: base.correctCount + delta.correctCount,
    incorrectCount: base.incorrectCount + delta.incorrectCount,
    unscorableCount: base.unscorableCount + delta.unscorableCount,
  }
}

export function scoredTrainingItemCount(score: TrainingUnitScore): number {
  assertTrainingUnitScore(score)
  return score.correctCount + score.incorrectCount
}

export function trainingScorePercentage(
  score: TrainingUnitScore,
): number | null {
  const total = scoredTrainingItemCount(score)
  return total === 0 ? null : (score.correctCount / total) * 100
}

