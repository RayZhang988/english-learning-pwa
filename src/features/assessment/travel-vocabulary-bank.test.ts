import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import {
  correctTravelVocabularyOptionIdR1,
  sampleTravelVocabularyStagePlansR1,
  toPublicTravelVocabularyQuestionR1,
  validateTravelVocabularyBankR1,
} from './travel-vocabulary-bank.ts'

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

describe('R1 travel vocabulary bank and sampling', () => {
  it('contains five valid 150-word pools with no repeated word', () => {
    expect(validateTravelVocabularyBankR1(travelVocabularyBankR1)).toBe(
      travelVocabularyBankR1,
    )
    expect(
      travelVocabularyBankR1.stages.map(
        (stage) => stage.candidates.length,
      ),
    ).toEqual([150, 150, 150, 150, 150])
    const allWords = travelVocabularyBankR1.stages.flatMap((stage) =>
      stage.candidates.map((candidate) => candidate.word),
    )
    expect(allWords).toHaveLength(750)
    expect(new Set(allWords).size).toBe(750)
  })

  it('samples 30 unique words per stage and shuffles answer positions', () => {
    const plans = sampleTravelVocabularyStagePlansR1({
      bank: travelVocabularyBankR1,
      random: seededRandom(42),
    })
    expect(plans).toHaveLength(5)
    expect(plans.map((plan) => plan.questions.length)).toEqual([
      30, 30, 30, 30, 30,
    ])
    const sampled = plans.flatMap((plan) =>
      plan.questions.map((question) => question.wordId),
    )
    expect(sampled).toHaveLength(150)
    expect(new Set(sampled).size).toBe(150)

    const correctPositions = new Set(
      plans.flatMap((plan) =>
        plan.questions.map((question) =>
          question.options.findIndex(
            (option) =>
              option.id ===
              correctTravelVocabularyOptionIdR1({
                bank: travelVocabularyBankR1,
                question,
              }),
          ),
        ),
      ),
    )
    expect(correctPositions).toEqual(new Set([0, 1, 2, 3]))
  })

  it('creates a different retest and avoids the immediately previous sample', () => {
    const first = sampleTravelVocabularyStagePlansR1({
      bank: travelVocabularyBankR1,
      random: seededRandom(7),
    })
    const recentWordIds = first.flatMap((plan) =>
      plan.questions.map((question) => question.wordId),
    )
    const second = sampleTravelVocabularyStagePlansR1({
      bank: travelVocabularyBankR1,
      random: seededRandom(7),
      recentWordIds,
    })
    const secondIds = second.flatMap((plan) =>
      plan.questions.map((question) => question.wordId),
    )

    expect(secondIds).not.toEqual(recentWordIds)
    expect(
      secondIds.filter((wordId) => recentWordIds.includes(wordId)),
    ).toHaveLength(0)
  })

  it('does not expose an answer key through the public question', () => {
    const plan = sampleTravelVocabularyStagePlansR1({
      bank: travelVocabularyBankR1,
      random: seededRandom(99),
    })[0]?.questions[0]
    if (!plan) {
      throw new Error('Expected a sampled R1 question')
    }
    const publicQuestion = toPublicTravelVocabularyQuestionR1(plan)
    const serialized = JSON.stringify(publicQuestion)

    expect(publicQuestion.kind).toBe('choice')
    expect(publicQuestion).not.toHaveProperty('wordId')
    expect(serialized).not.toContain('correctOptionId')
    expect(serialized).not.toContain('meaningZh')
    expect(serialized).not.toContain('scoring')
  })
})
