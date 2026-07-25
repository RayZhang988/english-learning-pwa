import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  AssessmentRuntimeError,
  createPlacementAssessmentRuntime,
  restorePlacementAssessmentRuntime,
} from './runtime.ts'
import type {
  AbilityProfile,
  PublicAssessmentItem,
  SpeechObservation,
} from './types.ts'

const baseTime = Date.parse('2026-07-25T01:00:00.000Z')

function testClock() {
  let value = baseTime
  return {
    now: () => new Date(value).toISOString(),
    advance: (milliseconds: number) => {
      value += milliseconds
    },
  }
}

function privateItem(itemId: string) {
  const item = placementBankV1.items.find(
    (candidate) => candidate.id === itemId,
  )
  if (!item) {
    throw new Error(`Missing production item ${itemId}`)
  }
  return item
}

const strongSpeech: SpeechObservation = {
  status: 'scored',
  transcript: 'A complete and understandable response',
  metrics: {
    completeness: 0.95,
    intelligibility: 0.9,
    fluency: 0.85,
    languageControl: 0.85,
    taskCompletion: 0.9,
    recognitionConfidence: 0.9,
  },
}

async function answerCurrentCorrectly(
  runtime: ReturnType<typeof createPlacementAssessmentRuntime>,
  clock: ReturnType<typeof testClock>,
  item: PublicAssessmentItem,
) {
  clock.advance(item.expectedSeconds * 1000)
  if (item.kind === 'choice') {
    const scoringItem = privateItem(item.id)
    if (scoringItem.kind !== 'choice') {
      throw new Error('Expected a private choice item')
    }
    runtime.selectChoice(
      item.id,
      scoringItem.scoring.correctOptionId,
    )
    return runtime.submitChoice(item.id)
  }
  return runtime.submitSpeech(item.id, strongSpeech)
}

async function completeStrongAssessment(input?: {
  readonly onCompleted?: (profile: AbilityProfile) => void | Promise<void>
}) {
  const clock = testClock()
  const runtime = createPlacementAssessmentRuntime({
    now: clock.now,
    createId: () => 'runtime-complete',
    onCompleted: input?.onCompleted,
  })
  let state = await runtime.start()

  for (let step = 0; step < 40; step += 1) {
    if (state.lifecycle === 'completed') {
      return { runtime, state, clock }
    }
    if (state.lifecycle !== 'active' || !state.item) {
      throw new Error(`Unexpected lifecycle ${state.lifecycle}`)
    }
    state = await answerCurrentCorrectly(
      runtime,
      clock,
      state.item,
    )
    expect(state.lifecycle).toBe('feedback')
    state = await runtime.continue()
  }

  throw new Error('Assessment exceeded its item limits')
}

async function advanceToSpeaking(
  runtime: ReturnType<typeof createPlacementAssessmentRuntime>,
  clock: ReturnType<typeof testClock>,
) {
  let state = await runtime.start()
  for (let step = 0; step < 30; step += 1) {
    if (
      state.lifecycle === 'active' &&
      state.phase === 'speaking' &&
      state.item
    ) {
      return state
    }
    if (state.lifecycle !== 'active' || !state.item) {
      throw new Error('Assessment ended before speaking')
    }
    state = await answerCurrentCorrectly(
      runtime,
      clock,
      state.item,
    )
    state = await runtime.continue()
  }
  throw new Error('Assessment did not reach speaking')
}

describe('PlacementAssessmentRuntime integration', () => {
  it('runs the production bank from a new session to one real profile', async () => {
    const completed: AbilityProfile[] = []
    const { runtime, state } = await completeStrongAssessment({
      onCompleted: (profile) => {
        completed.push(profile)
      },
    })

    expect(state.lifecycle).toBe('completed')
    expect(state.profile).not.toBeNull()
    expect(state.profile?.schemaVersion).toBe(1)
    expect(state.profile?.assessmentId).toBe('runtime-complete')
    expect(state.profile?.bankId).toBe(placementBankV1.id)
    expect(state.profile?.durationSeconds).toBeGreaterThanOrEqual(
      15 * 60,
    )
    expect(state.profile?.durationSeconds).toBeLessThanOrEqual(
      20 * 60,
    )
    expect(state.profile?.abilities.vocabulary.internalLevel).not.toBeNull()
    expect(state.profile?.abilities.listening.internalLevel).not.toBeNull()
    expect(state.profile?.abilities.speaking.internalLevel).not.toBeNull()
    expect(completed).toEqual([state.profile])

    const serialized = JSON.stringify(runtime.toSnapshot())
    expect(serialized).not.toContain('correctOptionId')
    expect(serialized).not.toContain('"scoring"')
  })

  it('restores an active snapshot as paused without counting offline time', async () => {
    const clock = testClock()
    const runtime = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'runtime-resume',
    })
    let state = await runtime.start()
    if (!state.item || state.item.kind !== 'choice') {
      throw new Error('Expected the first placement item to be a choice')
    }
    const firstItemId = state.item.id
    const scoringItem = privateItem(firstItemId)
    if (scoringItem.kind !== 'choice') {
      throw new Error('Expected private choice item')
    }

    clock.advance(25_000)
    runtime.selectChoice(
      firstItemId,
      scoringItem.scoring.correctOptionId,
    )
    const snapshot = runtime.toSnapshot()
    expect(snapshot.activeElapsedMs).toBe(25_000)

    clock.advance(24 * 60 * 60_000)
    const restored = restorePlacementAssessmentRuntime({
      snapshot,
      now: clock.now,
    })
    expect(restored.state.lifecycle).toBe('paused')
    expect(restored.state.progress.elapsedSeconds).toBe(25)
    expect(restored.state.selectedOptionId).toBe(
      scoringItem.scoring.correctOptionId,
    )

    state = await restored.resume()
    expect(state.lifecycle).toBe('active')
    expect(state.progress.elapsedSeconds).toBe(25)
    clock.advance(5_000)
    state = await restored.submitChoice(firstItemId)
    expect(state.lifecycle).toBe('feedback')
    expect(state.progress.elapsedSeconds).toBe(30)
  })

  it('reports recognition failures as unscorable with playback fallback', async () => {
    const clock = testClock()
    const runtime = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'runtime-recognition-failure',
    })
    let state = await advanceToSpeaking(runtime, clock)

    for (let failure = 0; failure < 2; failure += 1) {
      const item = state.item
      if (!item || item.kind !== 'speech') {
        throw new Error('Expected a speech item')
      }
      clock.advance(15_000)
      state = await runtime.reportRecognitionFailure(item.id, {
        status: 'unscorable',
        reason: 'recognition-failed',
        recordingAvailable: true,
      })
      expect(state.lifecycle).toBe('feedback')
      expect(state.lastSubmission).toMatchObject({
        itemId: item.id,
        status: 'unscorable',
        failureReason: 'recognition-failed',
        fallback: 'recording-playback',
      })
      state = await runtime.continue()
    }

    expect(state.lifecycle).toBe('completed')
    expect(state.profile?.outcome).toBe('partial')
    expect(state.profile?.abilities.speaking.status).toBe('unavailable')
    expect(state.profile?.abilities.speaking.internalLevel).toBeNull()
  })

  it('rejects duplicate and stale submissions without adding evidence', async () => {
    const clock = testClock()
    const runtime = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'runtime-duplicate',
    })
    let state = await runtime.start()
    const item = state.item
    if (!item || item.kind !== 'choice') {
      throw new Error('Expected a choice item')
    }
    const scoringItem = privateItem(item.id)
    if (scoringItem.kind !== 'choice') {
      throw new Error('Expected private choice item')
    }
    runtime.selectChoice(item.id, scoringItem.scoring.correctOptionId)
    clock.advance(10_000)
    state = await runtime.submitChoice(item.id)
    const responseCount = runtime.toSnapshot().session.responses.length

    await expect(runtime.submitChoice(item.id)).rejects.toMatchObject({
      code: 'invalid-transition',
    })
    expect(runtime.toSnapshot().session.responses).toHaveLength(
      responseCount,
    )

    state = await runtime.continue()
    expect(state.item?.id).not.toBe(item.id)
    await expect(runtime.skip(item.id)).rejects.toMatchObject({
      code: 'stale-item',
    })
  })

  it('supports explicit skip and exposes it without leaking correctness', async () => {
    const clock = testClock()
    const runtime = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'runtime-skip',
    })
    const active = await runtime.start()
    if (!active.item) {
      throw new Error('Expected a placement item')
    }

    clock.advance(8_000)
    const feedback = await runtime.skip(active.item.id)
    expect(feedback.lifecycle).toBe('feedback')
    expect(feedback.lastSubmission).toEqual({
      itemId: active.item.id,
      status: 'skipped',
      failureReason: 'user-skipped',
      fallback: null,
    })
    expect(feedback).not.toHaveProperty('score')
  })

  it('finishes the current item then hard-stops at twenty active minutes', async () => {
    const clock = testClock()
    const runtime = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'runtime-time-limit',
    })
    let state = await runtime.start()
    const item = state.item
    if (!item || item.kind !== 'choice') {
      throw new Error('Expected a choice item')
    }
    const scoringItem = privateItem(item.id)
    if (scoringItem.kind !== 'choice') {
      throw new Error('Expected private choice item')
    }

    runtime.selectChoice(item.id, scoringItem.scoring.correctOptionId)
    clock.advance(20 * 60_000)
    state = await runtime.submitChoice(item.id)
    expect(state.lifecycle).toBe('feedback')
    state = await runtime.continue()

    expect(state.lifecycle).toBe('completed')
    expect(state.profile?.outcome).toBe('partial')
    expect(state.profile?.durationSeconds).toBe(20 * 60)
  })

  it('does not allow actions after completion', async () => {
    const { runtime, state } = await completeStrongAssessment()
    expect(state.lifecycle).toBe('completed')

    await expect(runtime.continue()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
    await expect(runtime.start()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
    await expect(runtime.stop()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
  })
})
