import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../content/assessment/travel-vocabulary-bank.r1.ts'
import {
  createTravelVocabularyAssessmentRuntimeR1,
  restoreTravelVocabularyAssessmentRuntimeR1,
  type TravelVocabularyAssessmentRuntimeStateR1,
} from '../../src/features/assessment/index.ts'

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value =
      (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function correctOptionId(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  questionIndex: number,
) {
  const question = state.questions[questionIndex]
  const stageIndex = (state.stage?.order ?? 1) - 1
  const candidate = travelVocabularyBankR1.stages[
    stageIndex
  ]?.candidates.find((item) => item.word === question?.word)
  const option = question?.options.find(
    (item) => item.text === candidate?.meaningZh,
  )
  if (!question || !option) {
    throw new TypeError('R1 QA oracle could not resolve the answer.')
  }
  return { question, optionId: option.id }
}

describe('R1 fast unknown public acceptance', () => {
  it('atomically marks an unanswered next question as uncertain while arbitrary navigation remains non-mutating', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T12:00:00.000Z',
      createId: () => 'qa-r1-atomic-next',
      random: seededRandom(901),
    })
    let state = runtime.start()
    const firstQuestion = state.questions[0]
    const secondQuestion = state.questions[1]
    expect(firstQuestion).toBeDefined()
    expect(secondQuestion).toBeDefined()

    state = runtime.advanceToNextQuestion()
    expect(state.currentQuestionIndex).toBe(1)
    expect(state.draftAnswers[firstQuestion!.id]?.kind).toBe(
      'uncertain',
    )

    state = runtime.navigate(2)
    expect(state.currentQuestionIndex).toBe(2)
    expect(state.draftAnswers[secondQuestion!.id]).toBeUndefined()
  })

  it('submits a partially answered stage as 30 valid questions without fabricating correct answers', async () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T12:05:00.000Z',
      createId: () => 'qa-r1-partial-submit',
      random: seededRandom(902),
    })
    let state = runtime.start()
    const first = correctOptionId(state, 0)
    state = runtime.selectChoice(first.question.id, first.optionId)
    expect(state.actions.canSubmitStage).toBe(true)

    state = await runtime.submitStage()

    expect(state.lifecycle).toBe('stage-summary')
    expect(state.latestStageResult).toMatchObject({
      validQuestionCount: 30,
      correctCount: 1,
      uncertainCount: 29,
    })
  })

  it('finishes all five stages once, preserves existing evidence, and distinguishes the completion reason', async () => {
    const completedProfileIds: string[] = []
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T12:10:00.000Z',
      createId: () => 'qa-r1-finish-remaining',
      random: seededRandom(903),
      onCompleted: (profile) => {
        completedProfileIds.push(profile.profileId)
      },
    })
    let state = runtime.start()
    const first = correctOptionId(state, 0)
    state = runtime.selectChoice(first.question.id, first.optionId)
    const beforeConfirmation = runtime.toSnapshot()

    expect(runtime.toSnapshot()).toEqual(beforeConfirmation)
    state = await runtime.finishRemainingUnknown()

    expect(state.lifecycle).toBe('completed')
    expect(state.completionReason).toBe('remaining-marked-unknown')
    expect(state.profile).toMatchObject({
      completionReason: 'remaining-marked-unknown',
      travelVocabulary: {
        validQuestionCount: 150,
        correctCount: 1,
        uncertainCount: 149,
      },
    })
    expect(state.profile?.travelVocabulary.stageResults).toHaveLength(5)

    const repeated = await runtime.finishRemainingUnknown()
    expect(repeated.profile).toEqual(state.profile)
    expect(completedProfileIds).toEqual([state.profile?.profileId])
  })

  it('restores a pre-patch active schema-3 snapshot without rewriting its missing completion reason into a score', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T12:15:00.000Z',
      createId: () => 'qa-r1-legacy-schema3',
      random: seededRandom(904),
    })
    const started = runtime.start()
    const firstQuestion = started.questions[0]
    expect(firstQuestion).toBeDefined()
    runtime.advanceToNextQuestion()
    const snapshot = structuredClone(runtime.toSnapshot())
    const legacySession = {
      ...snapshot.session,
    } as Partial<typeof snapshot.session>
    delete legacySession.completionReason
    const legacySnapshot = {
      ...snapshot,
      session: legacySession,
    }

    const restored = restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot: legacySnapshot,
      now: () => '2026-07-27T12:16:00.000Z',
    })

    expect(restored.state.lifecycle).toBe('paused')
    expect(restored.state.completionReason).toBeNull()
    expect(
      restored.state.draftAnswers[firstQuestion!.id]?.kind,
    ).toBe('uncertain')
    expect(restored.state.profile).toBeNull()
  })
})
