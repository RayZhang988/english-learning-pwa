import { describe, expect, it } from 'vitest'
import {
  estimateTravelVocabularyStageR1,
  estimateTravelVocabularyTotalR1,
  mapTravelVocabularyLevelR1,
  TRAVEL_VOCABULARY_RESULT_LEVELS_R1,
  TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1,
} from './travel-vocabulary-model.ts'
import type {
  TravelVocabularyResponseR1,
  TravelVocabularyStageResultR1,
} from './travel-vocabulary-types.ts'

function responses(input: {
  readonly correct: number
  readonly incorrect: number
  readonly uncertain: number
}): readonly TravelVocabularyResponseR1[] {
  return Array.from({ length: 30 }, (_, index) => {
    const answer =
      index < input.correct
        ? 'correct'
        : index < input.correct + input.incorrect
          ? 'incorrect'
          : 'uncertain'
    return {
      questionId: `question-${index}`,
      wordId: `word-${index}`,
      selectedOptionId:
        answer === 'uncertain' ? null : 'choice-1',
      answer,
    }
  })
}

function stageResult(
  stageIndex: number,
  correct: number,
): TravelVocabularyStageResultR1 {
  const stage = TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1[stageIndex]
  if (!stage) {
    throw new Error('Missing stage definition')
  }
  const incorrect = 30 - correct
  return estimateTravelVocabularyStageR1({
    stageId: stage.id,
    stageOrder: stage.order,
    stageLabel: stage.label,
    representativeWordCount: stage.representativeWordCount,
    correctCount: correct,
    incorrectCount: incorrect,
    uncertainCount: 0,
    submittedAt: '2026-07-27T00:00:00.000Z',
    responses: responses({
      correct,
      incorrect,
      uncertain: 0,
    }),
  })
}

describe('R1 travel vocabulary estimation model', () => {
  it.each([
    [0, 0],
    [6, 0.2],
    [15, 0.5],
    [30, 1],
  ])(
    'maps %i/30 to mastery proportion %s',
    (correct, masteryRate) => {
      const result = stageResult(1, correct)
      expect(result.correctCount).toBe(correct)
      expect(result.masteryRate).toBe(masteryRate)
      expect(result.estimatedWords).toBe(
        Math.round(
          (masteryRate *
            TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1[1]
              .representativeWordCount) /
            10,
        ) * 10,
      )
    },
  )

  it('sums five rounded stage estimates and keeps a guess-aware interval', () => {
    const results = [0, 6, 15, 30, 30].map((correct, index) =>
      stageResult(index, correct),
    )
    const total = estimateTravelVocabularyTotalR1(results)

    expect(total.estimatedWords).toBe(2_180)
    expect(total.correctCount).toBe(81)
    expect(total.validQuestionCount).toBe(150)
    expect(total.reasonableInterval.lower).toBeLessThan(
      total.estimatedWords,
    )
    expect(total.reasonableInterval.upper).toBeGreaterThan(
      total.estimatedWords,
    )
    expect(total.chanceModel).toBe(
      'four-choice-with-uncertain-option',
    )
  })

  it('maps every one of the 15 inclusive boundaries centrally', () => {
    expect(TRAVEL_VOCABULARY_RESULT_LEVELS_R1).toHaveLength(15)
    for (const [index, level] of
      TRAVEL_VOCABULARY_RESULT_LEVELS_R1.entries()) {
      expect(
        mapTravelVocabularyLevelR1(level.minimumEstimatedWords).id,
      ).toBe(level.id)
      if (index > 0) {
        expect(
          mapTravelVocabularyLevelR1(
            level.minimumEstimatedWords - 1,
          ).id,
        ).toBe(
          TRAVEL_VOCABULARY_RESULT_LEVELS_R1[index - 1]?.id,
        )
      }
    }
  })
})
