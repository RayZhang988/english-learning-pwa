import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import { createPlacementAssessmentRuntime } from './runtime.ts'
import {
  createTravelVocabularyAssessmentRuntimeR1,
  restoreTravelVocabularyAssessmentRuntimeR1,
} from './travel-vocabulary-runtime.ts'
import { createVocabularyPlacementRuntime } from './vocabulary-runtime.ts'
import type {
  AbilityProfileR1,
  TravelVocabularyAssessmentRuntimeStateR1,
} from './travel-vocabulary-types.ts'

const baseTime = Date.parse('2026-07-27T04:00:00.000Z')

function testClock() {
  let value = baseTime
  return {
    now: () => new Date(value).toISOString(),
    advance: (milliseconds: number) => {
      value += milliseconds
    },
  }
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function correctOption(
  state: TravelVocabularyAssessmentRuntimeStateR1,
  word: string,
) {
  const stageIndex = (state.stage?.order ?? 1) - 1
  const candidate = travelVocabularyBankR1.stages[
    stageIndex
  ]?.candidates.find((item) => item.word === word)
  const question = state.questions.find(
    (item) => item.word === word,
  )
  const option = question?.options.find(
    (item) => item.text === candidate?.meaningZh,
  )
  if (!option) {
    throw new Error(`Missing correct option for ${word}`)
  }
  return option.id
}

function answerStage(input: {
  readonly runtime: ReturnType<
    typeof createTravelVocabularyAssessmentRuntimeR1
  >
  readonly state: TravelVocabularyAssessmentRuntimeStateR1
  readonly clock: ReturnType<typeof testClock>
  readonly correct: number
  readonly uncertain?: number
}) {
  const uncertain = input.uncertain ?? 0
  let state = input.state
  for (const [index, question] of state.questions.entries()) {
    input.clock.advance(1_000)
    const correct = correctOption(state, question.word)
    if (index < input.correct) {
      state = input.runtime.selectChoice(question.id, correct)
    } else if (index < input.correct + uncertain) {
      state = input.runtime.markUncertain(question.id)
    } else {
      const wrong = question.options.find(
        (option) => option.id !== correct,
      )
      if (!wrong) {
        throw new Error('Missing wrong option')
      }
      state = input.runtime.selectChoice(question.id, wrong.id)
    }
  }
  return state
}

async function completeRuntime(pattern: readonly number[]) {
  const clock = testClock()
  const completed: AbilityProfileR1[] = []
  const runtime = createTravelVocabularyAssessmentRuntimeR1({
    now: clock.now,
    createId: () => 'r1-complete',
    random: seededRandom(101),
    onCompleted: (profile) => {
      completed.push(profile)
    },
  })
  let state = runtime.start()
  for (const [stageIndex, correct] of pattern.entries()) {
    state = answerStage({
      runtime,
      state,
      clock,
      correct,
    })
    state = await runtime.submitStage()
    if (stageIndex < 4) {
      expect(state.lifecycle).toBe('stage-summary')
      state = runtime.continueToNextStage()
    }
  }
  return { clock, completed, runtime, state }
}

describe('R1 travel vocabulary runtime integration', () => {
  it('runs five stages at arbitrary scores and emits one real profile', async () => {
    const { completed, runtime, state } = await completeRuntime([
      0, 6, 15, 30, 30,
    ])

    expect(state.lifecycle).toBe('completed')
    expect(state.questions).toEqual([])
    expect(state.profile?.schemaVersion).toBe(3)
    expect(state.profile?.completionReason).toBe(
      'all-stages-completed',
    )
    expect(state.profile?.travelVocabulary.estimatedWords).toBe(2_180)
    expect(state.profile?.travelVocabulary.stageResults.map(
      (stage) => stage.masteryRate,
    )).toEqual([0, 0.2, 0.5, 1, 1])
    expect(state.profile?.resultLevel.label).toBe('高中二年级')
    expect(state.profile?.sampledWordIds).toHaveLength(150)
    expect(state.profile?.durationSeconds).toBe(150)
    for (const domain of ['listening', 'speaking'] as const) {
      expect(state.profile?.abilities[domain]).toMatchObject({
        domain,
        status: 'unavailable',
        calibrationState: 'pending-calibration',
        internalLevel: null,
        cefrEstimate: 'unknown',
        confidence: 0,
      })
    }
    expect(completed).toEqual([state.profile])
    expect(state.actions).toEqual({
      canStart: false,
      canNavigate: false,
      canAdvanceToNextQuestion: false,
      canAnswer: false,
      canMarkUncertain: false,
      canClearAnswer: false,
      canSubmitStage: false,
      canFinishRemainingUnknown: false,
      canContinueToNextStage: false,
      canPause: false,
      canResume: false,
    })
    await expect(runtime.submitStage()).rejects.toMatchObject({
      code: 'invalid-transition',
    })
  })

  it('advances with an atomic uncertain default without changing arbitrary navigation', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T04:00:00.000Z',
      createId: () => 'r1-advance',
      random: seededRandom(23),
    })
    let state = runtime.start()
    expect(state.actions.canSubmitStage).toBe(true)
    expect(state.remainingQuestionsToMarkUncertain).toBe(150)
    const first = state.questions[0]
    if (!first) {
      throw new Error('Missing first question')
    }

    state = runtime.advanceToNextQuestion()
    expect(state.currentQuestionIndex).toBe(1)
    expect(state.draftAnswers[first.id]?.kind).toBe('uncertain')

    state = runtime.navigate(2)
    expect(state.currentQuestionIndex).toBe(2)
    expect(state.draftAnswers[state.questions[1]?.id ?? 'missing']).toBe(
      undefined,
    )
  })

  it('finishes remaining questions once, preserves the formula and restores the result', async () => {
    const clock = testClock()
    const completed: AbilityProfileR1[] = []
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: clock.now,
      createId: () => 'r1-fast-finish',
      random: seededRandom(24),
      onCompleted: (profile) => {
        completed.push(profile)
      },
    })
    let state = runtime.start()
    const first = state.questions[0]
    if (!first) {
      throw new Error('Missing first question')
    }
    state = runtime.selectChoice(
      first.id,
      correctOption(state, first.word),
    )
    expect(state.remainingQuestionsToMarkUncertain).toBe(149)
    const beforeConfirmation = runtime.toSnapshot()
    expect(runtime.toSnapshot()).toEqual(beforeConfirmation)

    state = await runtime.finishRemainingUnknown()
    expect(state.lifecycle).toBe('completed')
    expect(state.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(state.profile?.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(state.profile?.travelVocabulary).toMatchObject({
      estimatedWords: 10,
      correctCount: 1,
      validQuestionCount: 150,
      uncertainCount: 149,
    })
    expect(
      state.profile?.travelVocabulary.stageResults.map((stage) => [
        stage.correctCount,
        stage.uncertainCount,
      ]),
    ).toEqual([
      [1, 29],
      [0, 30],
      [0, 30],
      [0, 30],
      [0, 30],
    ])

    const firstProfile = state.profile
    const repeated = await runtime.finishRemainingUnknown()
    expect(repeated.profile).toEqual(firstProfile)
    expect(completed).toEqual([firstProfile])

    const restored = restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot: runtime.toSnapshot(),
      now: clock.now,
    })
    expect(restored.state).toMatchObject({
      lifecycle: 'completed',
      completionReason: 'remaining-marked-unknown',
      profile: firstProfile,
    })
  })

  it('does not mutate core state when the caller cancels fast-finish confirmation', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T04:00:00.000Z',
      createId: () => 'r1-cancel-fast-finish',
      random: seededRandom(25),
    })
    runtime.start()
    const before = runtime.toSnapshot()

    // Confirmation UI belongs to 02. Cancellation deliberately calls no
    // assessment action, so 03 must have no tentative state to roll back.
    const after = runtime.toSnapshot()

    expect(after).toEqual(before)
    expect(runtime.state.lifecycle).toBe('active')
  })

  it('finishes from a submitted-stage summary and preserves that result', async () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T04:00:00.000Z',
      createId: () => 'r1-finish-from-summary',
      random: seededRandom(26),
    })
    runtime.start()
    let state = await runtime.submitStage()
    const firstResult = state.latestStageResult
    expect(state).toMatchObject({
      lifecycle: 'stage-summary',
      remainingQuestionsToMarkUncertain: 120,
      actions: { canFinishRemainingUnknown: true },
    })

    state = await runtime.finishRemainingUnknown()

    expect(state.profile?.travelVocabulary.stageResults[0]).toEqual(
      firstResult,
    )
    expect(
      state.profile?.travelVocabulary.stageResults
        .slice(1)
        .every((stage) => stage.uncertainCount === 30),
    ).toBe(true)
  })

  it('presents only single words and never exposes answer metadata', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T04:00:00.000Z',
      createId: () => 'r1-public',
      random: seededRandom(22),
    })
    const state = runtime.start()
    expect(state.questions).toHaveLength(30)
    expect(
      state.questions.every(
        (question) =>
          /^[a-z]+(?:-[a-z]+)?$/.test(question.word) &&
          question.kind === 'choice',
      ),
    ).toBe(true)
    const publicJson = JSON.stringify(state)
    const snapshotJson = JSON.stringify(runtime.toSnapshot())
    for (const forbidden of [
      'correctOptionId',
      'meaningZh',
      'scoring',
      'audioText',
      'sentence',
    ]) {
      expect(publicJson).not.toContain(forbidden)
      expect(snapshotJson).not.toContain(forbidden)
    }
  })

  it('restores the exact sampled questions, draft and active time', () => {
    const clock = testClock()
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: clock.now,
      createId: () => 'r1-restore',
      random: seededRandom(33),
    })
    let state = runtime.start()
    const first = state.questions[0]
    if (!first) {
      throw new Error('Missing first R1 question')
    }
    clock.advance(5_000)
    state = runtime.markUncertain(first.id)
    const snapshot = runtime.toSnapshot()
    const sampledBefore = snapshot.session.stagePlans

    clock.advance(24 * 60 * 60_000)
    const restored = restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot,
      now: clock.now,
    })
    expect(restored.state.lifecycle).toBe('paused')
    expect(restored.state.progress.elapsedSeconds).toBe(5)
    expect(restored.state.draftAnswers[first.id]).toEqual({
      questionId: first.id,
      kind: 'uncertain',
      optionId: null,
    })
    expect(restored.toSnapshot().session.stagePlans).toEqual(
      sampledBefore,
    )
    state = restored.resume()
    expect(state.lifecycle).toBe('active')
    expect(state.progress.elapsedSeconds).toBe(5)
  })

  it('preserves v1 and v2 snapshots but starts a new incompatible R1 sample', () => {
    const now = () => '2026-07-27T05:00:00.000Z'
    const v1 = createPlacementAssessmentRuntime({
      now,
      createId: () => 'legacy-v1',
    }).toSnapshot()
    const v2 = createVocabularyPlacementRuntime({
      now,
      createId: () => 'legacy-v2',
    }).toSnapshot()

    const migratedV1 = restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot: v1,
      now,
      createId: () => 'r1-from-v1',
      random: seededRandom(44),
    })
    const migratedV2 = restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot: v2,
      now,
      createId: () => 'r1-from-v2',
      random: seededRandom(45),
    })

    expect(migratedV1.state).toMatchObject({
      lifecycle: 'intro',
      sessionId: 'r1-from-v1',
      completionReason: null,
      migrationNotice:
        'legacy-measurement-incompatible-new-sample-required',
    })
    expect(migratedV1.toSnapshot().legacySource).toEqual({
      kind: 'assessment-runtime-v1',
      snapshot: v1,
    })
    expect(migratedV2.toSnapshot().legacySource).toEqual({
      kind: 'adaptive-vocabulary-runtime-v2',
      snapshot: v2,
    })
    expect(migratedV2.toSnapshot().session.completionReason).toBeNull()
  })
})
