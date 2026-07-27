import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import { correctTravelVocabularyOptionIdR1 } from './travel-vocabulary-bank.ts'
import {
  answerTravelVocabularyQuestionR1,
  canSubmitTravelVocabularyStageR1,
  continueTravelVocabularyStageR1,
  createTravelVocabularyAssessmentSessionR1,
  submitTravelVocabularyStageR1,
} from './travel-vocabulary-engine.ts'

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_103_515_245) + 12_345) >>> 0
    return value / 4_294_967_296
  }
}

function answerCurrentStage(input: {
  readonly session: ReturnType<
    typeof createTravelVocabularyAssessmentSessionR1
  >
  readonly correct: number
  readonly uncertain?: number
}) {
  let session = input.session
  const plan = session.stagePlans[session.currentStageIndex]
  if (!plan) {
    throw new Error('Missing current stage plan')
  }
  const uncertain = input.uncertain ?? 0
  for (const [index, question] of plan.questions.entries()) {
    const correctOptionId = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question,
    })
    if (index < input.correct) {
      session = answerTravelVocabularyQuestionR1({
        session,
        questionId: question.id,
        answer: { kind: 'choice', optionId: correctOptionId },
      })
    } else if (index < input.correct + uncertain) {
      session = answerTravelVocabularyQuestionR1({
        session,
        questionId: question.id,
        answer: { kind: 'uncertain' },
      })
    } else {
      const wrong = question.options.find(
        (option) => option.id !== correctOptionId,
      )
      if (!wrong) {
        throw new Error('Missing wrong option')
      }
      session = answerTravelVocabularyQuestionR1({
        session,
        questionId: question.id,
        answer: { kind: 'choice', optionId: wrong.id },
      })
    }
  }
  return session
}

describe('R1 staged travel vocabulary engine', () => {
  it('allows answer correction before submission and locks after submission', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'editable',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(1),
    })
    const question = session.stagePlans[0]?.questions[0]
    if (!question) {
      throw new Error('Missing first question')
    }
    const correct = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question,
    })
    const wrong = question.options.find(
      (option) => option.id !== correct,
    )
    if (!wrong) {
      throw new Error('Missing wrong option')
    }
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: question.id,
      answer: { kind: 'choice', optionId: wrong.id },
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: question.id,
      answer: { kind: 'choice', optionId: correct },
    })
    session = answerCurrentStage({
      session,
      correct: 0,
      uncertain: 30,
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: question.id,
      answer: { kind: 'choice', optionId: correct },
    })
    expect(canSubmitTravelVocabularyStageR1(session)).toBe(true)

    const submitted = submitTravelVocabularyStageR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })
    expect(submitted.result.correctCount).toBe(1)
    expect(submitted.result.uncertainCount).toBe(29)
    expect(() =>
      answerTravelVocabularyQuestionR1({
        session: submitted.session,
        questionId: question.id,
        answer: { kind: 'uncertain' },
      }),
    ).toThrow('locked')
  })

  it('requires 30 answers but never requires a passing score', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'zero-score',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(2),
    })
    expect(() =>
      submitTravelVocabularyStageR1({
        session,
        bank: travelVocabularyBankR1,
        submittedAt: '2026-07-27T00:01:00.000Z',
      }),
    ).toThrow('All 30 questions')

    session = answerCurrentStage({ session, correct: 0 })
    const submitted = submitTravelVocabularyStageR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })
    expect(submitted.result.masteryRate).toBe(0)
    const next = continueTravelVocabularyStageR1(
      submitted.session,
    )
    expect(next.currentStageIndex).toBe(1)
  })

  it('completes all five stages for mixed scores', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'mixed',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(3),
    })
    for (const [stageIndex, correct] of [0, 6, 15, 30, 12].entries()) {
      session = answerCurrentStage({ session, correct })
      session = submitTravelVocabularyStageR1({
        session,
        bank: travelVocabularyBankR1,
        submittedAt: `2026-07-27T00:${String(
          stageIndex + 1,
        ).padStart(2, '0')}:00.000Z`,
      }).session
      if (stageIndex < 4) {
        session = continueTravelVocabularyStageR1(session)
      }
    }
    expect(session.status).toBe('completed')
    expect(session.completedStages.map((stage) => stage.correctCount))
      .toEqual([0, 6, 15, 30, 12])
  })
})
