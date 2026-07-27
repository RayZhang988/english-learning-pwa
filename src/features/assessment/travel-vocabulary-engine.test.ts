import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import { correctTravelVocabularyOptionIdR1 } from './travel-vocabulary-bank.ts'
import {
  advanceTravelVocabularyQuestionR1,
  answerTravelVocabularyQuestionR1,
  canSubmitTravelVocabularyStageR1,
  continueTravelVocabularyStageR1,
  createTravelVocabularyAssessmentSessionR1,
  finishTravelVocabularyRemainingUnknownR1,
  navigateTravelVocabularyQuestionR1,
  submitTravelVocabularyStageR1,
} from './travel-vocabulary-engine.ts'
import { estimateTravelVocabularyTotalR1 } from './travel-vocabulary-model.ts'

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
  it('marks an unanswered current question uncertain before advancing', () => {
    const session = createTravelVocabularyAssessmentSessionR1({
      id: 'advance-unanswered',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(10),
    })
    const first = session.stagePlans[0]?.questions[0]
    if (!first) {
      throw new Error('Missing first question')
    }

    const advanced = advanceTravelVocabularyQuestionR1({ session })

    expect(advanced.currentQuestionIndex).toBe(1)
    expect(advanced.draftAnswers[first.id]).toEqual({
      questionId: first.id,
      kind: 'uncertain',
      optionId: null,
    })
  })

  it('keeps an existing answer when advancing and allows later correction', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'advance-answered',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(11),
    })
    const first = session.stagePlans[0]?.questions[0]
    if (!first) {
      throw new Error('Missing first question')
    }
    const correct = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question: first,
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: first.id,
      answer: { kind: 'choice', optionId: correct },
    })
    const original = session.draftAnswers[first.id]

    session = advanceTravelVocabularyQuestionR1({ session })
    expect(session.draftAnswers[first.id]).toEqual(original)

    session = navigateTravelVocabularyQuestionR1({
      session,
      questionIndex: 0,
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: first.id,
      answer: { kind: 'uncertain' },
    })
    expect(session.draftAnswers[first.id]?.kind).toBe('uncertain')
  })

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

  it('submits a fully unanswered stage as 30 uncertain answers', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'zero-score',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(2),
    })
    expect(canSubmitTravelVocabularyStageR1(session)).toBe(true)

    const submitted = submitTravelVocabularyStageR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })
    expect(submitted.result.masteryRate).toBe(0)
    expect(submitted.result.uncertainCount).toBe(30)
    const next = continueTravelVocabularyStageR1(
      submitted.session,
    )
    expect(next.currentStageIndex).toBe(1)
  })

  it('preserves partial answers and fills only missing answers on submit', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'partial-submit',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(12),
    })
    const plan = session.stagePlans[0]
    const first = plan?.questions[0]
    const second = plan?.questions[1]
    if (!first || !second) {
      throw new Error('Missing partial questions')
    }
    const correct = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question: first,
    })
    const secondCorrect = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question: second,
    })
    const wrong = second.options.find(
      (option) => option.id !== secondCorrect,
    )
    if (!wrong) {
      throw new Error('Missing wrong option')
    }
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: first.id,
      answer: { kind: 'choice', optionId: correct },
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: second.id,
      answer: { kind: 'choice', optionId: wrong.id },
    })

    const submitted = submitTravelVocabularyStageR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })

    expect(submitted.result).toMatchObject({
      correctCount: 1,
      incorrectCount: 1,
      uncertainCount: 28,
      validQuestionCount: 30,
    })
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
    expect(session.completionReason).toBe('all-stages-completed')
    expect(session.completedStages.map((stage) => stage.correctCount))
      .toEqual([0, 6, 15, 30, 12])
  })

  it('finishes from the first question with all 150 answers uncertain', () => {
    const session = createTravelVocabularyAssessmentSessionR1({
      id: 'finish-first',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(13),
    })

    const completed = finishTravelVocabularyRemainingUnknownR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:01:00.000Z',
    })

    expect(completed.status).toBe('completed')
    expect(completed.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(completed.completedStages).toHaveLength(5)
    expect(
      completed.completedStages.map((stage) => stage.uncertainCount),
    ).toEqual([30, 30, 30, 30, 30])
    expect(
      completed.completedStages.reduce(
        (total, stage) => total + stage.correctCount,
        0,
      ),
    ).toBe(0)
  })

  it('preserves current answers and submitted stages when finishing early', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'finish-after-submitted',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(14),
    })
    session = answerCurrentStage({ session, correct: 6 })
    const firstSubmitted = submitTravelVocabularyStageR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:01:00.000Z',
    }).session
    const preserved = firstSubmitted.completedStages[0]

    const completed = finishTravelVocabularyRemainingUnknownR1({
      session: firstSubmitted,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:02:00.000Z',
    })

    expect(completed.completedStages[0]).toEqual(preserved)
    expect(
      completed.completedStages
        .slice(1)
        .every(
          (stage) =>
            stage.correctCount === 0 &&
            stage.incorrectCount === 0 &&
            stage.uncertainCount === 30,
        ),
    ).toBe(true)
  })

  it('finishes from a partially answered final stage and is idempotent', () => {
    let session = createTravelVocabularyAssessmentSessionR1({
      id: 'finish-final',
      startedAt: '2026-07-27T00:00:00.000Z',
      bank: travelVocabularyBankR1,
      random: seededRandom(15),
    })
    for (let stageIndex = 0; stageIndex < 4; stageIndex += 1) {
      session = answerCurrentStage({ session, correct: 30 })
      session = submitTravelVocabularyStageR1({
        session,
        bank: travelVocabularyBankR1,
        submittedAt: `2026-07-27T00:0${stageIndex + 1}:00.000Z`,
      }).session
      session = continueTravelVocabularyStageR1(session)
    }
    const finalQuestion = session.stagePlans[4]?.questions[0]
    if (!finalQuestion) {
      throw new Error('Missing final-stage question')
    }
    const correct = correctTravelVocabularyOptionIdR1({
      bank: travelVocabularyBankR1,
      question: finalQuestion,
    })
    session = answerTravelVocabularyQuestionR1({
      session,
      questionId: finalQuestion.id,
      answer: { kind: 'choice', optionId: correct },
    })

    const completed = finishTravelVocabularyRemainingUnknownR1({
      session,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })
    const repeated = finishTravelVocabularyRemainingUnknownR1({
      session: completed,
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:06:00.000Z',
    })

    expect(completed.completedStages[4]).toMatchObject({
      correctCount: 1,
      incorrectCount: 0,
      uncertainCount: 29,
    })
    expect(repeated).toBe(completed)
  })

  it('uses the unchanged estimate formula for fast and ordinary completion', () => {
    const create = () =>
      createTravelVocabularyAssessmentSessionR1({
        id: 'formula-equivalence',
        startedAt: '2026-07-27T00:00:00.000Z',
        bank: travelVocabularyBankR1,
        random: seededRandom(16),
      })
    const answerFirstCorrect = (
      session: ReturnType<typeof create>,
    ) => {
      const first =
        session.stagePlans[session.currentStageIndex]?.questions[0]
      if (!first) {
        throw new Error('Missing formula comparison question')
      }
      return answerTravelVocabularyQuestionR1({
        session,
        questionId: first.id,
        answer: {
          kind: 'choice',
          optionId: correctTravelVocabularyOptionIdR1({
            bank: travelVocabularyBankR1,
            question: first,
          }),
        },
      })
    }

    const fast = finishTravelVocabularyRemainingUnknownR1({
      session: answerFirstCorrect(create()),
      bank: travelVocabularyBankR1,
      submittedAt: '2026-07-27T00:05:00.000Z',
    })
    let ordinary = answerFirstCorrect(create())
    for (let stageIndex = 0; stageIndex < 5; stageIndex += 1) {
      ordinary = submitTravelVocabularyStageR1({
        session: ordinary,
        bank: travelVocabularyBankR1,
        submittedAt: '2026-07-27T00:05:00.000Z',
      }).session
      if (stageIndex < 4) {
        ordinary = continueTravelVocabularyStageR1(ordinary)
      }
    }

    expect(
      estimateTravelVocabularyTotalR1(fast.completedStages),
    ).toEqual(
      estimateTravelVocabularyTotalR1(ordinary.completedStages),
    )
  })
})
