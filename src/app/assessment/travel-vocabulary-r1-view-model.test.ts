import { describe, expect, it } from 'vitest'
import {
  createTravelVocabularyAssessmentRuntimeR1,
  type TravelVocabularyAssessmentRuntimeR1,
} from '../../features/assessment/index.ts'
import {
  toTravelVocabularyR1FinishConfirmationViewModel,
  toTravelVocabularyR1QuestionViewModel,
  toTravelVocabularyR1ResultsViewModel,
  toTravelVocabularyR1StageResultViewModel,
  toTravelVocabularyR1StageReviewViewModel,
} from './travel-vocabulary-r1-view-model.ts'

function createRuntime(): TravelVocabularyAssessmentRuntimeR1 {
  return createTravelVocabularyAssessmentRuntimeR1({
    now: () => '2026-07-27T08:00:00.000Z',
    createId: () => 'r1-view-model',
    random: () => 0.42,
  })
}

describe('R1 assessment application view models', () => {
  it('maps the public question, draft, navigation and review state without leaking an answer key', () => {
    const runtime = createRuntime()
    let state = runtime.start()
    const first = state.questions[0]
    state = runtime.selectChoice(first.id, first.options[1].id)
    state = runtime.navigate(1)
    const second = state.questions[1]
    state = runtime.markUncertain(second.id)

    const question = toTravelVocabularyR1QuestionViewModel(state)
    const review = toTravelVocabularyR1StageReviewViewModel(state)

    expect(question.question.index).toBe(1)
    expect(question.question.id).toBe(second.id)
    expect(question.question.answerState).toBe('uncertain')
    expect(question.question.options).toHaveLength(4)
    expect(question.questionMap[0]?.answerState).toBe('answered')
    expect(question.questionMap[1]?.answerState).toBe('uncertain')
    expect(review.unansweredQuestions).toHaveLength(28)
    expect(review.unansweredCountLabel).toBe(
      '还有 28 题未答，提交后将按不会记录',
    )
    expect(review.submitAction.disabled).toBe(false)
    expect(review.finishRemainingAction?.disabled).toBe(false)
    expect(JSON.stringify({ question, review })).not.toMatch(
      /correctOptionId|meaningZh|wordId|scoring/u,
    )
  })

  it('maps atomic next-question availability and the runtime-owned early-finish count', () => {
    const runtime = createRuntime()
    const state = runtime.start()

    const question = toTravelVocabularyR1QuestionViewModel(state)
    const confirmation =
      toTravelVocabularyR1FinishConfirmationViewModel(state)

    expect(question.nextAction.disabled).toBe(false)
    expect(confirmation.remainingQuestionCountLabel).toBe('150 题')
    expect(confirmation.confirmAction.disabled).toBe(false)
  })

  it('keeps a zero-score stage eligible for the next stage', async () => {
    const runtime = createRuntime()
    let state = runtime.start()
    for (const question of state.questions) {
      state = runtime.markUncertain(question.id)
    }
    state = await runtime.submitStage()

    const viewModel = toTravelVocabularyR1StageResultViewModel(state)
    expect(viewModel.correctCountLabel).toBe('0 / 30')
    expect(viewModel.masteryRateLabel).toBe('0%')
    expect(viewModel.continueAction.disabled).toBe(false)
  })

  it('maps the completed schema 3 profile and leaves listening and speaking pending calibration', async () => {
    const runtime = createRuntime()
    let state = runtime.start()
    for (let stage = 0; stage < 5; stage += 1) {
      for (const question of state.questions) {
        state = runtime.markUncertain(question.id)
      }
      state = await runtime.submitStage()
      if (stage < 4) {
        state = runtime.continueToNextStage()
      }
    }
    if (!state.profile) {
      throw new Error('Expected a completed R1 profile.')
    }

    const results = toTravelVocabularyR1ResultsViewModel(
      state.profile,
    )
    expect(results.stageResults).toHaveLength(5)
    expect(results.answeredCountLabel).toBe('150 题')
    expect(results.listeningCalibrationLabel).toBe('待校准')
    expect(results.speakingCalibrationLabel).toBe('待校准')
    expect(results.disclaimer).toContain('估算')
    expect(results.levelDisclaimer).not.toContain('通过官方')
  })
})
